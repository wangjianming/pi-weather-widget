# Pi IP Weather Widget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a global Pi extension that resolves the current public IP to coordinates, fetches current weather, and non-blockingly displays a responsive colored label widget above Pi's editor.

**Architecture:** Keep network parsing, cache persistence, weather presentation, and lifecycle orchestration in separate modules with dependency injection at their boundaries. `index.ts` is a thin Pi adapter; `WeatherRuntime` owns refresh/expiry state; all other behavior is testable with Node's built-in test runner without loading Pi.

**Tech Stack:** Pi extension API, TypeScript loaded by Pi/jiti, Node.js 24 built-ins (`fetch`, `node:test`, `node:fs/promises`), IPWhois, Open-Meteo, `@earendil-works/pi-tui` width utilities.

## Global Constraints

- Install globally at `C:\Users\I\.pi\agent\extensions\weather-widget`.
- Run network and UI behavior only in Pi TUI mode.
- Do not block `session_start`, editor input, or conversation on cache or network work.
- Query IPWhois and then Open-Meteo on startup and every 30 minutes.
- Give each external request an independent 10-second timeout.
- Permit at most one complete refresh at a time.
- Treat a snapshot as displayable only while its age is strictly less than three hours; hide it at exactly three hours.
- If no valid snapshot exists, render nothing and emit no notification, dialog, status, loading text, or visible error.
- If refresh fails while a valid snapshot exists, preserve it and append `⚠ 数据已过期` without extending its lifetime.
- Use no API key, telemetry, manual location setting, settings UI, slash command, runtime npm dependency, or Nerd Font glyph.
- Respect `PI_CODING_AGENT_DIR` for the cache root and default to `~/.pi/agent`.
- Use Pi theme roles rather than hard-coded RGB colors.
- Keep the widget to one responsive line above the editor.
- Use Node 24's built-in test runner; ordinary automated tests must not call live APIs.

---

## File Map

- Create `package.json`: test commands and Node version contract; no dependencies.
- Create `types.ts`: location, weather, snapshot, and fetch contracts shared by all modules.
- Create `api.ts`: URL construction, timeout/abort handling, response validation, and the IP-to-weather chain.
- Create `cache.ts`: cache path resolution, shape/age validation, atomic persistence, and deletion.
- Create `weather-codes.ts`: complete WMO-code-to-Chinese-label/symbol mapping.
- Create `formatter.ts`: temperature bands, themed label composition, numeric formatting, and responsive field removal.
- Create `runtime.ts`: non-blocking startup, refresh exclusion, stale state, exact expiry, timers, and shutdown.
- Create `index.ts`: Pi lifecycle and `setWidget` adapter.
- Create `tests/fixtures.ts`: deterministic valid snapshot fixture.
- Create `tests/api.test.ts`: API and abort/timeout tests.
- Create `tests/cache.test.ts`: cache lifetime and atomic persistence tests.
- Create `tests/formatter.test.ts`: weather mapping, color band, and width degradation tests.
- Create `tests/lifecycle.test.ts`: runtime scheduling, concurrency, stale, expiry, and disposal tests.
- Create `README.md`: behavior, data sources, privacy, cache policy, and verification commands.

---

### Task 1: Core contracts and the IP-to-weather API chain

**Files:**
- Create: `package.json`
- Create: `types.ts`
- Create: `tests/fixtures.ts`
- Create: `tests/api.test.ts`
- Create: `api.ts`

**Interfaces:**
- Produces: `LocationInfo`, `CurrentWeather`, `WeatherSnapshot`, and `FetchLike` from `types.ts`.
- Produces: `buildWeatherUrl(latitude, longitude): string`.
- Produces: `parseLocation(payload): LocationInfo` and `parseCurrentWeather(payload): CurrentWeather`.
- Produces: `fetchWeatherSnapshot(options?): Promise<WeatherSnapshot>` with caller cancellation and a default 10-second timeout for each HTTP request.

- [ ] **Step 1: Add the dependency-free Node test harness and shared contracts**

Create `package.json`:

```json
{
  "name": "pi-weather-widget",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "test": "node --test tests/*.test.ts",
    "test:api": "node --test tests/api.test.ts",
    "test:cache": "node --test tests/cache.test.ts",
    "test:formatter": "node --test tests/formatter.test.ts",
    "test:lifecycle": "node --test tests/lifecycle.test.ts"
  }
}
```

Create `types.ts`:

```typescript
export interface LocationInfo {
  city?: string;
  region?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  displayName: string;
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
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;
```

Create `tests/fixtures.ts`:

```typescript
import type { WeatherSnapshot } from "../types.ts";

export function makeSnapshot(
  fetchedAt = "2026-08-19T06:00:00.000Z",
): WeatherSnapshot {
  return {
    location: {
      city: "西安",
      region: "陕西",
      country: "中国",
      latitude: 34.3416,
      longitude: 108.9398,
      timezone: "Asia/Shanghai",
      displayName: "西安",
    },
    weather: {
      temperatureC: 22.4,
      apparentTemperatureC: 23.1,
      relativeHumidityPercent: 46,
      weatherCode: 0,
      windSpeedKmh: 7.2,
      observedAt: "2026-08-19T14:00",
    },
    fetchedAt,
  };
}
```

- [ ] **Step 2: Write failing API tests**

