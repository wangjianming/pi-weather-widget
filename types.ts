export const TERMINAL_CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/u;

export function normalizeTerminalSafeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length === 0 || TERMINAL_CONTROL_CHARACTERS.test(text)) return undefined;
  return text;
}

export type LocationSource = "ip" | "manual";

export interface LocationInfo {
  city?: string;
  region?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  displayName: string;
  source?: LocationSource;
}

export interface CurrentWeather {
  temperatureC: number;
  apparentTemperatureC: number;
  relativeHumidityPercent: number;
  weatherCode: number;
  windSpeedKmh: number;
  observedAt?: string;
}

export interface WeatherSnapshot {
  location: LocationInfo;
  weather: CurrentWeather;
  fetchedAt: string;
  /** 生成本快照的 Open-Meteo 模型 ID（旧缓存可能缺失，按 best_match 处理）。 */
  model?: string;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;
