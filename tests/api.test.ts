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
