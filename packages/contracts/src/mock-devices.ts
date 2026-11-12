import type { SceneConfig } from "./index";

export interface MockDeviceTelemetry {
  id: string;
  name: string;
  type: "自动气象站" | "雨量站" | "雷达站" | "土壤传感器";
  status: "online" | "warning" | "offline";
  temperatureC: number;
  batteryPercent: number;
  signalDbm: number;
  lastSeenAt: string;
  source: "mock";
  protocol: "模拟心跳";
  location: { lon: number; lat: number };
  alert: string | null;
}

/** 本地演示设备，不代表真实设备、真实链路或真实视频状态。 */
export function demoDevices(scene: SceneConfig, now = new Date()): MockDeviceTelemetry[] {
  // 固定设备序列和状态组合，时间只影响心跳时间，便于 UI 告警流程稳定演示。
  const definitions = [
    ["自动气象站", "气象站"] as const,
    ["雨量站", "雨量站"] as const,
    ["雷达站", "雷达站"] as const,
    ["土壤传感器", "土壤传感器"] as const,
    ["自动气象站", "气象站"] as const,
    ["雨量站", "雨量站"] as const,
  ];
  return definitions.map(([type, label], index) => {
    const status = index === 4 ? "warning" : index === 5 ? "offline" : "online";
    const ageMs = status === "offline" ? 15 * 60000 : status === "warning" ? 4 * 60000 : 30000;
    return {
      id: `${scene.id}-mock-device-${index + 1}`,
      name: `${scene.shortName}${label} ${String(index + 1).padStart(2, "0")}`,
      type,
      status,
      temperatureC: Number((19 + index * 1.3).toFixed(1)),
      batteryPercent: Math.max(18, 96 - index * 13),
      signalDbm: -48 - index * 9,
      lastSeenAt: new Date(now.getTime() - ageMs).toISOString(),
      source: "mock",
      protocol: "模拟心跳",
      // 固定在场景中心附近，保证每次演示的地图定位结果一致。
      location: { lon: scene.center[0] + (index % 3 - 1) * 0.035, lat: scene.center[1] + (Math.floor(index / 3) - 0.5) * 0.035 },
      alert: status === "warning" ? "模拟告警：电池电量偏低" : status === "offline" ? "模拟告警：心跳超时" : null,
    };
  });
}
