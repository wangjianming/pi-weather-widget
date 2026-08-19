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
