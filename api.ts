import {
  normalizeTerminalSafeText,
  type CurrentWeather,
  type FetchLike,
  type LocationInfo,
  type WeatherSnapshot,
} from "./types.ts";

export const IPWHOIS_URL =
  "https://ipwho.is/?lang=zh-CN&fields=success,message,city,region,country,latitude,longitude,timezone";
export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

const CURRENT_FIELDS = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "weather_code",
  "wind_speed_10m",
].join(",");

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalText(value: unknown): string | undefined {
  return normalizeTerminalSafeText(value);
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function parentAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

async function requestJson(
  url: string,
  fetchImpl: FetchLike,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentAbortReason(parentSignal!));

  if (parentSignal?.aborted) {
    controller.abort(parentAbortReason(parentSignal));
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timeout = setTimeout(
    () => controller.abort(new Error(`request timed out after ${timeoutMs}ms`)),
    timeoutMs,
  );

  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export function parseLocation(payload: unknown): LocationInfo {
  const root = asRecord(payload, "IPWhois response");
  if (root.success !== true) {
    throw new Error(optionalText(root.message) ?? "IPWhois lookup failed");
  }

  const latitude = finiteNumber(root.latitude, "latitude");
  const longitude = finiteNumber(root.longitude, "longitude");
  if (latitude < -90 || latitude > 90) throw new Error("latitude is out of range");
  if (longitude < -180 || longitude > 180) throw new Error("longitude is out of range");

  const city = optionalText(root.city);
  const region = optionalText(root.region);
  const country = optionalText(root.country);
  const displayName = city ?? region ?? country;
  if (!displayName) throw new Error("display location is missing");

  let timezone: string | undefined;
  if (root.timezone !== undefined) {
    timezone = optionalText(asRecord(root.timezone, "timezone").id);
  }

  return { city, region, country, latitude, longitude, timezone, displayName };
}

export function parseCurrentWeather(payload: unknown): CurrentWeather {
  const root = asRecord(payload, "Open-Meteo response");
  const current = asRecord(root.current, "current weather");
  const temperatureC = finiteNumber(current.temperature_2m, "temperature_2m");
  const apparentTemperatureC = finiteNumber(
    current.apparent_temperature,
    "apparent_temperature",
  );
  const relativeHumidityPercent = finiteNumber(
    current.relative_humidity_2m,
    "relative_humidity_2m",
  );
  const weatherCode = finiteNumber(current.weather_code, "weather_code");
  const windSpeedKmh = finiteNumber(current.wind_speed_10m, "wind_speed_10m");

  if (relativeHumidityPercent < 0 || relativeHumidityPercent > 100) {
    throw new Error("relative_humidity_2m is out of range");
  }
  if (!Number.isInteger(weatherCode) || weatherCode < 0) {
    throw new Error("weather_code must be a non-negative integer");
  }
  if (windSpeedKmh < 0) throw new Error("wind_speed_10m is out of range");

  return {
    temperatureC,
    apparentTemperatureC,
    relativeHumidityPercent,
    weatherCode,
    windSpeedKmh,
    observedAt: optionalText(current.time),
  };
}

export function buildWeatherUrl(latitude: number, longitude: number): string {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("current", CURRENT_FIELDS);
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "kmh");
  url.searchParams.set("timezone", "auto");
  return url.toString();
}

export interface FetchWeatherSnapshotOptions {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
  now?: () => Date;
}

export async function fetchWeatherSnapshot(
  options: FetchWeatherSnapshotOptions = {},
): Promise<WeatherSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());

  const location = parseLocation(
    await requestJson(IPWHOIS_URL, fetchImpl, options.signal, timeoutMs),
  );
  const weather = parseCurrentWeather(
    await requestJson(
      buildWeatherUrl(location.latitude, location.longitude),
      fetchImpl,
      options.signal,
      timeoutMs,
    ),
  );

  return { location, weather, fetchedAt: now().toISOString() };
}
