import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Descriptions,
  Input,
  Popconfirm,
  Select,
  Space,
  Tag,
  Upload,
} from "antd";
import {
  ProductPlans,
  SignedLicenseSchema,
  type TenantEntitlement,
} from "@dtv/contracts";
import { authorizationApi, authApi } from "../api";
const stateNames: Record<TenantEntitlement["state"], string> = {
  active: "授权有效",
  development: "开发模式（未强制许可证）",
  demo: "隔离Mock演示授权",
  missing: "未导入许可证",
  invalid: "许可证无效或发行者不受信任",
  expired: "许可证已过期",
  "not-yet-valid": "许可证尚未生效",
  revoked: "许可证已吊销",
};
/** 租户可查看自己的授权；只有服务端配置的平台管理员可以导入和吊销。 */
export function TenantAuthorization({
  onApplied,
}: {
  onApplied: () => Promise<void>;
}) {
  const [status, setStatus] = useState<TenantEntitlement | null>(null),
    [tenants, setTenants] = useState<
      { tenantId: string; accountCount: number }[]
    >([]),
    [selected, setSelected] = useState(""),
    [operator, setOperator] = useState(false),
    [certificate, setCertificate] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      authorizationApi.current(controller.signal),
      authApi.session(),
    ])
      .then(async ([grant, session]) => {
        if (controller.signal.aborted) return;
        setStatus(grant);
        setSelected(grant.tenantId);
        setOperator(!!session.user?.platformAdmin);
        if (session.user?.platformAdmin) {
          const list = await authorizationApi.tenants(controller.signal);
          if (!controller.signal.aborted) setTenants(list);
        }
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, []);
  async function select(tenant: string) {
    setBusy(true);
    setError("");
    setNotice("");
    setCertificate("");
    try {
      const grant = await authorizationApi.tenant(tenant);
      setStatus(grant);
      setSelected(tenant);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply(revoke = false) {
    if (!status) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const next = revoke
        ? await authorizationApi.revoke(selected, status.revision)
        : await authorizationApi.import(
            selected,
            status.revision,
            SignedLicenseSchema.parse(JSON.parse(certificate)),
          );
      setStatus(next);
      setCertificate("");
      setNotice(
        revoke
          ? "许可证已吊销，后续业务请求立即按新状态校验"
          : "许可证已保存，后续业务请求立即按新授权校验",
      );
      await onApplied();
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "许可证JSON格式错误"
          : (e as Error).name === "ZodError"
            ? "许可证格式、套餐或依赖校验失败"
            : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tenant-authorization" aria-label="租户产品授权">
      <Alert
        type="info"
        showIcon
        message="产品授权与账号角色分别校验。许可证由离线发行工具签名，平台只保存签名证书和公钥；租户管理员不能自行扩大授权。"
      />
      {operator && (
        <Space wrap>
          <span>目标租户</span>
          <Select
            aria-label="授权目标租户"
            value={selected}
            disabled={busy}
            style={{ minWidth: 220 }}
            options={tenants.map((t) => ({
              value: t.tenantId,
              label: `${t.tenantId}（${t.accountCount}个启用账号）`,
            }))}
            onChange={(value) => void select(value)}
          />
        </Space>
      )}
      {status && (
        <Descriptions
          bordered
          size="small"
          column={2}
          items={[
            { key: "tenant", label: "租户", children: status.tenantId },
            {
              key: "state",
              label: "授权状态",
              children: (
                <Tag
                  color={
                    ["active", "demo", "development"].includes(status.state)
                      ? "green"
                      : "red"
                  }
                >
                  {stateNames[status.state]}
                </Tag>
              ),
            },
            { key: "revision", label: "配置修订", children: status.revision },
            {
              key: "plan",
              label: "产品套餐",
              children: status.license
                ? ProductPlans[status.license.plan].name
                : "—",
            },
            {
              key: "customer",
              label: "客户",
              children: status.license?.customer ?? "—",
            },
            {
              key: "project",
              label: "项目",
              children: status.license?.project.name ?? "—",
            },
            {
              key: "expires",
              label: "有效期至",
              children: status.license
                ? new Date(status.license.expiresAt).toLocaleString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                    hour12: false,
                  })
                : "—",
            },
            {
              key: "accounts",
              label: "启用账号上限",
              children: status.maxAccounts,
            },
            {
              key: "modules",
              label: "启用模块",
              span: 2,
              children: status.modules.join("、") || "无",
            },
            {
              key: "datasets",
              label: "授权数据集",
              span: 2,
              children: status.datasets.join("、") || "无",
            },
            {
              key: "regions",
              label: "授权地区",
              span: 2,
              children:
                status.regions?.join("、") ||
                (status.regions === null ? "按账号地区授权" : "无"),
            },
          ]}
        />
      )}
      {operator && (
        <>
          <Space wrap>
            <Upload
              accept=".json,application/json"
              showUploadList={false}
              disabled={busy}
              beforeUpload={async (file) => {
                try {
                  if (file.size > 32768) throw Error("许可证不能超过32KB");
                  const text = await file.text();
                  SignedLicenseSchema.parse(JSON.parse(text));
                  setCertificate(text);
                  setError("");
                } catch {
                  setError("许可证格式、套餐或大小无效，未替换当前输入");
                }
                return false;
              }}
            >
              <Button disabled={busy}>导入许可证文件</Button>
            </Upload>
            <Button
              disabled={busy || !selected}
              onClick={() => void select(selected)}
            >
              刷新授权
            </Button>
          </Space>
          <Input.TextArea
            aria-label="签名许可证JSON"
            rows={7}
            value={certificate}
            disabled={busy}
            onChange={(e) => setCertificate(e.target.value)}
            placeholder="粘贴离线签发的许可证JSON；不能直接编辑模块字段后保存"
          />
          <Space wrap>
            <Button
              type="primary"
              disabled={!certificate.trim() || !status || busy}
              onClick={() => void apply()}
            >
              校验并保存许可证
            </Button>
            <Popconfirm
              title="吊销该租户许可证？"
              description="业务请求及后续采集将被拒绝；恢复需导入更新的许可证。"
              onConfirm={() => apply(true)}
            >
              <Button
                danger
                disabled={
                  !status?.license || status.state === "revoked" || busy
                }
              >
                吊销许可证
              </Button>
            </Popconfirm>
          </Space>
        </>
      )}
      {error && <Alert type="error" showIcon message={error} />}
      {notice && <Alert type="success" showIcon message={notice} />}
    </section>
  );
}
