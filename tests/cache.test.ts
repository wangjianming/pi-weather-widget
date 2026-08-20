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

test("readFreshCache rejects and removes parseable non-ISO timestamps", async () => {
  await withTempDirectory(async (directory) => {
    const cachePath = join(directory, "weather-widget.json");
    await writeFile(
      cachePath,
      JSON.stringify(makeSnapshot("Tue, 19 Aug 2026 06:00:00 GMT")),
      "utf8",
    );

    assert.equal(
      await readFreshCache(cachePath, Date.parse("2026-08-19T07:00:00.000Z")),
      undefined,
    );
    await assert.rejects(readFile(cachePath, "utf8"), { code: "ENOENT" });
  });
});

test("readFreshCache rejects and removes normalized invalid calendar dates", async () => {
  await withTempDirectory(async (directory) => {
    const cachePath = join(directory, "weather-widget.json");
    await writeFile(
      cachePath,
      JSON.stringify(makeSnapshot("2026-02-30T06:00:00.000Z")),
      "utf8",
    );

    assert.equal(
      await readFreshCache(cachePath, Date.parse("2026-03-02T07:00:00.000Z")),
      undefined,
    );
    await assert.rejects(readFile(cachePath, "utf8"), { code: "ENOENT" });
  });
});

test("readFreshCache rejects and removes invalid nested snapshot values", async () => {
  const snapshot = makeSnapshot();
  const invalidSnapshots = [
    { ...snapshot, location: { ...snapshot.location, latitude: 91 } },
    {
      ...snapshot,
      location: { ...snapshot.location, displayName: "\u001b[31m西安" },
    },
    { ...snapshot, weather: { ...snapshot.weather, relativeHumidityPercent: 101 } },
    { ...snapshot, weather: { ...snapshot.weather, weatherCode: 0.5 } },
    { ...snapshot, weather: { ...snapshot.weather, windSpeedKmh: -1 } },
  ];

  for (const invalidSnapshot of invalidSnapshots) {
    await withTempDirectory(async (directory) => {
      const cachePath = join(directory, "weather-widget.json");
      await writeFile(cachePath, JSON.stringify(invalidSnapshot), "utf8");
      assert.equal(
        await readFreshCache(cachePath, Date.parse("2026-08-19T07:00:00.000Z")),
        undefined,
      );
      await assert.rejects(readFile(cachePath, "utf8"), { code: "ENOENT" });
    });
  }
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

test("snapshots may carry a location source of ip or manual, but nothing else", async () => {
  await withTempDirectory(async (directory) => {
    const cachePath = join(directory, "weather-widget.json");
    const nowMs = Date.parse("2026-08-19T07:00:00.000Z");

    for (const source of ["ip", "manual"]) {
      const snapshot = makeSnapshot();
      snapshot.location.source = source;
      await writeCacheAtomic(cachePath, snapshot);
      assert.deepEqual(await readFreshCache(cachePath, nowMs), snapshot);
    }

    const snapshot = makeSnapshot();
    await writeCacheAtomic(cachePath, snapshot);
    assert.deepEqual(await readFreshCache(cachePath, nowMs), snapshot);

    const invalid = makeSnapshot();
    invalid.location.source = "gps" as never;
    await writeCacheAtomic(cachePath, invalid);
    assert.equal(await readFreshCache(cachePath, nowMs), undefined);
  });
});
