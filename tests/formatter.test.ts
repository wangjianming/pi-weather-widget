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
