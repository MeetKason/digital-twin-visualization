import { demoStations, type BusinessData, type SceneConfig } from "@dtv/contracts";

/** 仅供隔离演示租户的新场景使用；正式账号及已有修订不自动注入或覆盖资料。 */
export function createDemoBusiness(scene: SceneConfig): BusinessData {
  const stations = demoStations(scene).map((station, index) => ({
    ...station,
    type: index % 3 === 0 ? "雷达站" : index % 2 ? "国家无人站" : "国家有人站",
    status: "运行正常",
    ...(index < 3 ? { bookmarkId: `${scene.id}-demo-view-${index + 1}` } : {}),
  }));
  const bookmarks = stations.slice(0, 3).map((station, index) => ({
    id: `${scene.id}-demo-view-${index + 1}`,
    name: `Mock · ${station.name}俯瞰`,
    view: { lon: station.lon, lat: station.lat, height: 8000, heading: Math.PI, pitch: -Math.PI / 4, roll: 0 },
  }));
  const plans = [[0, 1, 2], [3, 4, 5]].map((indices, route) => ({
    id: `${scene.id}-demo-route-${route + 1}`,
    name: `Mock · ${scene.shortName}${route === 0 ? "站点巡检" : "区域概览"}`,
    saved: true,
    points: indices.map((index) => {
      const station = stations[index];
      return {
        id: `${scene.id}-demo-point-${index + 1}`,
        name: station.name,
        lon: station.lon, lat: station.lat,
        height: 5000, duration: 8, transition: 4,
        direction: 1 as const, loops: 1, radius: 2500, pitch: -40,
        flightHeight: 8000, curve: "smooth" as const,
      };
    }),
  }));
  return {
    version: 1, stations, bookmarks, plans, assets: [],
    users: [{ id: "demo", name: "演示用户", role: "管理员", enabled: true }],
  };
}
