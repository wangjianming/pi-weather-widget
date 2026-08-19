import type { WeatherSnapshot } from "./types.ts";
import { getWeatherPresentation, type WeatherFamily } from "./weather-codes.ts";

export type TemperatureBand =
  | "ice"
  | "cool"
  | "comfortable"
  | "warm"
  | "hot"
  | "extreme";
export type ForegroundRole =
  | "text"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "muted"
  | "dim";
export type BackgroundRole =
  | "selectedBg"
  | "toolSuccessBg"
  | "toolPendingBg"
  | "toolErrorBg"
  | "customMessageBg";

export interface WeatherTheme {
  fg(role: ForegroundRole, text: string): string;
  bg(role: BackgroundRole, text: string): string;
  bold(text: string): string;
}

export interface TextMetrics {
  visibleWidth(text: string): number;
  truncateToWidth(text: string, width: number, ellipsis?: string): string;
}

interface Visibility {
  wind: boolean;
  humidity: boolean;
  feels: boolean;
  description: boolean;
}

const visibilityCandidates: Visibility[] = [
  { wind: true, humidity: true, feels: true, description: true },
  { wind: false, humidity: true, feels: true, description: true },
  { wind: false, humidity: false, feels: true, description: true },
  { wind: false, humidity: false, feels: false, description: true },
  { wind: false, humidity: false, feels: false, description: false },
];

export function temperatureBand(temperatureC: number): TemperatureBand {
  const displayed = Math.round(temperatureC);
  if (displayed <= 0) return "ice";
  if (displayed <= 15) return "cool";
  if (displayed <= 25) return "comfortable";
  if (displayed <= 32) return "warm";
  if (displayed <= 37) return "hot";
  return "extreme";
}

function pill(
  text: string,
  theme: WeatherTheme,
  foreground: ForegroundRole,
  background: BackgroundRole,
  bold = false,
): string {
  const padded = ` ${text} `;
  const colored = theme.fg(foreground, bold ? theme.bold(padded) : padded);
  return theme.bg(background, colored);
}

function temperatureStyle(band: TemperatureBand): {
  foreground: ForegroundRole;
  background: BackgroundRole;
  bold: boolean;
} {
  switch (band) {
    case "ice":
    case "cool":
      return { foreground: "accent", background: "selectedBg", bold: false };
    case "comfortable":
      return { foreground: "success", background: "toolSuccessBg", bold: false };
    case "warm":
      return { foreground: "warning", background: "toolPendingBg", bold: false };
    case "hot":
      return { foreground: "warning", background: "toolPendingBg", bold: true };
    case "extreme":
      return { foreground: "error", background: "toolErrorBg", bold: true };
  }
}

function locationForeground(family: WeatherFamily): ForegroundRole {
  switch (family) {
    case "clear":
      return "warning";
    case "rain":
      return "accent";
    case "snow":
      return "accent";
    case "thunder":
      return "error";
    case "cloud":
      return "muted";
    case "fog":
      return "dim";
    case "unknown":
      return "muted";
  }
}

function composeLine(
  snapshot: WeatherSnapshot,
  stale: boolean,
  theme: WeatherTheme,
  visibility: Visibility,
  locationName: string,
  includeStaleWarning: boolean,
): string {
  const presentation = getWeatherPresentation(snapshot.weather.weatherCode);
  const temperature = Math.round(snapshot.weather.temperatureC);
  const apparent = Math.round(snapshot.weather.apparentTemperatureC);
  const humidity = Math.round(
    Math.min(100, Math.max(0, snapshot.weather.relativeHumidityPercent)),
  );
  const wind = Math.round(snapshot.weather.windSpeedKmh);
  const style = temperatureStyle(temperatureBand(snapshot.weather.temperatureC));

  const segments = [
    pill(
      `${presentation.symbol} ${locationName}`,
      theme,
      locationForeground(presentation.family),
      "customMessageBg",
      true,
    ),
    pill(`${temperature}°C`, theme, style.foreground, style.background, style.bold),
  ];

  if (visibility.feels) {
    segments.push(pill(`体感 ${apparent}°C`, theme, "muted", "customMessageBg"));
  }
  const details: string[] = [];
  if (visibility.description) {
    details.push(presentation.description);
  }
  if (visibility.humidity) {
    details.push(`湿度 ${humidity}%`);
  }
  if (visibility.wind) {
    details.push(`风速 ${wind} km/h`);
  }
  if (details.length > 0) {
    segments.push(pill(details.join(" · "), theme, "muted", "customMessageBg"));
  }
  if (stale && includeStaleWarning) {
    segments.push(pill("⚠ 数据已过期", theme, "warning", "toolPendingBg"));
  }
  return segments.join(" ");
}

export function renderWeatherLine(
  snapshot: WeatherSnapshot,
  stale: boolean,
  theme: WeatherTheme,
  metrics: TextMetrics,
  width: number,
): string {
  const safeWidth = Math.max(0, width);
  for (const visibility of visibilityCandidates) {
    const line = composeLine(
      snapshot,
      stale,
      theme,
      visibility,
      snapshot.location.displayName,
      true,
    );
    if (metrics.visibleWidth(line) <= safeWidth) return line;
  }

  const minimum = visibilityCandidates[visibilityCandidates.length - 1]!;
  const originalName = snapshot.location.displayName;
  for (const includeWarning of stale ? [true, false] : [false]) {
    for (
      let nameWidth = metrics.visibleWidth(originalName);
      nameWidth >= 1;
      nameWidth -= 1
    ) {
      const shortenedName = metrics.truncateToWidth(originalName, nameWidth, "…");
      const line = composeLine(
        snapshot,
        stale,
        theme,
        minimum,
        shortenedName,
        includeWarning,
      );
      if (metrics.visibleWidth(line) <= safeWidth) return line;
    }
  }

  const finalLine = composeLine(snapshot, false, theme, minimum, "", false);
  return metrics.truncateToWidth(finalLine, safeWidth, "");
}
