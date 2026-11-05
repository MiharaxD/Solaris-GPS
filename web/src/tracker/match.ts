/**
 * Template matching do minimapa contra o mapa: NCC (correlação normalizada) com máscara, só
 * translação. Código puro (sem DOM): roda no Worker, na página e no runner de fixtures.
 */
import type { Gray, Rgba } from "./image";

/** Template já com a máscara aplicada: só os pixels válidos, com média zero. */
export interface Template {
  width: number;
  height: number;
  /** Posição (y * width + x) de cada pixel válido. */
  xs: Int32Array;
  ys: Int32Array;
  /** Valor menos a média dos válidos. */
  vals: Float32Array;
  /** Σ vals². */
  energy: number;
}

export function makeTemplate(g: Gray, mask: Uint8Array): Template {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]) {
      n++;
      sum += g.data[i]!;
    }
  }
  const mean = n ? sum / n : 0;
  const xs = new Int32Array(n);
  const ys = new Int32Array(n);
  const vals = new Float32Array(n);
  let energy = 0;
  for (let i = 0, k = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    xs[k] = i % g.width;
    ys[k] = Math.floor(i / g.width);
    const v = g.data[i]! - mean;
    vals[k++] = v;
    energy += v * v;
  }
  return { width: g.width, height: g.height, xs, ys, vals, energy };
}

/**
 * Template do recorte do minimapa (saída de `cropMinimap`), reduzido por `ds` (média em blocos).
 * Conta só bloco inteiro dentro da máscara (alpha) e fora do furo central (a seta), que tem
 * raio `hole` × metade do recorte.
 */
export function minimapTemplate(crop: Rgba, ds: number, hole = 0.24): Template {
  const w = Math.floor(crop.width / ds);
  const h = Math.floor(crop.height / ds);
  const g = new Float32Array(w * h);
  const mask = new Uint8Array(w * h);
  const c = (crop.width - 1) / 2;
  const holeR = hole * (crop.width / 2);
  const d = crop.data;
  const inv = 1 / (ds * ds);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let ok = true;
      for (let dy = 0; dy < ds; dy++) {
        const py = y * ds + dy;
        for (let dx = 0; dx < ds; dx++) {
          const px = x * ds + dx;
          const i = (py * crop.width + px) * 4;
          if (d[i + 3] === 0 || Math.hypot(px - c, py - c) < holeR) ok = false;
          s += 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
        }
      }
      g[y * w + x] = s * inv;
      mask[y * w + x] = ok ? 1 : 0;
    }
  }
  return makeTemplate({ width: w, height: h, data: g }, mask);
}

/** Reamostragem por área (cada pixel novo = média ponderada do que ele cobre). Boa pra reduzir. */
export function resizeGray(g: Gray, w: number, h: number): Gray {
  const wx = areaWeights(g.width, w);
  const wy = areaWeights(g.height, h);
  const tmp = new Float32Array(w * g.height);
  const d = g.data;
  for (let y = 0; y < g.height; y++) {
    const row = y * g.width;
    const o = y * w;
    for (let j = 0; j < w; j++) {
      let s = 0;
      for (let k = wx.start[j]!; k < wx.start[j + 1]!; k++) s += d[row + wx.idx[k]!]! * wx.wgt[k]!;
      tmp[o + j] = s;
    }
  }
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const dst = j * w;
    for (let k = wy.start[j]!; k < wy.start[j + 1]!; k++) {
      const src = wy.idx[k]! * w;
      const wgt = wy.wgt[k]!;
      for (let x = 0; x < w; x++) out[dst + x]! += tmp[src + x]! * wgt;
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Pesos de cada pixel novo (somam 1), em listas planas: pixel j usa idx/wgt de start[j] a
 * start[j+1]. Ampliando, vira vizinho mais próximo.
 */
function areaWeights(n: number, m: number): { start: Int32Array; idx: Int32Array; wgt: Float32Array } {
  const k = n / m;
  const start = new Int32Array(m + 1);
  const idx: number[] = [];
  const wgt: number[] = [];
  for (let j = 0; j < m; j++) {
    start[j] = idx.length;
    const a = j * k;
    const b = Math.min(n, a + k);
    for (let i = Math.floor(a); i < Math.ceil(b); i++) {
      const v = (Math.min(b, i + 1) - Math.max(a, i)) / (b - a);
      if (v > 0) {
        idx.push(i);
        wgt.push(v);
      }
    }
  }
  start[m] = idx.length;
  return { start, idx: Int32Array.from(idx), wgt: Float32Array.from(wgt) };
}

export interface MatchResult {
  score: number;
  /** Canto superior esquerdo do template na imagem. */
  x: number;
  y: number;
}

/**
 * Melhor posição do template em `img`, com o canto superior esquerdo em [x0, x1] × [y0, y1]
 * (cortado pra caber). NCC mascarada direta: O(posições × pixels válidos).
 */
export function matchTemplate(img: Gray, t: Template, x0 = 0, y0 = 0, x1 = Infinity, y1 = Infinity): MatchResult | null {
  const ax = Math.max(0, Math.floor(x0));
  const ay = Math.max(0, Math.floor(y0));
  const bx = Math.min(img.width - t.width, Math.ceil(x1));
  const by = Math.min(img.height - t.height, Math.ceil(y1));
  const n = t.vals.length;
  if (bx < ax || by < ay || n === 0 || t.energy <= 0) return null;
  const off = new Int32Array(n);
  for (let k = 0; k < n; k++) off[k] = t.ys[k]! * img.width + t.xs[k]!;
  const d = img.data;
  const vals = t.vals;
  let best: MatchResult | null = null;
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      const base = y * img.width + x;
      let s = 0;
      let s2 = 0;
      let st = 0;
      for (let k = 0; k < n; k++) {
        const v = d[base + off[k]!]!;
        s += v;
        s2 += v * v;
        st += v * vals[k]!;
      }
      const varI = s2 - (s * s) / n;
      if (varI <= 1e-6) continue;
      const score = st / Math.sqrt(varI * t.energy);
      if (!best || score > best.score) best = { score, x, y };
    }
  }
  return best;
}
