import { it, expect } from "vitest";
import { validateModelFile } from "../apps/web/src/business/modelValidation";
function glb(json: object) {
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const bytes = new Uint8Array(20 + text.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.length, true);
  view.setUint32(12, text.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(new TextEncoder().encode(text), 20);
  return new File([bytes], "model.glb");
}
it("GLB 与 GLTF 不得引用外网缓冲或纹理，合法内嵌模型可接收", async () => {
  await expect(
    validateModelFile(glb({ asset: { version: "2.0" }, scenes: [{}] })),
  ).resolves.toBeUndefined();
  await expect(
    validateModelFile(
      glb({
        asset: { version: "2.0" },
        buffers: [{ uri: "https://example.com/a.bin" }],
      }),
    ),
  ).rejects.toThrow("外部");
  await expect(
    validateModelFile(
      new File(
        [
          '{"asset":{"version":"2.0"},"images":[{"uri":"https://example.com/image.png"}]}',
        ],
        "model.gltf",
      ),
    ),
  ).rejects.toThrow("外部");
  await expect(
    validateModelFile(new File(["bad"], "model.glb")),
  ).rejects.toThrow();
});
