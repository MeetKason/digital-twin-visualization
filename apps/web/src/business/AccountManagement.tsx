import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  type TableColumnsType,
} from "antd";
import { authApi, accountAdminApi, type ManagedAccount } from "../api";
import { SettingsSectionIds, SettingsSectionNames, type SettingsSectionId } from "@dtv/contracts";

const scenes = ["xian", "taiyuan", "chengdu"] as const;
const sceneNames: Record<(typeof scenes)[number], string> = {
  xian: "西安",
  taiyuan: "太原",
  chengdu: "成都",
};
const defaultSceneOptions = scenes.map((value) => ({
  label: sceneNames[value],
  value,
}));
const roles: Record<ManagedAccount["role"], string> = {
  admin: "租户管理员",
  editor: "编辑员",
  viewer: "只读",
};
const roleOptions = Object.entries(roles).map(([value, label]) => ({
  value,
  label,
}));
const sectionOptions = SettingsSectionIds.map((value) => ({ value, label: SettingsSectionNames[value] }));
type AccountDraft = Omit<ManagedAccount, "id">;
type CreateAccountForm = Pick<
  ManagedAccount,
  "id" | "tenantId" | "role" | "scenes" | "settingsSections"
> & {
  password: string;
};

export function AccountManagement() {
  const [sceneIds, setSceneIds] = useState<string[]>([]);
  const [platformAdmin, setPlatformAdmin] = useState(false),
    [ownTenant, setOwnTenant] = useState("");
  useEffect(() => {
    void authApi
      .session()
      .then(({ user }) => {
        setSceneIds(user?.scenes ?? []);
        setPlatformAdmin(!!user?.platformAdmin);
        setOwnTenant(user?.tenantId ?? "");
      })
      .catch(() => {});
  }, []);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const allSceneOptions = [
    ...new Map(
      [
        ...defaultSceneOptions,
        ...[...sceneIds, ...accounts.flatMap((account) => account.scenes)].map(
          (id) => ({
            value: id,
            label: sceneNames[id as keyof typeof sceneNames] ?? id,
          }),
        ),
      ].map((option) => [option.value, option]),
    ).values(),
  ];
  const sceneOptions = platformAdmin
    ? allSceneOptions
    : allSceneOptions.filter((option) => sceneIds.includes(option.value));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rowDraft, setRowDraft] = useState<AccountDraft | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [createForm] = Form.useForm<CreateAccountForm>();
  const selectedScenes = Form.useWatch("scenes", createForm) as
    | string[]
    | undefined;

  const refresh = useCallback(async () => {
    // 用户清单只从管理员 API 读取，浏览器业务资料不参与身份授权。
    try {
      setAccounts(await accountAdminApi.list());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<unknown>, message: string) {
    // 统一处理账号变更的忙碌态、服务端错误和成功后的列表刷新。
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refresh();
      setNotice(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const beginEdit = (account: ManagedAccount) => {
    setEditingId(account.id);
    setRowDraft({
      tenantId: account.tenantId,
      role: account.role,
      scenes: account.scenes,
      settingsSections: account.settingsSections ?? (account.role === "admin" ? [...SettingsSectionIds] : []),
      disabled: !!account.disabled,
    });
  };

  const saveRow = async (account: ManagedAccount, draft = rowDraft) => {
    if (!draft) return;
    if (
      await run(
        () => accountAdminApi.update(account.id, draft),
        "账号权限已更新",
      )
    ) {
      setEditingId(null);
      setRowDraft(null);
    }
  };

  const columns: TableColumnsType<ManagedAccount> = [
    {
      title: "账号",
      dataIndex: "id",
      key: "id",
      width: 130,
    },
    {
      title: "租户",
      dataIndex: "tenantId",
      key: "tenantId",
      width: 150,
      render: (tenantId: string, account) =>
        editingId === account.id ? (
          <Input
            aria-label={`${account.id} 租户`}
            disabled={!platformAdmin}
            value={rowDraft?.tenantId ?? tenantId}
            onChange={(event) =>
              setRowDraft((draft) =>
                draft ? { ...draft, tenantId: event.target.value } : draft,
              )
            }
          />
        ) : (
          tenantId
        ),
    },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      width: 120,
      render: (role: ManagedAccount["role"], account) =>
        editingId === account.id ? (
          <Select
            aria-label={`${account.id} 角色`}
            value={rowDraft?.role ?? role}
            options={roleOptions}
            onChange={(value: ManagedAccount["role"]) =>
              setRowDraft((draft) =>
                draft ? { ...draft, role: value } : draft,
              )
            }
          />
        ) : (
          roles[role]
        ),
    },
    {
      title: "地区授权",
      dataIndex: "scenes",
      key: "scenes",
      width: 230,
      render: (authorizedScenes: string[], account) =>
        editingId === account.id ? (
          <Select
            mode={platformAdmin ? "tags" : "multiple"}
            className="account-row-scenes"
            aria-label={`${account.id} 地区授权`}
            options={sceneOptions}
            style={{ width: "100%" }}
            value={rowDraft?.scenes ?? authorizedScenes}
            onChange={(value) =>
              setRowDraft((draft) =>
                draft ? { ...draft, scenes: value as string[] } : draft,
              )
            }
          />
        ) : (
          authorizedScenes
            .map(
              (scene) => sceneNames[scene as keyof typeof sceneNames] ?? scene,
            )
            .join("、")
        ),
    },
    {
      title: "系统管理权限",
      dataIndex: "settingsSections",
      key: "settingsSections",
      width: 260,
      render: (_sections: SettingsSectionId[] | undefined, account) => {
        const granted = account.settingsSections ?? (account.role === "admin" ? [...SettingsSectionIds] : []);
        return editingId === account.id ? (
          <Select
            mode="multiple"
            aria-label={`${account.id} 系统管理权限`}
            options={sectionOptions}
            value={rowDraft?.settingsSections ?? granted}
            maxTagCount="responsive"
            style={{ width: "100%" }}
            onChange={(settingsSections) => setRowDraft((draft) => draft ? { ...draft, settingsSections } : draft)}
          />
        ) : granted.length ? `${granted.length} 项` : "无";
      },
    },
    {
      title: "状态",
      dataIndex: "disabled",
      key: "disabled",
      width: 90,
      render: (disabled: boolean) =>
        disabled ? <Tag>已停用</Tag> : <Tag color="green">启用</Tag>,
    },
    {
      title: "账号操作",
      key: "actions",
      width: 300,
      render: (_value, account) => {
        const editing = editingId === account.id;
        const currentDraft = editing ? rowDraft : null;
        const accountPassword = resettingId === account.id ? password : "";
        return (
          <Space size={[6, 6]} wrap className="account-actions">
            {editing ? (
              <>
                <Button
                  type="primary"
                  size="small"
                  disabled={
                    busy ||
                    !currentDraft?.scenes.length ||
                    !currentDraft?.tenantId.trim()
                  }
                  onClick={() => void saveRow(account)}
                >
                  保存
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    setEditingId(null);
                    setRowDraft(null);
                  }}
                >
                  取消
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="small"
                  disabled={busy || editingId !== null}
                  onClick={() => beginEdit(account)}
                >
                  编辑权限
                </Button>
                <Popconfirm
                  title={account.disabled ? "启用此账号？" : "停用此账号？"}
                  onConfirm={() =>
                    void saveRow(account, {
                      tenantId: account.tenantId,
                      role: account.role,
                      scenes: account.scenes,
                      disabled: !account.disabled,
                    })
                  }
                >
                  <Button size="small" disabled={busy}>
                    {account.disabled ? "启用" : "停用"}
                  </Button>
                </Popconfirm>
                <Button
                  size="small"
                  disabled={busy}
                  onClick={() => {
                    setResettingId(
                      resettingId === account.id ? null : account.id,
                    );
                    setPassword("");
                  }}
                >
                  重置密码
                </Button>
                {resettingId === account.id && (
                  <Space.Compact className="account-password-reset">
                    <Input.Password
                      aria-label={`${account.id} 新密码`}
                      placeholder="至少 12 位新密码"
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      value={accountPassword}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <Button
                      type="primary"
                      disabled={busy || accountPassword.length < 12}
                      onClick={async () => {
                        if (
                          await run(
                            () =>
                              accountAdminApi.resetPassword(
                                account.id,
                                accountPassword,
                              ),
                            "密码已重置，原会话已失效",
                          )
                        ) {
                          setResettingId(null);
                          setPassword("");
                        }
                      }}
                    >
                      确认
                    </Button>
                  </Space.Compact>
                )}
              </>
            )}
          </Space>
        );
      },
    },
  ];

  return (
    <div className="account-management">
      <Alert
        type="info"
        showIcon
        message={
          <>
            这里管理服务器真实登录账号、角色和地区授权。密码只在新建或重置时提交，服务端仅保存
            scrypt 哈希；禁用账号会立即终止其后续请求。
          </>
        }
      />
      <Space className="account-toolbar" wrap>
        <Button
          type={creating ? "default" : "primary"}
          onClick={() => {
            if (creating) createForm.resetFields();
            setCreating((value) => !value);
          }}
        >
          {creating ? "取消新增" : "新增登录账号"}
        </Button>
        <Button loading={busy} onClick={() => void refresh()}>
          刷新
        </Button>
      </Space>
      {error && <Alert type="error" showIcon message={error} />}
      {notice && <Alert type="success" showIcon message={notice} />}
      {creating && (
        <Form<CreateAccountForm>
          form={createForm}
          layout="vertical"
          className="account-create"
          initialValues={{
            tenantId: ownTenant,
            role: "viewer",
            scenes: sceneIds.slice(0, 1),
            settingsSections: [],
          }}
          onFinish={(values) =>
            void run(async () => {
              await accountAdminApi.create(values);
              setCreating(false);
              createForm.resetFields();
            }, "账号已创建")
          }
        >
          <Form.Item
            label="账号 ID"
            name="id"
            rules={[
              { required: true, message: "请输入账号 ID" },
              { min: 2, max: 64, message: "账号 ID 长度须为 2 至 64 位" },
              {
                pattern: /^[A-Za-z0-9._-]+$/,
                message: "仅支持字母、数字、点、下划线和连字符",
              },
            ]}
          >
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item
            label="租户 ID"
            name="tenantId"
            rules={[{ required: true, message: "请输入租户 ID" }]}
          >
            <Input disabled={!platformAdmin} maxLength={64} />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select options={roleOptions} />
          </Form.Item>
          <Form.Item
            label="授权地区"
            name="scenes"
            rules={[
              {
                validator: async (_rule, value: string[] | undefined) => {
                  if (value?.length) return;
                  throw new Error("请至少选择一个授权地区");
                },
              },
            ]}
          >
            <Select
              mode={platformAdmin ? "tags" : "multiple"}
              className="account-scene-select"
              options={sceneOptions}
            />
          </Form.Item>
          <Form.Item label="系统管理权限" name="settingsSections">
            <Select mode="multiple" options={sectionOptions} maxTagCount="responsive" placeholder="不开放系统管理" />
          </Form.Item>
          <Form.Item
            label="初始密码（至少 12 位）"
            name="password"
            rules={[
              { required: true, message: "请输入初始密码" },
              { min: 12, max: 128, message: "密码长度须为 12 至 128 位" },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button
            className="account-create-submit"
            type="primary"
            htmlType="submit"
            loading={busy}
            disabled={!selectedScenes?.length}
          >
            创建账号
          </Button>
        </Form>
      )}
      <Table<ManagedAccount>
        className="account-table"
        rowKey="id"
        columns={columns}
        dataSource={accounts}
        loading={busy && !creating}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        scroll={{ x: 1280 }}
        locale={{ emptyText: error ? "账号清单加载失败" : "暂无账号" }}
      />
    </div>
  );
}
