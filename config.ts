import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import { normalizeTerminalSafeText, type LocationInfo, type WeatherSnapshot } from "./types.ts";
import { DEFAULT_MODEL_ID, isSupportedModelId } from "./models.ts";

export interface WeatherWidgetConfig {
  location?: LocationInfo;
  model?: string;
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

export function isWeatherWidgetConfig(value: unknown): value is WeatherWidgetConfig {
  if (!isRecord(value)) return false;
  if (value.location !== undefined && !isFixedLocation(value.location)) return false;
  if (value.model !== undefined && !isSupportedModelId(value.model)) return false;
  return true;
}

export function resolveConfigPath(
  env: Record<string, string | undefined> = process.env,
  homeDirectory = homedir(),
): string {
  const configRoot = env.PI_CODING_AGENT_DIR?.trim() || join(homeDirectory, ".pi", "agent");
  return join(configRoot, "weather-widget.json");
}

export async function readWeatherConfig(
  configPath: string,
): Promise<WeatherWidgetConfig | undefined> {
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

  return isWeatherWidgetConfig(parsed) ? parsed : undefined;
}

export async function writeWeatherConfig(
  configPath: string,
  config: WeatherWidgetConfig,
): Promise<void> {
  const directory = dirname(configPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(configPath)}.${process.pid}.${randomUUID()}.tmp`,
  );

  const normalized: WeatherWidgetConfig = {};
  if (config.location !== undefined) normalized.location = config.location;
  if (config.model !== undefined) normalized.model = config.model;

  try {
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, configPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/** 清除固定位置，但保留气象模型配置。 */
export async function clearLocationFromConfig(configPath: string): Promise<void> {
  const existing = await readWeatherConfig(configPath);
  if (existing?.model !== undefined) {
    await writeWeatherConfig(configPath, { model: existing.model });
  } else {
    await rm(configPath, { force: true });
  }
}

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

export function isCacheUsable(
  snapshot: WeatherSnapshot,
  fixedLocation: LocationInfo | undefined,
  model: string | undefined,
): boolean {
  const snapshotModel = snapshot.model ?? DEFAULT_MODEL_ID;
  if (snapshotModel !== (model ?? DEFAULT_MODEL_ID)) return false;

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
