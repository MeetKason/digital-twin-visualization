import { useCallback, useEffect, useState } from "react";
import { authApi, publicationApi } from "../api";
import type { Business } from "./useBusiness";

export function PublicationPage({ business }: { business: Business }) {
  const [canPublish, setCanPublish] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [trafficPercent, setTrafficPercent] = useState(100);
  const [publications, setPublications] = useState<Awaited<ReturnType<typeof publicationApi.list>>>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const session = await authApi.session();
    const allowed = session.user?.role === "admin";
    setCanPublish(allowed);
    setCurrentUserId(session.user?.id ?? "");
    if (!allowed) {
      setPublications([]);
      return;
    }
    setPublications(await publicationApi.list(business.sceneId, signal));
  }, [business.sceneId]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError((e as Error).message);
    });
    return () => controller.abort();
  }, [refresh]);
  /** 创建当前修订的发布快照；快照之后仍需另一管理员审批才能激活。 */
  async function publish() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await publicationApi.publish(business.sceneId, business.revision, message.trim());
      setMessage("");
      await refresh();
      setNotice(`修订 ${business.revision} 已发布`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** 恢复会生成新草稿修订，不会改写历史快照。 */
  async function rollback(targetRevision: number) {
    if (!window.confirm(`确定将已发布版本 ${targetRevision} 恢复为新的草稿修订吗？当前草稿会保留在历史修订中。`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const restored = await publicationApi.rollback(
        business.sceneId, targetRevision, business.revision,
      );
      await business.reload();
      await refresh();
      setNotice(`版本 ${targetRevision} 已恢复为草稿修订 ${restored.revision}；发布历史未修改`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** 审批流程与发布者分离，拒绝时将原因传回服务端审计。 */
  async function review(revision: number, decision: "approve" | "reject") {
    const message = decision === "reject"
      ? window.prompt("请填写拒绝原因（必填）")?.trim() ?? ""
      : window.prompt("审批意见（选填）")?.trim() ?? "";
    if (decision === "reject" && !message) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await publicationApi.review(business.sceneId, revision, decision, message);
      await refresh();
      setNotice(decision === "approve" ? `版本 ${revision} 审批通过` : `版本 ${revision} 已拒绝`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  /** 激活已审批版本，并按用户稳定比例逐步放量。 */
  async function activate(revision: number) {
    if (!window.confirm(`确认将已审批版本 ${revision} 切换为当前在线版本吗？只读用户将看到此快照。`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await publicationApi.activate(business.sceneId, revision, trafficPercent);
      await refresh();
      setNotice(`版本 ${revision} 已激活，${trafficPercent}% 的只读用户将看到此版本`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="publication-page" aria-label="业务发布管理">
      <p className="data-disclaimer">发布会将当前服务端修订保存为不可变快照。发布后需由另一位管理员审批，再设置灰度比例并激活；未进入灰度组的只读用户继续读取上一活动版本或演示基线。</p>
      <dl><dt>当前地区</dt><dd>{business.sceneId}</dd><dt>当前修订</dt><dd>{business.revision || "尚未保存"}</dd></dl>
      {canPublish ? (
        <>
          <label>发布说明（选填）<input maxLength={200} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="例如：秋季演练点位更新" /></label>
          <label>激活灰度比例（%）<input type="number" min={1} max={100} step={1} value={trafficPercent} onChange={(event) => setTrafficPercent(Math.max(1, Math.min(100, Number(event.target.value) || 1)))} /></label>
          <button className="primary" disabled={busy || business.revision < 1} onClick={() => void publish()}>{busy ? "正在发布…" : `发布当前修订 ${business.revision || ""}`}</button>
          {business.revision < 1 && <p className="muted">先保存一次业务资料，再发布当前修订。</p>}
        </>
      ) : <p className="muted">仅管理员可以查看、审批和激活版本。</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      {notice && <p role="status" className="success-text">{notice}</p>}
      <h3>已发布版本</h3>
      {canPublish && !publications.length && <p className="muted">当前地区暂无已发布版本。</p>}
      {!!publications.length && <div className="table-scroll"><table aria-label="已发布版本"><thead><tr><th>修订</th><th>状态</th><th>发布时间</th><th>发布人</th><th>审批信息</th><th>发布说明</th><th>快照内容</th>{canPublish && <th>操作</th>}</tr></thead><tbody>{publications.map((item) => <tr key={item.id}><td>{item.revision}</td><td>{item.active ? `在线 · 灰度 ${item.trafficPercent ?? 100}%` : item.approvalStatus === "pending_approval" ? "待审批" : item.approvalStatus === "approved" ? "已审批" : "已拒绝"}</td><td>{new Date(item.publishedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</td><td>{item.publisher}</td><td>{item.reviewMessage || item.approvedBy || item.rejectedBy || "—"}</td><td>{item.message || "—"}</td><td>{item.snapshot.stations.length} 站点 · {item.snapshot.plans.length} 方案 · {item.snapshot.assets.length} 资源</td>{canPublish && <td>{item.approvalStatus === "pending_approval" && item.publisher !== currentUserId && <><button disabled={busy} onClick={() => void review(item.revision, "approve")}>批准</button><button disabled={busy} onClick={() => void review(item.revision, "reject")}>拒绝</button></>}{item.approvalStatus === "pending_approval" && item.publisher === currentUserId && <span className="muted">需其他管理员审批</span>}{item.approvalStatus === "approved" && !item.active && <button disabled={busy} onClick={() => void activate(item.revision)}>激活</button>}<button disabled={busy || business.revision < 1} onClick={() => void rollback(item.revision)}>恢复为新草稿</button></td>}</tr>)}</tbody></table></div>}
    </section>
  );
}
