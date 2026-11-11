import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

// 离线生成自有演示素材：不使用外部模型、图片、视频或网络资源。
const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
    body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;margin:48px;color:#203a56;line-height:1.8}h1{font-size:26px;color:#164b7c}h2{font-size:17px;margin-top:28px}.label{background:#edf5ff;border-left:4px solid #1677ff;padding:16px}li{margin:10px 0}footer{margin-top:48px;color:#6c8094;font-size:12px}
    </style><h1>气象站点演示资料</h1><p>Digital Twin Visualization · 本地示例</p>
    <div class="label">Mock 模拟资料：用于功能演示，不属于真实站点档案，不用于业务研判。</div>
    <h2>可演示的操作</h2><ol><li>从地图搜索或点位列表选择演示站点，查看观测时次和气象要素。</li><li>查看站点绑定的自有三维模型、模拟监测视频及本说明文件。</li><li>通过工具箱保存视角，选择预置巡检路线进行漫游。</li><li>切换气象时次，查看雷达回波、云图、风场和预报时效。</li></ol>
    <h2>数据与文件说明</h2><p>观测、设备遥测和视频数值均为模拟数据。文件存于服务端受控仓库，按租户和地区校验访问权限。真实业务资料由管理员后续接入。</p>
    <footer>示例版本 1 · 可在项目中重新生成 · 不依赖公网资源</footer></html>`);
  await mkdir("work/demo-assets", { recursive: true });
  const pdf = await page.pdf({ format: "A4", printBackground: true });
  await writeFile("work/demo-assets/Mock-站点说明.pdf", pdf);
  // Canvas + MediaRecorder 创建短视频；视频中的 Mock 标记始终可见。
  const videoBase64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    document.body.replaceChildren(canvas);
    const context = canvas.getContext("2d");
    const stream = canvas.captureStream(12);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 160000 });
    const chunks = [];
    const complete = new Promise((resolve) => {
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
        let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
        resolve(btoa(binary));
      };
    });
    let frame = 0;
    const draw = () => {
      context.fillStyle = "#102c46"; context.fillRect(0, 0, 640, 360);
      context.fillStyle = "#31d5d7"; context.font = "bold 25px sans-serif"; context.fillText("MOCK | Station Camera", 28, 45);
      context.fillStyle = "#dbeaff"; context.font = "18px sans-serif"; context.fillText("Simulated telemetry - not live video", 28, 78);
      context.fillStyle = "#24674c"; context.fillRect(0, 260, 640, 100);
      context.strokeStyle = "#f0f5fb"; context.lineWidth = 7; context.beginPath(); context.moveTo(310, 260); context.lineTo(310, 125); context.moveTo(274, 160); context.lineTo(350, 160); context.stroke();
      context.fillStyle = "#6ec5f7"; context.beginPath(); context.arc(310, 120, 28, 0, Math.PI * 2); context.fill();
      context.strokeStyle = "#ffc857"; context.lineWidth = 4; context.beginPath(); context.moveTo(310, 120); context.lineTo(310 + Math.cos(frame / 8) * 40, 120 + Math.sin(frame / 8) * 40); context.stroke();
      context.fillStyle = "#fff"; context.font = "18px monospace"; context.fillText(`MOCK TEMP ${(18 + Math.sin(frame / 10)).toFixed(1)} C  | FRAME ${frame}`, 28, 322);
      frame++;
    };
    draw(); recorder.start(); const timer = setInterval(draw, 1000 / 12);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    clearInterval(timer); recorder.stop(); stream.getTracks().forEach((track) => track.stop());
    return complete;
  });
  const positions = [];
  const indices = [];
  // 由长方体组合气象观测塔，所有缓冲区内嵌；无需外部纹理。
  for (const [cx, cy, cz, sx, sy, sz] of [[0,0,0,60,8,60],[0,60,0,6,120,6],[0,105,0,70,4,4],[0,125,0,28,18,24]]) {
    const offset = positions.length / 3;
    for (const [x,y,z] of [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]) positions.push(cx+x*sx/2,cy+y*sy/2,cz+z*sz/2);
    for (const i of [0,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4]) indices.push(offset+i);
  }
  const vertexBytes = Buffer.from(new Float32Array(positions).buffer);
  const indexBytes = Buffer.from(new Uint16Array(indices).buffer);
  const buffer = Buffer.concat([vertexBytes, indexBytes]);
  const model = { asset: { version: "2.0", generator: "DTV自有Mock观测塔" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.15,0.65,0.95,1], metallicFactor: 0.1, roughnessFactor: 0.7 } }],
    buffers: [{ uri: "data:application/octet-stream;base64," + buffer.toString("base64"), byteLength: buffer.length }],
    bufferViews: [{ buffer:0,byteOffset:0,byteLength:vertexBytes.length },{ buffer:0,byteOffset:vertexBytes.length,byteLength:indexBytes.length }],
    accessors: [{bufferView:0,componentType:5126,count:positions.length/3,type:"VEC3",min:[-35,-4,-30],max:[35,134,30]},{bufferView:1,componentType:5123,count:indices.length,type:"SCALAR"}] };
  const fixtures = [
    { name: "Mock-观测塔.gltf", kind: "model", base64: Buffer.from(JSON.stringify(model)).toString("base64") },
    { name: "Mock-站点说明.pdf", kind: "document", base64: pdf.toString("base64") },
    { name: "Mock-监测视频.webm", kind: "video", base64: videoBase64 },
  ];
  await writeFile("apps/core-api/src/demo-assets/fixtures.generated.json", JSON.stringify(fixtures));
  await writeFile("work/demo-assets/Mock-监测视频.webm", Buffer.from(videoBase64, "base64"));
  console.log("已生成三维模型、PDF和3秒Mock视频；均不含外部资源。");
} finally { await browser.close(); }
