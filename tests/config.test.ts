import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearLocationFromConfig,
  isCacheUsable,
  isWeatherWidgetConfig,
  readWeatherConfig,
  resolveConfigPath,
  writeWeatherConfig,
} from "../config.ts";
import type { LocationInfo } from "../types.ts";
import { makeSnapshot } from "./fixtures.ts";

async function withTempDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "pi-weather-widget-config-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const manualLocation: LocationInfo = {
  city: "上海",
  region: "上海市",
  country: "中国",
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: "Asia/Shanghai",
  displayName: "上海",
  source: "manual",
};

test("resolveConfigPath honors PI_CODING_AGENT_DIR and the default home", () => {
  assert.equal(
    resolveConfigPath({ PI_CODING_AGENT_DIR: "D:\\pi-config" }, "C:\\Users\\I"),
    join("D:\\pi-config", "weather-widget.json"),
  );
  assert.equal(
    resolveConfigPath({}, "C:\\Users\\I"),
    join("C:\\Users\\I", ".pi", "agent", "weather-widget.json"),
  );
});

test("writeWeatherConfig then readWeatherConfig round-trips location and model", async () => {
  await withTempDirectory(async (directory) => {
    const configPath = join(directory, "weather-widget.json");
    await writeWeatherConfig(configPath, { location: manualLocation, model: "cma_grapes_global" });

    const config = await readWeatherConfig(configPath);
    assert.deepEqual(config, { location: manualLocation, model: "cma_grapes_global" });

    const raw = JSON.parse(await readFile(configPath, "utf8"));
    assert.ok(isWeatherWidgetConfig(raw));
  });
});

test("writeWeatherConfig omits empty sections and accepts model-only configs", async () => {
  await withTempDirectory(async (directory) => {
    const configPath = join(directory, "weather-widget.json");
    await writeWeatherConfig(configPath, { model: "ecmwf_ifs025" });

    const raw = JSON.parse(await readFile(configPath, "utf8"));
    assert.deepEqual(raw, { model: "ecmwf_ifs025" });
    assert.deepEqual(await readWeatherConfig(configPath), { model: "ecmwf_ifs025" });
  });
});

test("readWeatherConfig returns undefined for missing, invalid, or malformed files", async () => {
  await withTempDirectory(async (directory) => {
    const configPath = join(directory, "weather-widget.json");
    assert.equal(await readWeatherConfig(configPath), undefined);

    await writeFile(configPath, "{ not json", "utf8");
    assert.equal(await readWeatherConfig(configPath), undefined);

    await writeFile(configPath, JSON.stringify({ location: { latitude: 999 } }), "utf8");
    assert.equal(await readWeatherConfig(configPath), undefined);

    await writeFile(configPath, JSON.stringify({ model: "not_a_real_model" }), "utf8");
    assert.equal(await readWeatherConfig(configPath), undefined);

    // 空对象是合法的“无配置”，行为等同配置文件缺失
    await writeFile(configPath, JSON.stringify({}), "utf8");
    assert.deepEqual(await readWeatherConfig(configPath), {});
  });
});

test("clearLocationFromConfig keeps the model and tolerates a missing file", async () => {
  await withTempDirectory(async (directory) => {
    const configPath = join(directory, "weather-widget.json");
    await writeWeatherConfig(configPath, { location: manualLocation, model: "cma_grapes_global" });
    await clearLocationFromConfig(configPath);
    assert.deepEqual(await readWeatherConfig(configPath), { model: "cma_grapes_global" });

    await clearLocationFromConfig(configPath);
    await clearLocationFromConfig(join(directory, "absent.json"));
  });
});

test("isCacheUsable matches manual snapshots only against the same fixed coordinates", () => {
  const manualSnapshot = makeSnapshot();
  manualSnapshot.location.source = "manual";
  manualSnapshot.location.latitude = 31.2304;
  manualSnapshot.location.longitude = 121.4737;

  const samePlace = { ...manualLocation, latitude: 31.2311, longitude: 121.4735 };
  const otherPlace = { ...manualLocation, latitude: 39.9042, longitude: 116.4074 };

  assert.equal(isCacheUsable(manualSnapshot, samePlace, undefined), true);
  assert.equal(isCacheUsable(manualSnapshot, otherPlace, undefined), false);
  assert.equal(isCacheUsable(manualSnapshot, undefined, undefined), false);
});

test("isCacheUsable accepts IP snapshots only in automatic mode", () => {
  const ipSnapshot = makeSnapshot();
  ipSnapshot.location.source = "ip";

  assert.equal(isCacheUsable(ipSnapshot, undefined, undefined), true);
  assert.equal(isCacheUsable(ipSnapshot, manualLocation, undefined), false);

  const legacySnapshot = makeSnapshot();
  assert.equal(isCacheUsable(legacySnapshot, undefined, undefined), true);
});

test("isCacheUsable rejects snapshots produced by a different model", () => {
  const snapshot = makeSnapshot();
  snapshot.model = "cma_grapes_global";

  assert.equal(isCacheUsable(snapshot, undefined, "cma_grapes_global"), true);
  assert.equal(isCacheUsable(snapshot, undefined, undefined), false);

  const legacySnapshot = makeSnapshot();
  assert.equal(isCacheUsable(legacySnapshot, undefined, "cma_grapes_global"), false);
});
