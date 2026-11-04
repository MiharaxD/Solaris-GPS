/**
 * Achar e recortar o minimapa num frame de tela cheia. O minimapa do WuWa é um círculo no canto
 * superior esquerdo com um anel fino claro na borda; a detecção é uma transformada de Hough de
 * círculos sobre o gradiente, numa versão reduzida do canto, refinada na resolução cheia.
 */
import { subImage, toGray, type Gray, type Rgba } from "./image";

export type MinimapShape = "circle" | "square";

/** Região do minimapa em pixels do frame. */
export interface MinimapRegion {
  cx: number;
  cy: number;
  r: number;
  shape: MinimapShape;
}

export interface Detection {
  region: MinimapRegion;
  /** 0–1: fração do círculo com borda forte alinhada. Abaixo de ~0,35 é chute. */
  score: number;
}

/** Área de busca (fração do frame) e faixa de raio (fração da altura). */
export const SEARCH = { w: 0.3, h: 0.42, rMin: 0.05, rMax: 0.13 };

interface Grad {
  w: number;
  h: number;
  gx: Float32Array;
  gy: Float32Array;
  mag: Float32Array;
}

function sobel(g: Gray): Grad {
  const { width: w, height: h, data: d } = g;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = d[i - w - 1]!, b = d[i - w]!, c = d[i - w + 1]!;
      const l = d[i - 1]!, r = d[i + 1]!;
      const e = d[i + w - 1]!, f = d[i + w]!, k = d[i + w + 1]!;
      const sx = c + 2 * r + k - a - 2 * l - e;
      const sy = e + 2 * f + k - a - 2 * b - c;
      gx[i] = sx;
      gy[i] = sy;
      mag[i] = Math.hypot(sx, sy);
    }
  }
  return { w, h, gx, gy, mag };
}

/**
 * Fração de pontos do círculo onde o gradiente é forte e aponta na direção radial (pra dentro
 * ou pra fora). Robusto ao conteúdo do minimapa, que não forma um círculo.
 */
function ringScore(gr: Grad, cx: number, cy: number, r: number, thr: number): number {
  const n = Math.max(32, Math.round(2 * Math.PI * r));
  let hits = 0;
  let total = 0;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const x = Math.round(cx + r * ux);
    const y = Math.round(cy + r * uy);
    if (x < 1 || y < 1 || x >= gr.w - 1 || y >= gr.h - 1) continue;
    total++;
    // melhor ponto num raio ±1 (anel fino, borda dupla)
    let best = 0;
    for (let dr = -1; dr <= 1; dr++) {
      const i = Math.round(cy + (r + dr) * uy) * gr.w + Math.round(cx + (r + dr) * ux);
      const m = gr.mag[i]!;
      if (m < thr) continue;
      const cos = Math.abs(gr.gx[i]! * ux + gr.gy[i]! * uy) / m;
      if (cos > best) best = cos;
    }
    if (best > 0.8) hits++;
  }
  // fora da imagem conta como erro: o minimapa inteiro cabe na tela
  return total ? hits / n : 0;
}

function percentile(a: Float32Array, p: number): number {
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(a.length / 20000));
  for (let i = 0; i < a.length; i += step) sample.push(a[i]!);
  sample.sort((x, y) => x - y);
  return sample[Math.min(sample.length - 1, Math.floor(p * sample.length))] ?? 0;
}

/**
 * Procura o minimapa no canto superior esquerdo de um frame `frameW`×`frameH`. `corner` é o
 * recorte desse canto (a partir de 0,0), pra não precisar ler o frame inteiro.
 */
