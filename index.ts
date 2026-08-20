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
  clearLocationFromConfig,
  isCacheUsable,
  readWeatherConfig,
  resolveConfigPath,
  writeWeatherConfig,
} from "./config.ts";
import {
  DEFAULT_MODEL_ID,
  WEATHER_MODELS,
  describeWeatherModel,
  findWeatherModel,
  formatModelList,
} from "./models.ts";
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
  "  /weather auto          清除固定位置，恢复 IP 自动定位",
  "  /weather model [名称]   查看/设置气象数据模型（例：/weather model cma_grapes_global）",
  "  /weather               查看当前状态",
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
        const config = await readWeatherConfig(configPath).catch(() => undefined);
        const cached = await readFreshCache(cachePath, nowMs);
        if (!cached || !isCacheUsable(cached, config?.location, config?.model)) return undefined;
        return cached;
      },
      fetchSnapshot: async (signal) => {
        const config = await readWeatherConfig(configPath).catch(() => undefined);
        return fetchWeatherSnapshot({
          signal,
          fixedLocation: config?.location,
          model: config?.model,
        });
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
    description:
      "配置天气组件：set 固定位置、auto 恢复 IP 定位、model 切换气象模型、无参数查看状态",
    getArgumentCompletions: (prefix: string) => {
      const items = [
        { value: "set ", label: "set", description: "固定位置（城市名、IP 或 纬度,经度）" },
        { value: "auto", label: "auto", description: "清除固定位置，恢复 IP 自动定位" },
      ];
      if (prefix === "model" || prefix.startsWith("model ")) {
        items.push(
          ...WEATHER_MODELS.map((model) => ({
            value: `model ${model.id}`,
            label: model.id,
            description: model.description,
          })),
        );
      } else {
        items.push({ value: "model ", label: "model", description: "查看/设置气象数据模型" });
      }
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args: string, ctx) => {
      const configPath = resolveConfigPath();
      const cachePath = resolveCachePath();
      const trimmed = args.trim();

      if (trimmed.length === 0) {
        const config = await readWeatherConfig(configPath).catch(() => undefined);
        if (config?.location) {
          ctx.ui.notify(`定位模式：固定 ${formatLocationSummary(config.location)}`, "info");
        } else {
          const current = runtime?.currentSnapshot;
          const suffix = current ? `（当前：${current.location.displayName}）` : "";
          ctx.ui.notify(`定位模式：IP 自动定位${suffix}`, "info");
        }
        ctx.ui.notify(
          `气象模型：${config?.model ?? DEFAULT_MODEL_ID}（${describeWeatherModel(config?.model)}）`,
          "info",
        );
        if (!runtime) {
          ctx.ui.notify("天气组件当前未运行（非 TUI 模式），配置将在下次会话生效", "warning");
        }
        return;
      }

      if (trimmed === "auto" || trimmed === "ip") {
        try {
          await clearLocationFromConfig(configPath);
        } catch {
          ctx.ui.notify("清除配置文件失败，请检查 ~/.pi/agent 目录权限", "error");
          return;
        }
        await removeCache(cachePath).catch(() => undefined);
        await runtime?.forceRefresh();
        ctx.ui.notify("已恢复 IP 自动定位", "info");
        return;
      }

      if (trimmed === "model" || trimmed.startsWith("model ")) {
        const modelArg = trimmed === "model" ? "" : trimmed.slice("model".length).trim();
        if (modelArg.length === 0) {
          const config = await readWeatherConfig(configPath).catch(() => undefined);
          const current = config?.model ?? DEFAULT_MODEL_ID;
          ctx.ui.notify(
            `当前气象模型：${current}（${describeWeatherModel(current)}）\n可用模型：\n${formatModelList()}`,
            "info",
          );
          return;
        }

        const requested = modelArg === "auto" || modelArg === "default" ? DEFAULT_MODEL_ID : modelArg;
        if (!findWeatherModel(requested)) {
          ctx.ui.notify(
            `未知模型“${modelArg}”。可用模型：\n${formatModelList()}`,
            "warning",
          );
          return;
        }

        try {
          const existing = await readWeatherConfig(configPath).catch(() => undefined);
          await writeWeatherConfig(configPath, {
            location: existing?.location,
            ...(requested === DEFAULT_MODEL_ID ? {} : { model: requested }),
          });
        } catch {
          ctx.ui.notify("写入配置文件失败，请检查 ~/.pi/agent 目录权限", "error");
          return;
        }
        await removeCache(cachePath).catch(() => undefined);
        await runtime?.forceRefresh();
        ctx.ui.notify(
          requested === DEFAULT_MODEL_ID
            ? `已恢复默认气象模型 ${DEFAULT_MODEL_ID}`
            : `已切换气象模型：${requested}（${describeWeatherModel(requested)}）`,
          "info",
        );
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
        const existing = await readWeatherConfig(configPath).catch(() => undefined);
        await writeWeatherConfig(configPath, {
          location,
          ...(existing?.model !== undefined ? { model: existing.model } : {}),
        });
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