Create `tests/api.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWeatherUrl,
  fetchWeatherSnapshot,
  parseCurrentWeather,
  parseLocation,
} from "../api.ts";
import type { FetchLike } from "../types.ts";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const locationPayload = {
  success: true,
  city: "西安",
  region: "陕西",
  country: "中国",
  latitude: 34.3416,
  longitude: 108.9398,
  timezone: { id: "Asia/Shanghai" },
};

const weatherPayload = {
  current: {
    temperature_2m: 22.4,
    apparent_temperature: 23.1,
    relative_humidity_2m: 46,
    weather_code: 0,
    wind_speed_10m: 7.2,
    time: "2026-08-19T14:00",
  },
};

test("buildWeatherUrl requests the exact current fields and units", () => {
  const url = new URL(buildWeatherUrl(34.3416, 108.9398));
  assert.equal(url.origin + url.pathname, "https://api.open-meteo.com/v1/forecast");
  assert.equal(url.searchParams.get("latitude"), "34.3416");
  assert.equal(url.searchParams.get("longitude"), "108.9398");
  assert.equal(
    url.searchParams.get("current"),
    "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
  );
  assert.equal(url.searchParams.get("temperature_unit"), "celsius");
  assert.equal(url.searchParams.get("wind_speed_unit"), "kmh");
  assert.equal(url.searchParams.get("timezone"), "auto");
});

test("parseLocation selects the first non-empty city, region, or country", () => {
  assert.equal(parseLocation(locationPayload).displayName, "西安");
  assert.equal(
    parseLocation({ ...locationPayload, city: "", region: "陕西" }).displayName,
    "陕西",
  );
  assert.equal(
    parseLocation({ ...locationPayload, city: "", region: "", country: "中国" }).displayName,
    "中国",
  );
});

test("parseLocation rejects failed, missing-name, and out-of-range data", () => {
  assert.throws(() => parseLocation({ success: false, message: "denied" }), /denied/);
  assert.throws(
    () => parseLocation({ ...locationPayload, city: "", region: "", country: "" }),
    /display location/,
  );
  assert.throws(
    () => parseLocation({ ...locationPayload, latitude: 91 }),
    /latitude/,
  );
  assert.throws(
    () => parseLocation({ ...locationPayload, longitude: Number.NaN }),
    /longitude/,
  );
});

test("parseCurrentWeather validates required physical fields", () => {
  assert.deepEqual(parseCurrentWeather(weatherPayload), {
    temperatureC: 22.4,
    apparentTemperatureC: 23.1,
    relativeHumidityPercent: 46,
    weatherCode: 0,
    windSpeedKmh: 7.2,
    observedAt: "2026-08-19T14:00",
  });
  assert.throws(
    () => parseCurrentWeather({ current: { ...weatherPayload.current, relative_humidity_2m: 101 } }),
    /relative_humidity_2m/,
  );
  assert.throws(
    () => parseCurrentWeather({ current: { ...weatherPayload.current, wind_speed_10m: -1 } }),
    /wind_speed_10m/,
  );
  assert.throws(
    () => parseCurrentWeather({ current: { ...weatherPayload.current, weather_code: 0.5 } }),
    /weather_code/,
  );
});

test("fetchWeatherSnapshot performs geolocation before weather", async () => {
  const calls: string[] = [];
  const fakeFetch: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    return calls.length === 1 ? jsonResponse(locationPayload) : jsonResponse(weatherPayload);
  };

  const snapshot = await fetchWeatherSnapshot({
    fetchImpl: fakeFetch,
    now: () => new Date("2026-08-19T06:05:00.000Z"),
  });

  assert.match(calls[0]!, /^https:\/\/ipwho\.is\//);
  assert.match(calls[1]!, /^https:\/\/api\.open-meteo\.com\/v1\/forecast/);
  assert.equal(snapshot.location.displayName, "西安");
  assert.equal(snapshot.weather.temperatureC, 22.4);
  assert.equal(snapshot.fetchedAt, "2026-08-19T06:05:00.000Z");
});

test("each request can time out without an unhandled pending fetch", async () => {
  const hangingFetch: FetchLike = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });

  await assert.rejects(
    fetchWeatherSnapshot({ fetchImpl: hangingFetch, timeoutMs: 10 }),
    /timed out after 10ms/,
  );
});

test("caller cancellation propagates into the active request", async () => {
  const controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  const hangingFetch: FetchLike = async (_input, init) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  };

  const pending = fetchWeatherSnapshot({
    fetchImpl: hangingFetch,
    signal: controller.signal,
  });
  controller.abort(new Error("session shutdown"));

  await assert.rejects(pending, /session shutdown/);
  assert.equal(requestSignal?.aborted, true);
});
```

- [ ] **Step 3: Run the API tests and verify the red state**

Run from `C:\Users\I\.pi\agent\extensions\weather-widget`:

```powershell
npm run test:api
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `api.ts`.

- [ ] **Step 4: Implement the API chain**

Create `api.ts`:

```typescript
import type {
  CurrentWeather,
  FetchLike,
  LocationInfo,
  WeatherSnapshot,
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
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
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
```

- [ ] **Step 5: Run the API tests and verify green**

Run:

```powershell
npm run test:api
```

Expected: 7 tests pass, 0 fail.

- [ ] **Step 6: Commit the API slice**

```powershell
git add package.json types.ts api.ts tests\fixtures.ts tests\api.test.ts
git commit -m "feat: add IP weather API client"
```

---

### Task 2: Three-hour atomic cache

**Files:**
- Create: `tests/cache.test.ts`
- Create: `cache.ts`

**Interfaces:**
- Consumes: `WeatherSnapshot` from `types.ts`.
- Produces: `CACHE_MAX_AGE_MS`, fixed at `10_800_000` milliseconds.
- Produces: `resolveCachePath(env?, homeDirectory?): string`.
- Produces: `cacheAgeMs(snapshot, nowMs): number | undefined` and `isFreshSnapshot(snapshot, nowMs): boolean`.
- Produces: `readFreshCache(path, nowMs): Promise<WeatherSnapshot | undefined>`.
- Produces: `writeCacheAtomic(path, snapshot): Promise<void>` and `removeCache(path): Promise<void>`.

- [ ] **Step 1: Write failing cache tests**

Create `tests/cache.test.ts`:

```typescript
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CACHE_MAX_AGE_MS,
  FUTURE_CLOCK_SKEW_MS,
  isFreshSnapshot,
  readFreshCache,
  resolveCachePath,
  writeCacheAtomic,
} from "../cache.ts";
import { makeSnapshot } from "./fixtures.ts";

async function withTempDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pi-weather-widget-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("resolveCachePath honors PI_CODING_AGENT_DIR and the default home", () => {
  assert.equal(
    resolveCachePath({ PI_CODING_AGENT_DIR: "D:\\pi-config" }, "C:\\Users\\I"),
    join("D:\\pi-config", "cache", "weather-widget.json"),
  );
  assert.equal(
    resolveCachePath({}, "C:\\Users\\I"),
    join("C:\\Users\\I", ".pi", "agent", "cache", "weather-widget.json"),
  );
});

