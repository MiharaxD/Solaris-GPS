/**
 * Regiões do mapa (ex.: Jinzhou, Ragunna, Septimont) a partir da área de topo dos marcadores
 * já posicionados. O retângulo de cada uma limita a busca global do tracker quando o usuário diz
 * onde está. Só aparecem em mapas com 2+ regiões (na prática, o Overworld).
 */
import type { Rect } from "./tracker/globalSearch";

export interface Region {
  id: string;
  label: string;
  /** Nação (agrupa no seletor); null = região solta. */
  group: string | null;
  rect: Rect;
}

/** Nação de cada região de topo do WutheringData (as outras ficam soltas). */
const NATION: Record<string, string> = {
  Jinzhou: "Huanglong",
  Ragunna: "Rinascita",
  Septimont: "Rinascita",
};

/** Mínimo de marcadores pra uma área virar região (descarta sobras do extrator). */
const MIN_POINTS = 30;

function quantile(sorted: readonly number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

/**
 * Agrupa os pontos pela área de topo e tira o retângulo de cada uma (quantis 0,5–99,5% pra
 * ignorar pontos perdidos, mais uma folga). Nações com 2+ regiões ganham também a opção inteira.
 */
export function computeRegions(points: Iterable<{ area: readonly string[]; px: number; py: number }>, margin = 600): Region[] {
  const byArea = new Map<string, { xs: number[]; ys: number[] }>();
  for (const p of points) {
    const name = p.area[0];
    if (!name) continue;
    let a = byArea.get(name);
    if (!a) byArea.set(name, (a = { xs: [], ys: [] }));
    a.xs.push(p.px);
    a.ys.push(p.py);
  }
  const out: Region[] = [];
  for (const [name, { xs, ys }] of byArea) {
    if (xs.length < MIN_POINTS) continue;
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    out.push({
      id: name,
      label: name,
      group: NATION[name] ?? null,
      rect: {
        x0: quantile(xs, 0.005) - margin,
        y0: quantile(ys, 0.005) - margin,
        x1: quantile(xs, 0.995) + margin,
        y1: quantile(ys, 0.995) + margin,
      },
    });
  }
  if (out.length < 2) return [];
  const nations = new Map<string, Region[]>();
  for (const r of out) if (r.group) nations.set(r.group, [...(nations.get(r.group) ?? []), r]);
  for (const [nation, rs] of nations) {
    if (rs.length < 2) continue;
    out.push({
      id: `nation:${nation}`,
      label: `${nation} inteira`,
      group: nation,
      rect: {
        x0: Math.min(...rs.map((r) => r.rect.x0)),
        y0: Math.min(...rs.map((r) => r.rect.y0)),
        x1: Math.max(...rs.map((r) => r.rect.x1)),
        y1: Math.max(...rs.map((r) => r.rect.y1)),
      },
    });
  }
  // por nação (ou nome da região solta); dentro da nação, a opção inteira primeiro
  const key = (r: Region) => `${r.group ?? r.label}\u0000${r.id.startsWith("nation:") ? "" : r.label}`;
  return out.sort((a, b) => key(a).localeCompare(key(b)));
}
