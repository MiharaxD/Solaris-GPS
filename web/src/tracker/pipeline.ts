/**
 * Pipeline do tracker por frame. O MESMO código roda no Web Worker (frames da tela
 * compartilhada) e no runner de fixtures em Node: quem chama só fornece `read`, que devolve
 * um retângulo do frame em RGBA.
 */
import type { Rgba } from "./image";
import { cropMinimap, detectMinimap, searchCorner, type Detection, type MinimapRegion, type MinimapShape } from "./minimap";

export type ReadRect = (x: number, y: number, w: number, h: number) => Rgba;

export interface FrameOptions {
  /** Região já conhecida (ajuste do usuário ou detecção anterior). */
  region: MinimapRegion | null;
  /** Força a detecção automática mesmo com região conhecida. */
  detect: boolean;
  shape: MinimapShape;
}

export interface FrameResult {
  region: MinimapRegion | null;
  detection: Detection | null;
  crop: Rgba | null;
  /** ms por etapa. */
  timings: Record<string, number>;
}

const now = () => performance.now();

export function processFrame(read: ReadRect, frameW: number, frameH: number, opts: FrameOptions): FrameResult {
  const timings: Record<string, number> = {};
  let region = opts.region;
  let detection: Detection | null = null;
  if (opts.detect || !region) {
    const t0 = now();
    const c = searchCorner(frameW, frameH);
    detection = detectMinimap(read(0, 0, c.w, c.h), frameW, frameH, opts.shape);
    timings.detect = now() - t0;
    if (detection && (opts.detect || !region)) region = { ...detection.region, shape: opts.shape };
  }
  let crop: Rgba | null = null;
  if (region) {
    const t0 = now();
    const x = Math.floor(region.cx - region.r);
    const y = Math.floor(region.cy - region.r);
    const size = Math.ceil(region.r * 2) + 2;
    crop = cropMinimap(read(x, y, size, size), region, x, y);
    timings.crop = now() - t0;
  }
  return { region, detection, crop, timings };
}
