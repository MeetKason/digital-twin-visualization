/** 将界面使用的逻辑名称映射到项目提供的 iconfont 字形。 */
const icons: Record<string, { normal: string; active?: string }> = {
  home: { normal: "shouye-weixuanzhong", active: "shouye-xuanzhong" },
  roam: { normal: "manyou-weixuanzhong", active: "manyou-xuanzhong" },
  station: {
    normal: "dianweiguanli-weixuanzhong",
    active: "dianweiguanli-xuanzhong",
  },
  weather: {
    normal: "qixiangzhuanti-weixuanzhong",
    active: "qixiangzhuanti-xuanzhong",
  },
  device: {
    normal: "shebeijiankong-weixuanzhong",
    active: "shebeijiankong-xuanzhong",
  },
  settings: { normal: "shezhi-weixuanzhong", active: "shezhi-xuanzhong" },
  user: { normal: "zhanghao" },
  password: { normal: "mima" },
  chevron: { normal: "you" },
  close: { normal: "jiajianduicuo-2" },
  layers: { normal: "tuceng" },
  tools: { normal: "gongjuxiang" },
  north: { normal: "zhibei" },
  plus: { normal: "jiajianduicuo" },
  minus: { normal: "jiajianduicuo-1" },
  fullscreen: { normal: "quanping" },
  locate: { normal: "dingwei" },
  search: { normal: "dingwei" },
  play: { normal: "bofang" },
  pause: { normal: "zanting" },
  previous: { normal: "houtui" },
  next: { normal: "qianjin" },
  up: { normal: "shang" },
  down: { normal: "xia" },
  video: { normal: "bofang" },
};

export function Icon({
  name,
  size = 24,
  active = false,
}: {
  name: string;
  size?: number;
  active?: boolean;
}) {
  const icon = icons[name] ?? icons.home;
  const fontClass = active && icon.active ? icon.active : icon.normal;
  return (
    <span
      className="icon"
      style={{ width: size, height: size, fontSize: size }}
      aria-hidden="true"
    >
      <svg className="svgfont" viewBox="0 0 1024 1024" focusable="false">
        <use href={`#icon-${fontClass}`} />
      </svg>
    </span>
  );
}