test("a snapshot is fresh only while age is strictly below three hours", () => {
  const fetchedAtMs = Date.parse("2026-08-19T06:00:00.000Z");
  const snapshot = makeSnapshot(new Date(fetchedAtMs).toISOString());
  assert.equal(isFreshSnapshot(snapshot, fetchedAtMs + CACHE_MAX_AGE_MS - 1), true);
  assert.equal(isFreshSnapshot(snapshot, fetchedAtMs + CACHE_MAX_AGE_MS), false);
  assert.equal(isFreshSnapshot(snapshot, fetchedAtMs + CACHE_MAX_AGE_MS + 1), false);
});

test("future clock skew up to five minutes is tolerated but larger skew is invalid", () => {
  const nowMs = Date.parse("2026-08-19T06:00:00.000Z");
  assert.equal(
    isFreshSnapshot(
      makeSnapshot(new Date(nowMs + FUTURE_CLOCK_SKEW_MS).toISOString()),
      nowMs,
    ),
    true,
  );
  assert.equal(
    isFreshSnapshot(
      makeSnapshot(new Date(nowMs + FUTURE_CLOCK_SKEW_MS + 1).toISOString()),
      nowMs,
    ),
    false,
  );
});

test("readFreshCache returns valid data and deletes expired data", async () => {
  await withTempDirectory(async (directory) => {
    const cachePath = join(directory, "cache", "weather-widget.json");
    const snapshot = makeSnapshot("2026-08-19T06:00:00.000Z");
    await writeCacheAtomic(cachePath, snapshot);

    assert.deepEqual(
      await readFreshCache(cachePath, Date.parse("2026-08-19T08:59:59.999Z")),
      snapshot,
    );
    assert.equal(
      await readFreshCache(cachePath, Date.parse("2026-08-19T09:00:00.000Z")),
      undefined,
    );
    await assert.rejects(readFile(cachePath, "utf8"), { code: "ENOENT" });
  });
});

test("readFreshCache silently removes malformed cache JSON", async () => {
  await withTempDirectory(async (directory) => {
    const cachePath = join(directory, "weather-widget.json");
    await writeFile(cachePath, "{not-json", "utf8");
    assert.equal(await readFreshCache(cachePath, Date.now()), undefined);
    await assert.rejects(readFile(cachePath, "utf8"), { code: "ENOENT" });
  });
});

test("writeCacheAtomic leaves one complete JSON file and no temporary files", async () => {
  await withTempDirectory(async (directory) => {
    const cachePath = join(directory, "cache", "weather-widget.json");
    const snapshot = makeSnapshot();
    await writeCacheAtomic(cachePath, snapshot);
    assert.deepEqual(JSON.parse(await readFile(cachePath, "utf8")), snapshot);
    assert.deepEqual(await readdir(join(directory, "cache")), ["weather-widget.json"]);
  });
});
```

- [ ] **Step 2: Run cache tests and verify the red state**

Run:

```powershell
npm run test:cache
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `cache.ts`.

- [ ] **Step 3: Implement cache validation and persistence**

Create `cache.ts`:

```typescript
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

export function isWeatherSnapshot(value: unknown): value is WeatherSnapshot {
  if (!isRecord(value) || !isRecord(value.location) || !isRecord(value.weather)) return false;
  const { location, weather } = value;
  const fetchedAt = typeof value.fetchedAt === "string" ? Date.parse(value.fetchedAt) : Number.NaN;

  return (
    Number.isFinite(fetchedAt) &&
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
  const fetchedAtMs = Date.parse(snapshot.fetchedAt);
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
```

- [ ] **Step 4: Run cache tests and the cumulative suite**

Run:

```powershell
npm run test:cache
npm test
```

Expected: cache suite reports 6 passing tests; cumulative suite reports 13 passing tests and 0 failures.

- [ ] **Step 5: Commit the cache slice**

```powershell
git add cache.ts tests\cache.test.ts
git commit -m "feat: add three-hour weather cache"
```

---

### Task 3: WMO mapping and responsive colored labels

**Files:**
- Create: `tests/formatter.test.ts`
- Create: `weather-codes.ts`
- Create: `formatter.ts`

**Interfaces:**
- Consumes: `WeatherSnapshot` from `types.ts`.
- Produces: `getWeatherPresentation(code): WeatherPresentation` and `KNOWN_WMO_CODES`.
- Produces: `temperatureBand(temperatureC): TemperatureBand`; classification uses the same rounded integer displayed to the user.
- Produces: `renderWeatherLine(snapshot, stale, theme, metrics, width): string`.
- Consumes from `index.ts` later: a `WeatherTheme` adapter and `TextMetrics` adapter around Pi/TUI utilities.

- [ ] **Step 1: Write failing mapping and formatter tests**

