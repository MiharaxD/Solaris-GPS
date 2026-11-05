/// <reference lib="webworker" />
/**
 * Worker da medição de escala (ticket 18): recebe um print com posição conhecida, recorta o
 * minimapa com o mesmo pipeline do tracker, monta a janela do mapa das tiles e varre os raios.
 * Fica fora da página porque a varredura leva alguns segundos.
 */
import type { MapInfo } from "../maps";
import type { MinimapRegion } from "./minimap";
import { processFrame } from "./pipeline";
import { sweepScale, sweepWindow, type ScaleSweep } from "./scale";
import { browserTileReader, grayWindow } from "./tiles";

export interface ScaleRequest {
  bitmap: ImageBitmap;
  info: MapInfo;
  px: [number, number];
  /** Região ajustada à mão pra essa resolução; sem ela, detecta. */
  region: MinimapRegion | null;
  center?: number;
}

export type ScaleResponse =
  | { ok: true; sweep: ScaleSweep; r: number; ms: number }
  | { ok: false; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (ev: MessageEvent<ScaleRequest>) => {
  const { bitmap, info, px, region, center } = ev.data;
  try {
    const t0 = performance.now();
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    const read = (x: number, y: number, w: number, h: number) => {
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, Math.max(1, w), Math.max(1, h));
      return { width: img.width, height: img.height, data: img.data };
    };
    const res = processFrame(read, bitmap.width, bitmap.height, { region, detect: region === null, shape: region?.shape ?? "circle" });
    if (!res.crop || !res.region) throw new Error("não achei o minimapa no print");
    const opts = { center };
    const w = sweepWindow(px, opts);
    const win = await grayWindow(browserTileReader(info), info, w.x0, w.y0, w.w, w.h);
    const sweep = sweepScale(res.crop, res.region.r, px, win, w.x0, w.y0, opts);
    scope.postMessage({ ok: true, sweep, r: res.region.r, ms: performance.now() - t0 } satisfies ScaleResponse);
  } catch (e) {
    scope.postMessage({ ok: false, message: e instanceof Error ? e.message : String(e) } satisfies ScaleResponse);
  } finally {
    bitmap.close();
  }
};
