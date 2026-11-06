import { describe, expect, it } from "vitest";
import type { MapInfo } from "../maps";
import { embedInFrame, subImage, type Rgba } from "./image";

import { DEFAULT_SESSION, TrackSession } from "./session";
import { fakeCrop, fakeMap, pyramid, withRing } from "./synthetic";

const SIZE = 1024;
const map = fakeMap(SIZE, 0.5);
const info: MapInfo = { name: "teste", map_id: "teste", tileSize: 256, minZoom: 0, maxZoom: 2, bounds: { x0: 0, y0: 0, x1: SIZE, y1: SIZE } };
const reader = pyramid(map, 2, 0, 256);


/** No mapa sintético a busca global só sai "certa" em poucos pontos (as manchas se repetem); (777, 210) é um. */
/** Frame 800×600 com o minimapa (raio 72, mostrando 60 px do mapa, com o anel) em (120, 120). */
const C = 48 + 71.5;
function frameAt(p: [number, number]): Rgba {
  return withRing(embedInFrame(fakeCrop(map, p, 72, 60), 800, 600, 48, 48), C, C, 72.5);
}
/** Tela sem minimapa (menu, cutscene). */
const blank: Rgba = { width: 800, height: 600, data: new Uint8ClampedArray(800 * 600 * 4).fill(90) };
/** Minimapa à vista, mas com nada que case (o rastreio se perde). */
const noise = withRing(blank, C, C, 72.5);
const readOf = (f: Rgba) => (x: number, y: number, w: number, h: number) => subImage(f, x, y, w, h);

function session(clock: { t: number }) {
  const s = new TrackSession(() => reader, () => clock.t);
  s.setRegion({ cx: C, cy: C, r: 72, shape: "circle" }, "circle");
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
    s.setRegion({ cx: C, cy: C, r: 72, shape: "circle" }, "circle");
    s.setMap({ info, radiusPx: 60, refs: [] });
    s.findHere([400, 400]);
    await s.step(readOf(frameAt([400, 400])), 800, 600);
    expect(Math.hypot(s.pos![0] - 400, s.pos![1] - 400)).toBeLessThan(2);
    // nada casa, perde o rastreio e reaparece longe (sem teleporte confirmado)
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

  it("sem minimapa pausa e, quando ele volta, retoma de onde parou", async () => {
    const clock = { t: 0 };
    const s = session(clock);
    s.setMap({ info, radiusPx: 60, refs: [] });
    s.findHere([400, 400]);
    await s.step(readOf(frameAt([400, 400])), 800, 600);
    expect(s.state).toBe("seguindo");
    // um frame ruim não pausa; dois seguidos sim, e aí nada é localizado
    clock.t += 100;
    const r1 = await s.step(readOf(blank), 800, 600);
    expect(r1.presence?.visible).toBe(true);
    clock.t += 100;
    const r2 = await s.step(readOf(blank), 800, 600);
    expect(r2.presence?.visible).toBe(false);
    expect(s.state).toBe("pausado");
    for (let i = 0; i < 50; i++) {
      clock.t += 100;
      const r = await s.step(readOf(blank), 800, 600);
      expect(r.located).toBeNull();
      expect(r.heading).toBeNull();
    }
    expect(s.state).toBe("pausado");
    expect(s.pausedFor).toBe(5000);
    // 5 s depois o minimapa volta: segue pela camada local, sem passar por "perdido"
    clock.t += 100;
    const r3 = await s.step(readOf(frameAt([405, 398])), 800, 600);
    expect(r3.presence?.visible).toBe(true);
    expect(r3.located?.mode).toBe("local");
    expect(r3.rejected).toBeNull();
    expect(s.state).toBe("seguindo");
    expect(s.pausedFor).toBe(0);
    expect(Math.hypot(s.pos![0] - 405, s.pos![1] - 398)).toBeLessThan(2);
  });

  it("teleporte pra outro Nexus longe: a referência sozinha não prende no Nexus antigo", async () => {
    // em volta do Nexus antigo o mapa é liso: a camada imagem não casa nada ali (como no jogo,
    // onde o minimapa do lugar novo não casa em volta do velho) e só a referência sobra
    const flat: typeof map = { ...map, data: new Float32Array(map.data) };
    for (let y = 200; y < 600; y++) for (let x = 200; x < 600; x++) flat.data[y * SIZE + x] = 90;
    const flatReader = pyramid(flat, 2, 0, 256);
    // Nexus (anel) sob a seta, na escala do minimapa de raio 72 (21,5 px a raio 126)
    const at = (p: [number, number]): Rgba => {
      const f = withRing(embedInFrame(fakeCrop(flat, p, 72, 60), 800, 600, 48, 48), C, C, 72.5);
      const rr = (21.5 * 72) / 126;
      for (let a = 0; a < 360; a += 0.5) {
        const t = (a * Math.PI) / 180;
        for (const [dr, rgb] of [[-1, [60, 155, 200]], [0, [200, 225, 240]], [1, [60, 155, 200]]] as const) {
          const i = (Math.round(C + 6 + (rr + dr) * Math.sin(t)) * f.width + Math.round(C + 4 + (rr + dr) * Math.cos(t))) * 4;
          f.data[i] = rgb[0];
          f.data[i + 1] = rgb[1];
          f.data[i + 2] = rgb[2];
        }
      }
      return f;
    };
    const k = 60 / 72;
    const refs = [
      { id: "velho", kind: "nexus" as const, px: [400 + 4 * k, 400 + 6 * k] as [number, number] },
      { id: "novo", kind: "nexus" as const, px: [777 + 4 * k, 210 + 6 * k] as [number, number] },
    ];
    const clock = { t: 0 };
    const s = new TrackSession(() => flatReader, () => clock.t);
    s.setRegion({ cx: C, cy: C, r: 72, shape: "circle" }, "circle");
    s.setMap({ info, radiusPx: 60, refs });
    s.findHere([400, 400]);
    const r0 = await s.step(readOf(at([400, 400])), 800, 600);
    expect(r0.fused?.layer).toBe("referências");
    expect(Math.hypot(s.pos![0] - 400, s.pos![1] - 400)).toBeLessThan(3);
    // teleportou pro outro Nexus, a mais de 400 px: o Nexus antigo ainda "casa" pela referência,
    // mas a busca guiada confere pela imagem e pula pro novo
    const far = at([777, 210]);
    for (let i = 0; i < 3; i++) {
      clock.t += 100;
      await s.step(readOf(far), 800, 600);
    }
    expect(Math.hypot(s.pos![0] - 777, s.pos![1] - 210)).toBeLessThan(4);
    expect(s.state).toBe("seguindo");
  });

  it("anel fraco na região salva: pausa e não move a região (o minimapa é fixo)", async () => {
    const clock = { t: 0 };
    const s = new TrackSession(() => reader, () => clock.t);
    const saved = { cx: C + 40, cy: C + 30, r: 72, shape: "circle" as const };
    s.setRegion(saved, "circle");
    s.setMap({ info, radiusPx: 60, refs: [] });
    s.findHere([400, 400]);
    for (let i = 0; i < 5; i++) {
      const r = await s.step(readOf(frameAt([400, 400])), 800, 600);
      expect(r.detection).toBeNull();
      clock.t += 1000;
    }
    expect(s.region).toEqual(saved);
    expect(s.state).toBe("pausado");
  });
});
