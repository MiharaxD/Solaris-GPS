/**
 * Estimativa automática da calibração, sem o usuário precisar identificar nenhum teleporte.
 *
 * Ideia: os teleportes/Nexus ficam sempre em terra. Testamos as 8 orientações possíveis
 * (eixos trocados e/ou espelhados) e uma faixa de escalas/deslocamentos, e ficamos com a
 * transformação (similaridade: escala uniforme, sem cisalhamento) que põe mais referências
 * em cima de terra. "Terra" = pixel das tiles que não é a cor de fundo nem preto.
 */
import type { Affine } from "./affine";
import type { MapInfo } from "./maps";

export interface LandMask {
  /** 1 = terra. Linha a linha, largura `w`. */
  data: Uint8Array;
  w: number;
  h: number;
  /** Pixels do zoom máximo por pixel da máscara. */
  scale: number;
  /** Origem da máscara em pixel do zoom máximo. */
  x0: number;
  y0: number;
}

export interface Estimate {
  affine: Affine;
  onLand: number;
  total: number;
  orientation: string;
}

const MASK_MAX = 1024;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Monta a máscara de terra num zoom reduzido (≈ até 1024 px de lado). */
export async function buildLandMask(info: MapInfo): Promise<LandMask> {
  const { x0, y0, x1, y1 } = info.bounds;
  const ts = info.tileSize;
  // zoom em que o mapa inteiro tem ~MASK_MAX px no maior lado
  let z = info.maxZoom;
  while (z > info.minZoom && Math.max(x1 - x0, y1 - y0) / 2 ** (info.maxZoom - z) > MASK_MAX) z--;
  const f = 2 ** (info.maxZoom - z);
  const c0 = Math.floor(x0 / f / ts);
  const c1 = Math.ceil(x1 / f / ts) - 1;
  const r0 = Math.floor(y0 / f / ts);
  const r1 = Math.ceil(y1 / f / ts) - 1;
  const canvas = document.createElement("canvas");
  canvas.width = (c1 - c0 + 1) * ts;
  canvas.height = (r1 - r0 + 1) * ts;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const jobs: Promise<void>[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      jobs.push(
        loadImage(`/tiles/${info.name}/${z}/${r}_${c}.webp`).then((img) => {
          if (img) ctx.drawImage(img, (c - c0) * ts, (r - r0) * ts);
        }),
      );
    }
  }
  await Promise.all(jobs);

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const bg = backgroundColor(data);
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const r = data[p]!, g = data[p + 1]!, b = data[p + 2]!, a = data[p + 3]!;
    const nearBg = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) < 30;
    const black = r + g + b < 12;
    mask[i] = a > 0 && !nearBg && !black ? 1 : 0;
  }
  return { data: dilate(mask, canvas.width, canvas.height, 2), w: canvas.width, h: canvas.height, scale: f, x0: c0 * ts * f, y0: r0 * ts * f };
}

/** Cor mais comum (quantizada) = fundo azul pintado nas tiles. */
function backgroundColor(px: Uint8ClampedArray): [number, number, number] {
  const counts = new Map<number, number>();
  for (let p = 0; p < px.length; p += 4 * 7) {
    const key = ((px[p]! >> 3) << 10) | ((px[p + 1]! >> 3) << 5) | (px[p + 2]! >> 3);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = 0;
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN && k !== 0) {
      best = k;
      bestN = n;
    }
  }
  return [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4];
}

function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[yy * w + xx] = 1;
        }
      }
    }
  }
  return out;
}

