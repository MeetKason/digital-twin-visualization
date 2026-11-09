function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("dtv-files-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function readLegacyFile(id: string): Promise<Blob> {
  const db = await open();
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const r = db.transaction("files").objectStore("files").get(id);
      r.onsuccess = () =>
        r.result
          ? resolve(r.result)
          : reject(new Error("本地文件已丢失，请重新上传"));
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
async function deleteLegacyFile(id: string) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

const endpoint = (sceneId: string, id?: string) =>
  `/api/scenes/${encodeURIComponent(sceneId)}/files${id ? `/${encodeURIComponent(id)}` : ""}`;
async function checked(response: Response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `文件请求失败（${response.status}）`);
  }
  return response;
}
export async function storeFile(sceneId: string, file: File): Promise<string> {
  if (file.size > 100 * 1024 * 1024) throw new Error("文件不得超过100MB");
  const response = await checked(
    await fetch(endpoint(sceneId), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-DTV-Request": "1",
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
      },
      body: file,
    }),
  );
  return (await response.json()).id;
}
export async function readFile(sceneId: string, id: string): Promise<Blob> {
  if (!id.startsWith("srv_")) return readLegacyFile(id);
  return (
    await checked(
      await fetch(endpoint(sceneId, id), { credentials: "same-origin" }),
    )
  ).blob();
}
export async function deleteFile(sceneId: string, id: string) {
  if (!id.startsWith("srv_")) return deleteLegacyFile(id);
  await checked(
    await fetch(endpoint(sceneId, id), {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "X-DTV-Request": "1" },
    }),
  );
}
export async function migrateFile(sceneId: string, id: string, name: string) {
  return storeFile(sceneId, new File([await readLegacyFile(id)], name));
}

export async function persistUploadedFile(
  sceneId: string,
  id: string,
  save: () => Promise<boolean>,
) {
  if (await save()) return;
  // A lost response may mean the save succeeded: server reference checks protect it.
  await deleteFile(sceneId, id).catch(() => {});
  throw new Error(
    "资料未保存，文件未关联；请重新加载后重试。未清理的文件可在“查看未关联文件”中处理",
  );
}
export async function listFiles(
  sceneId: string,
): Promise<{ id: string; name: string; size: number; referenced: boolean }[]> {
  return (
    await checked(
      await fetch(endpoint(sceneId), { credentials: "same-origin" }),
    )
  ).json();
}
