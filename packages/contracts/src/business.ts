import { z } from "zod";
import type { Station } from "./index";
export type Coordinate = [number, number];
export interface CameraView {
  lon: number;
  lat: number;
  height: number;
  heading: number;
  pitch: number;
  roll: number;
}
export interface Bookmark {
  id: string;
  name: string;
  view: CameraView;
}
export interface ManagedStation extends Station {
  region?: string;
  maintenance?: string;
  status?: string;
  modelId?: string;
  bookmarkId?: string;
}
export interface Asset {
  id: string;
  name: string;
  kind: "model" | "video" | "document";
  blobId: string;
  fileName: string;
  size: number;
  stationId?: string;
  modelType?: string;
  scale?: number;
  heading?: number;
}
export interface CruisePoint {
  id: string;
  name: string;
  lon: number;
  lat: number;
  height: number;
  duration: number;
  transition: number;
  direction: 1 | -1;
  loops: number;
  radius: number;
  pitch: number;
  modelId?: string;
  bookmarkId?: string;
  angle?: number;
  flightHeight?: number;
  curve?: "smooth" | "linear";
  view?: CameraView;
}
export interface CruisePlan {
  id: string;
  name: string;
  points: CruisePoint[];
  saved: boolean;
}
export interface DemoUser {
  id: string;
  name: string;
  role: "管理员" | "操作员" | "只读";
  enabled: boolean;
}
export interface BusinessData {
  version: 1;
  stations: ManagedStation[];
  bookmarks: Bookmark[];
  assets: Asset[];
  plans: CruisePlan[];
  users: DemoUser[];
}
export interface BusinessPublication {
  id: string;
  tenantId: string;
  sceneId: string;
  revision: number;
  publisher: string;
  message: string;
  publishedAt: string;
  snapshot: BusinessData;
  approvalStatus: "pending_approval" | "approved" | "rejected";
  approvedBy?: string;
  rejectedBy?: string;
  reviewedAt?: string;
  reviewMessage?: string;
  active?: boolean;
  trafficPercent?: number;
  previousRevision?: number;
}
export function parseCoordinate(lon: string, lat: string): Coordinate {
  if (!lon.trim() || !lat.trim()) throw new Error("经纬度不能为空");
  const point: [number, number] = [Number(lon), Number(lat)];
  if (
    !point.every(Number.isFinite) ||
    Math.abs(point[0]) > 180 ||
    Math.abs(point[1]) > 90
  )
    throw new Error("请输入有效经纬度");
  return point;
}
const rad = (v: number) => (v * Math.PI) / 180;
const R = 6371008.8;
/** 用球面 Haversine 公式累计相邻点距离；用于演示测量，不代表测绘成果。 */
export function distanceMeters(points: Coordinate[]): number {
  return points.slice(1).reduce((sum, b, i) => {
    const a = points[i];
    const h =
      Math.sin(rad(b[1] - a[1]) / 2) ** 2 +
      Math.cos(rad(a[1])) *
        Math.cos(rad(b[1])) *
        Math.sin(rad(b[0] - a[0]) / 2) ** 2;
    return sum + 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
  }, 0);
}
/** 用球面经纬度环面积近似计算多边形面积，少于三个点时面积为零。 */
export function areaMeters(points: Coordinate[]): number {
  if (points.length < 3) return 0;
  const area = points.reduce((sum, a, i) => {
    const b = points[(i + 1) % points.length];
    let delta = rad(b[0] - a[0]);
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    return sum + delta * (2 + Math.sin(rad(a[1])) + Math.sin(rad(b[1])));
  }, 0);
  return Math.abs((area * R * R) / 2);
}
/** 校验站点坐标、编码与高程后生成新增或编辑后的不可变数组。 */
export function saveStation(
  stations: ManagedStation[],
  item: ManagedStation,
  editingId?: string,
) {
  parseCoordinate(String(item.lon), String(item.lat));
  if (!item.id.trim() || !item.name.trim())
    throw new Error("站点编码与名称必填");
  if (!Number.isFinite(item.elevationM)) throw new Error("高程必须是有效数值");
  if (stations.some((s) => s.id === item.id && s.id !== editingId))
    throw new Error("站点编码已存在");
  if (editingId && item.id !== editingId)
    throw new Error("编辑时不允许更改站点编码");
  return editingId
    ? stations.map((s) => (s.id === editingId ? { ...item } : s))
    : [...stations, { ...item }];
}
function csvRows(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
export function parseStationCsv(
  text: string,
  existing: ManagedStation[],
  sceneId: string,
) {
  const rows = csvRows(text.replace(/^\uFEFF/, ""));
  if (!rows.length || !["站点编码", "id"].includes(rows[0][0]))
    throw new Error("请使用下载的 CSV 模板");
  const imported: ManagedStation[] = [],
    errors: { line: number; message: string }[] = [];
  let skipped = 0;
  const known = new Set(existing.map((s) => s.id));
  rows.slice(1).forEach((r, i) => {
    try {
      if (r.length < 4) throw new Error("缺少必填列");
      const [id, name, lon, lat, height = "0", type = "国家有人站"] = r.map(
        (x) => x.trim(),
      );
      if (known.has(id)) {
        skipped++;
        return;
      }
      const [x, y] = parseCoordinate(lon, lat);
      const item: ManagedStation = {
        id,
        name,
        lon: x,
        lat: y,
        elevationM: Number(height),
        type,
        sceneId,
        source: "mock",
        status: "运行正常",
      };
      saveStation([], item);
      imported.push(item);
      known.add(id);
    } catch (e) {
      errors.push({
        line: i + 2,
        message: e instanceof Error ? e.message : "格式错误",
      });
    }
  });
  return { imported, errors, skipped };
}
export function movePoint<T>(points: T[], from: number, to: number) {
  const copy = [...points];
  if (from < 0 || to < 0 || from >= copy.length || to >= copy.length)
    return copy;
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}
export function validatePlan(plan: { name: string; points: CruisePoint[] }) {
  if (!plan.name.trim() || !plan.points.length)
    throw new Error("方案名称和至少一个点位必填");
  for (const p of plan.points) {
    if (
      p.angle !== undefined &&
      (!Number.isFinite(p.angle) || p.angle <= 0 || p.angle > 3600)
    )
      throw new Error("环绕角度超出范围");
    if (
      p.flightHeight !== undefined &&
      (!Number.isFinite(p.flightHeight) ||
        p.flightHeight < 0 ||
        p.flightHeight > 100000)
    )
      throw new Error("转场飞行高度超出范围");
    parseCoordinate(String(p.lon), String(p.lat));
    for (const [key, value] of Object.entries({
      height: p.height,
      duration: p.duration,
      transition: p.transition,
      loops: p.loops,
      radius: p.radius,
      pitch: p.pitch,
    })) {
      if (!Number.isFinite(value)) throw new Error(`${key} 无效`);
    }
    if (
      p.duration < 1 ||
      p.duration > 600 ||
      p.transition < 0.1 ||
      p.transition > 120 ||
      p.radius < 10 ||
      p.radius > 100000 ||
      !Number.isInteger(p.loops) ||
      p.loops < 1 ||
      p.loops > 10 ||
      p.pitch > 0 ||
      p.pitch < -89
    )
      throw new Error("环绕/转场参数超出范围");
  }
}

const stringId = z.string().min(1).max(200);
const viewSchema = z.object({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  height: z.number().positive(),
  heading: z.number(),
  pitch: z.number(),
  roll: z.number(),
});
const stationSchema = z.object({
  id: stringId,
  name: z.string().min(1).max(200),
  sceneId: stringId,
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  elevationM: z.number(),
  source: z.literal("mock"),
  type: z.string(),
  region: z.string().optional(),
  maintenance: z.string().optional(),
  status: z.string().optional(),
  modelId: z.string().optional(),
  bookmarkId: z.string().optional(),
});
const pointSchema = z.object({
  id: stringId,
  name: z.string(),
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  height: z.number(),
  duration: z.number(),
  transition: z.number(),
  direction: z.union([z.literal(1), z.literal(-1)]),
  loops: z.number(),
  radius: z.number(),
  pitch: z.number(),
  modelId: z.string().optional(),
  bookmarkId: z.string().optional(),
  angle: z.number().optional(),
  flightHeight: z.number().optional(),
  curve: z.enum(["smooth", "linear"]).optional(),
});
const businessSchema = z.object({
  version: z.literal(1),
  stations: z.array(stationSchema).max(10000),
  bookmarks: z
    .array(z.object({ id: stringId, name: z.string(), view: viewSchema }))
    .max(1000),
  assets: z
    .array(
      z.object({
        id: stringId,
        name: z.string(),
        kind: z.enum(["model", "video", "document"]),
        modelType: z.string().optional(),
        blobId: stringId,
        fileName: z.string(),
        size: z.number().nonnegative(),
        stationId: z.string().optional(),
        scale: z.number().positive().optional(),
        heading: z.number().optional(),
      }),
    )
    .max(1000),
  plans: z
    .array(
      z.object({
        id: stringId,
        name: z.string(),
        saved: z.boolean(),
        points: z.array(pointSchema).max(200),
      }),
    )
    .max(1000),
  users: z
    .array(
      z.object({
        id: stringId,
        name: z.string(),
        role: z.enum(["管理员", "操作员", "只读"]),
        enabled: z.boolean(),
      }),
    )
    .max(1000),
});
export function parseBusinessData(raw: unknown, sceneId: string): BusinessData {
  const value = businessSchema.parse(raw);
  if (value.stations.some((s) => s.sceneId !== sceneId))
    throw new Error("本地资料所属地区不匹配");
  const unique = (items: { id: string }[], label: string) => {
    if (new Set(items.map((i) => i.id)).size !== items.length)
      throw new Error(`${label} ID 重复`);
  };
  unique(value.stations, "站点");
  unique(value.plans, "方案");
  unique(value.assets, "模型/附件");
  unique(value.bookmarks, "视角");
  unique(value.users, "用户");
  const models = new Set(
      value.assets.filter((a) => a.kind === "model").map((a) => a.id),
    ),
    bookmarks = new Set(value.bookmarks.map((b) => b.id)),
    stations = new Set(value.stations.map((s) => s.id));
  const refs = (item: { modelId?: string; bookmarkId?: string }) => {
    if (item.modelId && !models.has(item.modelId))
      throw new Error("关联模型不存在");
    if (item.bookmarkId && !bookmarks.has(item.bookmarkId))
      throw new Error("关联视角不存在");
  };
  value.stations.forEach(refs);
  for (const plan of value.plans) {
    unique(plan.points, "方案节点");
    if (plan.saved) validatePlan(plan);
    plan.points.forEach(refs);
  }
  for (const asset of value.assets)
    if (asset.stationId && !stations.has(asset.stationId))
      throw new Error("附件关联站点不存在");
  return value;
}
export function csvCell(value: unknown): string {
  let text = String(value);
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
