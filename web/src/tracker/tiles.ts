/**
 * Janelas do mapa montadas das tiles (nunca dos PNGs costurados), em qualquer zoom da pirâmide
 * do web (`build_tiles` gera z1..zmax pra todos os mapas, mesmo os que só têm o zoom máximo
 * baixado). Quem chama fornece o leitor: `fetch` + `createImageBitmap` no navegador/Worker
 * (`browserTileReader`), `sharp` no runner de fixtures.
 */
import type { Gray, Rgba } from "./image";
import type { Planes } from "./locate";
import type { MapInfo } from "../maps";

/** Devolve a tile (zoom, linha, coluna), ou null se não existir (0 bytes/fora da grade). */
export type TileReader = (z: number, row: number, col: number) => Promise<Rgba | null>;

/** Cache LRU por cima de um leitor (guarda a promessa: pedidos repetidos não duplicam o fetch). */
export function lruTileReader(read: TileReader, max = 36): TileReader {
  const cache = new Map<string, Promise<Rgba | null>>();
  return (z, row, col) => {
    const key = `${z}/${row}_${col}`;
    let p = cache.get(key);
    if (p) cache.delete(key);
    else p = read(z, row, col);
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
  /** Zoom da janela (padrão: o máximo). As coordenadas são pixels desse zoom. */
  z?: number;
}

/** Canais (cinza ou RGB) + validade da janela [x0, x0+w) × [y0, y0+h). Fora das tiles = 0 e inválido. */
export async function planesWindow(read: TileReader, info: MapInfo, x0: number, y0: number, w: number, h: number, opt: PlanesWindowOptions): Promise<Planes> {
  const ts = info.tileSize;
  const z = opt.z ?? info.maxZoom;
  const k = Math.pow(2, z - info.maxZoom);
  const nc = opt.color ? 3 : 1;
  const chans = Array.from({ length: nc }, () => new Float32Array(w * h));
  const valid = new Uint8Array(w * h);
  const [br, bgg, bb] = opt.bg ?? MAP_BG;
  const tol = opt.bgTol ?? 14;
  const b = info.bounds;
  const r0 = Math.max(Math.floor(y0 / ts), Math.floor((b.y0 * k) / ts));
  const r1 = Math.min(Math.floor((y0 + h - 1) / ts), Math.ceil((b.y1 * k) / ts) - 1);
  const c0 = Math.max(Math.floor(x0 / ts), Math.floor((b.x0 * k) / ts));
  const c1 = Math.min(Math.floor((x0 + w - 1) / ts), Math.ceil((b.x1 * k) / ts) - 1);
  const jobs: Promise<void>[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      jobs.push(
        read(z, r, c).then((t) => {
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

/** Cinza da janela em pixel do zoom `z` (padrão: o máximo). Fora das tiles = 0 (preto). */
export async function grayWindow(read: TileReader, info: MapInfo, x0: number, y0: number, w: number, h: number, z?: number): Promise<Gray> {
  const p = await planesWindow(read, info, x0, y0, w, h, { color: false, mask: "none", z });
  return { width: w, height: h, data: p.chans[0]! };
}

/** Leitor pras tiles servidas pelo Vite (`/tiles/<name>/<z>/<linha>_<coluna>.webp`). */
export function browserTileReader(info: MapInfo, base = "/tiles"): TileReader {
  const canvas = new OffscreenCanvas(info.tileSize, info.tileSize);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  return async (z, row, col) => {
    const res = await fetch(`${base}/${info.name}/${z}/${row}_${col}.webp`);
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
