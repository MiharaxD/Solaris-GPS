import { describe, expect, it } from "vitest";
import type { Gray, Rgba } from "./image";
import { resizeGray } from "./match";
import { median, sweepScale, sweepWindow } from "./scale";

/** "Mapa" sintético: soma de manchas gaussianas determinísticas. */
function fakeMap(size: number): Gray {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blobs = Array.from({ length: 220 }, () => ({ x: rnd() * size, y: rnd() * size, s: 8 + rnd() * 40, a: rnd() * 160 - 60 }));
  const data = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 90;
      for (const b of blobs) {
        const d2 = (x - b.x) ** 2 + (y - b.y) ** 2;
        if (d2 < 9 * b.s * b.s) v += b.a * Math.exp(-d2 / (2 * b.s * b.s));
      }
      data[y * size + x] = v;
    }
  }
  return { width: size, height: size, data };
}

/** Recorte do minimapa: raio `r` na tela, mostrando `R` px do mapa em volta de `p`. */
function fakeCrop(map: Gray, p: [number, number], r: number, R: number): Rgba {
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

describe("resizeGray", () => {
  it("preserva a média ao reduzir", () => {
    const g = fakeMap(64);
    const small = resizeGray(g, 23, 23);
    const mean = (a: Float32Array) => a.reduce((s, v) => s + v, 0) / a.length;
    expect(mean(small.data)).toBeCloseTo(mean(g.data), 0);
  });
});

describe("sweepScale", () => {
  it("acha o raio e o erro da anotação num mapa sintético", () => {
    const map = fakeMap(900);
    const truth: [number, number] = [450, 440];
    const crop = fakeCrop(map, truth, 120, 100);
    const annotated: [number, number] = [truth[0] + 9, truth[1] - 6];
    const opts = { center: 160, range: 2, search: 24 };
    const w = sweepWindow(annotated, opts);
    expect(w.x0).toBeGreaterThan(0);
    const win: Gray = { width: w.w, height: w.h, data: new Float32Array(w.w * w.h) };
    for (let y = 0; y < w.h; y++) win.data.set(map.data.subarray((w.y0 + y) * map.width + w.x0, (w.y0 + y) * map.width + w.x0 + w.w), y * w.w);
    const sw = sweepScale(crop, 120, annotated, win, w.x0, w.y0, opts);
    expect(sw.best).not.toBeNull();
    expect(sw.best!.radiusPx).toBeGreaterThan(98);
    expect(sw.best!.radiusPx).toBeLessThan(102);
    expect(sw.best!.score).toBeGreaterThan(0.95);
    expect(Math.abs(sw.best!.dx + 9)).toBeLessThan(3);
    expect(Math.abs(sw.best!.dy - 6)).toBeLessThan(3);
  });
});

describe("median", () => {
  it("ímpar, par e vazio", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
