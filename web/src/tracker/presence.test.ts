import { describe, expect, it } from "vitest";
import { embedInFrame, subImage } from "./image";
import { minimapPresence, PresenceGate } from "./presence";
import { fakeCrop, fakeMap, withRing } from "./synthetic";

const map = fakeMap(512, 0.5);
const C = 48 + 71.5;
const minimap = embedInFrame(fakeCrop(map, [256, 256], 72, 60), 800, 600, 48, 48);
const readOf = (f: typeof minimap) => (x: number, y: number, w: number, h: number) => subImage(f, x, y, w, h);
const reg = { cx: C, cy: C, r: 72, shape: "circle" as const };

describe("presença do minimapa", () => {
  it("com o anel dá score alto, também com a região uns px fora", () => {
    const f = withRing(minimap, C, C, 72.5);
    expect(minimapPresence(readOf(f), 800, 600, reg).score).toBeGreaterThan(0.8);
    const off = minimapPresence(readOf(f), 800, 600, { ...reg, cx: C + 3, cy: C - 3, r: 70 });
    expect(off.score).toBeGreaterThan(0.8);
    expect(Math.abs(off.region.cx - C)).toBeLessThanOrEqual(1);
  });

  it("sem o anel (o mapa na tela toda, como no mapa aberto) ou com a tela lisa, score baixo", () => {
    const data = new Uint8ClampedArray(800 * 600 * 4);
    for (let y = 0; y < 600; y++) {
      for (let x = 0; x < 800; x++) {
        const i = (y * 800 + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = map.data[(y % 512) * 512 + (x % 512)]!;
        data[i + 3] = 255;
      }
    }
    expect(minimapPresence(readOf({ width: 800, height: 600, data }), 800, 600, reg).score).toBeLessThan(0.4);
    const flat = { width: 800, height: 600, data: new Uint8ClampedArray(800 * 600 * 4).fill(60) };
    expect(minimapPresence(readOf(flat), 800, 600, reg).score).toBe(0);
  });

  it("histerese: pausa com 2 frames fracos seguidos e volta com 1 forte", () => {
    const g = new PresenceGate();
    expect(g.update(0.1)).toBe(true);
    expect(g.update(0.9)).toBe(true);
    expect(g.update(0.1)).toBe(true);
    expect(g.update(0.1)).toBe(false);
    expect(g.update(0.45)).toBe(false); // no meio: mantém
    expect(g.update(0.6)).toBe(true);
    expect(g.update(0.45)).toBe(true);
  });
});
