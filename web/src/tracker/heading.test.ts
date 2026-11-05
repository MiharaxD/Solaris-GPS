import { describe, expect, it } from "vitest";
import type { Rgba } from "./image";
import { angleDiff, arrowHeading } from "./heading";

/** Recorte 252×252 com a seta (triângulo com entalhe atrás) apontando pra `deg` (0 = norte, horário). */
function arrowCrop(deg: number): Rgba {
  const W = 252;
  const c = (W - 1) / 2;
  const data = new Uint8ClampedArray(W * W * 4);
  for (let i = 0; i < W * W; i++) data.set([40, 60, 70, 255], i * 4);
  // seta "pra cima" em coordenadas locais: ponta (0,-27), cantos (±18, 21), entalhe (0, 10)
  const tip: [number, number] = [0, -27];
  const left: [number, number] = [-18, 21];
  const right: [number, number] = [18, 21];
  const notch: [number, number] = [0, 10];
  const inTri = (p: [number, number], a: [number, number], b: [number, number], q: [number, number]) => {
    const s = (u: [number, number], v: [number, number], w: [number, number]) => (u[0] - w[0]) * (v[1] - w[1]) - (v[0] - w[0]) * (u[1] - w[1]);
    const d1 = s(p, a, b);
    const d2 = s(p, b, q);
    const d3 = s(p, q, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const t = (deg * Math.PI) / 180;
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      // gira o ponto de volta pro referencial da seta
      const dx = x - c;
      const dy = y - c;
      const lx = dx * Math.cos(t) + dy * Math.sin(t);
      const ly = -dx * Math.sin(t) + dy * Math.cos(t);
      const p: [number, number] = [lx, ly];
      if (inTri(p, tip, left, notch) || inTri(p, tip, notch, right)) {
        // metade clara, metade amarela (como no jogo)
        data.set(lx < 0 ? [250, 245, 220, 255] : [240, 200, 50, 255], (y * W + x) * 4);
      }
    }
  }
  return { width: W, height: W, data };
}

describe("arrowHeading", () => {
  it("acha a direção em vários ângulos", () => {
    for (const deg of [0, 37, 90, 142, 200, 305, 359]) {
      const h = arrowHeading(arrowCrop(deg), 126)!;
      expect(h).not.toBeNull();
      expect(angleDiff(h.deg, deg)).toBeLessThan(2);
      expect(h.symmetry).toBeGreaterThan(0.9);
    }
  });

  it("sem seta, null", () => {
    const empty: Rgba = { width: 252, height: 252, data: new Uint8ClampedArray(252 * 252 * 4).fill(60) };
    expect(arrowHeading(empty, 126)).toBeNull();
  });

  it("angleDiff dá a volta", () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 190)).toBe(180);
  });
});
