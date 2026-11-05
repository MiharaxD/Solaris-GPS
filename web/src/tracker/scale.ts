/**
 * Calibração da escala minimapa→mapa (ticket 18). A escala é guardada como o raio do minimapa
 * em pixel do zoom máximo (`radiusPx`): a área do mundo que o minimapa mostra não depende da
 * resolução nem da escala de UI, então por frame basta `radiusPx / r` (r = raio detectado na
 * tela) pra ter os px do mapa por px do minimapa.
 *
 * Dado um recorte com posição conhecida, testa vários raios em volta do chute (só centro da
 * busca), cada um com o melhor NCC numa janela de translação (a anotação tem erro), em duas
 * passadas: grossa (reduz 4×, passo de 5%) e fina (reduz 2×, passo de 1%).
 */
import type { Gray, Rgba } from "./image";
import { matchTemplate, minimapTemplate, resizeGray, type Template } from "./match";

/** Chute da spec: o minimapa mostra ~1 tile (512 px) do z6 do Overworld, raio ~256. Só centro da busca. */
export const DEFAULT_RADIUS_GUESS = 256;

export interface ScaleSample {
  /** Raio do minimapa em px do zoom máximo. */
  radiusPx: number;
  score: number;
  /** Onde o centro casou, relativo à posição anotada (px do zoom máximo). */
  dx: number;
  dy: number;
  pass: "coarse" | "fine";
}

export interface ScaleSweep {
  samples: ScaleSample[];
  /** Melhor raio (refinado por parábola na passada fina). */
  best: ScaleSample | null;
}

export interface SweepOptions {
  /** Centro da busca (raio em px do zoom máximo). */
  center?: number;
  /** A busca grossa vai de center/range a center×range. */
  range?: number;
  /** Erro aceito na posição anotada, em px do zoom máximo. */
  search?: number;
}

/** Janela que `sweepScale` precisa (px do zoom máximo), pra montar das tiles antes. */
export function sweepWindow(px: [number, number], opts: SweepOptions = {}): { x0: number; y0: number; w: number; h: number } {
  const { center = DEFAULT_RADIUS_GUESS, range = 3, search = 48 } = opts;
  const half = Math.ceil(center * range * 1.1 + search + 16);
  return { x0: Math.floor(px[0]) - half, y0: Math.floor(px[1]) - half, w: 2 * half, h: 2 * half };
}

/**
 * Varre os raios. `crop` = saída de `cropMinimap` (raio `r` na tela); `win` = cinza do mapa com
 * canto em (`winX0`, `winY0`), de preferência montado com `sweepWindow`.
 */
export function sweepScale(crop: Rgba, r: number, px: [number, number], win: Gray, winX0: number, winY0: number, opts: SweepOptions = {}): ScaleSweep {
  const { center = DEFAULT_RADIUS_GUESS, range = 3, search = 48 } = opts;
  const samples: ScaleSample[] = [];
  const coarseT = minimapTemplate(crop, 4);
  const steps = Math.ceil((2 * Math.log(range)) / Math.log(1.05));
  for (let i = 0; i <= steps; i++) {
    const R = center * Math.pow(range, -1 + (2 * i) / steps);
    const s = scoreAt(coarseT, 4, R, r, px, win, winX0, winY0, search);
    if (s) samples.push({ ...s, pass: "coarse" });
  }
  const coarse = best(samples);
  if (!coarse) return { samples, best: null };
  const fineT = minimapTemplate(crop, 2);
  const fine: ScaleSample[] = [];
  for (let i = -8; i <= 8; i++) {
    const s = scoreAt(fineT, 2, coarse.radiusPx * (1 + i / 100), r, px, win, winX0, winY0, search);
    if (s) fine.push({ ...s, pass: "fine" });
  }
  samples.push(...fine);
  samples.sort((a, b) => a.radiusPx - b.radiusPx);
  return { samples, best: refine(fine) ?? coarse };
}

function best(list: ScaleSample[]): ScaleSample | null {
  return list.reduce<ScaleSample | null>((a, b) => (!a || b.score > a.score ? b : a), null);
}

/** Vértice da parábola (em log do raio) pelos vizinhos do melhor da passada fina. */
function refine(fine: ScaleSample[]): ScaleSample | null {
  const b = best(fine);
  if (!b) return null;
  const i = fine.indexOf(b);
  const p = fine[i - 1];
  const n = fine[i + 1];
  if (!p || !n) return b;
  const den = p.score - 2 * b.score + n.score;
  if (den >= 0) return b;
  const t = (0.5 * (p.score - n.score)) / den; // -0.5..0.5 em passos
  const lr = Math.log(b.radiusPx) + t * (Math.log(n.radiusPx) - Math.log(p.radiusPx)) / 2;
  return { ...b, radiusPx: Math.exp(lr) };
}

function scoreAt(t: Template, ds: number, R: number, r: number, px: [number, number], win: Gray, winX0: number, winY0: number, search: number) {
  const k = (ds * R) / r; // px do mapa por px do template
  const half = (t.width / 2) * k + search + 2 * k;
  const sx0 = Math.floor(px[0] - half);
  const sy0 = Math.floor(px[1] - half);
  const size = Math.ceil(2 * half);
  const n = Math.max(t.width + 1, Math.round(size / k));
  const small = resizeGray(subGray(win, sx0 - winX0, sy0 - winY0, size, size), n, n);
  const kk = size / n;
  const u0 = (px[0] - search - sx0) / kk - t.width / 2;
  const v0 = (px[1] - search - sy0) / kk - t.height / 2;
  const m = matchTemplate(small, t, u0, v0, u0 + (2 * search) / kk, v0 + (2 * search) / kk);
  if (!m) return null;
  return {
    radiusPx: R,
    score: m.score,
    dx: sx0 + (m.x + t.width / 2) * kk - px[0],
    dy: sy0 + (m.y + t.height / 2) * kk - px[1],
  };
}

/** Recorte de um Gray; fora da imagem = 0. */
function subGray(g: Gray, x0: number, y0: number, w: number, h: number): Gray {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = y0 + y;
    if (sy < 0 || sy >= g.height) continue;
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      if (sx >= 0 && sx < g.width) out[y * w + x] = g.data[sy * g.width + sx]!;
    }
  }
  return { width: w, height: h, data: out };
}

/** Mediana (escala salva = mediana das medições). */
export function median(list: number[]): number | null {
  if (list.length === 0) return null;
  const s = [...list].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
