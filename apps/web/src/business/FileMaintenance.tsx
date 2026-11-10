import { UiButton } from "../ui/controls";
import { useState } from "react";
import { deleteFile, listFiles } from "./files";
export function FileMaintenance({ sceneId }: { sceneId: string }) {
  const [files, setFiles] = useState<Awaited<
    ReturnType<typeof listFiles>
  > | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    // 刷新当前租户与地区的服务端文件清单，不读取其他地区的文件路径。
    setBusy(true);
    try {
      setFiles((await listFiles(sceneId)).filter((f) => !f.referenced));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="file-maintenance">
      <UiButton disabled={busy} onClick={() => void refresh()}>
        查看未关联文件
      </UiButton>
      {files && (
        <>
          <p className="muted">
            上传未保存或移除资料后未清理的服务器文件。清理前请确认其他账号没有正在关联该文件；已保存的引用会阻止清理。
          </p>
          {files.length === 0 && <p>没有未关联文件</p>}
          {files.map((file) => (
            <div className="asset-row" key={file.id}>
              <span>
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
              </span>
              <UiButton
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void deleteFile(sceneId, file.id)
                    .then(refresh)
                    .catch((e) => {
                      setError(e.message);
                      setBusy(false);
                    });
                }}
              >
                清理文件
              </UiButton>
            </div>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}；可再次查看或重试清理
        </p>
      )}
    </div>
  );
}
