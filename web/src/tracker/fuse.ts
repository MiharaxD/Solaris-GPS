/**
 * Fusão das camadas (ticket 23). Uma valida a outra; resultado incoerente é descartado.
 *  - Seguindo (com posição anterior): camada imagem + referências. Concordando (≤ `agree` px),
 *    vale a imagem (mais precisa). Discordando, a constelação (2+ ícones) vence; com 1 ícone,
 *    vence a imagem só se o NCC for alto; senão, nenhum dos dois (mantém a última).
 *  - Sem posição anterior: a busca global e a busca guiada (ícone no centro logo após o TP →
 *    só os teleportes do tipo, conferidos pela imagem). A guiada vence: ela só pode cair num
 *    teleporte do tipo certo. Sem ícone no centro, vale a global se não for "incerta".
 * Código puro: roda no Worker e no runner.
 */
import type { GlobalResult } from "./globalSearch";
import type { DetectedIcon } from "./icons";
import type { Located } from "./locate";
import type { RefFix, RefPoint } from "./references";

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

/** Posições candidatas pra busca guiada: ícones perto do centro × teleportes do mesmo tipo. */
export function centerCandidates(icons: readonly DetectedIcon[], s: number, r: number, refs: readonly RefPoint[], opt: FuseOptions = DEFAULT_FUSE): [number, number][] {
  const lim = (opt.centerIcon * r) / 126;
  const out: [number, number][] = [];
  for (const i of icons) {
    if (Math.hypot(i.dx, i.dy) > lim) continue;
    for (const q of refs) if (q.kind === i.kind) out.push([q.px[0] - i.dx * s, q.px[1] - i.dy * s]);
  }
  return out;
}

export function fuseGlobal(global: GlobalResult | null, guided: GlobalResult | null, opt: FuseOptions = DEFAULT_FUSE): Fused | null {
  const g = guided && guided.score >= opt.minGuided ? guided : null;
  if (g && global && dist(g.px, global.px) <= opt.agree) return { px: g.px, layer: "ambas", confidence: "alta" };
  if (g) return { px: g.px, layer: "ambas", confidence: "média", note: global ? "busca global discordou do teleporte" : undefined };
  if (global?.confident) return { px: global.px, layer: "imagem", confidence: "média" };
  return null;
}
