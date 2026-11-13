import {
  Cartesian3,
  Cartographic,
  Color,
  Ellipsoid,
  CustomDataSource,
  CustomShader,
  CustomShaderTranslucencyMode,
  HeadingPitchRange,
  HeightReference,
  LightingModel,
  Math as CesiumMath,
  Matrix4,
  MetadataComponentType,
  MetadataType,
  Ray,
  Transforms,
  VoxelContent,
  VoxelPrimitive,
  VoxelShapeType,
  type Viewer,
  type VoxelProvider,
} from "cesium";
import { FLOW_VOLUME_CEILING_M, createLatticeFlow, demoFlowFootprints, flowVolumeMeters } from "./flowLattice";

const BOX_HALF_METERS = 700;
const GROUND_CLEARANCE_M = 2;
const VOXEL_X = 64;
const VOXEL_Y = 64;
const VOXEL_Z = 32;

const VOLUME_SHADER = `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
  float speed = fsInput.metadata.speed;
  if (speed < 0.45) {
    material.diffuse = vec3(0.0);
    material.alpha = 0.0;
  } else {
    float t = clamp((speed - 0.4) / 8.0, 0.0, 1.0);
    vec3 color = mix(vec3(0.0, 0.72, 0.62), vec3(0.55, 0.9, 0.12), smoothstep(0.0, 0.28, t));
    color = mix(color, vec3(1.0, 0.82, 0.05), smoothstep(0.18, 0.48, t));
    color = mix(color, vec3(1.0, 0.42, 0.05), smoothstep(0.4, 0.72, t));
    color = mix(color, vec3(0.9, 0.08, 0.1), smoothstep(0.62, 1.0, t));
    material.diffuse = color;
    material.alpha = 0.03 + 0.07 * t;
  }
}`;

/** Speed samples in Cesium's X, then Y, then Z order. Z is up. */
function buildSpeedVolume(): Float32Array {
  const solver = createLatticeFlow(96, 96);
  for (let step = 0; step < 360; step++) solver.step();
  const speed = new Float32Array(VOXEL_X * VOXEL_Y * VOXEL_Z);
  for (let z = 0; z < VOXEL_Z; z++) {
    const heightM = ((z + 0.5) / VOXEL_Z) * FLOW_VOLUME_CEILING_M;
    for (let y = 0; y < VOXEL_Y; y++) {
      const north = (y + 0.5) / VOXEL_Y;
      for (let x = 0; x < VOXEL_X; x++) {
        speed[x + VOXEL_X * (y + VOXEL_Y * z)] = flowVolumeMeters(
          solver.flow,
          (x + 0.5) / VOXEL_X,
          north,
          heightM,
        );
      }
    }
  }
  return speed;
}

/**
 * Cartographic height of the ENU origin.
 * The scene exaggerates voxel boxes again, so the anchor is lowered until the
 * rendered bottom sits on the same terrain surface the white masses use.
 */
function anchorHeight(renderedGround: number, exaggeration: number): number {
  const scale = exaggeration > 0 ? exaggeration : 1;
  const half = FLOW_VOLUME_CEILING_M / 2;
  return (renderedGround + GROUND_CLEARANCE_M - half * (scale - 1)) / scale;
}

/** Height of the rendered globe under the demo center. Matches CLAMP_TO_GROUND. */
function sampleRenderedGround(viewer: Viewer, longitude: number, latitude: number): number | undefined {
  const ellipsoid = viewer.scene.globe.ellipsoid ?? Ellipsoid.WGS84;
  const normal = ellipsoid.geodeticSurfaceNormal(Cartesian3.fromDegrees(longitude, latitude), new Cartesian3());
  const origin = Cartesian3.fromDegrees(longitude, latitude, 12000);
  const hit = viewer.scene.globe.pick(new Ray(origin, Cartesian3.negate(normal, new Cartesian3())), viewer.scene);
  const picked = hit ? Cartographic.fromCartesian(hit)?.height : undefined;
  const sampled = picked ?? viewer.scene.globe.getHeight(Cartographic.fromDegrees(longitude, latitude));
  if (sampled === undefined || sampled <= -5 || sampled >= 8000) return undefined;
  return sampled;
}

/**
 * Draw illustrative white masses and a ray-marched speed volume.
 * The buildings are not surveyed models, and the volume is a display of the street-level solve.
 */
