import { describe, expect, it } from "vitest";
import { fuseGlobal, fuseLocal, guidedCandidates, iconAtCenter } from "./fuse";
import type { GlobalResult } from "./globalSearch";
import type { Located } from "./locate";
import type { RefFix, RefPoint } from "./references";

const img = (px: [number, number], score: number): Located => ({ px, score, coarseScore: score, margin: 0.2, timings: {} });
const ref = (px: [number, number], mode: RefFix["mode"]): RefFix => ({ px, matched: [], mode, residual: 0 });
const glob = (px: [number, number], score: number, confident: boolean): GlobalResult => ({ ...img(px, score), peaks: 1, rank: 0, confident });

describe("fuseLocal", () => {
  it("concordando, vale a imagem com confiança alta", () => {
    expect(fuseLocal(img([100, 100], 0.8), ref([110, 105], "prev"))).toEqual({ px: [100, 100], layer: "ambas", confidence: "alta" });
  });
  it("discordando: constelação vence; 1 ícone só perde pra imagem forte; senão descarta", () => {
    expect(fuseLocal(img([100, 100], 0.9), ref([300, 100], "constellation"))?.layer).toBe("referências");
    expect(fuseLocal(img([100, 100], 0.7), ref([300, 100], "prev"))?.layer).toBe("imagem");
    expect(fuseLocal(img([100, 100], 0.4), ref([300, 100], "prev"))).toBeNull();
  });
  it("imagem fraca não vale sozinha", () => {
    expect(fuseLocal(img([100, 100], 0.2), null)).toBeNull();
    expect(fuseLocal(img([100, 100], 0.2), ref([5, 5], "prev"))?.layer).toBe("referências");
  });
});

describe("fuseGlobal", () => {
  it("a guiada vence a global discordante; a global incerta sozinha não vale", () => {
    expect(fuseGlobal(glob([0, 0], 0.5, true), glob([500, 500], 0.36, true))?.px).toEqual([500, 500]);
    expect(fuseGlobal(glob([0, 0], 0.5, false), null)).toBeNull();
    expect(fuseGlobal(glob([0, 0], 0.8, true), null)?.layer).toBe("imagem");
    expect(fuseGlobal(glob([10, 0], 0.8, true), glob([0, 0], 0.8, true))?.confidence).toBe("alta");
  });
});

describe("guidedCandidates", () => {
  const refs: RefPoint[] = [
    { id: "a", kind: "nexus", px: [1000, 1000] },
    { id: "b", kind: "beacon", px: [2000, 2000] },
    { id: "c", kind: "beacon", px: [2100, 2000] },
    { id: "d", kind: "beacon", px: [5000, 5000] },
  ];
  it("com ícone sob a seta, só ele conta e a posição pula a barreira", () => {
    const g = guidedCandidates([{ kind: "nexus", dx: 10, dy: 0, score: 1 }, { kind: "beacon", dx: 80, dy: 0, score: 1 }], 0.5, 126, refs);
    expect(g).toEqual({ candidates: [[995, 1000]], trusted: true });
    expect(iconAtCenter([{ kind: "beacon", dx: 80, dy: 0, score: 1 }], 126)).toBe(false);
  });
  it("um ícone longe: cada teleporte do tipo, sem pular a barreira", () => {
    const g = guidedCandidates([{ kind: "beacon", dx: 80, dy: -40, score: 1 }], 0.5, 126, refs);
    expect(g.trusted).toBe(false);
    expect(g.candidates).toEqual([[1960, 2020], [2060, 2020], [4960, 5020]]);
  });
  it("dois ícones longe que formam constelação: uma posição só", () => {
    // jogador em (2050, 2100): b a (-50, -100) e c a (50, -100), em px do mapa; s = 0,5
    const icons = [
      { kind: "beacon" as const, dx: -100, dy: -200, score: 1 },
      { kind: "beacon" as const, dx: 100, dy: -200, score: 1 },
    ];
    expect(guidedCandidates(icons, 0.5, 126, refs)).toEqual({ candidates: [[2050, 2100]], trusted: true });
  });
});
