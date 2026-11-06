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

  it("com região, só procura dentro dela", async () => {
    const size = 1024;
    const map = fakeMap(size, 0.5);
    const info: MapInfo = { name: "teste", map_id: "teste", tileSize: 256, minZoom: 0, maxZoom: 2, bounds: { x0: 0, y0: 0, x1: size, y1: size } };
    const read = pyramid(map, 2, 0, 256);
    const g = new GlobalLocator(info, read, new ImageLocator(info, read), DEFAULT_MASK, { ...DEFAULT_GLOBAL, minTemplate: 24 });
    const truth: [number, number] = [777, 210];
    const crop = fakeCrop(map, truth, 72, 60);
    const inside = await g.locate(crop, 72, 60, undefined, { x0: 600, y0: 0, x1: 1024, y1: 400 });
    expect(Math.hypot(inside!.px[0] - truth[0], inside!.px[1] - truth[1])).toBeLessThan(1.5);
    const outside = await g.locate(crop, 72, 60, undefined, { x0: 0, y0: 500, x1: 500, y1: 1024 });
    // fora da região o lugar certo nem é candidato
    expect(outside === null || Math.hypot(outside.px[0] - truth[0], outside.px[1] - truth[1]) > 100).toBe(true);
  });
});
