import { describe, expect, it } from "vitest";
import type { MapInfo } from "../maps";
import type { Gray, Rgba } from "./image";
import { DEFAULT_GLOBAL, GlobalLocator } from "./globalSearch";
import { ImageLocator } from "./imageLocator";
import { DEFAULT_MASK } from "./locate";
import { resizeGray } from "./match";
import { fakeCrop, fakeMap } from "./synthetic";
import type { TileReader } from "./tiles";

/** Pirâmide em memória (como a do build_tiles): o zoom máximo e os menores por redução. */
function pyramid(map: Gray, maxZoom: number, minZoom: number, ts: number): TileReader {
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

describe("GlobalLocator", () => {
  it("acha a posição sem anterior, usando os zooms reduzidos", async () => {
    const size = 1024;
    const map = fakeMap(size, 0.5);
    const info: MapInfo = { name: "teste", map_id: "teste", tileSize: 256, minZoom: 0, maxZoom: 2, bounds: { x0: 0, y0: 0, x1: size, y1: size } };
    const read = pyramid(map, 2, 0, 256);
    const fine = new ImageLocator(info, read);
    const g = new GlobalLocator(info, read, fine, DEFAULT_MASK, { ...DEFAULT_GLOBAL, minTemplate: 24 });
    expect(g.zoomFor(60)).toBe(0); // visão geral no zoom 0 (gerado, 4× menor)
    for (const truth of [[300.4, 640.2], [777, 210]] as [number, number][]) {
      const crop = fakeCrop(map, truth, 72, 60);
      const res = await g.locate(crop, 72, 60);
      expect(res).not.toBeNull();
      expect(Math.hypot(res!.px[0] - truth[0], res!.px[1] - truth[1])).toBeLessThan(1.5);
      expect(res!.score).toBeGreaterThan(0.95);
    }
  });
});
