import { describe, expect, it } from "vitest";
import type { Rgba } from "./image";
import { cameraView, DEFAULT_MASK, detectCone, locateByImage, makeMapWindow, minimapPlanes, planesFromGray } from "./locate";
import { fakeCrop, fakeMap } from "./synthetic";

/** Clareia um setor (como o cone de visão do jogo) entre os ângulos a0 e a1 (graus, atan2). */
function addCone(crop: Rgba, a0: number, a1: number, amount = 60): void {
  const c = (crop.width - 1) / 2;
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const a = (Math.atan2(y - c, x - c) * 180) / Math.PI;
      if (a < a0 || a > a1) continue;
      const i = (y * crop.width + x) * 4;
      for (let k = 0; k < 3; k++) crop.data[i + k] = crop.data[i + k]! + amount;
    }
  }
}

describe("detectCone", () => {
  it("acha o setor claro", () => {
    const crop = fakeCrop(fakeMap(600, 0.3), [300, 300], 120, 100);
    addCone(crop, -100, -40, 40);
    const cone = detectCone(crop)!;
    expect(cone).not.toBeNull();
    const deg = (r: number) => (r * 180) / Math.PI;
    expect(Math.abs(deg(cone.a0) + 100)).toBeLessThanOrEqual(10);
    expect(Math.abs(deg(cone.a1) + 40)).toBeLessThanOrEqual(10);
  });

  it("sem cone, não inventa", () => {
    expect(detectCone(fakeCrop(fakeMap(600, 0.15), [300, 300], 120, 100))).toBeNull();
  });
});

describe("cameraView", () => {
  it("meio do cone em graus a partir do norte, horário", () => {
    // atan2 -100..-40 = meio em -70 (y pra baixo) = 20° a partir do norte; 150..210 = oeste
    for (const [a0, a1, want] of [[-100, -40, 20], [30, 90, 150]] as const) {
      const crop = fakeCrop(fakeMap(600, 0.3), [300, 300], 120, 100);
      addCone(crop, a0, a1, 40);
      const cam = cameraView(crop)!;
      expect(cam).not.toBeNull();
      expect(Math.abs(cam.deg - want)).toBeLessThanOrEqual(8);
      expect(Math.abs(cam.width - 60)).toBeLessThanOrEqual(16);
    }
  });
});

describe("locateByImage", () => {
  it("acha a posição partindo de uma anterior deslocada, mesmo com cone", () => {
    const map = fakeMap(900, 0.3);
    const truth: [number, number] = [452.3, 437.6];
    const crop = fakeCrop(map, truth, 120, 100);
    addCone(crop, 20, 85, 40);
    const win = makeMapWindow(planesFromGray(map), 0, 0, 4);
    const mini = minimapPlanes(crop, DEFAULT_MASK);
    for (const prev of [[452, 437], [540, 400], [380, 500]] as [number, number][]) {
      const L = locateByImage(mini, 100 / 120, prev, win)!;
      expect(L).not.toBeNull();
      expect(Math.hypot(L.px[0] - truth[0], L.px[1] - truth[1])).toBeLessThan(1.5);
      expect(L.score).toBeGreaterThan(0.9);
    }
  });

  it("fora do alcance da busca, não acha o lugar certo", () => {
    const map = fakeMap(900);
    const crop = fakeCrop(map, [450, 450], 120, 100);
    const win = makeMapWindow(planesFromGray(map), 0, 0, 4);
    const L = locateByImage(minimapPlanes(crop, DEFAULT_MASK), 100 / 120, [650, 450], win, { search: 60, candidates: 3, minValid: 0.4 });
    expect(L === null || Math.hypot(L.px[0] - 450, L.px[1] - 450) > 100).toBe(true);
  });
});
