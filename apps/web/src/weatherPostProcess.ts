import { PostProcessStage, type Scene } from "cesium";

// Mars3D Rain/Snow/Fog 均以 Cesium 后处理覆盖当前视口。这里使用独立编写的
// 屏幕空间着色器，保持现有 Cesium Viewer 和离线构建，不依赖另一套 Cesium 运行时。
const RAIN_SHADER = `
uniform sampler2D colorTexture;
uniform float u_time;
in vec2 v_textureCoordinates;

float hashRain(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec4 base = texture(colorTexture, v_textureCoordinates);
  vec2 pixel = gl_FragCoord.xy;
  float rain = 0.0;
  // 三层不同间距与速度的雨丝，方向固定向下并略带风斜。
  for (int i = 0; i < 3; i++) {
    float layer = float(i);
    float width = 18.0 + layer * 9.0;
    vec2 flowing = vec2(
      pixel.x + pixel.y * 0.12 + layer * 37.0,
      pixel.y + u_time * (390.0 + layer * 75.0)
    );
    vec2 grid = flowing / vec2(width, 94.0);
    vec2 cell = floor(grid);
    vec2 local = fract(grid);
    float center = 0.2 + hashRain(cell + 17.0) * 0.6;
    float line = 1.0 - smoothstep(0.015, 0.065, abs(local.x - center));
    float lengthMask = smoothstep(0.02, 0.13, local.y) *
      (1.0 - smoothstep(0.45, 0.9, local.y));
    rain = max(rain, line * lengthMask * step(0.36, hashRain(cell + layer * 41.0)));
  }
  out_FragColor = vec4(mix(base.rgb, vec3(0.78, 0.87, 0.96), min(0.68, rain * 0.63)), base.a);
}`;

const SNOW_SHADER = `
uniform sampler2D colorTexture;
uniform float u_time;
in vec2 v_textureCoordinates;

float hashSnow(vec2 p) {
  return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453);
}

void main() {
  vec4 base = texture(colorTexture, v_textureCoordinates);
  vec2 pixel = gl_FragCoord.xy;
  float snow = 0.0;
  // 三层雪花以不同大小和低速下落；水平摆动只改变视觉位置。
  for (int i = 0; i < 3; i++) {
    float layer = float(i);
    float spacing = 34.0 + layer * 22.0;
    vec2 moving = vec2(
      pixel.x + sin(u_time * (0.6 + layer * 0.15) + layer) * (8.0 + layer * 4.0),
      pixel.y + u_time * (42.0 + layer * 19.0)
    );
    vec2 grid = moving / spacing;
    vec2 cell = floor(grid);
    vec2 center = vec2(hashSnow(cell + 11.0), hashSnow(cell + 29.0)) * 0.6 + 0.2;
    float flake = 1.0 - smoothstep(0.025, 0.085, length(fract(grid) - center));
    snow += flake * step(0.32, hashSnow(cell + 53.0)) * (0.28 + layer * 0.07);
  }
  out_FragColor = vec4(mix(base.rgb, vec3(0.94, 0.97, 1.0), min(0.75, snow)), base.a);
}`;

const FOG_SHADER = `
uniform sampler2D colorTexture;
uniform sampler2D depthTexture;
uniform float u_cameraHeight;
in vec2 v_textureCoordinates;

void main() {
  vec4 base = texture(colorTexture, v_textureCoordinates);
  float depth = czm_readDepth(depthTexture, v_textureCoordinates);
  float distance = 9000.0;
  if (depth < 1.0) {
    vec2 xy = v_textureCoordinates * 2.0 - 1.0;
    vec4 eye = czm_inverseProjection * vec4(xy, depth, 1.0);
    distance = max(0.0, -eye.z / max(0.0001, eye.w));
  }
  // 对应 Mars3D 示例的 fogByDistance: 100m 起雾，9000m 达到 0.9 强度。
  float altitudeFade = mix(1.0, 0.35, smoothstep(1000.0, 60000.0, u_cameraHeight));
  float haze = smoothstep(100.0, 9000.0, distance) * 0.9 * altitudeFade;
  out_FragColor = vec4(mix(base.rgb, vec3(0.88, 0.91, 0.94), haze), base.a);
}`;

export type WeatherEffectKind = "rain" | "snow" | "fog";

/** 后处理每帧读取当前视口，因此相机平移、旋转、缩放后天气仍覆盖整个画面。 */
export function createWeatherPostProcess(scene: Scene, kind: WeatherEffectKind): () => void {
  const startedAt = performance.now();
  const stage = scene.postProcessStages.add(new PostProcessStage({
    name: `dtv-weather-${kind}`,
    fragmentShader: kind === "rain" ? RAIN_SHADER : kind === "snow" ? SNOW_SHADER : FOG_SHADER,
    uniforms: kind === "fog"
      ? { u_cameraHeight: () => scene.camera.positionCartographic.height }
      : { u_time: () => (performance.now() - startedAt) / 1000 },
  }));
  let frame = 0;
  let lastRender = 0;
  let disposed = false;
  if (kind !== "fog") {
    const animate = (now: number) => {
      if (disposed) return;
      frame = requestAnimationFrame(animate);
      if (now - lastRender < 32) return;
      lastRender = now;
      scene.requestRender();
    };
    frame = requestAnimationFrame(animate);
  }
  scene.requestRender();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    scene.postProcessStages.remove(stage);
    scene.requestRender();
  };
}
