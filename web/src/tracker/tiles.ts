/**
 * Janela do mapa em tons de cinza, montada das tiles do zoom máximo (nunca dos PNGs
 * costurados). Quem chama fornece o leitor de tile: `fetch` + `createImageBitmap` no
 * navegador/Worker (`browserTileReader`), `sharp` no runner de fixtures.
 */
import type { Gray, Rgba } from "./image";
import type { Planes } from "./locate";
import type { MapInfo } from "../maps";

/** Devolve a tile (linha, coluna) do zoom máximo, ou null se não existir (0 bytes/fora da grade). */
export type TileReader = (row: number, col: number) => Promise<Rgba | null>;

/** Cinza da janela [x0, x0+w) × [y0, y0+h) em pixel do zoom máximo. Fora das tiles = 0 (preto). */
export async function grayWindow(read: TileReader, info: MapInfo, x0: number, y0: number, w: number, h: number): Promise<Gray> {
  const ts = info.tileSize;
  const out = new Float32Array(w * h);
  const b = info.bounds;
  const r0 = Math.max(Math.floor(y0 / ts), Math.floor(b.y0 / ts));
  const r1 = Math.min(Math.floor((y0 + h - 1) / ts), Math.ceil(b.y1 / ts) - 1);
  const c0 = Math.max(Math.floor(x0 / ts), Math.floor(b.x0 / ts));
  const c1 = Math.min(Math.floor((x0 + w - 1) / ts), Math.ceil(b.x1 / ts) - 1);
  const jobs: Promise<void>[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      jobs.push(
        read(r, c).then((t) => {
          if (!t) return;
          const tx = c * ts;
          const ty = r * ts;
          const ya = Math.max(y0, ty);
          const yb = Math.min(y0 + h, ty + t.height);
          const xa = Math.max(x0, tx);
          const xb = Math.min(x0 + w, tx + t.width);
          for (let y = ya; y < yb; y++) {
            let i = ((y - ty) * t.width + (xa - tx)) * 4;
            let o = (y - y0) * w + (xa - x0);
            for (let x = xa; x < xb; x++, i += 4, o++) {
              out[o] = 0.299 * t.data[i]! + 0.587 * t.data[i + 1]! + 0.114 * t.data[i + 2]!;
            }
          }
        }),
      );
    }
  }
  await Promise.all(jobs);
  return { width: w, height: h, data: out };
}

/** Cache LRU por cima de um leitor (guarda a promessa: pedidos repetidos não duplicam o fetch). */
export function lruTileReader(read: TileReader, max = 36): TileReader {
  const cache = new Map<string, Promise<Rgba | null>>();
  return (row, col) => {
    const key = `${row}_${col}`;
    let p = cache.get(key);
    if (p) cache.delete(key);
    else p = read(row, col);
    cache.set(key, p);
    while (cache.size > max) cache.delete(cache.keys().next().value!);
    return p;
  };
}

/** Cor de fundo pintada nas tiles (vazio/mar do th.gl) e padding preto. */
export const MAP_BG: [number, number, number] = [4, 36, 52];

export interface PlanesWindowOptions {
  color: boolean;
  /**
   * O que fica inválido: "none" = nada; "black" = padding preto e fora das tiles; "bg" = isso e
   * também a cor de fundo (±`bgTol`). Nos fixtures, mascarar o fundo piora: o mar do minimapa
   * também é escuro e casa com ele.
   */
  mask: "none" | "black" | "bg";
  bg?: [number, number, number];
  bgTol?: number;
}

/** Canais (cinza ou RGB) + validade da janela, em px do zoom máximo. Fora das tiles = inválido. */
export async function planesWindow(read: TileReader, info: MapInfo, x0: number, y0: number, w: number, h: number, opt: PlanesWindowOptions): Promise<Planes> {
  const ts = info.tileSize;
  const nc = opt.color ? 3 : 1;
  const chans = Array.from({ length: nc }, () => new Float32Array(w * h));
  const valid = new Uint8Array(w * h);
  const [br, bgg, bb] = opt.bg ?? MAP_BG;
  const tol = opt.bgTol ?? 14;
  const b = info.bounds;
  const r0 = Math.max(Math.floor(y0 / ts), Math.floor(b.y0 / ts));
  const r1 = Math.min(Math.floor((y0 + h - 1) / ts), Math.ceil(b.y1 / ts) - 1);
  const c0 = Math.max(Math.floor(x0 / ts), Math.floor(b.x0 / ts));
  const c1 = Math.min(Math.floor((x0 + w - 1) / ts), Math.ceil(b.x1 / ts) - 1);
  const jobs: Promise<void>[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      jobs.push(
        read(r, c).then((t) => {
          if (!t) return;
          const tx = c * ts;
          const ty = r * ts;
          const ya = Math.max(y0, ty);
          const yb = Math.min(y0 + h, ty + t.height);
          const xa = Math.max(x0, tx);
          const xb = Math.min(x0 + w, tx + t.width);
          const d = t.data;
          for (let y = ya; y < yb; y++) {
            let i = ((y - ty) * t.width + (xa - tx)) * 4;
            let o = (y - y0) * w + (xa - x0);
            for (let x = xa; x < xb; x++, i += 4, o++) {
              const R = d[i]!;
              const G = d[i + 1]!;
              const B = d[i + 2]!;
              if (nc === 3) {
                chans[0]![o] = R;
                chans[1]![o] = G;
                chans[2]![o] = B;
              } else chans[0]![o] = 0.299 * R + 0.587 * G + 0.114 * B;
              const isBg = Math.abs(R - br) <= tol && Math.abs(G - bgg) <= tol && Math.abs(B - bb) <= tol;
              valid[o] = (opt.mask === "bg" && isBg) || R + G + B < 20 ? 0 : 1;
            }
          }
        }),
      );
    }
  }
  await Promise.all(jobs);
  return { width: w, height: h, chans, valid: opt.mask === "none" ? null : valid };
}

/** Leitor pras tiles servidas pelo Vite (`/tiles/<name>/<z>/<linha>_<coluna>.webp`). */
export function browserTileReader(info: MapInfo, base = "/tiles"): TileReader {
  const canvas = new OffscreenCanvas(info.tileSize, info.tileSize);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return async (row, col) => {
    const res = await fetch(`${base}/${info.name}/${info.maxZoom}/${row}_${col}.webp`);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size === 0) return null;
    const bmp = await createImageBitmap(blob);
    try {
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      ctx.drawImage(bmp, 0, 0);
      const img = ctx.getImageData(0, 0, bmp.width, bmp.height);
      return { width: img.width, height: img.height, data: img.data };
    } finally {
      bmp.close();
    }
  };
}
