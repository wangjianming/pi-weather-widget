import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { WeatherSnapshot } from "./types.ts";

export const CACHE_MAX_AGE_MS = 3 * 60 * 60 * 1_000;
export const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.trim().length > 0);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseIsoTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString() === value ? timestamp : undefined;
}

export function isWeatherSnapshot(value: unknown): value is WeatherSnapshot {
  if (!isRecord(value) || !isRecord(value.location) || !isRecord(value.weather)) return false;
  const { location, weather } = value;

  return (
    parseIsoTimestamp(value.fetchedAt) !== undefined &&
    isOptionalText(location.city) &&
    isOptionalText(location.region) &&
    isOptionalText(location.country) &&
    typeof location.displayName === "string" &&
    location.displayName.trim().length > 0 &&
    isOptionalText(location.timezone) &&
    isFiniteNumber(location.latitude) &&
    location.latitude >= -90 &&
    location.latitude <= 90 &&
    isFiniteNumber(location.longitude) &&
    location.longitude >= -180 &&
    location.longitude <= 180 &&
    isFiniteNumber(weather.temperatureC) &&
    isFiniteNumber(weather.apparentTemperatureC) &&
    isFiniteNumber(weather.relativeHumidityPercent) &&
    weather.relativeHumidityPercent >= 0 &&
    weather.relativeHumidityPercent <= 100 &&
    isFiniteNumber(weather.weatherCode) &&
    Number.isInteger(weather.weatherCode) &&
    weather.weatherCode >= 0 &&
    isFiniteNumber(weather.windSpeedKmh) &&
    weather.windSpeedKmh >= 0 &&
    isOptionalText(weather.observedAt)
  );
}

export function cacheAgeMs(snapshot: WeatherSnapshot, nowMs: number): number | undefined {
  if (!isWeatherSnapshot(snapshot) || !Number.isFinite(nowMs)) return undefined;
  const fetchedAtMs = parseIsoTimestamp(snapshot.fetchedAt);
  if (fetchedAtMs === undefined) return undefined;
  const futureSkew = fetchedAtMs - nowMs;
  if (futureSkew > FUTURE_CLOCK_SKEW_MS) return undefined;
  return Math.max(0, nowMs - fetchedAtMs);
}

export function isFreshSnapshot(snapshot: WeatherSnapshot, nowMs: number): boolean {
  const age = cacheAgeMs(snapshot, nowMs);
  return age !== undefined && age < CACHE_MAX_AGE_MS;
}

export function resolveCachePath(
  env: Record<string, string | undefined> = process.env,
  homeDirectory = homedir(),
): string {
  const configRoot = env.PI_CODING_AGENT_DIR?.trim() || join(homeDirectory, ".pi", "agent");
  return join(configRoot, "cache", "weather-widget.json");
}

export async function removeCache(cachePath: string): Promise<void> {
  await rm(cachePath, { force: true });
}

export async function readFreshCache(
  cachePath: string,
  nowMs: number,
): Promise<WeatherSnapshot | undefined> {
  let raw: string;
  try {
    raw = await readFile(cachePath, "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await removeCache(cachePath).catch(() => undefined);
    return undefined;
  }

  if (!isWeatherSnapshot(parsed) || !isFreshSnapshot(parsed, nowMs)) {
    await removeCache(cachePath).catch(() => undefined);
    return undefined;
  }
  return parsed;
}

export async function writeCacheAtomic(
  cachePath: string,
  snapshot: WeatherSnapshot,
): Promise<void> {
  const directory = dirname(cachePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(cachePath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, cachePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}
