/**
 * Direção do jogador pela seta no centro do minimapa (ticket 22). A seta é um triângulo com
 * um entalhe atrás, simétrico pelo eixo ponta→costas: acha o eixo de maior simetria da
 * silhueta (contorno amarelo + face clara que ele cerca) e a ponta pelo lado que vai mais longe do centróide (nos
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

/**
 * Silhueta da seta: o contorno amarelo saturado + o que ele cerca (a face clara). Não basta
 * "amarelo ou claro": em terreno claro (areia, prédios) e sob o cone de visão da câmera, que
 * clareia o chão a partir da seta, o terreno passava no filtro e a silhueta virava seta + cone,
 * e a direção ia junto com a câmera. O terreno clareado perde saturação, o contorno não.
 */
function arrowPixels(crop: Rgba, within: number): { xs: Float64Array; ys: Float64Array; grid: Uint8Array } {
  const W = crop.width;
  const H = crop.height;
  const c = (W - 1) / 2;
  const lim = within * (W / 2);
  const x0 = Math.max(0, Math.floor(c - lim));
  const y0 = Math.max(0, Math.floor(c - lim));
  const x1 = Math.min(W - 1, Math.ceil(c + lim));
  const y1 = Math.min(H - 1, Math.ceil(c + lim));
  const ww = x1 - x0 + 1;
  const hh = y1 - y0 + 1;
  const d = crop.data;
  // 1 = amarelo do contorno; 2 = fora (alcança a borda da janela sem cruzar o amarelo)
  const lab = new Uint8Array(ww * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < ww; x++) {
      const i = ((y + y0) * W + x + x0) * 4;
      const R = d[i]!;
      const G = d[i + 1]!;
      const B = d[i + 2]!;
      if (d[i + 3] !== 0 && R >= 180 && G >= 140 && B <= 0.62 * R && R - B >= 90) lab[y * ww + x] = 1;
    }
  }
  const stack: number[] = [];
  const push = (k: number) => {
    if (lab[k] === 0) {
      lab[k] = 2;
      stack.push(k);
    }
  };
  for (let x = 0; x < ww; x++) {
    push(x);
    push((hh - 1) * ww + x);
  }
  for (let y = 0; y < hh; y++) {
    push(y * ww);
    push(y * ww + ww - 1);
  }
  while (stack.length) {
    const k = stack.pop()!;
    const x = k % ww;
    if (x > 0) push(k - 1);
    if (x < ww - 1) push(k + 1);
    if (k >= ww) push(k - ww);
    if (k < (hh - 1) * ww) push(k + ww);
  }
  const grid = new Uint8Array(W * H);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < ww; x++) {
      if (lab[y * ww + x] === 2) continue;
      const X = x + x0;
      const Y = y + y0;
      if (Math.hypot(X - c, Y - c) > lim) continue;
      grid[Y * W + X] = 1;
      xs.push(X);
      ys.push(Y);
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
