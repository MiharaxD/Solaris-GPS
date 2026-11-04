/**
 * Laboratório do tracker (só pra depurar): abre um print, roda o MESMO pipeline do Worker e
 * mostra o frame com o círculo detectado, o mapa de bordas do canto e o recorte mascarado.
 */
import "./style.css";
import { embedInFrame, resize, subImage, toGray, type Rgba } from "./tracker/image";
import { searchCorner } from "./tracker/minimap";
import { processFrame } from "./tracker/pipeline";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const root = document.getElementById("lab")!;
const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp" });
const sim1080 = h("input", { type: "checkbox" });
const out = h("div", { className: "lab-out" });
const info = h("pre", { className: "lab-info" });
root.append(
  h("h1", { textContent: "Laboratório do tracker" }),
  h("p", {
    textContent:
      "Abra um print de tela cheia (ou um recorte só do minimapa: ele é colado num frame 2560×1440 sintético). " +
      "Roda o mesmo pipeline do Worker.",
  }),
  h("div", { className: "lab-bar" }, file, h("label", {}, sim1080, " reduzir pra 1080p")),
  info,
  out,
);

function toCanvas(img: Rgba, maxW = 640): HTMLCanvasElement {
  const c = h("canvas", { width: img.width, height: img.height });
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  c.style.width = `${Math.min(maxW, img.width)}px`;
  return c;
}

async function decode(f: File): Promise<Rgba> {
  const bmp = await createImageBitmap(f);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { width: d.width, height: d.height, data: d.data };
}

file.addEventListener("change", () => void run());
sim1080.addEventListener("change", () => void run());

async function run(): Promise<void> {
  const f = file.files?.[0];
  if (!f) return;
  let frame = await decode(f);
  const note: string[] = [];
  if (frame.width < 800) {
    frame = embedInFrame(frame);
    note.push("recorte colado em 2560×1440 na posição (40, 40)");
  }
  if (sim1080.checked && frame.height !== 1080) {
    frame = resize(frame, Math.round((frame.width * 1080) / frame.height), 1080);
    note.push("reduzido pra 1080p");
  }
  const read = (x: number, y: number, w: number, hh: number) => subImage(frame, x, y, w, hh);
  const res = processFrame(read, frame.width, frame.height, { region: null, detect: true, shape: "circle" });

  const view = toCanvas(frame, 900);
  const ctx = view.getContext("2d")!;
  if (res.region) {
    ctx.lineWidth = Math.max(2, frame.height / 400);
    ctx.strokeStyle = "#ff3b3b";
    ctx.beginPath();
    ctx.arc(res.region.cx, res.region.cy, res.region.r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // mapa de bordas (gradiente) do canto procurado, na resolução de trabalho da detecção
  const c = searchCorner(frame.width, frame.height);
  const g = toGray(read(0, 0, c.w, c.h), Math.max(1, Math.round(frame.height / 540)));
  const edges = new Uint8ClampedArray(g.width * g.height * 4);
  for (let y = 1; y < g.height - 1; y++) {
    for (let x = 1; x < g.width - 1; x++) {
      const i = y * g.width + x;
      const v = Math.min(255, Math.hypot(g.data[i + 1]! - g.data[i - 1]!, g.data[i + g.width]! - g.data[i - g.width]!) * 3);
      edges.fill(v, i * 4, i * 4 + 3);
      edges[i * 4 + 3] = 255;
    }
  }
  out.replaceChildren(
    h("figure", {}, view, h("figcaption", { textContent: "frame + círculo detectado" })),
    h("figure", {}, toCanvas({ width: g.width, height: g.height, data: edges }, 400), h("figcaption", { textContent: "bordas do canto" })),
    ...(res.crop ? [h("figure", {}, toCanvas(res.crop, 300), h("figcaption", { textContent: "recorte com máscara" }))] : []),
  );
  const d = res.detection;
  info.textContent = [
    `frame ${frame.width}×${frame.height}${note.length ? ` (${note.join("; ")})` : ""}`,
    d ? `minimapa: centro (${d.region.cx.toFixed(1)}, ${d.region.cy.toFixed(1)}) raio ${d.region.r.toFixed(1)} · confiança ${(d.score * 100).toFixed(0)}%` : "minimapa: não encontrado",
    `ms: ${Object.entries(res.timings).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" · ")}`,
  ].join("\n");
}
