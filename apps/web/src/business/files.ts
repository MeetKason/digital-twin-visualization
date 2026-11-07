function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("dtv-files-v1", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function storeFile(file: File) {
  if (file.size > 100 * 1024 * 1024) throw new Error("文件不得超过 100MB");
  const db = await open(),
    id = crypto.randomUUID();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(file, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return id;
  } finally {
    db.close();
  }
}
export async function readFile(id: string): Promise<Blob> {
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
export async function deleteFile(id: string) {
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