/** Caixa envolvente da terra, em pixel do zoom máximo. */
function landBox(mask: LandMask): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      if (mask.data[y * mask.w + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const s = mask.scale;
  return [mask.x0 + minX * s, mask.y0 + minY * s, mask.x0 + (maxX + 1) * s, mask.y0 + (maxY + 1) * s];
}

/** 8 orientações: (troca eixos?) × sinal X × sinal Y. Matriz 2x2 [a, b, d, e]. */
const ORIENTATIONS: { name: string; m: [number, number, number, number] }[] = [];
for (const swap of [false, true]) {
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      const m: [number, number, number, number] = swap ? [0, sx, sy, 0] : [sx, 0, 0, sy];
      ORIENTATIONS.push({ name: `${swap ? "x←Y" : "x←X"}${sx < 0 ? "(−)" : ""} ${swap ? "y←X" : "y←Y"}${sy < 0 ? "(−)" : ""}`, m });
    }
  }
}

export function estimateCalibration(refs: readonly { x: number; y: number }[], mask: LandMask): Estimate | null {
  if (refs.length < 4) return null;
  const [lx0, ly0, lx1, ly1] = landBox(mask);
  const landW = lx1 - lx0;
  const landH = ly1 - ly0;
  if (!(landW > 0 && landH > 0)) return null;

  const onLand = (px: number, py: number): boolean => {
    const mx = Math.floor((px - mask.x0) / mask.scale);
    const my = Math.floor((py - mask.y0) / mask.scale);
    return mx >= 0 && my >= 0 && mx < mask.w && my < mask.h && mask.data[my * mask.w + mx] === 1;
  };

  let best: (Estimate & { penalty: number }) | null = null;
  for (const o of ORIENTATIONS) {
    const [a, b, d, e] = o.m;
    const u = refs.map((r) => [a * r.x + b * r.y, d * r.x + e * r.y] as const);
    const ux0 = Math.min(...u.map((p) => p[0])), ux1 = Math.max(...u.map((p) => p[0]));
    const uy0 = Math.min(...u.map((p) => p[1])), uy1 = Math.max(...u.map((p) => p[1]));
    const s0 = Math.min(landW / (ux1 - ux0 || 1), landH / (uy1 - uy0 || 1));
    const ucx = (ux0 + ux1) / 2, ucy = (uy0 + uy1) / 2;
    const lcx = (lx0 + lx1) / 2, lcy = (ly0 + ly1) / 2;

    // busca grossa → fina em escala (k) e deslocamento (fração da caixa de terra)
    let local = { k: 1, dx: 0, dy: 0, n: -1 };
    const stages: [number, number, number][] = [
      [0.35, 0.05, 0.2], // faixa de k, passo de k, faixa de deslocamento
      [0.06, 0.01, 0.04],
      [0.012, 0.002, 0.008],
    ];
    for (const [kr, ks, dr] of stages) {
      const center = local.n < 0 ? { k: 1, dx: 0, dy: 0 } : local;
      const ds = dr / 5;
      for (let k = center.k - kr; k <= center.k + kr + 1e-9; k += ks) {
        const s = s0 * k;
        for (let dx = center.dx - dr; dx <= center.dx + dr + 1e-9; dx += ds) {
          for (let dy = center.dy - dr; dy <= center.dy + dr + 1e-9; dy += ds) {
            const ox = lcx + dx * landW - s * ucx;
            const oy = lcy + dy * landH - s * ucy;
            let n = 0;
            for (const [ux, uy] of u) if (onLand(s * ux + ox, s * uy + oy)) n++;
            if (n > local.n || (n === local.n && Math.abs(k - 1) < Math.abs(local.k - 1))) local = { k, dx, dy, n };
          }
        }
      }
    }
    const s = s0 * local.k;
    const ox = lcx + local.dx * landW - s * ucx;
    const oy = lcy + local.dy * landH - s * ucy;
    const penalty = Math.abs(local.k - 1);
    if (!best || local.n > best.onLand || (local.n === best.onLand && penalty < best.penalty)) {
      best = {
        affine: [s * a, s * b, ox, s * d, s * e, oy],
        onLand: local.n,
        total: refs.length,
        orientation: o.name,
        penalty,
      };
    }
  }
  if (!best) return null;
  const { penalty: _p, ...est } = best;
  return est;
}
