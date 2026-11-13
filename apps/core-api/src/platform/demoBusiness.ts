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
  const plans = [[0, 1, 2], [3, 4, 5]].map((indices, route) => {
    const points = indices.map((index, position) => {
      const station = stations[index];
      const next = stations[indices[position + 1]];
      const previous = stations[indices[position - 1]];
      // 视点朝向下一个巡游点；终点沿用入站方向，形成连贯的相机视点序列。
      const from = next ? station : previous ?? station;
      const to = next ?? station;
      const fromLat = (from.lat * Math.PI) / 180;
      const toLat = (to.lat * Math.PI) / 180;
      const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
      const heading =
        from === to
          ? Math.PI
          : Math.atan2(
              Math.sin(deltaLon) * Math.cos(toLat),
              Math.cos(fromLat) * Math.sin(toLat) -
                Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon),
            );

      return {
        id: `${scene.id}-demo-point-${index + 1}`,
        name: station.name,
        lon: station.lon,
        lat: station.lat,
        // 视点飞行以站点地面位置为观察目标，高度/朝向定义相机观察姿态。
        height: station.elevationM,
        duration: 6,
        transition: 4,
        direction: 1 as const,
        loops: 1,
        radius: 8000,
        pitch: -40,
        angle: 0,
        flightHeight: 2500,
        curve: "smooth" as const,
        view: {
          lon: station.lon,
          lat: station.lat,
          height: 5200,
          heading,
          pitch: (-40 * Math.PI) / 180,
          roll: 0,
        },
      };
    });
    return {
      id: `${scene.id}-demo-route-${route + 1}`,
      name:
        route === 0
          ? `示例 · ${scene.shortName}视点飞行`
          : `Mock · ${scene.shortName}区域概览`,
      saved: true,
      // 参考 Mars3D setCameraViewList：依次飞抵视点并停留，可在界面暂停/继续。
      speedMps: route === 0 ? 180 : 130,
      routeHeightM: 800,
      points,
    };
  });
  return {
    version: 1, stations, bookmarks, plans, assets: [],
    users: [{ id: "demo", name: "演示用户", role: "管理员", enabled: true }],
  };
}
