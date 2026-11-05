import { describe, expect, it } from "vitest";
import type { Gray } from "./image";
import { resizeGray } from "./match";
import { median, sweepScale, sweepWindow } from "./scale";
import { fakeCrop, fakeMap } from "./synthetic";

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
