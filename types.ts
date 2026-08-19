export interface LocationInfo {
  city?: string;
  region?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  displayName: string;
}

export interface CurrentWeather {
  temperatureC: number;
  apparentTemperatureC: number;
  relativeHumidityPercent: number;
  weatherCode: number;
  windSpeedKmh: number;
  observedAt?: string;
}

export interface WeatherSnapshot {
  location: LocationInfo;
  weather: CurrentWeather;
  fetchedAt: string;
}

export type FetchLike = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;
