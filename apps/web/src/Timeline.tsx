import { UiButton, UiSlider } from "./ui/controls";
import { Icon } from "./Icon";
export function Timeline({
  times,
  mode,
  index,
  onIndex,
  playing,
  onPlaying,
}: {
  times: string[];
  mode: "demo" | "ingested";
  index: number;
  onIndex: (i: number) => void;
  playing: boolean;
  onPlaying: (b: boolean) => void;
}) {
  const label = (s: string) =>
    new Date(s).toLocaleTimeString("zh-CN", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const ticks =
    times.length <= 13
      ? times.map((_, i) => i)
      : Array.from({ length: 13 }, (_, i) =>
          Math.round((i * (times.length - 1)) / 12),
        );
  return (
    <section className="timeline" aria-label="气象过程时间轴">
      <div className="timeline-header">
        <div>
          <strong>气象过程时间轴</strong>
          <span>
            {mode === "demo"
              ? "2026-11-07 · 固定演示时次"
              : times.length
                ? "入库时次 · Mock"
                : "暂无入库时次"}
          </span>
        </div>
        <div className="play-controls">
          <UiButton
            disabled={!times.length}
            aria-label="上一时次"
            onClick={() => onIndex(Math.max(0, index - 1))}
          >
            <Icon name="previous" size={20} />
          </UiButton>
          <UiButton
            disabled={!times.length}
            aria-label={playing ? "暂停时间轴" : "播放时间轴"}
            className="primary"
            onClick={() => onPlaying(!playing)}
          >
            {playing ? <Icon name="pause" size={20} /> : <Icon name="play" size={20} />}
          </UiButton>
          <UiButton
            disabled={!times.length}
            aria-label="下一时次"
            onClick={() => onIndex(Math.min(times.length - 1, index + 1))}
          >
            <Icon name="next" size={20} />
          </UiButton>
          <span className="tag">
            {times[index] ? label(times[index]) : "无时次"}
          </span>
        </div>
        <span className="timeline-source">Mock · 北京时间</span>
      </div>
      <UiSlider
        disabled={!times.length}
        aria-label="气象时次"

        min="0"
        max={Math.max(0, times.length - 1)}
        value={index}
        onChange={(e) => onIndex(Number(e.target.value))}
      />
      <div className="time-ticks">
        {ticks.map((i) => {
          const t = times[i];
          return (
            <UiButton
              title={new Date(t).toLocaleString("zh-CN", {
                timeZone: "Asia/Shanghai",
              })}
              key={t}
              onClick={() => onIndex(i)}
            >
              {label(t)}
            </UiButton>
          );
        })}
      </div>
    </section>
  );
}
