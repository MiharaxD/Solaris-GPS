/**
 * Direção do jogador pela seta no centro do minimapa (ticket 22). A seta é um triângulo com
 * um entalhe atrás, simétrico pelo eixo ponta→costas: acha o eixo de maior simetria da
 * silhueta (amarelo + face clara) e a ponta pelo lado que vai mais longe do centróide (nos
 * prints: ~27 px na frente contra ~21 atrás a 1440p). O cone de visão é da câmera e não entra.
 * Código puro: roda no Worker e no runner.
 */
import type { Rgba } from "./image";

export interface Heading {
  /** 0 = norte, sentido horário, em graus. */
  deg: number;
  /** Fração da silhueta que coincide com o espelho pelo eixo (1 = simétrica). */
  symmetry: number;
  /** Comprimento à frente / atrás do centróide (≈ 1,3 na seta). */
  ratio: number;
}

/** Silhueta da seta: amarelo e branco-amarelado (não azulado) perto do centro. */
function arrowPixels(crop: Rgba, within: number): { xs: Float64Array; ys: Float64Array; grid: Uint8Array } {
  const W = crop.width;
  const H = crop.height;
  const c = (W - 1) / 2;
  const lim = within * (W / 2);
  const grid = new Uint8Array(W * H);
  const xs: number[] = [];
  const ys: number[] = [];
  const d = crop.data;
  for (let y = Math.max(0, Math.floor(c - lim)); y <= Math.min(H - 1, Math.ceil(c + lim)); y++) {
    for (let x = Math.max(0, Math.floor(c - lim)); x <= Math.min(W - 1, Math.ceil(c + lim)); x++) {
      if (Math.hypot(x - c, y - c) > lim) continue;
      const i = (y * W + x) * 4;
      const R = d[i]!;
      const G = d[i + 1]!;
      const B = d[i + 2]!;
      if (d[i + 3] !== 0 && R >= 170 && G >= 140 && R >= B + 15) {
        grid[y * W + x] = 1;
        xs.push(x);
        ys.push(y);
      }
    }
  }
  return { xs: Float64Array.from(xs), ys: Float64Array.from(ys), grid };
}

export function arrowHeading(crop: Rgba, r: number, minPixels = 120): Heading | null {
  const k = (r / 126) ** 2;
  const { xs, ys, grid } = arrowPixels(crop, 0.3);
  const n = xs.length;
  if (n < minPixels * k) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i]!;
    my += ys[i]!;
  }
  mx /= n;
  my /= n;
  const W = crop.width;
  const H = crop.height;
  const score = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    let hit = 0;
    for (let i = 0; i < n; i++) {
      const px = xs[i]! - mx;
      const py = ys[i]! - my;
      const dd = px * ux + py * uy;
      const rx = Math.round(mx + 2 * dd * ux - px);
      const ry = Math.round(my + 2 * dd * uy - py);
      if (rx >= 0 && ry >= 0 && rx < W && ry < H && grid[ry * W + rx]) hit++;
    }
    return hit;
  };
  // eixo: passo de 2°, depois 0,25° em volta do melhor
  let best = { deg: 0, hit: -1 };
  for (let deg = 0; deg < 180; deg += 2) {
    const h = score(deg);
    if (h > best.hit) best = { deg, hit: h };
  }
  const coarse = best.deg;
  for (let deg = coarse - 2; deg <= coarse + 2; deg += 0.25) {
    const h = score(deg);
    if (h > best.hit) best = { deg, hit: h };
  }
  const t = (best.deg * Math.PI) / 180;
  const ux = Math.cos(t);
  const uy = Math.sin(t);
  let fwd = 0;
  let back = 0;
  for (let i = 0; i < n; i++) {
    const dd = (xs[i]! - mx) * ux + (ys[i]! - my) * uy;
    fwd = Math.max(fwd, dd);
    back = Math.max(back, -dd);
  }
  const sign = fwd >= back ? 1 : -1;
  const ang = (Math.atan2(sign * uy, sign * ux) * 180) / Math.PI; // 0 = leste, y pra baixo
  return {
    deg: (((ang + 90) % 360) + 360) % 360,
    symmetry: best.hit / n,
    ratio: Math.max(fwd, back) / Math.max(1e-6, Math.min(fwd, back)),
  };
}

/** Diferença angular em graus (0–180). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}
