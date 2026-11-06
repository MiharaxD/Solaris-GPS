/**
 * Mensagens entre a página e o Worker do tracker (ticket 25). O Worker lê os frames sozinho
 * (`stream`, via MediaStreamTrackProcessor) ou recebe um por vez (`frame`, quando o navegador
 * não tem o processor) e guarda o estado do rastreio; a página só manda configuração e comandos.
 */
import type { MapInfo } from "../maps";
import type { Fused } from "./fuse";
import type { Rect } from "./globalSearch";
import type { Heading } from "./heading";
import type { CameraView } from "./locate";
import type { DetectedIcon } from "./icons";
import type { Located } from "./locate";
import type { Detection, MinimapRegion, MinimapShape } from "./minimap";
import type { RefFix, RefPoint } from "./references";

export interface LocatedResult extends Located {
  mode: "local" | "global";
  /** Na global, margem e NCC acima dos limiares; na local, sempre true (a fusão julga o NCC). */
  confident: boolean;
}

export interface MapConfig {
  info: MapInfo;
  /** Escala salva do mapa (`minimapScale.radiusPx`); null = não dá pra localizar. */
  radiusPx: number | null;
  /** Teleportes/Nexus em px (camada de referências). */
  refs: RefPoint[];
}

export type ToWorker =
  | { type: "stream"; readable: ReadableStream<VideoFrame> }
  | { type: "frame"; bitmap: ImageBitmap }
  | { type: "config"; region: MinimapRegion | null; shape: MinimapShape; hz: number }
  | { type: "detect" }
  | { type: "map"; map: MapConfig | null }
  /** global = procurar no mapa inteiro; here = Find me (clique); hold = esperando o clique. */
  | { type: "find"; mode: "global" | "hold" }
  | { type: "find"; mode: "here"; px: [number, number] }
  | { type: "grab" }
  /** Região escolhida (só a busca no mapa inteiro respeita); null = mapa todo. */
  | { type: "area"; area: Rect | null };

export type TrackState = "sem-mapa" | "sem-escala" | "pausado" | "procurando" | "seguindo" | "perdido" | "esperando-clique";

export interface TrackStatus {
  state: TrackState;
  /** Última posição aceita, suavizada pra exibir (px do zoom máximo); continua valendo quando "perdido". */
  pos: [number, number] | null;
  /** Há quanto tempo (ms) o rastreio está pausado sem minimapa; 0 fora da pausa. */
  pausedFor: number;
  /** Frames processados por segundo (média móvel). */
  hz: number;
  /** Fração do tempo em que o Worker está processando (0–1): o custo de CPU do rastreio. */
  busy: number;
  /** Frames que chegaram e foram pulados (o Worker só pega o mais recente). */
  dropped: number;
}

export interface ResultMessage {
  type: "result";
  frameW: number;
  frameH: number;
  region: MinimapRegion | null;
  detection: Detection | null;
  /** Recorte do minimapa já com a máscara (alpha), no máximo ~4 por segundo (prévia). */
  crop: ImageBitmap | null;
  located: LocatedResult | null;
  icons: DetectedIcon[];
  refFix: RefFix | null;
  /** Posição final (ticket 23): camadas conferidas uma pela outra; null = sem resultado neste frame. */
  fused: Fused | null;
  /** Posição descartada como salto impossível (ticket 26). */
  rejected: { px: [number, number]; reason: string } | null;
  heading: Heading | null;
  /** Pra onde a câmera olha (cone de visão do minimapa); null = cone não achado. */
  camera: CameraView | null;
  /** Anel do minimapa na região (ticket 27); null = não medido (sem região ou minimapa quadrado). */
  presence: { score: number; visible: boolean } | null;
  timings: Record<string, number>;
  track: TrackStatus;
}

export type FromWorker =
  | ResultMessage
  | { type: "grab"; blob: Blob | null }
  | { type: "error"; message: string };
