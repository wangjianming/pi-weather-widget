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
