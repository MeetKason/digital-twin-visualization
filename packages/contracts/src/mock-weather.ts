import type { WeatherObservation } from "./index";

export type MockWeatherTopic =
  | "rainstorm"
  | "convection"
  | "cold-snow"
  | "flash-flood";

export interface MockWeatherWarning {
  type: string;
  level: "黄色 Mock" | "橙色 Mock" | "红色 Mock";
  value: number;
  unit: string;
}

/** 仅用于原型交互的透明阈值示例，不是正式预警或风险算法。 */
export function deriveMockWeatherWarning(
  topic: MockWeatherTopic,
  observation: WeatherObservation | undefined,
  elevationM = 0,
): MockWeatherWarning | null {
  // 各专题使用显式阈值和 Mock 标签；仅展示交互提示，不代表正式气象预警。
  if (!observation) return null;
  const rainfall = observation.elements.rainfallMm ?? 0;
  const wind = observation.elements.windSpeedMs ?? 0;
  const temperature = observation.elements.temperatureC ?? 99;
  if (topic === "rainstorm" && rainfall >= 2.4)
    return { type: "短时强降水（模拟）", level: rainfall >= 4 ? "橙色 Mock" : "黄色 Mock", value: rainfall, unit: "mm/h" };
  if (topic === "convection" && (wind >= 3.5 || rainfall >= 3.2))
    return { type: "强对流关注（模拟）", level: wind >= 4.8 || rainfall >= 4.5 ? "橙色 Mock" : "黄色 Mock", value: Math.max(wind, rainfall), unit: "m/s 或 mm/h" };
  if (topic === "cold-snow" && temperature <= 16)
    return { type: "低温关注（模拟）", level: temperature <= 12 ? "橙色 Mock" : "黄色 Mock", value: temperature, unit: "°C" };
  if (topic === "flash-flood" && rainfall >= 2 && elevationM < 500)
    return { type: "山洪关注（模拟）", level: rainfall >= 4 ? "红色 Mock" : "橙色 Mock", value: rainfall, unit: "mm/h" };
  return null;
}
