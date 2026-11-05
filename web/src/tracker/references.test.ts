import { describe, expect, it } from "vitest";
import type { Rgba } from "./image";
import { detectIcons, type DetectedIcon } from "./icons";
import { locateByRefs, refPoints, type RefPoint } from "./references";

const REFS: RefPoint[] = [
  { id: "a", kind: "beacon", px: [1000, 1000] },
  { id: "b", kind: "beacon", px: [1060, 980] },
  { id: "c", kind: "nexus", px: [950, 1050] },
  { id: "d", kind: "beacon", px: [3000, 3000] },
  { id: "e", kind: "beacon", px: [3060, 2980] },
];

/** Ícones como o minimapa mostraria com o jogador em `p` (escala s px do mapa por px da tela). */
function iconsAt(p: [number, number], s: number, ids: string[]): DetectedIcon[] {
  return ids.map((id) => {
    const q = REFS.find((r) => r.id === id)!;
    return { kind: q.kind, dx: (q.px[0] - p[0]) / s, dy: (q.px[1] - p[1]) / s, score: 1 };
  });
}

describe("locateByRefs", () => {
  const s = 0.83;
  it("constelação: 2+ ícones dão a posição sem anterior", () => {
    const p: [number, number] = [1010, 1020];
    const fix = locateByRefs(iconsAt(p, s, ["a", "b", "c"]), s, REFS, null)!;
    expect(fix.mode).toBe("constellation");
    expect(fix.matched).toHaveLength(3);
    expect(Math.hypot(fix.px[0] - p[0], fix.px[1] - p[1])).toBeLessThan(0.01);
  });

  it("par repetido em outro lugar: desempata pela anterior", () => {
    const p: [number, number] = [3010, 3010];
    const icons = iconsAt(p, s, ["d", "e"]); // o mesmo desenho de a+b
    const fix = locateByRefs(icons, s, REFS, [3050, 3000])!;
    expect(Math.hypot(fix.px[0] - p[0], fix.px[1] - p[1])).toBeLessThan(0.01);
  });

  it("1 ícone: ambíguo sem anterior; com anterior, a referência mais perto", () => {
    const p: [number, number] = [1005, 990];
    const icons = iconsAt(p, s, ["a"]);
    expect(locateByRefs(icons, s, REFS, null)).toBeNull();
    const fix = locateByRefs(icons, s, REFS, [1015, 995])!;
    expect(fix.mode).toBe("prev");
    expect(Math.hypot(fix.px[0] - p[0], fix.px[1] - p[1])).toBeLessThan(0.01);
  });

  it("tipo errado não casa", () => {
    const icons = iconsAt([1000, 1040], s, ["c"]).map((i) => ({ ...i, kind: "beacon" as const }));
    const fix = locateByRefs(icons, s, REFS, [1000, 1040]);
    expect(fix === null || Math.hypot(fix.px[0] - 1000, fix.px[1] - 1040) > 30).toBe(true);
  });
});

describe("refPoints", () => {
  it("aplica a afim, junta os manuais e tira os ignorados", () => {
    const pts = refPoints(
      [
        { id: "tp-1", kind: "beacon", entityId: 1, x: 10, y: 20, z: 0, area: [], label: "" },
        { id: "tp-2", kind: "nexus", entityId: 2, x: 30, y: 40, z: 0, area: [], label: "" },
      ],
      [2, 0, 100, 0, 2, 200],
      [{ id: "m1", cat: "nexus", name: "x", px: [5, 6] }, { id: "m2", cat: "chest", name: "y", px: [7, 8] }],
      new Set(["tp-2"]),
    );
    expect(pts).toEqual([
      { id: "tp-1", kind: "beacon", px: [120, 240] },
      { id: "m1", kind: "nexus", px: [5, 6] },
    ]);
  });
});

describe("detectIcons", () => {
  /** Recorte 252×252 (raio 126) com fundo escuro, um Nexus (anel) e um teleporte (pilha). */
  function scene(): Rgba {
    const W = 252;
    const data = new Uint8ClampedArray(W * W * 4);
    const put = (x: number, y: number, rgb: [number, number, number]) => {
      if (x < 0 || y < 0 || x >= W || y >= W) return;
      const i = (Math.round(y) * W + Math.round(x)) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    };
    for (let i = 0; i < W * W; i++) {
      data[i * 4] = 30;
      data[i * 4 + 1] = 50;
      data[i * 4 + 2] = 60;
      data[i * 4 + 3] = 255;
    }
    // Nexus em (+40, -30): anel de raio 21,5 (borda azul, miolo branco-azulado)
    for (let a = 0; a < 360; a += 0.5) {
      const t = (a * Math.PI) / 180;
      for (const [dr, rgb] of [[-1, [60, 155, 200]], [0, [200, 225, 240]], [1, [60, 155, 200]]] as const) {
        put(126 + 40 + (21.5 + dr) * Math.cos(t), 126 - 30 + (21.5 + dr) * Math.sin(t), rgb as [number, number, number]);
      }
    }
    // teleporte em (-50, 20): contorno azul 14×36
    for (let y = -18; y <= 18; y++) for (const x of [-7, 7]) put(126 - 50 + x, 126 + 20 + y, [60, 155, 200]);
    for (let x = -7; x <= 7; x++) for (const y of [-18, 18]) put(126 - 50 + x, 126 + 20 + y, [60, 155, 200]);
    // seta amarela cobrindo metade do anel
    for (let y = -30; y <= 0; y++) for (let x = 20; x <= 70; x++) put(126 + x, 126 - 30 + y, [240, 210, 60]);
    return { width: W, height: W, data };
  }

  it("acha o Nexus coberto pela metade e o teleporte", () => {
    const icons = detectIcons(scene(), 126);
    const n = icons.find((i) => i.kind === "nexus")!;
    const t = icons.find((i) => i.kind === "beacon")!;
    expect(icons).toHaveLength(2);
    expect(Math.hypot(n.dx - 40.5, n.dy + 29.5)).toBeLessThan(1.5);
    expect(Math.hypot(t.dx + 49.5, t.dy - 20.5)).toBeLessThan(1.5);
  });
});