export function detectMinimap(corner: Rgba, frameW: number, frameH: number, shape: MinimapShape = "circle"): Detection | null {
  void frameW;
  const f = Math.max(1, Math.round(frameH / 540)); // ~540 linhas de trabalho
  const g = toGray(corner, f);
  const gr = sobel(g);
  const thr = Math.max(8, percentile(gr.mag, 0.9));
  const rMin = Math.floor((SEARCH.rMin * frameH) / f);
  const rMax = Math.ceil((SEARCH.rMax * frameH) / f);
  const rStep = 1;
  const nr = Math.floor((rMax - rMin) / rStep) + 1;
  const W = gr.w;
  const H = gr.h;
  const acc = new Float32Array(nr * W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const m = gr.mag[i]!;
      if (m < thr) continue;
      const ux = gr.gx[i]! / m;
      const uy = gr.gy[i]! / m;
      for (let k = 0; k < nr; k++) {
        const r = rMin + k * rStep;
        for (const s of [1, -1]) {
          const cx = Math.round(x + s * r * ux);
          const cy = Math.round(y + s * r * uy);
          if (cx < 0 || cy < 0 || cx >= W || cy >= H) continue;
          acc[(k * H + cy) * W + cx]! += 1;
        }
      }
    }
  }
  // candidatos: máximos normalizados pela circunferência (senão raio grande sempre ganha)
  const cands: { x: number; y: number; r: number; v: number }[] = [];
  for (let k = 0; k < nr; k++) {
    const r = rMin + k * rStep;
    const norm = 1 / (2 * Math.PI * r);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const v = acc[(k * H + y) * W + x]! * norm;
        if (v > 0.04) cands.push({ x, y, r, v });
      }
    }
  }
  cands.sort((a, b) => b.v - a.v);
  // verifica os melhores com o score de anel na resolução reduzida e refina na cheia
  let best: Detection | null = null;
  const fullG = f > 1 ? sobel(toGray(corner, 1)) : gr;
  const fullThr = Math.max(8, percentile(fullG.mag, 0.9));
  for (const c of cands.slice(0, 12)) {
    let bx = c.x * f + (f - 1) / 2;
    let by = c.y * f + (f - 1) / 2;
    let br = c.r * f;
    let bs = ringScore(fullG, bx, by, br, fullThr);
    // refinamento local: passo f, depois 1
    for (const step of f > 1 ? [f, 1] : [1]) {
      let improved = true;
      while (improved) {
        improved = false;
        for (const [dx, dy, dr] of [[step, 0, 0], [-step, 0, 0], [0, step, 0], [0, -step, 0], [0, 0, step], [0, 0, -step]] as const) {
          const s = ringScore(fullG, bx + dx, by + dy, br + dr, fullThr);
          if (s > bs) {
            bs = s;
            bx += dx;
            by += dy;
            br += dr;
            improved = true;
          }
        }
      }
    }
    if (!best || bs > best.score) best = { region: { cx: bx, cy: by, r: br, shape }, score: bs };
  }
  return best;
}

/** Tamanho do canto do frame que a detecção precisa ler. */
export function searchCorner(frameW: number, frameH: number): { w: number; h: number } {
  return { w: Math.ceil(frameW * SEARCH.w), h: Math.ceil(frameH * SEARCH.h) };
}

/**
 * Recorta o minimapa (quadrado 2r×2r) e zera o alpha fora da máscara: no círculo, também o
 * anel da borda (≈4% do raio) não conta.
 */
export function cropMinimap(frame: Rgba, reg: MinimapRegion, offsetX = 0, offsetY = 0): Rgba {
  const size = Math.round(reg.r * 2);
  const crop = subImage(frame, reg.cx - reg.r - offsetX, reg.cy - reg.r - offsetY, size, size);
  if (reg.shape === "circle") {
    const rIn = reg.r * 0.95;
    const c = (size - 1) / 2;
    for (let y = 0; y < crop.height; y++) {
      for (let x = 0; x < crop.width; x++) {
        if (Math.hypot(x - c, y - c) > rIn) crop.data[(y * crop.width + x) * 4 + 3] = 0;
      }
    }
  }
  return crop;
}

/** Região padrão de config.json (em 2560×1440 de referência), escalada pro frame. */
export function scaleRegion(reg: MinimapRegion, fromH: number, toH: number): MinimapRegion {
  const k = toH / fromH;
  return { ...reg, cx: reg.cx * k, cy: reg.cy * k, r: reg.r * k };
}
