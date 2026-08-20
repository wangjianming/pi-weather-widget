import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { normalizeTerminalSafeText, type LocationInfo, type WeatherSnapshot } from "./types.ts";

export interface LocationConfig {
  location: LocationInfo;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFixedLocation(value: unknown): value is LocationInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value.displayName === "string" &&
    normalizeTerminalSafeText(value.displayName) !== undefined &&
    isFiniteNumber(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    isFiniteNumber(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    (value.timezone === undefined || normalizeTerminalSafeText(value.timezone) !== undefined) &&
    (value.city === undefined || normalizeTerminalSafeText(value.city) !== undefined) &&
    (value.region === undefined || normalizeTerminalSafeText(value.region) !== undefined) &&
    (value.country === undefined || normalizeTerminalSafeText(value.country) !== undefined)
  );
}

export function isLocationConfig(value: unknown): value is LocationConfig {
  return isRecord(value) && isFixedLocation(value.location);
}

export function resolveConfigPath(
  env: Record<string, string | undefined> = process.env,
  homeDirectory = homedir(),
): string {
  const configRoot = env.PI_CODING_AGENT_DIR?.trim() || join(homeDirectory, ".pi", "agent");
  return join(configRoot, "weather-widget.json");
}

export async function readLocationConfig(
  configPath: string,
): Promise<LocationConfig | undefined> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  return isLocationConfig(parsed) ? parsed : undefined;
}

export async function writeLocationConfig(
  configPath: string,
  location: LocationInfo,
): Promise<void> {
  const directory = dirname(configPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(configPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  const config: LocationConfig = { location };
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, configPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function clearLocationConfig(configPath: string): Promise<void> {
  await rm(configPath, { force: true });
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isCacheUsable(
  snapshot: WeatherSnapshot,
  fixedLocation: LocationInfo | undefined,
): boolean {
  const source = snapshot.location.source;
  if (fixedLocation) {
    return (
      source === "manual" &&
      rounded(snapshot.location.latitude) === rounded(fixedLocation.latitude) &&
      rounded(snapshot.location.longitude) === rounded(fixedLocation.longitude)
    );
  }
  return source !== "manual";
}
