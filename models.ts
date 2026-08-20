export interface WeatherModelOption {
  id: string;
  description: string;
}

export const DEFAULT_MODEL_ID = "best_match";

/**
 * Open-Meteo 支持且能提供 weather_code/cloud_cover 的常用全球/国家 Seamless 模型白名单。
 * 全部坐标可用（国家模型域外走全球兑底）；仅域内可用的型号（gfs_hrrr、italia_meteo 等）
 * 与不输出 weather_code 的模型（ecmwf_aifs025、gfs_graphcast025、kma_seamless、bom_access_global）不收录。
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
  { id: "gem_seamless", description: "加拿大 GEM（全球可用，加拿大推荐）" },
  { id: "knmi_seamless", description: "荷兰 KNMI HARMONIE（本域高分辨率，域外全球兑底）" },
  { id: "dmi_seamless", description: "丹麦 DMI HARMONIE（本域高分辨率，域外全球兑底）" },
  { id: "meteoswiss_icon_seamless", description: "瑞士气象局 ICON（本域高分辨率，域外全球兑底）" },
  { id: "geosphere_seamless", description: "奥地利 AROME（本域高分辨率，域外全球兑底）" },
  { id: "chmi_aladin_seamless", description: "捷克 ALADIN（本域高分辨率，域外全球兑底）" },
  { id: "arpae_cosmo_seamless", description: "意大利 ARPAE COSMO（本域高分辨率，域外全球兑底）" },
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