Create `tests/formatter.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import {
  renderWeatherLine,
  temperatureBand,
  type TextMetrics,
  type WeatherTheme,
} from "../formatter.ts";
import { getWeatherPresentation, KNOWN_WMO_CODES } from "../weather-codes.ts";
import { makeSnapshot } from "./fixtures.ts";

const plainTheme: WeatherTheme = {
  fg: (_role, text) => text,
  bg: (_role, text) => text,
  bold: (text) => text,
};

const plainMetrics: TextMetrics = {
  visibleWidth: (text) => Array.from(text).length,
  truncateToWidth: (text, width, ellipsis = "…") => {
    const characters = Array.from(text);
    if (characters.length <= width) return text;
    if (width <= 0) return "";
    const suffix = Array.from(ellipsis);
    if (suffix.length >= width) return suffix.slice(0, width).join("");
    return characters.slice(0, width - suffix.length).join("") + ellipsis;
  },
};

test("every supported WMO code has a symbol, Chinese label, and family", () => {
  for (const code of KNOWN_WMO_CODES) {
    const presentation = getWeatherPresentation(code);
    assert.notEqual(presentation.family, "unknown", `code ${code}`);
    assert.ok(presentation.symbol.length > 0, `code ${code}`);
    assert.ok(presentation.description.length > 0, `code ${code}`);
  }
  assert.deepEqual(getWeatherPresentation(999), {
    symbol: "○",
    description: "未知",
    family: "unknown",
  });
});

test("temperature bands use rounded displayed temperatures without decimal gaps", () => {
  const cases: Array<[number, string]> = [
    [-0.4, "ice"],
    [0.49, "ice"],
    [0.5, "cool"],
    [15.49, "cool"],
    [15.5, "comfortable"],
    [25.49, "comfortable"],
    [25.5, "warm"],
    [32.49, "warm"],
    [32.5, "hot"],
    [37.49, "hot"],
    [37.5, "extreme"],
  ];
  for (const [temperature, expected] of cases) {
    assert.equal(temperatureBand(temperature), expected, String(temperature));
  }
});

test("extreme heat uses Pi error roles and renders rounded units", () => {
  const calls: string[] = [];
  const recordingTheme: WeatherTheme = {
    fg: (role, text) => {
      calls.push(`fg:${role}`);
      return text;
    },
    bg: (role, text) => {
      calls.push(`bg:${role}`);
      return text;
    },
    bold: (text) => {
      calls.push("bold");
      return text;
    },
  };
  const snapshot = makeSnapshot();
  snapshot.weather.temperatureC = 38.2;
  snapshot.weather.apparentTemperatureC = 41.7;

  const line = renderWeatherLine(snapshot, false, recordingTheme, plainMetrics, 200);
  assert.match(line, /38°C/);
  assert.match(line, /体感 42°C/);
  assert.ok(calls.includes("fg:error"));
  assert.ok(calls.includes("bg:toolErrorBg"));
  assert.ok(calls.includes("bold"));
});

test("responsive rendering removes wind, humidity, feels-like, then description", () => {
  const snapshot = makeSnapshot();
  const outputs = Array.from({ length: 100 }, (_unused, index) =>
    renderWeatherLine(snapshot, false, plainTheme, plainMetrics, 100 - index),
  );

  assert.ok(outputs.some((line) => !line.includes("风速") && line.includes("湿度")));
  assert.ok(outputs.some((line) => !line.includes("湿度") && line.includes("体感")));
  assert.ok(outputs.some((line) => !line.includes("体感") && line.includes("晴")));
  assert.ok(outputs.some((line) => !line.includes("晴") && line.includes("22°C")));
});

test("minimum narrow rendering keeps symbol, a truncated location, and temperature", () => {
  const snapshot = makeSnapshot();
  snapshot.location.displayName = "一个非常非常长的地点名称";
  const line = renderWeatherLine(snapshot, false, plainTheme, plainMetrics, 14);
  assert.match(line, /☀/);
  assert.match(line, /22°C/);
  assert.ok(plainMetrics.visibleWidth(line) <= 14);
});

test("a stale warning survives normal detail removal", () => {
  const snapshot = makeSnapshot();
  const full = renderWeatherLine(snapshot, true, plainTheme, plainMetrics, 200);
  assert.match(full, /⚠ 数据已过期/);
  const narrower = renderWeatherLine(snapshot, true, plainTheme, plainMetrics, 45);
  assert.match(narrower, /⚠ 数据已过期/);
  assert.doesNotMatch(narrower, /风速/);
});
```

- [ ] **Step 2: Run formatter tests and verify the red state**

Run:

```powershell
npm run test:formatter
```

Expected: FAIL because `formatter.ts` and `weather-codes.ts` do not exist.

- [ ] **Step 3: Implement the complete WMO mapping**

Create `weather-codes.ts`:

```typescript
export type WeatherFamily =
  | "clear"
  | "cloud"
  | "fog"
  | "rain"
  | "snow"
  | "thunder"
  | "unknown";

export interface WeatherPresentation {
  symbol: string;
  description: string;
  family: WeatherFamily;
}

export const KNOWN_WMO_CODES = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75,
  77, 80, 81, 82, 85, 86, 95, 96, 99,
] as const;

const presentations = new Map<number, WeatherPresentation>([
  [0, { symbol: "☀", description: "晴", family: "clear" }],
  [1, { symbol: "☀", description: "大部晴朗", family: "clear" }],
  [2, { symbol: "◒", description: "多云", family: "cloud" }],
  [3, { symbol: "☁", description: "阴", family: "cloud" }],
  [45, { symbol: "≋", description: "雾", family: "fog" }],
  [48, { symbol: "≋", description: "雾凇", family: "fog" }],
  [51, { symbol: "☂", description: "小毛毛雨", family: "rain" }],
  [53, { symbol: "☂", description: "毛毛雨", family: "rain" }],
  [55, { symbol: "☂", description: "大毛毛雨", family: "rain" }],
  [56, { symbol: "☂", description: "轻微冻雨", family: "rain" }],
  [57, { symbol: "☂", description: "冻雨", family: "rain" }],
  [61, { symbol: "☂", description: "小雨", family: "rain" }],
  [63, { symbol: "☂", description: "中雨", family: "rain" }],
  [65, { symbol: "☂", description: "大雨", family: "rain" }],
  [66, { symbol: "☂", description: "轻微冻雨", family: "rain" }],
  [67, { symbol: "☂", description: "强冻雨", family: "rain" }],
  [71, { symbol: "❄", description: "小雪", family: "snow" }],
  [73, { symbol: "❄", description: "中雪", family: "snow" }],
  [75, { symbol: "❄", description: "大雪", family: "snow" }],
  [77, { symbol: "❄", description: "米雪", family: "snow" }],
  [80, { symbol: "☂", description: "小阵雨", family: "rain" }],
  [81, { symbol: "☂", description: "阵雨", family: "rain" }],
  [82, { symbol: "☂", description: "强阵雨", family: "rain" }],
  [85, { symbol: "❄", description: "小阵雪", family: "snow" }],
  [86, { symbol: "❄", description: "强阵雪", family: "snow" }],
  [95, { symbol: "⚡", description: "雷暴", family: "thunder" }],
  [96, { symbol: "⚡", description: "雷暴伴冰雹", family: "thunder" }],
  [99, { symbol: "⚡", description: "强雷暴伴冰雹", family: "thunder" }],
]);

const unknownPresentation: WeatherPresentation = {
  symbol: "○",
  description: "未知",
  family: "unknown",
};

export function getWeatherPresentation(code: number): WeatherPresentation {
  return presentations.get(code) ?? unknownPresentation;
}
```

- [ ] **Step 4: Implement themed labels and responsive degradation**

Create `formatter.ts`:

