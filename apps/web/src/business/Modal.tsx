import { Modal as AntModal } from "antd";
import type { ReactNode } from "react";

/** 全站业务弹窗统一复用 Ant Modal 的键盘、焦点与遮罩交互。 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <AntModal
      open
      centered
      closable={{ "aria-label": `关闭${title}` }}
      title={title}
      className="business-modal"
      width={600}
      maskClosable={false}
      footer={null}
      onCancel={onClose}
      styles={{
        body: { maxHeight: "calc(94vh - 72px)", overflowY: "auto" },
      }}
    >
      {children}
    </AntModal>
  );
}
