import { describe, expect, it } from "vitest";
import { computeRegions } from "./regions";

function cloud(area: string, x: number, y: number, n = 200, spread = 1000) {
  return Array.from({ length: n }, (_, i) => ({ area: [area, "sub"], px: x + ((i * 37) % spread), py: y + ((i * 91) % spread) }));
}

describe("regiões", () => {
  it("tira o retângulo de cada área de topo, com folga e sem os pontos perdidos", () => {
    const pts = [...cloud("Jinzhou", 0, 0), ...cloud("Ragunna", 5000, 0), ...cloud("Septimont", 5000, 3000)];
    pts.push({ area: ["Jinzhou"], px: 90000, py: 90000 }); // ponto perdido não estica a região
    const regions = computeRegions(pts, 100);
    const jin = regions.find((r) => r.id === "Jinzhou")!;
    expect(jin.group).toBe("Huanglong");
    expect(jin.rect.x0).toBeLessThan(0);
    expect(jin.rect.x1).toBeLessThan(2000);
    // nação com 2+ regiões ganha a opção inteira, logo antes das regiões dela
    const ids = regions.map((r) => r.id);
    expect(ids).toEqual(["Jinzhou", "nation:Rinascita", "Ragunna", "Septimont"]);
    const rin = regions.find((r) => r.id === "nation:Rinascita")!;
    expect(rin.rect.y1).toBeGreaterThan(3900);
  });

  it("mapa com uma região só (ou áreas pequenas) não tem seletor", () => {
    expect(computeRegions(cloud("Jinzhou", 0, 0))).toEqual([]);
    expect(computeRegions([...cloud("Jinzhou", 0, 0), ...cloud("Ilha", 0, 0, 5)])).toEqual([]);
  });
});
