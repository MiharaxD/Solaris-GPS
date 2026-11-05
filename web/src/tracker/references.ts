/**
 * Camada de referências (ticket 21): teleportes e Nexus conhecidos (WutheringData pela
 * calibração + cadastrados à mão em data/maps, menos os `ignoredRefs`), identificados pelos
 * ícones do minimapa. Posição do jogador = referência − deslocamento ícone→centro × escala.
 *  - 2+ ícones: constelação (a mesma posição explica vários ícones).
 *  - 1 ícone: só com posição anterior (a referência do tipo certo mais perto do esperado).
 * Código puro: roda no Worker e no runner.
 */
import { apply, type Affine } from "../affine";
import type { ManualMarker } from "../progress";
import type { GameRef } from "../refs";
import type { DetectedIcon, IconKind } from "./icons";

export interface RefPoint {
  id: string;
  kind: IconKind;
  /** px do zoom máximo. */
  px: [number, number];
}

/** Referências do mapa em px: as do WutheringData (com a afim da calibração) e as manuais. */
export function refPoints(refs: readonly GameRef[], affine: Affine | null, manual: readonly ManualMarker[], ignored: ReadonlySet<string>): RefPoint[] {
  const out: RefPoint[] = [];
  if (affine) {
    for (const r of refs) if (!ignored.has(r.id)) out.push({ id: r.id, kind: r.kind, px: apply(affine, [r.x, r.y]) });
  }
  for (const m of manual) {
    if ((m.cat === "beacon" || m.cat === "nexus") && !ignored.has(m.id)) out.push({ id: m.id, kind: m.cat, px: [m.px[0], m.px[1]] });
  }
  return out;
}

export interface RefOptions {
  /** Distância máxima entre a posição prevista de um ícone e a referência (px do zoom máximo). */
  tol: number;
  /** Com posição anterior: até onde a nova pode estar (px do zoom máximo). */
  maxJump: number;
}

export const DEFAULT_REFS: RefOptions = { tol: 14, maxJump: 400 };

export interface RefFix {
  px: [number, number];
  /** Ícones explicados por referências (o resto pode ser ícone fora dos dados ou detecção falsa). */
  matched: { icon: DetectedIcon; ref: RefPoint }[];
  mode: "constellation" | "prev";
  /** Resíduo médio dos ícones casados (px do zoom máximo). */
  residual: number;
}

/**
 * `s` = px do mapa por px do minimapa. Sem posição anterior e com 1 ícone, devolve null
 * (ambíguo: qualquer referência do tipo serviria).
 */
export function locateByRefs(icons: readonly DetectedIcon[], s: number, refs: readonly RefPoint[], prev: [number, number] | null, opt: RefOptions = DEFAULT_REFS): RefFix | null {
  if (icons.length === 0 || refs.length === 0) return null;
  const off = icons.map((i) => [i.dx * s, i.dy * s] as const);
  type Hyp = { px: [number, number]; matched: { icon: DetectedIcon; ref: RefPoint }[]; residual: number; jump: number };
  let best: Hyp | null = null;
  for (let i = 0; i < icons.length; i++) {
    for (const q of refs) {
      if (q.kind !== icons[i]!.kind) continue;
      const P: [number, number] = [q.px[0] - off[i]![0], q.px[1] - off[i]![1]];
      const jump = prev ? Math.hypot(P[0] - prev[0], P[1] - prev[1]) : 0;
      if (prev && jump > opt.maxJump) continue;
      // quais ícones essa posição explica (cada um pela referência mais perto)
      const matched: { icon: DetectedIcon; ref: RefPoint }[] = [];
      let sx = 0;
      let sy = 0;
      for (let j = 0; j < icons.length; j++) {
        const ex = P[0] + off[j]![0];
        const ey = P[1] + off[j]![1];
        let nearest: RefPoint | null = null;
        let nd = opt.tol;
        for (const t of refs) {
          if (t.kind !== icons[j]!.kind) continue;
          const d = Math.hypot(t.px[0] - ex, t.px[1] - ey);
          if (d <= nd) {
            nd = d;
            nearest = t;
          }
        }
        if (nearest) {
          matched.push({ icon: icons[j]!, ref: nearest });
          sx += nearest.px[0] - off[j]![0];
          sy += nearest.px[1] - off[j]![1];
        }
      }
      if (matched.length === 0) continue;
      const px: [number, number] = [sx / matched.length, sy / matched.length];
      let residual = 0;
      for (const m of matched) {
        const j = icons.indexOf(m.icon);
        residual += Math.hypot(px[0] + off[j]![0] - m.ref.px[0], px[1] + off[j]![1] - m.ref.px[1]);
      }
      residual /= matched.length;
      const h: Hyp = { px, matched, residual, jump };
      if (!best || better(h, best)) best = h;
    }
  }
  if (!best) return null;
  if (best.matched.length >= 2) return { px: best.px, matched: best.matched, mode: "constellation", residual: best.residual };
  if (!prev) return null;
  return { px: best.px, matched: best.matched, mode: "prev", residual: best.residual };

  function better(a: Hyp, b: Hyp): boolean {
    if (a.matched.length !== b.matched.length) return a.matched.length > b.matched.length;
    if (prev && Math.abs(a.jump - b.jump) > 1) return a.jump < b.jump;
    return a.residual < b.residual;
  }
}
