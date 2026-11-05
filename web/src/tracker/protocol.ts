/** Mensagens entre a página e o Worker do tracker. */
import type { MapInfo } from "../maps";
import type { Located } from "./locate";
import type { Detection, MinimapRegion, MinimapShape } from "./minimap";

/** Pedido da camada imagem (ticket 19): achar o minimapa em volta da posição anterior. */
export interface LocateRequest {
  info: MapInfo;
  /** Escala salva do mapa (`minimapScale.radiusPx`). */
  radiusPx: number;
  prev: [number, number];
  /** Raio da busca, px do zoom máximo (padrão 160). */
  search?: number;
}

export interface FrameMessage {
  type: "frame";
  seq: number;
  bitmap: ImageBitmap;
  region: MinimapRegion | null;
  detect: boolean;
  shape: MinimapShape;
  locate?: LocateRequest;
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
  /** Resultado da camada imagem, quando pedida. */
  located: Located | null;
  timings: Record<string, number>;
}

export interface ErrorMessage {
  type: "error";
  seq: number;
  message: string;
}

export type FromWorker = ResultMessage | ErrorMessage;
