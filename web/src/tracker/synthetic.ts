/** Imagens sintéticas pros testes do tracker (mapa de manchas e recorte do minimapa). */
import type { Gray, Rgba } from "./image";
import { resizeGray } from "./match";
import type { TileReader } from "./tiles";

/** "Mapa" sintético: soma de manchas gaussianas determinísticas. */
/** `amp` escala o contraste das manchas (1 = forte; o minimapa real fica perto de 0,3). */
export function fakeMap(size: number, amp = 1): Gray {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blobs = Array.from({ length: 220 }, () => ({ x: rnd() * size, y: rnd() * size, s: 8 + rnd() * 40, a: rnd() * 160 - 60 }));
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 90;
      for (const b of blobs) {
        const d2 = (x - b.x) ** 2 + (y - b.y) ** 2;
        if (d2 < 9 * b.s * b.s) v += amp * b.a * Math.exp(-d2 / (2 * b.s * b.s));
      }
      data[y * size + x] = v;
    }
  }
  return { width: size, height: size, data };
}

/** Recorte do minimapa: raio `r` na tela, mostrando `R` px do mapa em volta de `p`. */
export function fakeCrop(map: Gray, p: [number, number], r: number, R: number): Rgba {
  const size = 2 * r;
  const s = R / r;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const mx = p[0] + (x + 0.5 - r) * s - 0.5;
      const my = p[1] + (y + 0.5 - r) * s - 0.5;
      const x0 = Math.floor(mx);
      const y0 = Math.floor(my);
      const tx = mx - x0;
      const ty = my - y0;
      const at = (xx: number, yy: number) => map.data[yy * map.width + xx]!;
      const v = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = Math.hypot(x - (size - 1) / 2, y - (size - 1) / 2) > r * 0.95 ? 0 : 255;
    }
  }
  return { width: size, height: size, data };
}

/** Pirâmide em memória (como a do build_tiles): o zoom máximo e os menores por redução. */
export function pyramid(map: Gray, maxZoom: number, minZoom: number, ts: number): TileReader {
  const levels = new Map<number, Gray>();
  for (let z = maxZoom; z >= minZoom; z--) {
    const k = Math.pow(2, maxZoom - z);
    levels.set(z, k === 1 ? map : resizeGray(map, map.width / k, map.height / k));
  }
  return async (z, row, col) => {
    const g = levels.get(z);
    if (!g || row < 0 || col < 0 || (row + 1) * ts > g.height || (col + 1) * ts > g.width) return null;
    const data = new Uint8ClampedArray(ts * ts * 4);
    for (let y = 0; y < ts; y++) {
      for (let x = 0; x < ts; x++) {
        const v = g.data[(row * ts + y) * g.width + col * ts + x]!;
        const i = (y * ts + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    return { width: ts, height: ts, data } satisfies Rgba;
  };
}
