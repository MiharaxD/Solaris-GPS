import { describe, expect, it } from "vitest";
import { anchorAt, apply, fitAffine, fitSimilarity, invert, isMirrored, type Affine, type Pair } from "./affine";

// Afim "realista": coordenadas de jogo na casa de 1e7–1e8, eixos trocados e escala ~1/5000.
const TRUE: Affine = [0, 1 / 4900, 15000, -1 / 5100, 0, 20000];
const GAME: [number, number][] = [
  [-4243700, 10040600],
  [31259259, 8523998],
  [128740100, 109111700],
  [-17524494, -87495031],
  [60000000, 40000000],
];
const pairs = (t: Affine, noise = 0): Pair[] =>
  GAME.map((g, i) => {
    const [x, y] = apply(t, g);
    return { game: g, px: [x + (i % 2 ? noise : -noise), y + (i % 3 ? noise : -noise)] };
  });

describe("fitAffine", () => {
  it("recupera a afim exata com 3 pontos", () => {
    const fit = fitAffine(pairs(TRUE).slice(0, 3))!;
    expect(fit).not.toBeNull();
    for (const g of GAME) {
      const [x, y] = apply(fit.affine, g);
      const [ex, ey] = apply(TRUE, g);
      expect(Math.hypot(x - ex, y - ey)).toBeLessThan(1e-6);
    }
    expect(fit.max).toBeLessThan(1e-6);
  });

  it("com ruído, resíduos refletem o erro", () => {
    const fit = fitAffine(pairs(TRUE, 3))!;
    expect(fit.rms).toBeGreaterThan(0.5);
    expect(fit.rms).toBeLessThan(6);
    expect(fit.residuals).toHaveLength(GAME.length);
  });

  it("recusa menos de 3 pontos e pontos colineares", () => {
    expect(fitAffine(pairs(TRUE).slice(0, 2))).toBeNull();
    const line: Pair[] = [0, 1, 2, 3].map((i) => ({ game: [i * 1e6, i * 2e6], px: [i, i] }));
    expect(fitAffine(line)).toBeNull();
  });
});

describe("fitSimilarity / anchorAt", () => {
  // TRUE tem eixos trocados com sinais (0, +, −, 0) e escalas quase iguais → espelhada.
  const SIM_N: Affine = [0.0002, -0.0001, 500, 0.0001, 0.0002, 800]; // rotação+escala
  const SIM_M: Affine = [0, 1 / 5000, 15000, 1 / 5000, 0, 20000]; // troca de eixos = espelhada

  it("2 pontos recuperam a similaridade (normal e espelhada)", () => {
    for (const t of [SIM_N, SIM_M]) {
      const fit = fitSimilarity(pairs(t).slice(0, 2), isMirrored(t))!;
      for (const g of GAME) {
        const [x, y] = apply(fit, g);
        const [ex, ey] = apply(t, g);
        expect(Math.hypot(x - ex, y - ey)).toBeLessThan(1e-6);
      }
    }
  });

  it("detecta espelhamento", () => {
    expect(isMirrored(SIM_N)).toBe(false);
    expect(isMirrored(SIM_M)).toBe(true);
  });

  it("anchorAt encaixa um ponto", () => {
    const t = anchorAt(SIM_N, { game: GAME[0]!, px: [10, 20] });
    const [x, y] = apply(t, GAME[0]!);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(20, 6);
  });
});

describe("invert", () => {
  it("ida e volta", () => {
    const inv = invert(TRUE)!;
    for (const g of GAME) {
      const back = apply(inv, apply(TRUE, g));
      expect(Math.abs(back[0] - g[0])).toBeLessThan(1e-3);
      expect(Math.abs(back[1] - g[1])).toBeLessThan(1e-3);
    }
  });

  it("singular devolve null", () => {
    expect(invert([1, 2, 0, 2, 4, 0])).toBeNull();
  });
});
