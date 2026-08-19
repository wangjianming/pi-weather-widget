import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { fetchWeatherSnapshot } from "./api.ts";
import {
  readFreshCache,
  removeCache,
  resolveCachePath,
  writeCacheAtomic,
} from "./cache.ts";
import { renderWeatherLine, type WeatherTheme } from "./formatter.ts";
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