```typescript
import type { WeatherSnapshot } from "./types.ts";
import { getWeatherPresentation, type WeatherFamily } from "./weather-codes.ts";

export type TemperatureBand = "ice" | "cool" | "comfortable" | "warm" | "hot" | "extreme";
export type ForegroundRole = "text" | "accent" | "success" | "warning" | "error" | "muted" | "dim";
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
    case "clear": return "warning";
    case "rain": return "accent";
    case "snow": return "accent";
    case "thunder": return "error";
    case "cloud": return "muted";
    case "fog": return "dim";
    case "unknown": return "muted";
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
    for (let nameWidth = metrics.visibleWidth(originalName); nameWidth >= 1; nameWidth -= 1) {
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
```

- [ ] **Step 5: Run formatter and cumulative tests**

Run:

```powershell
npm run test:formatter
npm test
```

Expected: formatter suite reports 6 passing tests; cumulative suite reports 19 passing tests and 0 failures.

- [ ] **Step 6: Commit the presentation slice**

```powershell
git add formatter.ts weather-codes.ts tests\formatter.test.ts
git commit -m "feat: render responsive colored weather labels"
```

---

### Task 4: Non-blocking refresh, stale state, exact expiry, and shutdown

**Files:**
- Create: `tests/lifecycle.test.ts`
- Create: `runtime.ts`

**Interfaces:**
- Consumes: `WeatherSnapshot` and cache age constants.
- Produces: `Scheduler`, `WeatherRuntimeDependencies`, and `WeatherRuntime`.
- `WeatherRuntime.start(): void` must return synchronously.
- `WeatherRuntime.refresh(): Promise<void>` is public for deterministic tests; callers normally rely on startup and interval scheduling.
- `WeatherRuntime.dispose(): void` aborts active work, clears both timer classes, and hides the widget.

- [ ] **Step 1: Write failing lifecycle tests with a fake clock**

Create `tests/lifecycle.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import { CACHE_MAX_AGE_MS } from "../cache.ts";
import {
  WeatherRuntime,
  type Scheduler,
  type WeatherRuntimeDependencies,
} from "../runtime.ts";
import type { WeatherSnapshot } from "../types.ts";
import { makeSnapshot } from "./fixtures.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

interface ScheduledTask {
  id: number;
  at: number;
  intervalMs?: number;
  callback: () => void;
}

class FakeScheduler implements Scheduler {
  private nextId = 1;
  private tasks = new Map<number, ScheduledTask>();
  private nowMs: number;

  constructor(nowMs: number) {
    this.nowMs = nowMs;
  }

  now(): number {
    return this.nowMs;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    return this.add(callback, delayMs);
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  setInterval(callback: () => void, intervalMs: number): unknown {
    const id = this.add(callback, intervalMs);
    this.tasks.get(id)!.intervalMs = intervalMs;
    return id;
  }

  clearInterval(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  activeTaskCount(): number {
    return this.tasks.size;
  }

  advanceBy(milliseconds: number): void {
    const target = this.nowMs + milliseconds;
    while (true) {
      const next = [...this.tasks.values()]
        .filter((task) => task.at <= target)
        .sort((left, right) => left.at - right.at || left.id - right.id)[0];
      if (!next) break;
      this.nowMs = next.at;
      if (next.intervalMs === undefined) {
        this.tasks.delete(next.id);
      } else {
        next.at += next.intervalMs;
      }
      next.callback();
    }
    this.nowMs = target;
  }

  private add(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.tasks.set(id, {
      id,
      at: this.nowMs + Math.max(0, delayMs),
      callback,
    });
    return id;
  }
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

function createHarness(options: {
  nowMs?: number;
  readCache?: () => Promise<WeatherSnapshot | undefined>;
  fetchSnapshot?: (signal: AbortSignal) => Promise<WeatherSnapshot>;
}) {
  const nowMs = options.nowMs ?? Date.parse("2026-08-19T06:00:00.000Z");
  const scheduler = new FakeScheduler(nowMs);
  const shown: Array<{ snapshot: WeatherSnapshot; stale: boolean }> = [];
  let hideCount = 0;
  const writes: WeatherSnapshot[] = [];
  let removeCount = 0;

  const dependencies: WeatherRuntimeDependencies = {
    scheduler,
    readCache: options.readCache ?? (async () => undefined),
    fetchSnapshot:
      options.fetchSnapshot ?? (async () => makeSnapshot(new Date(scheduler.now()).toISOString())),
    writeCache: async (snapshot) => { writes.push(snapshot); },
    removeCache: async () => { removeCount += 1; },
    show: (snapshot, stale) => { shown.push({ snapshot, stale }); },
    hide: () => { hideCount += 1; },
  };

  return {
    runtime: new WeatherRuntime(dependencies),
    scheduler,
    shown,
    writes,
    get hideCount() { return hideCount; },
    get removeCount() { return removeCount; },
  };
}

test("start returns immediately while cache I/O remains pending", () => {
  const pendingCache = deferred<WeatherSnapshot | undefined>();
  const harness = createHarness({ readCache: () => pendingCache.promise });
  harness.runtime.start();
  assert.equal(harness.shown.length, 0);
  assert.equal(harness.scheduler.activeTaskCount(), 1);
  harness.runtime.dispose();
});

test("valid cache is shown before a pending network refresh completes", async () => {
  const pendingWeather = deferred<WeatherSnapshot>();
  const cached = makeSnapshot("2026-08-19T05:00:00.000Z");
  const harness = createHarness({
    readCache: async () => cached,
    fetchSnapshot: () => pendingWeather.promise,
  });
  harness.runtime.start();
  await flushPromises();
  assert.deepEqual(harness.shown, [{ snapshot: cached, stale: false }]);
  harness.runtime.dispose();
});

test("failed refresh with no valid snapshot stays hidden", async () => {
  const harness = createHarness({
    fetchSnapshot: async () => { throw new Error("offline"); },
  });
  harness.runtime.start();
  await flushPromises();
  assert.equal(harness.shown.length, 0);
  assert.equal(harness.hideCount, 1);
  harness.runtime.dispose();
});

test("failed refresh preserves valid cache as stale without extending expiry", async () => {
  const cached = makeSnapshot("2026-08-19T05:00:00.000Z");
  const harness = createHarness({
    readCache: async () => cached,
    fetchSnapshot: async () => { throw new Error("offline"); },
  });
  harness.runtime.start();
  await flushPromises();
  assert.deepEqual(harness.shown.map((entry) => entry.stale), [false, true]);

  harness.scheduler.advanceBy(2 * 60 * 60 * 1_000);
  await flushPromises();
  assert.ok(harness.hideCount >= 1);
  assert.ok(harness.removeCount >= 1);
  harness.runtime.dispose();
});

test("an active refresh prevents overlapping interval refreshes", async () => {
  const first = deferred<WeatherSnapshot>();
  let calls = 0;
  const harness = createHarness({
    fetchSnapshot: async () => {
      calls += 1;
      if (calls === 1) return first.promise;
      return makeSnapshot(new Date(harness.scheduler.now()).toISOString());
    },
  });
  harness.runtime.start();
  await flushPromises();
  assert.equal(calls, 1);

  harness.scheduler.advanceBy(30 * 60 * 1_000);
  await flushPromises();
  assert.equal(calls, 1);

  first.resolve(makeSnapshot(new Date(harness.scheduler.now()).toISOString()));
  await flushPromises();
  harness.scheduler.advanceBy(30 * 60 * 1_000);
  await flushPromises();
  assert.equal(calls, 2);
  harness.runtime.dispose();
});

test("a slow cache read cannot overwrite a newer interval refresh", async () => {
  const pendingCache = deferred<WeatherSnapshot | undefined>();
  const fresh = makeSnapshot("2026-08-19T06:30:00.000Z");
  const older = makeSnapshot("2026-08-19T05:00:00.000Z");
  const harness = createHarness({
    readCache: () => pendingCache.promise,
    fetchSnapshot: async () => fresh,
  });
  harness.runtime.start();
  harness.scheduler.advanceBy(30 * 60 * 1_000);
  await flushPromises();
  assert.deepEqual(harness.shown, [{ snapshot: fresh, stale: false }]);

  pendingCache.resolve(older);
  await flushPromises();
  assert.equal(
    harness.shown.some((entry) => entry.snapshot.fetchedAt === older.fetchedAt),
    false,
  );
  harness.runtime.dispose();
});

test("successful refresh displays and persists a fresh snapshot", async () => {
  const fresh = makeSnapshot("2026-08-19T06:00:00.000Z");
  const harness = createHarness({ fetchSnapshot: async () => fresh });
  harness.runtime.start();
  await flushPromises();
  assert.deepEqual(harness.shown, [{ snapshot: fresh, stale: false }]);
  assert.deepEqual(harness.writes, [fresh]);
  harness.runtime.dispose();
});

test("dispose aborts the request, clears timers, and hides the widget", async () => {
  let activeSignal: AbortSignal | undefined;
  const harness = createHarness({
    fetchSnapshot: async (signal) => {
      activeSignal = signal;
      return new Promise<WeatherSnapshot>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    },
  });
  harness.runtime.start();
  await flushPromises();
  harness.runtime.dispose();
  await flushPromises();
  assert.equal(activeSignal?.aborted, true);
  assert.equal(harness.scheduler.activeTaskCount(), 0);
  assert.equal(harness.hideCount, 1);
});

test("cache write failure does not hide newly fetched in-memory weather", async () => {
  const scheduler = new FakeScheduler(Date.parse("2026-08-19T06:00:00.000Z"));
  const shown: WeatherSnapshot[] = [];
  const runtime = new WeatherRuntime({
    scheduler,
    readCache: async () => undefined,
    fetchSnapshot: async () => makeSnapshot("2026-08-19T06:00:00.000Z"),
    writeCache: async () => { throw new Error("disk full"); },
    removeCache: async () => undefined,
    show: (snapshot) => { shown.push(snapshot); },
    hide: () => undefined,
  });
  runtime.start();
  await flushPromises();
  assert.equal(shown.length, 1);
  runtime.dispose();
});
```

