/**
 * Fusão das camadas (ticket 23). Uma valida a outra; resultado incoerente é descartado.
 *  - Seguindo (com posição anterior): camada imagem + referências. Concordando (≤ `agree` px),
 *    vale a imagem (mais precisa). Discordando, a constelação (2+ ícones) vence; com 1 ícone,
 *    vence a imagem só se o NCC for alto; senão, nenhum dos dois (mantém a última).
 *  - Sem posição anterior: a busca global e a busca guiada (os ícones à vista → só as posições
 *    que põem um teleporte do tipo certo onde o ícone está, conferidas pela imagem). A guiada
 *    vence: ela só pode cair numa posição que explica um ícone. Sem ícone, vale a global se não
 *    for "incerta".
 * Código puro: roda no Worker e no runner.
 */
import type { GlobalResult } from "./globalSearch";
import type { DetectedIcon } from "./icons";
import type { Located } from "./locate";
import { locateByRefs, type RefFix, type RefPoint } from "./references";

export type Layer = "imagem" | "referências" | "ambas";
export type Confidence = "alta" | "média" | "baixa";

export interface Fused {
  px: [number, number];
  layer: Layer;
  confidence: Confidence;
  /** O que foi descartado e por quê, se algo foi. */
  note?: string;
}

export interface FuseOptions {
  /** Distância máxima (px do zoom máximo) pra duas camadas "concordarem". */
  agree: number;
  /** NCC mínimo da imagem pra valer sozinha; acima de `strongScore`, vence 1 ícone discordante. */
  minScore: number;
  strongScore: number;
  /** Ícone a até isso do centro (px da tela a 1440p) = logo após o TP. */
  centerIcon: number;
  /** NCC mínimo da busca guiada. */
  minGuided: number;
}

export const DEFAULT_FUSE: FuseOptions = { agree: 20, minScore: 0.3, strongScore: 0.6, centerIcon: 30, minGuided: 0.25 };

const dist = (a: readonly [number, number], b: readonly [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function fuseLocal(image: Located | null, ref: RefFix | null, opt: FuseOptions = DEFAULT_FUSE): Fused | null {
  const img = image && image.score >= opt.minScore ? image : null;
  if (img && ref) {
    if (dist(img.px, ref.px) <= opt.agree) return { px: img.px, layer: "ambas", confidence: "alta" };
    if (ref.mode === "constellation") return { px: ref.px, layer: "referências", confidence: "média", note: "imagem discordou da constelação" };
    if (img.score >= opt.strongScore) return { px: img.px, layer: "imagem", confidence: "média", note: "ícone discordou da imagem" };
    return null;
  }
  if (img) return { px: img.px, layer: "imagem", confidence: img.score >= opt.strongScore ? "média" : "baixa" };
  if (ref) return { px: ref.px, layer: "referências", confidence: ref.mode === "constellation" ? "média" : "baixa" };
  return null;
}

/** Há ícone sob a seta (a até `centerIcon` do centro): o jogador acabou de teleportar pra ele. */
export function iconAtCenter(icons: readonly DetectedIcon[], r: number, opt: FuseOptions = DEFAULT_FUSE): boolean {
  const lim = (opt.centerIcon * r) / 126;
  return icons.some((i) => Math.hypot(i.dx, i.dy) <= lim);
}

export interface Guided {
  /** Posições a conferir pela imagem (px do zoom máximo). */
  candidates: [number, number][];
  /**
   * A posição achada pode pular a barreira de saltos: ícone sob a seta (logo após o TP) ou
   * constelação (2+ ícones explicados pela mesma posição). Um ícone só, longe, não basta.
   */
  trusted: boolean;
}

/**
 * Candidatas da busca guiada (`s` = px do mapa por px do minimapa). Com ícone sob a seta, só
 * ele conta (posição = teleporte do tipo, como antes). Senão, 2+ ícones que formam uma
 * constelação dão uma posição só; nos outros casos, cada ícone × cada teleporte do tipo dele.
 */
export function guidedCandidates(icons: readonly DetectedIcon[], s: number, r: number, refs: readonly RefPoint[], opt: FuseOptions = DEFAULT_FUSE): Guided {
  if (icons.length === 0 || refs.length === 0) return { candidates: [], trusted: false };
  const lim = (opt.centerIcon * r) / 126;
  const center = icons.filter((i) => Math.hypot(i.dx, i.dy) <= lim);
  if (center.length === 0 && icons.length >= 2) {
    const fix = locateByRefs(icons, s, refs, null);
    if (fix?.mode === "constellation") return { candidates: [fix.px], trusted: true };
  }
  const out: [number, number][] = [];
  for (const i of center.length ? center : icons) {
    for (const q of refs) {
      if (q.kind !== i.kind) continue;
      const p: [number, number] = [q.px[0] - i.dx * s, q.px[1] - i.dy * s];
      if (!out.some((o) => dist(o, p) < opt.agree / 2)) out.push(p);
    }
  }
  return { candidates: out, trusted: center.length > 0 };
}

export function fuseGlobal(global: GlobalResult | null, guided: GlobalResult | null, opt: FuseOptions = DEFAULT_FUSE): Fused | null {
  const g = guided && guided.score >= opt.minGuided ? guided : null;
  if (g && global && dist(g.px, global.px) <= opt.agree) return { px: g.px, layer: "ambas", confidence: "alta" };
  if (g) return { px: g.px, layer: "ambas", confidence: "média", note: global ? "busca global discordou do teleporte" : undefined };
  if (global?.confident) return { px: global.px, layer: "imagem", confidence: "média" };
  return null;
}
