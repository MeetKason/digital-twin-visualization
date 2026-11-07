function checkResources(value: unknown): void {
  if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (
        key === "uri" &&
        typeof item === "string" &&
        !item.startsWith("data:")
      )
        throw new Error(
          "模型包含外部纹理或缓冲区；请使用内嵌资源的 GLB / GLTF",
        );
      checkResources(item);
    }
}
export async function validateModelFile(file: File): Promise<void> {
  if (file.size > 100 * 1024 * 1024) throw new Error("模型文件不得超过 100MB");
  let json: unknown;
  if (file.name.toLowerCase().endsWith(".glb")) {
    const header = new DataView(await file.slice(0, 20).arrayBuffer());
    if (
      header.byteLength < 20 ||
      header.getUint32(0, true) !== 0x46546c67 ||
      header.getUint32(4, true) !== 2 ||
      header.getUint32(8, true) !== file.size ||
      header.getUint32(16, true) !== 0x4e4f534a
    )
      throw new Error("不是有效 GLB 2.0 文件");
    const size = header.getUint32(12, true);
    if (size > file.size - 20) throw new Error("GLB JSON 块长度错误");
    json = JSON.parse(await file.slice(20, 20 + size).text());
  } else if (file.name.toLowerCase().endsWith(".gltf"))
    json = JSON.parse(await file.text());
  else throw new Error("仅支持 GLB / GLTF");
  if ((json as { asset?: { version?: string } })?.asset?.version !== "2.0")
    throw new Error("仅支持 glTF 2.0");
  checkResources(json);
}
