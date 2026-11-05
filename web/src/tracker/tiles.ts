/**
 * Janela do mapa em tons de cinza, montada das tiles do zoom máximo (nunca dos PNGs
 * costurados). Quem chama fornece o leitor de tile: `fetch` + `createImageBitmap` no
 * navegador/Worker (`browserTileReader`), `sharp` no runner de fixtures.
 */
import type { Gray, Rgba } from "./image";
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