- [ ] **Step 2: Run lifecycle tests and verify the red state**

Run:

```powershell
npm run test:lifecycle
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `runtime.ts`.

- [ ] **Step 3: Implement the lifecycle runtime**

Create `runtime.ts`:

```typescript
import { CACHE_MAX_AGE_MS } from "./cache.ts";
import type { WeatherSnapshot } from "./types.ts";

export const REFRESH_INTERVAL_MS = 30 * 60 * 1_000;

export interface Scheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface WeatherRuntimeDependencies {
  scheduler: Scheduler;
  readCache(nowMs: number): Promise<WeatherSnapshot | undefined>;
  fetchSnapshot(signal: AbortSignal): Promise<WeatherSnapshot>;
  writeCache(snapshot: WeatherSnapshot): Promise<void>;
  removeCache(): Promise<void>;
  show(snapshot: WeatherSnapshot, stale: boolean): void;
  hide(): void;
  refreshIntervalMs?: number;
  maxAgeMs?: number;
}

export class WeatherRuntime {
  private readonly refreshIntervalMs: number;
  private readonly maxAgeMs: number;
  private readonly dependencies: WeatherRuntimeDependencies;
  private started = false;
  private disposed = false;
  private refreshing = false;
  private activeController: AbortController | undefined;
  private refreshHandle: unknown;
  private expiryHandle: unknown;
  private snapshot: WeatherSnapshot | undefined;

  constructor(dependencies: WeatherRuntimeDependencies) {
    this.dependencies = dependencies;
    this.refreshIntervalMs = dependencies.refreshIntervalMs ?? REFRESH_INTERVAL_MS;
    this.maxAgeMs = dependencies.maxAgeMs ?? CACHE_MAX_AGE_MS;
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.refreshHandle = this.dependencies.scheduler.setInterval(
      () => { void this.refresh(); },
      this.refreshIntervalMs,
    );
    void this.initialize();
  }

