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
