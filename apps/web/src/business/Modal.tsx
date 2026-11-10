import { useEffect, type ReactNode } from "react";
import { Icon } from "../Icon";
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);
  return (
    <div className="modal-backdrop">
      <section
        className="business-modal panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="panel-heading">
          <strong>{title}</strong>
          <button
            aria-label={`关闭${title}`}
            className="mini"
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="panel-body">{children}</div>
      </section>
    </div>
  );
}
