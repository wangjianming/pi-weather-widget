export interface WeatherModelOption {
  id: string;
  description: string;
}

export const DEFAULT_MODEL_ID = "best_match";

/**
 * Open-Meteo 支持且能提供 weather_code/cloud_cover 的常用全球模型白名单。
 * 注意：ecmwf_aifs025 / gfs_graphcast025 等 AI 模型不输出 weather_code，不可用。
 */
export const WEATHER_MODELS: readonly WeatherModelOption[] = [
  { id: "best_match", description: "Open-Meteo 默认（按区域自动挑模型）" },
  { id: "cma_grapes_global", description: "中国气象局 GRAPES（中国区域推荐）" },
  { id: "ecmwf_ifs025", description: "欧洲中期天气预报中心 IFS 0.25°" },
  { id: "gfs_seamless", description: "美国 NCEP GFS" },
  { id: "icon_seamless", description: "德国 ICON" },
  { id: "meteofrance_seamless", description: "法国 ARPEGE/AROME" },
  { id: "jma_seamless", description: "日本气象厅 GSM/MSM" },
  { id: "metno_seamless", description: "挪威 MET 北欧模型" },
  { id: "ukmo_seamless", description: "英国气象局 UM" },
];

const MODEL_IDS = new Set(WEATHER_MODELS.map((model) => model.id));

export function isSupportedModelId(value: unknown): value is string {
  return typeof value === "string" && MODEL_IDS.has(value);
}

export function findWeatherModel(id: string): WeatherModelOption | undefined {
  return WEATHER_MODELS.find((model) => model.id === id);
}

export function describeWeatherModel(id: string | undefined): string {
  return findWeatherModel(id ?? DEFAULT_MODEL_ID)?.description ?? (id ?? DEFAULT_MODEL_ID);
}

export function formatModelList(): string {
  return WEATHER_MODELS.map((model) => `  ${model.id} — ${model.description}`).join("\n");
}