  async refresh(): Promise<void> {
    if (this.disposed || this.refreshing) return;
    this.refreshing = true;
    const controller = new AbortController();
    this.activeController = controller;

    try {
      const snapshot = await this.dependencies.fetchSnapshot(controller.signal);
      if (this.disposed) return;
      this.snapshot = snapshot;
      this.dependencies.show(snapshot, false);
      this.scheduleExpiry();
      void this.dependencies.writeCache(snapshot).catch(() => undefined);
    } catch {
      if (this.disposed || controller.signal.aborted) return;
      this.showStaleOrHide();
    } finally {
      if (this.activeController === controller) this.activeController = undefined;
      this.refreshing = false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activeController?.abort(new Error("weather widget disposed"));
    if (this.refreshHandle !== undefined) {
      this.dependencies.scheduler.clearInterval(this.refreshHandle);
      this.refreshHandle = undefined;
    }
    this.clearExpiry();
    this.dependencies.hide();
  }

  private async initialize(): Promise<void> {
    try {
      const cached = await this.dependencies.readCache(this.dependencies.scheduler.now());
      if (this.disposed) return;
      if (cached && !this.snapshot) {
        this.snapshot = cached;
        this.dependencies.show(cached, false);
        this.scheduleExpiry();
      }
    } catch {
      if (this.disposed) return;
    }
    await this.refresh();
  }

  private remainingLifetimeMs(snapshot: WeatherSnapshot): number {
    const fetchedAtMs = Date.parse(snapshot.fetchedAt);
    if (!Number.isFinite(fetchedAtMs)) return 0;
    const age = Math.max(0, this.dependencies.scheduler.now() - fetchedAtMs);
    return this.maxAgeMs - age;
  }

  private showStaleOrHide(): void {
    if (this.snapshot && this.remainingLifetimeMs(this.snapshot) > 0) {
      this.dependencies.show(this.snapshot, true);
      return;
    }
    this.snapshot = undefined;
    this.clearExpiry();
    this.dependencies.hide();
    void this.dependencies.removeCache().catch(() => undefined);
  }

  private scheduleExpiry(): void {
    this.clearExpiry();
    if (!this.snapshot) return;
    const delay = Math.max(0, this.remainingLifetimeMs(this.snapshot));
    this.expiryHandle = this.dependencies.scheduler.setTimeout(
      () => this.expireSnapshot(),
      delay,
    );
  }

  private expireSnapshot(): void {
    this.expiryHandle = undefined;
    if (this.disposed || !this.snapshot) return;
    const remaining = this.remainingLifetimeMs(this.snapshot);
    if (remaining > 0) {
      this.expiryHandle = this.dependencies.scheduler.setTimeout(
        () => this.expireSnapshot(),
        remaining,
      );
      return;
    }
    this.snapshot = undefined;
    this.dependencies.hide();
    void this.dependencies.removeCache().catch(() => undefined);
  }

  private clearExpiry(): void {
    if (this.expiryHandle === undefined) return;
    this.dependencies.scheduler.clearTimeout(this.expiryHandle);
    this.expiryHandle = undefined;
  }
}
```

- [ ] **Step 4: Run lifecycle and cumulative tests**

Run:

```powershell
npm run test:lifecycle
npm test
```

Expected: lifecycle suite reports 9 passing tests; cumulative suite reports 28 passing tests and 0 failures.

- [ ] **Step 5: Commit the runtime slice**

```powershell
git add runtime.ts tests\lifecycle.test.ts
git commit -m "feat: add nonblocking weather lifecycle"
```

---

### Task 5: Pi global extension adapter and user documentation

**Files:**
- Create: `index.ts`
- Create: `README.md`
- Verify: all files in the project

**Interfaces:**
- Consumes: `fetchWeatherSnapshot`, cache functions, `renderWeatherLine`, and `WeatherRuntime`.
- Consumes: Pi `session_start`, `session_shutdown`, `ctx.ui.setWidget`, theme roles, `visibleWidth`, and `truncateToWidth`.
- Produces: the default Pi extension factory loaded from `index.ts`.

- [ ] **Step 1: Verify the entrypoint is absent before implementation**

Run:

```powershell
$env:PI_OFFLINE = "1"
pi -e .\index.ts --list-models *> $null
```

Expected: non-zero exit because `index.ts` does not exist. Remove the process-local variable after the check:

```powershell
Remove-Item Env:PI_OFFLINE
```

- [ ] **Step 2: Implement the thin Pi adapter**

Create `index.ts`:

```typescript
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { fetchWeatherSnapshot } from "./api.ts";
import {
  readFreshCache,
  removeCache,
  resolveCachePath,
  writeCacheAtomic,
} from "./cache.ts";
import {
  renderWeatherLine,
  type WeatherTheme,
} from "./formatter.ts";
import { WeatherRuntime, type Scheduler } from "./runtime.ts";

const WIDGET_ID = "weather-widget";

const scheduler: Scheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

function adaptTheme(theme: Theme): WeatherTheme {
  return {
    fg: (role, text) => theme.fg(role, text),
    bg: (role, text) => theme.bg(role, text),
    bold: (text) => theme.bold(text),
  };
}

export default function weatherWidgetExtension(pi: ExtensionAPI): void {
  let runtime: WeatherRuntime | undefined;

  pi.on("session_start", (_event, ctx) => {
    runtime?.dispose();
    runtime = undefined;
    if (ctx.mode !== "tui") return;

    const cachePath = resolveCachePath();
    runtime = new WeatherRuntime({
      scheduler,
      readCache: (nowMs) => readFreshCache(cachePath, nowMs),
      fetchSnapshot: (signal) => fetchWeatherSnapshot({ signal }),
      writeCache: (snapshot) => writeCacheAtomic(cachePath, snapshot),
      removeCache: () => removeCache(cachePath),
      show: (snapshot, stale) => {
        ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => ({
          render(width: number): string[] {
            const line = renderWeatherLine(
              snapshot,
              stale,
              adaptTheme(theme),
              { visibleWidth, truncateToWidth },
              width,
            );
            return line.length > 0 ? [line] : [];
          },
          invalidate(): void {},
        }));
      },
      hide: () => ctx.ui.setWidget(WIDGET_ID, undefined),
    });

    runtime.start();
  });

  pi.on("session_shutdown", () => {
    runtime?.dispose();
    runtime = undefined;
  });
}
```

- [ ] **Step 3: Document behavior, privacy, and verification**

Create `README.md`:

```markdown
# Pi Weather Widget

A global Pi extension that resolves the current public IP to an approximate city and coordinates, fetches current weather, and displays one responsive colored line above Pi's editor.

## Behavior

- Starts cache and network work in the background without blocking Pi.
- Refreshes the complete IP-to-weather chain every 30 minutes.
- Uses cache only while it is less than three hours old.
- Keeps valid weather with a `⚠ 数据已过期` label after a failed refresh.
- Hides the widget completely when no valid weather exists.
- Drops wind, humidity, apparent temperature, and description in that order on narrow terminals.
- Supports only Pi TUI mode; print and JSON modes do not start weather work.

