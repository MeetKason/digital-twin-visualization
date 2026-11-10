import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import { authApi, publicationApi } from "../api";
import type { BusinessPublication } from "@dtv/contracts";
import type { Business } from "./useBusiness";

export function PublicationPage({ business }: { business: Business }) {
  const [canPublish, setCanPublish] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [trafficPercent, setTrafficPercent] = useState(100);
  const [publications, setPublications] = useState<BusinessPublication[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const session = await authApi.session();
      const allowed = session.user?.role === "admin";
      setCanPublish(allowed);
      setCurrentUserId(session.user?.id ?? "");
      if (!allowed) {
        setPublications([]);
        return;
      }
      setPublications(await publicationApi.list(business.sceneId, signal));
    },
    [business.sceneId],
  );

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
      await publicationApi.publish(
        business.sceneId,
        business.revision,
        message.trim(),
      );
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
    if (
      !window.confirm(
        `确定将已发布版本 ${targetRevision} 恢复为新的草稿修订吗？当前草稿会保留在历史修订中。`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const restored = await publicationApi.rollback(
        business.sceneId,
        targetRevision,
        business.revision,
      );
      await business.reload();
      await refresh();
      setNotice(
        `版本 ${targetRevision} 已恢复为草稿修订 ${restored.revision}；发布历史未修改`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** 审批流程与发布者分离，拒绝时将原因传回服务端审计。 */
  async function review(revision: number, decision: "approve" | "reject") {
    const reviewMessage =
      decision === "reject"
        ? (window.prompt("请填写拒绝原因（必填）")?.trim() ?? "")
        : (window.prompt("审批意见（选填）")?.trim() ?? "");
    if (decision === "reject" && !reviewMessage) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await publicationApi.review(
        business.sceneId,
        revision,
        decision,
        reviewMessage,
      );
      await refresh();
      setNotice(
        decision === "approve"
          ? `版本 ${revision} 审批通过`
          : `版本 ${revision} 已拒绝`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** 激活已审批版本，并按用户稳定比例逐步放量。 */
  async function activate(revision: number) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await publicationApi.activate(business.sceneId, revision, trafficPercent);
      await refresh();
      setNotice(
        `版本 ${revision} 已激活，${trafficPercent}% 的只读用户将看到此版本`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns: TableColumnsType<BusinessPublication> = [
    { title: "修订", dataIndex: "revision", key: "revision", width: 80 },
    {
      title: "状态",
      key: "status",
      width: 130,
      render: (_value, item) => {
        if (item.active)
          return (
            <Tag color="green">在线 · 灰度 {item.trafficPercent ?? 100}%</Tag>
          );
        const status = {
          pending_approval: ["orange", "待审批"],
          approved: ["blue", "已审批"],
          rejected: ["red", "已拒绝"],
        }[item.approvalStatus];
        return <Tag color={status[0]}>{status[1]}</Tag>;
      },
    },
    {
      title: "发布时间",
      dataIndex: "publishedAt",
      key: "publishedAt",
      width: 175,
      render: (value: string) =>
        new Date(value).toLocaleString("zh-CN", {
          timeZone: "Asia/Shanghai",
          hour12: false,
        }),
    },
    { title: "发布人", dataIndex: "publisher", key: "publisher", width: 120 },
    {
      title: "审批信息",
      key: "review",
      width: 160,
      render: (_value, item) =>
        item.reviewMessage || item.approvedBy || item.rejectedBy || "—",
    },
    {
      title: "发布说明",
      dataIndex: "message",
      key: "message",
      width: 200,
      render: (value: string) => value || "—",
    },
    {
      title: "快照内容",
      key: "snapshot",
      width: 220,
      render: (_value, item) =>
        `${item.snapshot.stations.length} 站点 · ${item.snapshot.plans.length} 方案 · ${item.snapshot.assets.length} 资源`,
    },
    ...(canPublish
      ? [
          {
            title: "操作",
            key: "actions",
            width: 320,
            render: (_value: unknown, item: BusinessPublication) => (
              <Space wrap size={[4, 6]}>
                {item.approvalStatus === "pending_approval" &&
                  item.publisher !== currentUserId && (
                    <>
                      <Button
                        size="small"
                        type="primary"
                        disabled={busy}
                        onClick={() => void review(item.revision, "approve")}
                      >
                        批准
                      </Button>
                      <Button
                        size="small"
                        danger
                        disabled={busy}
                        onClick={() => void review(item.revision, "reject")}
                      >
                        拒绝
                      </Button>
                    </>
                  )}
                {item.approvalStatus === "pending_approval" &&
                  item.publisher === currentUserId && (
                    <span className="muted">需其他管理员审批</span>
                  )}
                {item.approvalStatus === "approved" && !item.active && (
                  <Popconfirm
                    title={`激活已审批版本 ${item.revision}？`}
                    description="只读用户将按设定灰度比例读取此快照。"
                    onConfirm={() => void activate(item.revision)}
                  >
                    <Button size="small" type="primary" disabled={busy}>
                      激活
                    </Button>
                  </Popconfirm>
                )}
                <Popconfirm
                  title={`恢复版本 ${item.revision} 为新草稿？`}
                  description="当前草稿会保留在历史修订中。"
                  onConfirm={() => void rollback(item.revision)}
                >
                  <Button size="small" disabled={busy || business.revision < 1}>
                    恢复为新草稿
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <section className="publication-page" aria-label="业务发布管理">
      <Alert
        type="info"
        showIcon
        message="发布会将当前服务端修订保存为不可变快照。发布后需由另一位管理员审批，再设置灰度比例并激活；未进入灰度组的只读用户继续读取上一活动版本或演示基线。"
      />
      <dl>
        <dt>当前地区</dt>
        <dd>{business.sceneId}</dd>
        <dt>当前修订</dt>
        <dd>{business.revision || "尚未保存"}</dd>
      </dl>
      {canPublish ? (
        <div className="publication-form">
          <label>
            发布说明（选填）
            <Input.TextArea
              maxLength={200}
              showCount
              rows={2}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="例如：秋季演练点位更新"
            />
          </label>
          <label>
            激活灰度比例（%）
            <InputNumber
              min={1}
              max={100}
              step={1}
              value={trafficPercent}
              onChange={(value) =>
                setTrafficPercent(Math.min(100, Math.max(1, value ?? 1)))
              }
            />
          </label>
          <Button
            className="publication-submit"
            type="primary"
            loading={busy}
            disabled={business.revision < 1}
            onClick={() => void publish()}
          >
            发布当前修订 {business.revision || ""}
          </Button>
          {business.revision < 1 && (
            <span className="muted">先保存一次业务资料，再发布当前修订。</span>
          )}
        </div>
      ) : (
        <p className="muted">仅管理员可以查看、审批和激活版本。</p>
      )}
      {error && <Alert type="error" showIcon message={error} />}
      {notice && <Alert type="success" showIcon message={notice} />}
      <h3>已发布版本</h3>
      <Table<BusinessPublication>
        className="publication-table"
        rowKey="id"
        columns={columns}
        dataSource={publications}
        loading={busy}
        scroll={{ x: 1180 }}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{
          emptyText: canPublish ? "当前地区暂无已发布版本" : "暂无版本",
        }}
      />
    </section>
  );
}
