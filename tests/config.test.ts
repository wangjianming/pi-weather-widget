import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  clearLocationConfig,
  isCacheUsable,
  isLocationConfig,
  readLocationConfig,
  resolveConfigPath,
  writeLocationConfig,
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

test("writeLocationConfig then readLocationConfig round-trips", async () => {
  await withTempDirectory(async (directory) => {
    const configPath = join(directory, "weather-widget.json");
    await writeLocationConfig(configPath, manualLocation);

    const config = await readLocationConfig(configPath);
    assert.deepEqual(config, { location: manualLocation });

    const raw = JSON.parse(await readFile(configPath, "utf8"));
    assert.ok(isLocationConfig(raw));
  });
});

test("readLocationConfig returns undefined for missing, invalid, or malformed files", async () => {
  await withTempDirectory(async (directory) => {
    const configPath = join(directory, "weather-widget.json");
    assert.equal(await readLocationConfig(configPath), undefined);

    await writeFile(configPath, "{ not json", "utf8");
    assert.equal(await readLocationConfig(configPath), undefined);

    await writeFile(configPath, JSON.stringify({ location: { latitude: 999 } }), "utf8");
    assert.equal(await readLocationConfig(configPath), undefined);

    await writeFile(configPath, JSON.stringify({}), "utf8");
    assert.equal(await readLocationConfig(configPath), undefined);
  });
});

test("clearLocationConfig removes the file and tolerates a missing file", async () => {
  await withTempDirectory(async (directory) => {
    const configPath = join(directory, "weather-widget.json");
    await writeLocationConfig(configPath, manualLocation);
    await clearLocationConfig(configPath);
    assert.equal(await readLocationConfig(configPath), undefined);

    await clearLocationConfig(configPath);
  });
});

test("isCacheUsable matches manual snapshots only against the same fixed coordinates", () => {
  const manualSnapshot = makeSnapshot();
  manualSnapshot.location.source = "manual";
  manualSnapshot.location.latitude = 31.2304;
  manualSnapshot.location.longitude = 121.4737;

  const samePlace = { ...manualLocation, latitude: 31.2311, longitude: 121.4735 };
  const otherPlace = { ...manualLocation, latitude: 39.9042, longitude: 116.4074 };

  assert.equal(isCacheUsable(manualSnapshot, samePlace), true);
  assert.equal(isCacheUsable(manualSnapshot, otherPlace), false);
  assert.equal(isCacheUsable(manualSnapshot, undefined), false);
});

test("isCacheUsable accepts IP snapshots only in automatic mode", () => {
  const ipSnapshot = makeSnapshot();
  ipSnapshot.location.source = "ip";

  assert.equal(isCacheUsable(ipSnapshot, undefined), true);
  assert.equal(isCacheUsable(ipSnapshot, manualLocation), false);

  const legacySnapshot = makeSnapshot();
  assert.equal(isCacheUsable(legacySnapshot, undefined), true);
});
