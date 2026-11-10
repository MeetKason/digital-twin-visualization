import { useCallback, useEffect, useMemo, useState } from "react";
import { auditApi, type AuditEntry } from "../api";

const resultLabel: Record<string, string> = {
  success: "成功",
  denied: "拒绝",
  rejected: "未通过",
};
const columns = ["时间", "操作人", "地区", "操作", "结果"];
function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[=+@-]/.test(text.trimStart()) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
function localTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(date);
}

export function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      setEntries(await auditApi.list(signal));
      setError("");
    } catch (e) {
      if (!signal?.aborted) setError((e as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return [...entries]
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .filter((entry) => result === "all" || entry.result === result)
      .filter(
        (entry) =>
          !search ||
          [entry.actor, entry.sceneId, entry.action, entry.result].some(
            (value) => value.toLocaleLowerCase().includes(search),
          ),
      );
  }, [entries, query, result]);

  function exportCsv() {
    const content = [
      columns,
      ...filtered.map((entry) => [
        localTime(entry.at),
        entry.actor,
        entry.sceneId,
        entry.action,
        resultLabel[entry.result] ?? entry.result,
      ]),
    ]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(
      new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "tenant-audit.csv";
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="audit-page" aria-label="操作审计">
      <p className="data-disclaimer">
        记录由服务端按当前登录租户提供，只读展示最近 500
        条。演示账号只能查看自己的隔离演示记录。
      </p>
      <div className="audit-toolbar">
        <label>
          搜索操作人、地区或操作
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入关键词"
          />
        </label>
        <label>
          结果筛选
          <select
            aria-label="结果筛选"
            value={result}
            onChange={(event) => setResult(event.target.value)}
          >
            <option value="all">全部结果</option>
            <option value="success">成功</option>
            <option value="denied">拒绝</option>
            <option value="rejected">未通过</option>
          </select>
        </label>
        <button onClick={() => void refresh()} disabled={loading}>
          刷新
        </button>
        <button onClick={exportCsv} disabled={filtered.length === 0}>
          导出 CSV
        </button>
      </div>
      {error && (
        <div role="alert" className="error-text">
          <p>{error}</p>
          <button onClick={() => void refresh()}>重试</button>
        </div>
      )}
      {loading ? (
        <p className="muted" role="status">
          正在加载审计记录…
        </p>
      ) : (
        <div className="table-scroll audit-table-wrap">
          <table aria-label="审计记录">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry) => (
                <tr key={entry.id}>
                  <td>{localTime(entry.at)}</td>
                  <td>{entry.actor}</td>
                  <td>{entry.sceneId || "—"}</td>
                  <td>{entry.action}</td>
                  <td>{resultLabel[entry.result] ?? entry.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && (
            <p className="muted audit-empty">
              {error
                ? ""
                : entries.length
                  ? "没有符合筛选条件的记录。"
                  : "暂无审计记录。"}
            </p>
          )}
        </div>
      )}
      {!loading && (
        <p className="muted">
          显示 {filtered.length} / {entries.length} 条
        </p>
      )}
    </section>
  );
}
