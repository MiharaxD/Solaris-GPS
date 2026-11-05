/// <reference lib="webworker" />
/**
 * Web Worker do tracker: recebe frames (ImageBitmap) da tela compartilhada e roda o pipeline
 * fora da thread da página. Só lê os retângulos de que precisa (canto da busca, recorte).
 */
import { GlobalLocator } from "./globalSearch";
import { ImageLocator } from "./imageLocator";
import { centerCandidates, DEFAULT_FUSE, fuseGlobal, fuseLocal, type Fused } from "./fuse";
import { arrowHeading, type Heading } from "./heading";
import { detectIcons, type DetectedIcon } from "./icons";
import { DEFAULT_MASK } from "./locate";
import { locateByRefs, type RefFix } from "./references";
import { processFrame } from "./pipeline";
import type { FromWorker, LocatedResult, ToWorker } from "./protocol";
import { browserTileReader, lruTileReader } from "./tiles";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const canvas = new OffscreenCanvas(1, 1);
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
/** Uma por mapa: guarda a janela e o cache de tiles entre frames. */
let locator: ImageLocator | null = null;
let global: GlobalLocator | null = null;

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
    let heading: Heading | null = null;
    if (res.crop && res.region && res.crop.width > 0) {
      const t1 = performance.now();
      heading = arrowHeading(res.crop, res.region.r);
      res.timings.heading = performance.now() - t1;
    }
    let located: LocatedResult | null = null;
    let icons: DetectedIcon[] = [];
    let refFix: RefFix | null = null;
    let fused: Fused | null = null;
    const req = msg.locate;
    if (req?.refs && res.crop && res.region && res.crop.width > 0) {
      const t1 = performance.now();
      icons = detectIcons(res.crop, res.region.r);
      refFix = locateByRefs(icons, req.radiusPx / res.region.r, req.refs, req.prev ?? null);
      res.timings.refs = performance.now() - t1;
    }
    if (req && res.crop && res.region && res.crop.width > 0) {
      if (locator?.info.name !== req.info.name) {
        const read = browserTileReader(req.info);
        locator = new ImageLocator(req.info, read);
        global = new GlobalLocator(req.info, lruTileReader(read, 64), locator, DEFAULT_MASK);
      }
      const t1 = performance.now();
      const r = res.region.r;
      if (req.prev) {
        const L = await locator.locate(res.crop, r, req.radiusPx, req.prev, req.search);
        located = L && { ...L, mode: "local", confident: true };
        fused = fuseLocal(L, refFix);
        res.timings.locate = performance.now() - t1;
      } else {
        // ícone no centro (logo após o TP): só os teleportes do tipo; senão (ou se falhar), o mapa inteiro
        const cands = req.refs ? centerCandidates(icons, req.radiusPx / r, r, req.refs) : [];
        const guided = cands.length ? await global!.locate(res.crop, r, req.radiusPx, cands) : null;
        const G = !guided || guided.score < DEFAULT_FUSE.minGuided ? await global!.locate(res.crop, r, req.radiusPx) : null;
        const best = guided ?? G;
        located = best && { ...best, mode: "global" };
        fused = fuseGlobal(G, guided);
        res.timings.global = performance.now() - t1;
      }
    }
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
      located,
      icons,
      refFix,
      fused,
      heading,
      timings: res.timings,
    };
    scope.postMessage(out, crop ? [crop] : []);
  } catch (e) {
    scope.postMessage({ type: "error", seq: msg.seq, message: e instanceof Error ? e.message : String(e) } satisfies FromWorker);
  } finally {
    bitmap.close();
  }
};
