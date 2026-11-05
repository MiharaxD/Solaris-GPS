import { describe, expect, it } from "vitest";
import type { MapInfo } from "../maps";
import { embedInFrame, subImage, type Rgba } from "./image";

import { DEFAULT_SESSION, TrackSession } from "./session";
import { fakeCrop, fakeMap, pyramid } from "./synthetic";

const SIZE = 1024;
const map = fakeMap(SIZE, 0.5);
const info: MapInfo = { name: "teste", map_id: "teste", tileSize: 256, minZoom: 0, maxZoom: 2, bounds: { x0: 0, y0: 0, x1: SIZE, y1: SIZE } };
const reader = pyramid(map, 2, 0, 256);


/** No mapa sintético a busca global só sai "certa" em poucos pontos (as manchas se repetem); (777, 210) é um. */
/** Frame 800×600 com o minimapa (raio 72, mostrando 60 px do mapa) em (120, 120). */
function frameAt(p: [number, number]): Rgba {
  return embedInFrame(fakeCrop(map, p, 72, 60), 800, 600, 48, 48);
}
const readOf = (f: Rgba) => (x: number, y: number, w: number, h: number) => subImage(f, x, y, w, h);

function session(clock: { t: number }) {
  const s = new TrackSession(() => reader, () => clock.t);
  s.setRegion({ cx: 48 + 71.5, cy: 48 + 71.5, r: 72, shape: "circle" }, "circle");
  return s;
}

describe("TrackSession", () => {
  it("sem escala não procura; com escala acha sozinho e segue", async () => {
    const clock = { t: 0 };
    const s = session(clock);
    s.setMap({ info, radiusPx: null, refs: [] });
    await s.step(readOf(frameAt([777, 210])), 800, 600);
    expect(s.state).toBe("sem-escala");
    s.setMap({ info, radiusPx: 60, refs: [] });
    expect(s.state).toBe("procurando");
    const r1 = await s.step(readOf(frameAt([777, 210])), 800, 600);
    expect(r1.located?.mode).toBe("global");
    expect(s.state).toBe("seguindo");
    // anda 20 px: a camada local acompanha
    clock.t += 100;
    const r2 = await s.step(readOf(frameAt([797, 200])), 800, 600);
    expect(r2.located?.mode).toBe("local");
    expect(Math.hypot(s.pos![0] - 797, s.pos![1] - 200)).toBeLessThan(2);
  });

  it("perde o rastreio quando nada casa e volta a procurar no mapa todo", async () => {
    const clock = { t: 0 };
    const s = session(clock);
    s.setMap({ info, radiusPx: 60, refs: [] });
    s.findHere([500, 500]);
    const noise: Rgba = { width: 800, height: 600, data: new Uint8ClampedArray(800 * 600 * 4).fill(90) };
    await s.step(readOf(noise), 800, 600);
    clock.t += 2000;
    expect(s.state).toBe("perdido");
    const r = await s.step(readOf(frameAt([777, 210])), 800, 600);
    expect(r.located?.mode).toBe("global");
    expect(s.state).toBe("seguindo");
  });

  it("salto da busca global sem ícone: descarta até repetir no mesmo lugar", async () => {
    const clock = { t: 0 };
    const s = new TrackSession(() => reader, () => clock.t, { ...DEFAULT_SESSION, jump: { ...DEFAULT_SESSION.jump, maxSpeed: 10 } });
    s.setRegion({ cx: 48 + 71.5, cy: 48 + 71.5, r: 72, shape: "circle" }, "circle");
    s.setMap({ info, radiusPx: 60, refs: [] });
    s.findHere([400, 400]);
    await s.step(readOf(frameAt([400, 400])), 800, 600);
    expect(Math.hypot(s.pos![0] - 400, s.pos![1] - 400)).toBeLessThan(2);
    // some o minimapa, perde o rastreio e reaparece longe (sem teleporte confirmado)
    const noise: Rgba = { width: 800, height: 600, data: new Uint8ClampedArray(800 * 600 * 4).fill(90) };
    clock.t += 100;
    await s.step(readOf(noise), 800, 600);
    const far = frameAt([777, 210]);
    for (let i = 0; i < 2; i++) {
      clock.t += 2000;
      const r = await s.step(readOf(far), 800, 600);
      expect(r.located?.mode).toBe("global");
      expect(r.rejected).not.toBeNull();
      expect(r.fused).toBeNull();
      expect(Math.hypot(s.pos![0] - 400, s.pos![1] - 400)).toBeLessThan(2);
    }
    clock.t += 2000;
    const r = await s.step(readOf(far), 800, 600);
    expect(r.rejected).toBeNull();
    expect(Math.hypot(s.pos![0] - 777, s.pos![1] - 210)).toBeLessThan(2);
    expect(s.display).toEqual(s.pos);
  });

  it("andando, a posição exibida é suavizada perto da medida", async () => {
    const clock = { t: 0 };
    const s = session(clock);
    s.setMap({ info, radiusPx: 60, refs: [] });
    s.findHere([400, 400]);
    for (let i = 0; i <= 10; i++) {
      await s.step(readOf(frameAt([400 + 3 * i, 400])), 800, 600);
      clock.t += 100;
    }
    expect(Math.hypot(s.pos![0] - 430, s.pos![1] - 400)).toBeLessThan(2);
    expect(Math.hypot(s.display![0] - 430, s.display![1] - 400)).toBeLessThan(3);
  });

  it("Find me: espera o clique sem localizar, depois procura em volta dele", async () => {
    const clock = { t: 0 };
    const s = session(clock);
    s.setMap({ info, radiusPx: 60, refs: [] });
    s.holdForClick();
    const r0 = await s.step(readOf(frameAt([400, 400])), 800, 600);
    expect(s.state).toBe("esperando-clique");
    expect(r0.located).toBeNull();
    s.findHere([440, 380]);
    const r1 = await s.step(readOf(frameAt([400, 400])), 800, 600);
    expect(r1.located?.mode).toBe("local");
    expect(Math.hypot(s.pos![0] - 400, s.pos![1] - 400)).toBeLessThan(2);
  });
});
