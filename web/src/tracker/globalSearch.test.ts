import { describe, expect, it } from "vitest";
import type { MapInfo } from "../maps";
import { DEFAULT_GLOBAL, GlobalLocator } from "./globalSearch";
import { ImageLocator } from "./imageLocator";
import { DEFAULT_MASK } from "./locate";
import { fakeCrop, fakeMap, pyramid } from "./synthetic";

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
