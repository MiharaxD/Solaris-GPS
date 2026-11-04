/// <reference lib="webworker" />
/**
 * Web Worker do tracker: recebe frames (ImageBitmap) da tela compartilhada e roda o pipeline
 * fora da thread da página. Só lê os retângulos de que precisa (canto da busca, recorte).
 */
import { processFrame } from "./pipeline";
import type { FromWorker, ToWorker } from "./protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const canvas = new OffscreenCanvas(1, 1);
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;

scope.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  if (msg.type !== "frame") return;
  const { bitmap } = msg;
  try {
    const t0 = performance.now();
    const read = (x: number, y: number, w: number, h: number) => {
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, Math.max(1, w), Math.max(1, h));
      return { width: img.width, height: img.height, data: img.data };
    };
    const res = processFrame(read, bitmap.width, bitmap.height, { region: msg.region, detect: msg.detect, shape: msg.shape });
    let crop: ImageBitmap | null = null;
    if (res.crop && res.crop.width > 0) {
      const t1 = performance.now();
      crop = await createImageBitmap(new ImageData(new Uint8ClampedArray(res.crop.data), res.crop.width, res.crop.height));
      res.timings.encode = performance.now() - t1;
    }
    res.timings.total = performance.now() - t0;
    const out: FromWorker = {
      type: "result",
      seq: msg.seq,
      frameW: bitmap.width,
      frameH: bitmap.height,
      region: res.region,
      detection: res.detection,
      crop,
      timings: res.timings,
    };
    scope.postMessage(out, crop ? [crop] : []);
  } catch (e) {
    scope.postMessage({ type: "error", seq: msg.seq, message: e instanceof Error ? e.message : String(e) } satisfies FromWorker);
  } finally {
    bitmap.close();
  }
};