## Data sources

- IP geolocation: `https://ipwho.is/`
- Weather: `https://open-meteo.com/`

No API key is required. IP location is approximate and can reflect a VPN, proxy, or ISP exit point.

## Cache and privacy

The cache is `${PI_CODING_AGENT_DIR:-~/.pi/agent}/cache/weather-widget.json`. It stores the approximate location, coordinates, current weather, observation time, and successful fetch time. It does not store the public IP, API keys, Pi messages, or telemetry.

IPWhois receives the caller's public IP. Open-Meteo receives the resolved coordinates and normal HTTP metadata.

## Verification

```powershell
npm test
$env:PI_OFFLINE = "1"
pi -e .\index.ts --list-models *> $null
Remove-Item Env:PI_OFFLINE
```

For an intentional live API smoke test:

```powershell
node --input-type=module -e "import('./api.ts').then(async m => console.log(JSON.stringify(await m.fetchWeatherSnapshot(), null, 2)))"
```

After installation, run `/reload` in Pi. With no valid cache, the widget stays hidden until both API requests succeed.
```

- [ ] **Step 4: Run every automated test**

Run:

```powershell
npm test
```

Expected: 28 tests pass, 0 fail, 0 skipped.

- [ ] **Step 5: Verify Pi can load the entrypoint without starting a session**

Run:

```powershell
$env:PI_OFFLINE = "1"
pi -e .\index.ts --list-models *> $null
$exitCode = $LASTEXITCODE
Remove-Item Env:PI_OFFLINE
if ($exitCode -ne 0) { throw "Pi extension load failed with exit code $exitCode" }
```

Expected: command exits with code 0 and does not report an extension import or transpilation error. Because no session starts, the weather runtime does not make API calls.

- [ ] **Step 6: Run one intentional live API smoke test**

Run:

```powershell
node --input-type=module -e "import('./api.ts').then(async m => console.log(JSON.stringify(await m.fetchWeatherSnapshot(), null, 2)))"
```

Expected: JSON contains a non-empty `location.displayName`, finite `location.latitude` and `location.longitude`, all five current weather fields, and an ISO `fetchedAt`. The displayed city may reflect the current VPN or proxy exit and is not asserted to equal a fixed city.

- [ ] **Step 7: Reload and manually verify the real Pi TUI**

In the active Pi TUI, run:

```text
/reload
```

Verify all of these observations:

1. The editor is usable immediately; no loading row, dialog, notification, or visible error appears.
2. After successful network completion, one colored label line appears above the editor.
3. The line contains weather symbol/location, actual temperature, apparent temperature, description, humidity, and wind when width allows.
4. Narrowing the terminal removes wind, humidity, apparent temperature, then description without broken ANSI sequences.
5. Changing Pi's theme redraws readable colors.
6. A second `/reload` produces only one widget and no duplicate refresh behavior.

- [ ] **Step 8: Commit the Pi adapter and documentation**

```powershell
git add index.ts README.md
git commit -m "feat: display weather above the Pi editor"
```

---

### Task 6: Final verification against the approved specification

**Files:**
- Verify: `docs/superpowers/specs/2026-08-19-weather-widget-design.md`
- Verify: `package.json`, `types.ts`, `api.ts`, `cache.ts`, `weather-codes.ts`, `formatter.ts`, `runtime.ts`, `index.ts`, `README.md`
- Verify: `tests/*.test.ts`

**Interfaces:**
- Consumes the completed extension only; produces no new runtime API.
- Produces final evidence: clean tests, successful Pi load, intentional live response, and clean Git status.

- [ ] **Step 1: Run targeted and full test commands from a clean process**

```powershell
npm run test:api
npm run test:cache
npm run test:formatter
npm run test:lifecycle
npm test
```

Expected:

- API: 7 pass, 0 fail.
- Cache: 6 pass, 0 fail.
- Formatter: 6 pass, 0 fail.
- Lifecycle: 9 pass, 0 fail.
- Full suite: 28 pass, 0 fail, 0 skipped.

- [ ] **Step 2: Verify no runtime dependency or secret was introduced**

```powershell
node -e "const p=require('./package.json'); if (p.dependencies || p.devDependencies) process.exit(1)"
git grep -n -E "(api[_-]?key|Bearer [A-Za-z0-9]|sk-[A-Za-z0-9])" -- ':!docs/superpowers/specs/*' ':!docs/superpowers/plans/*'
```

Expected: the dependency check exits 0. The grep produces no secret or credential value; descriptive prose such as “No API key is required” is acceptable only if the command pattern is adjusted to exclude documentation.

- [ ] **Step 3: Verify the extension load and live chain once more**

```powershell
$env:PI_OFFLINE = "1"
pi -e .\index.ts --list-models *> $null
$loadExit = $LASTEXITCODE
Remove-Item Env:PI_OFFLINE
if ($loadExit -ne 0) { throw "Extension load failed" }

node --input-type=module -e "import('./api.ts').then(async m => { const s = await m.fetchWeatherSnapshot(); if (!s.location.displayName || !Number.isFinite(s.weather.temperatureC)) process.exit(1); console.log(s.location.displayName, s.weather.temperatureC + '°C'); })"
```

Expected: Pi load exits 0; live smoke test prints one location and one finite Celsius temperature.

- [ ] **Step 4: Inspect repository status and commit history**

```powershell
git status --short
git log --oneline --decorate -6
```

Expected: `git status --short` prints nothing. History includes the design commit and one focused commit for each implementation slice.

- [ ] **Step 5: Record manual acceptance evidence without changing code**

Record the observed results in the final implementation report:

```text
- /reload remained immediately interactive: yes/no
- Widget appeared only after valid weather: yes/no
- Colored temperature band visible: yes/no
- Narrow-width degradation order verified: yes/no
- Theme change redraw verified: yes/no
- No duplicate widget after second /reload: yes/no
- Automated tests: 28 passed / 0 failed
- Pi extension load: exit 0
- Live API chain: location and finite temperature returned
- Residual risk: IP geolocation follows public/VPN exit and public no-key APIs have no uptime SLA
```

Expected: every yes/no item is `yes`; any `no` reopens the corresponding task before completion is claimed.
