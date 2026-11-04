import { describe, expect, it } from "vitest";
import { defaultFilter, makeVisibility, markerText, parseFilter, searchMarkers, type GameMarker } from "./markers";

const mk = (id: string, cat: string, sub: string, name: string, area: string[]): GameMarker => ({
  id, cat, sub, name, x: 0, y: 0, z: 0, area,
});

const M = [
  mk("e1", "chest", "premium", "Baú premium", ["Jinzhou", "Central Plains"]),
  mk("e2", "chest", "basic", "Baú básico", ["Jinzhou", "Desorock Highland"]),
  mk("e3", "plant", "Angelica", "Angelica", ["Huanglong", "Gorges of Spirits"]),
  mk("tp-1", "beacon", "beacon", "Teleporte", ["Jinzhou", "Central Plains"]),
];
const T = M.map(markerText);

describe("searchMarkers", () => {
  it("ignora acentos e caixa, exige todas as palavras", () => {
    expect(searchMarkers(M, T, "bau JINZHOU").map((m) => m.id)).toEqual(["e1", "e2"]);
    expect(searchMarkers(M, T, "baú central").map((m) => m.id)).toEqual(["e1"]);
    expect(searchMarkers(M, T, "padrao")).toEqual([]);
  });

  it("acha pela subcategoria traduzida e pela área", () => {
    expect(searchMarkers(M, T, "premium").map((m) => m.id)).toEqual(["e1"]);
    expect(searchMarkers(M, T, "gorges").map((m) => m.id)).toEqual(["e3"]);
  });

  it("consulta vazia não devolve nada e respeita o limite", () => {
    expect(searchMarkers(M, T, "   ")).toEqual([]);
    expect(searchMarkers(M, T, "jinzhou", 1)).toHaveLength(1);
  });
});

describe("filtro", () => {
  it("esconde categoria, subcategoria e referências ignoradas", () => {
    const vis = makeVisibility({ hiddenCats: ["plant"], hiddenSubs: ["chest/basic"] }, new Set(["tp-1"]));
    expect(M.filter(vis).map((m) => m.id)).toEqual(["e1"]);
  });

  it("padrão deixa as categorias numerosas desligadas", () => {
    const vis = makeVisibility(defaultFilter(), new Set());
    expect(M.filter(vis).map((m) => m.id)).toEqual(["e1", "e2", "tp-1"]);
  });

  it("preferência corrompida volta ao padrão", () => {
    expect(parseFilter("{lixo")).toEqual(defaultFilter());
    expect(parseFilter(JSON.stringify({ hiddenCats: ["ore", 3], hiddenSubs: null }))).toEqual({
      hiddenCats: ["ore"],
      hiddenSubs: [],
    });
  });
});
