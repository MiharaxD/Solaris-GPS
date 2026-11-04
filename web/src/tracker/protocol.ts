/** Mensagens entre a página e o Worker do tracker. */
import type { Detection, MinimapRegion, MinimapShape } from "./minimap";

export interface FrameMessage {
  type: "frame";
  seq: number;
  bitmap: ImageBitmap;
  region: MinimapRegion | null;
  detect: boolean;
  shape: MinimapShape;
}

export type ToWorker = FrameMessage;

export interface ResultMessage {
  type: "result";
  seq: number;
  frameW: number;
  frameH: number;
  region: MinimapRegion | null;
  detection: Detection | null;
  /** Recorte do minimapa já com a máscara (alpha). */
  crop: ImageBitmap | null;
  timings: Record<string, number>;
}

export interface ErrorMessage {
  type: "error";
  seq: number;
  message: string;
}

export type FromWorker = ResultMessage | ErrorMessage;
