import { Icon } from "./Icon";
export function Timeline({
  times,
  index,
  onIndex,
  playing,
  onPlaying,
}: {
  times: string[];
  index: number;
  onIndex: (i: number) => void;
  playing: boolean;
  onPlaying: (b: boolean) => void;
}) {
  const label = (s: string) => s.slice(11, 16);
  return (
    <section className="timeline" aria-label="气象过程时间轴">
      <div className="timeline-header">
        <div>
          <strong>气象过程时间轴</strong>
          <span>2026-11-07 · 固定演示时次</span>
        </div>
        <div className="play-controls">
          <button
            aria-label="上一时次"
            onClick={() => onIndex(Math.max(0, index - 1))}
          >
            <Icon name="previous" size={20} />
          </button>
          <button
            aria-label={playing ? "暂停时间轴" : "播放时间轴"}
            className="primary"
            onClick={() => onPlaying(!playing)}
          >
            {playing ? "Ⅱ" : <Icon name="play" size={20} />}
          </button>
          <button
            aria-label="下一时次"
            onClick={() => onIndex(Math.min(times.length - 1, index + 1))}
          >
            <Icon name="next" size={20} />
          </button>
          <span className="tag">
            {times[index] ? label(times[index]) : "无时次"}
          </span>
        </div>
        <span className="timeline-source">Mock · 北京时间 UTC+8</span>
      </div>
      <input
        aria-label="气象时次"
        type="range"
        min="0"
        max={Math.max(0, times.length - 1)}
        value={index}
        onChange={(e) => onIndex(Number(e.target.value))}
      />
      <div className="time-ticks">
        {times.map((t, i) => (
          <button key={t} onClick={() => onIndex(i)}>
            {label(t)}
          </button>
        ))}
      </div>
    </section>
  );
}
