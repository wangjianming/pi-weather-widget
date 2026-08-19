export type WeatherFamily =
  | "clear"
  | "cloud"
  | "fog"
  | "rain"
  | "snow"
  | "thunder"
  | "unknown";

export interface WeatherPresentation {
  symbol: string;
  description: string;
  family: WeatherFamily;
}

export const KNOWN_WMO_CODES = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75,
  77, 80, 81, 82, 85, 86, 95, 96, 99,
] as const;

const presentations = new Map<number, WeatherPresentation>([
  [0, { symbol: "☀", description: "晴", family: "clear" }],
  [1, { symbol: "☀", description: "大部晴朗", family: "clear" }],
  [2, { symbol: "◒", description: "多云", family: "cloud" }],
  [3, { symbol: "☁", description: "阴", family: "cloud" }],
  [45, { symbol: "≋", description: "雾", family: "fog" }],
  [48, { symbol: "≋", description: "雾凇", family: "fog" }],
  [51, { symbol: "☂", description: "小毛毛雨", family: "rain" }],
  [53, { symbol: "☂", description: "毛毛雨", family: "rain" }],
  [55, { symbol: "☂", description: "大毛毛雨", family: "rain" }],
  [56, { symbol: "☂", description: "轻微冻雨", family: "rain" }],
  [57, { symbol: "☂", description: "冻雨", family: "rain" }],
  [61, { symbol: "☂", description: "小雨", family: "rain" }],
  [63, { symbol: "☂", description: "中雨", family: "rain" }],
  [65, { symbol: "☂", description: "大雨", family: "rain" }],
  [66, { symbol: "☂", description: "轻微冻雨", family: "rain" }],
  [67, { symbol: "☂", description: "强冻雨", family: "rain" }],
  [71, { symbol: "❄", description: "小雪", family: "snow" }],
  [73, { symbol: "❄", description: "中雪", family: "snow" }],
  [75, { symbol: "❄", description: "大雪", family: "snow" }],
  [77, { symbol: "❄", description: "米雪", family: "snow" }],
  [80, { symbol: "☂", description: "小阵雨", family: "rain" }],
  [81, { symbol: "☂", description: "阵雨", family: "rain" }],
  [82, { symbol: "☂", description: "强阵雨", family: "rain" }],
  [85, { symbol: "❄", description: "小阵雪", family: "snow" }],
  [86, { symbol: "❄", description: "强阵雪", family: "snow" }],
  [95, { symbol: "⚡", description: "雷暴", family: "thunder" }],
  [96, { symbol: "⚡", description: "雷暴伴冰雹", family: "thunder" }],
  [99, { symbol: "⚡", description: "强雷暴伴冰雹", family: "thunder" }],
]);

const unknownPresentation: WeatherPresentation = {
  symbol: "○",
  description: "未知",
  family: "unknown",
};

export function getWeatherPresentation(code: number): WeatherPresentation {
  return presentations.get(code) ?? unknownPresentation;
}