export function createFlowDemo(
  viewer: Viewer,
  _host: HTMLElement,
  center: [number, number],
): { dispose: () => void } {
  const [centerLon, centerLat] = center;
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLon = metersPerDegreeLat * Math.cos((centerLat * Math.PI) / 180);
  const halfLat = BOX_HALF_METERS / metersPerDegreeLat;
  const halfLon = BOX_HALF_METERS / metersPerDegreeLon;
  const west = centerLon - halfLon;
  const south = centerLat - halfLat;
  const east = centerLon + halfLon;
  const north = centerLat + halfLat;

  const buildings = new CustomDataSource("flow-demo");
  const ring = [west, south, east, south, east, north, west, north, west, south];
  buildings.entities.add({
    polyline: {
      positions: Cartesian3.fromDegreesArray(ring),
      clampToGround: true,
      width: 2,
      material: Color.fromCssColorString("#7ec8e3"),
    },
  });
  for (const block of demoFlowFootprints) {
    const lon0 = west + block.x0 * (east - west);
    const lon1 = west + block.x1 * (east - west);
    const lat0 = south + block.y0 * (north - south);
    const lat1 = south + block.y1 * (north - south);
    buildings.entities.add({
      polygon: {
        hierarchy: Cartesian3.fromDegreesArray([lon0, lat0, lon1, lat0, lon1, lat1, lon0, lat1]),
        height: 0,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        extrudedHeight: block.heightM,
        extrudedHeightReference: HeightReference.RELATIVE_TO_GROUND,
        material: Color.WHITE,
        outline: true,
        outlineColor: Color.fromCssColorString("#9aafc2"),
        closeTop: true,
        closeBottom: true,
      },
    });
  }
  let removed = false;
  const added = viewer.dataSources.add(buildings);
  void Promise.resolve(added).then(() => {
    if (removed && !viewer.isDestroyed()) viewer.dataSources.remove(buildings, true);
  });

  const halfUp = FLOW_VOLUME_CEILING_M / 2;
  const shapeTransform = new Matrix4();
  Matrix4.multiply(
    Matrix4.fromTranslation(new Cartesian3(0, 0, halfUp)),
    Matrix4.fromScale(new Cartesian3(BOX_HALF_METERS, BOX_HALF_METERS, halfUp)),
    shapeTransform,
  );
  const placement = new Matrix4();
  const speed = buildSpeedVolume();
  const provider = {
    shape: VoxelShapeType.BOX,
    dimensions: new Cartesian3(VOXEL_X, VOXEL_Y, VOXEL_Z),
    paddingBefore: new Cartesian3(),
    paddingAfter: new Cartesian3(),
    names: ["speed"],
    types: [MetadataType.SCALAR],
    componentTypes: [MetadataComponentType.FLOAT32],
    minimumValues: [[0]],
    maximumValues: [[12]],
    maximumTileCount: 1,
    availableLevels: 1,
    globalTransform: Matrix4.clone(Matrix4.IDENTITY),
    shapeTransform,
    requestData: () => Promise.resolve(VoxelContent.fromMetadataArray([new Float32Array(speed)])),
  } as unknown as VoxelProvider;
  const customShader = new CustomShader({
    lightingModel: LightingModel.UNLIT,
    translucencyMode: CustomShaderTranslucencyMode.TRANSLUCENT,
    fragmentShaderText: VOLUME_SHADER,
  });
  const primitive = new VoxelPrimitive({ provider, customShader });
  primitive.screenSpaceError = 1e6;
  primitive.stepSize = 0.65;
  primitive.depthTest = true;

  let disposed = false;
  let attached = false;
  let framed = false;
  let frame = 0;
  let ticks = 0;
  let framedAt = Number.NaN;

  const place = (renderedGround: number) => {
    const exaggeration = viewer.scene.verticalExaggeration || 1;
    Transforms.eastNorthUpToFixedFrame(
      Cartesian3.fromDegrees(centerLon, centerLat, anchorHeight(renderedGround, exaggeration)),
      undefined,
      placement,
    );
    (primitive as unknown as { modelMatrix: Matrix4 }).modelMatrix = placement;
  };
  const followGround = () => {
    if (disposed || viewer.isDestroyed()) return false;
    const rendered = sampleRenderedGround(viewer, centerLon, centerLat);
    if (rendered === undefined || Math.abs(rendered - framedAt) < 20) return false;
    place(rendered);
    if (!attached) attach();
    framedAt = rendered;
    framed = false;
    viewer.scene.requestRender();
    return true;
  };
  const frameVolume = () => {
    const sphere = primitive.boundingSphere;
    const center = sphere?.center;
    if (!sphere || !center || sphere.radius < 50) return false;
    const cart = Cartographic.fromCartesian(center);
    if (!cart || cart.height < -100 || cart.height > 8000) return false;
    viewer.camera.cancelFlight();
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    viewer.camera.viewBoundingSphere(
      sphere,
      new HeadingPitchRange(CesiumMath.toRadians(18), CesiumMath.toRadians(-46), sphere.radius * 2.2),
    );
    viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    return true;
  };
  const attach = () => {
    if (attached || disposed || viewer.isDestroyed()) return;
    attached = true;
    viewer.scene.primitives.add(primitive);
    primitive.tileLoad.addEventListener(() => {
      if (!disposed && !viewer.isDestroyed()) viewer.scene.requestRender();
    });
  };
  const onTiles = () => {
    if (followGround() && attached) framed = frameVolume();
  };

  const pump = () => {
    if (disposed || viewer.isDestroyed()) return;
    ticks += 1;
    followGround();
    if (!attached && ticks === 8) {
      place(0);
      attach();
      framedAt = 0;
    }
    if (attached && (!framed || ticks === 40 || ticks === 100)) framed = frameVolume();
    viewer.scene.requestRender();
    const waitingForTerrain = !viewer.scene.globe.tilesLoaded && ticks < 600;
    if (ticks < 180 || waitingForTerrain) frame = requestAnimationFrame(pump);
  };
  viewer.scene.globe.tileLoadProgressEvent.addEventListener(onTiles);
  place(0);
  frame = requestAnimationFrame(pump);

  return {
    dispose() {
      disposed = true;
      removed = true;
      cancelAnimationFrame(frame);
      if (!viewer.isDestroyed()) {
        viewer.scene.globe.tileLoadProgressEvent.removeEventListener(onTiles);
        if (attached) viewer.scene.primitives.remove(primitive);
        viewer.dataSources.remove(buildings, true);
        viewer.scene.requestRender();
      }
      if (!primitive.isDestroyed()) primitive.destroy();
      if (!customShader.isDestroyed()) customShader.destroy();
    },
  };
}
