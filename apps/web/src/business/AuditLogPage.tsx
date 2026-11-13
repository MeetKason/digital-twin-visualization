import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Input,
  Select,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import { auditApi, type AuditEntry } from "../api";

const resultLabel: Record<string, string> = {
  success: "成功",
  denied: "拒绝",
  rejected: "未通过",
};
const columns = ["时间", "操作人", "地区", "操作", "结果"];
const resultOptions = [
  { value: "all", label: "全部结果" },
  { value: "success", label: "成功" },
  { value: "denied", label: "拒绝" },
  { value: "rejected", label: "未通过" },
];
const tableColumns: TableColumnsType<AuditEntry> = [
  {
    title: "时间",
    dataIndex: "at",
    key: "at",
    width: 200,
    render: localTime,
  },
  { title: "操作人", dataIndex: "actor", key: "actor", width: 140 },
  {
    title: "地区",
    dataIndex: "sceneId",
    key: "sceneId",
    width: 100,
    render: (value: string) => value || "—",
  },
  { title: "操作", dataIndex: "action", key: "action" },
  {
    title: "结果",
    dataIndex: "result",
    key: "result",
    width: 110,
    render: (value: string) => (
      <Tag
        color={
          value === "success" ? "green" : value === "denied" ? "red" : "orange"
        }
      >
        {resultLabel[value] ?? value}
      </Tag>
    ),
  },
];
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
        <label className="audit-search-field">
          <span>搜索操作人、地区或操作</span>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="输入关键词"
            allowClear
          />
        </label>
        <label className="audit-result-field">
          <span>结果筛选</span>
          <Select
            aria-label="结果筛选"
            value={result}
            onChange={setResult}
            options={resultOptions}
          />
        </label>
        <Button onClick={() => void refresh()} loading={loading}>
          刷新
        </Button>
        <Button onClick={exportCsv} disabled={filtered.length === 0}>
          导出 CSV
        </Button>
      </div>
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            <Button size="small" onClick={() => void refresh()}>
              重试
            </Button>
          }
        />
      )}
      <Table<AuditEntry>
        className="audit-table"
        aria-label="审计记录"
        rowKey="id"
        columns={tableColumns}
        dataSource={filtered}
        loading={loading}
        scroll={{ x: 760 }}
        pagination={{
          pageSize: 20,
          hideOnSinglePage: true,
          showTotal: (total) => `共 ${total} 条`,
        }}
        locale={{
          emptyText: error
            ? "审计记录加载失败"
            : entries.length
              ? "没有符合筛选条件的记录"
              : "暂无审计记录",
        }}
      />
    </section>
  );
}
