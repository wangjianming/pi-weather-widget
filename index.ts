import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWeatherSnapshot,
  formatCoordinateLabel,
  parseCoordinateInput,
  parseIpInput,
  resolveLocationByIp,
  resolveLocationByQuery,
} from "./api.ts";
import {
  clearLocationConfig,
  isCacheUsable,
  readLocationConfig,
  resolveConfigPath,
  writeLocationConfig,
} from "./config.ts";
import {
  readFreshCache,
  removeCache,
  resolveCachePath,
  writeCacheAtomic,
} from "./cache.ts";
import { renderWeatherLine, type WeatherTheme } from "./formatter.ts";
import { WeatherRuntime, type Scheduler } from "./runtime.ts";
import type { LocationInfo } from "./types.ts";

const WIDGET_ID = "weather-widget";

const USAGE = [
  "用法：",
  "  /weather set <城市名>   固定位置（例：/weather set 上海）",
  "  /weather set <纬度,经度> 固定位置（例：/weather set 31.23,121.47）",
  "  /weather set <IP>      按该 IP 解析并固定（例：/weather set 114.114.114.114）",
  "  /weather auto          清除配置，恢复 IP 自动定位",
  "  /weather               查看当前定位模式",
].join("\n");

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

function formatLocationSummary(location: LocationInfo): string {
  const coordinates = formatCoordinateLabel(location.latitude, location.longitude);
  return `${location.displayName}（${coordinates}）`;
}

export default function weatherWidgetExtension(pi: ExtensionAPI): void {
  let runtime: WeatherRuntime | undefined;

  pi.on("session_start", (_event, ctx) => {
    runtime?.dispose();
    runtime = undefined;
    if (ctx.mode !== "tui") return;

    const cachePath = resolveCachePath();
    const configPath = resolveConfigPath();
    runtime = new WeatherRuntime({
      scheduler,
      readCache: async (nowMs) => {
        const fixed = await readLocationConfig(configPath).catch(() => undefined);
        const cached = await readFreshCache(cachePath, nowMs);
        if (!cached || !isCacheUsable(cached, fixed?.location)) return undefined;
        return cached;
      },
      fetchSnapshot: async (signal) => {
        const fixed = await readLocationConfig(configPath).catch(() => undefined);
        return fetchWeatherSnapshot({ signal, fixedLocation: fixed?.location });
      },
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

  pi.registerCommand("weather", {
    description: "配置天气组件定位：set 城市/坐标、auto 恢复 IP 定位、无参数查看状态",
    getArgumentCompletions: (prefix: string) => {
      const items = [
        { value: "set ", label: "set", description: "固定位置（城市名、IP 或 纬度,经度）" },
        { value: "auto", label: "auto", description: "清除配置，恢复 IP 自动定位" },
      ];
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx) => {
      const configPath = resolveConfigPath();
      const cachePath = resolveCachePath();
      const trimmed = args.trim();

      if (trimmed.length === 0) {
        const fixed = await readLocationConfig(configPath).catch(() => undefined);
        if (fixed) {
          ctx.ui.notify(`定位模式：固定 ${formatLocationSummary(fixed.location)}`, "info");
        } else {
          const current = runtime?.currentSnapshot;
          const suffix = current ? `（当前：${current.location.displayName}）` : "";
          ctx.ui.notify(`定位模式：IP 自动定位${suffix}`, "info");
        }
        if (!runtime) {
          ctx.ui.notify("天气组件当前未运行（非 TUI 模式），配置将在下次会话生效", "warning");
        }
        return;
      }

      if (trimmed === "auto" || trimmed === "ip") {
        try {
          await clearLocationConfig(configPath);
        } catch {
          ctx.ui.notify("清除配置文件失败，请检查 ~/.pi/agent 目录权限", "error");
          return;
        }
        await removeCache(cachePath).catch(() => undefined);
        await runtime?.forceRefresh();
        ctx.ui.notify("已恢复 IP 自动定位", "info");
        return;
      }

      const query = trimmed === "set" ? "" : trimmed.startsWith("set ") ? trimmed.slice(4).trim() : undefined;
      if (query === undefined) {
        ctx.ui.notify(`未知参数“${trimmed}”。\n${USAGE}`, "warning");
        return;
      }
      if (query.length === 0) {
        ctx.ui.notify(USAGE, "info");
        return;
      }

      let location: LocationInfo | undefined = parseCoordinateInput(query);
      if (!location) {
        const ip = parseIpInput(query);
        if (ip) {
          location = await resolveLocationByIp(ip, {
            timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
          }).catch(() => undefined);
        }
      }
      if (!location) {
        location = await resolveLocationByQuery(query, {
          timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
        }).catch(() => undefined);
      }
      if (!location) {
        ctx.ui.notify(
          `无法解析位置“${query}”：请使用“纬度,经度”坐标、公网 IP，或改用 Open-Meteo 可识别的城市名`,
          "error",
        );
        return;
      }

      try {
        await writeLocationConfig(configPath, location);
      } catch {
        ctx.ui.notify("写入配置文件失败，请检查 ~/.pi/agent 目录权限", "error");
        return;
      }
      await removeCache(cachePath).catch(() => undefined);
      await runtime?.forceRefresh();
      ctx.ui.notify(`已固定位置：${formatLocationSummary(location)}`, "info");
    },
  });
}
