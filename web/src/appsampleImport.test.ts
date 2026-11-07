import { describe, expect, it } from "vitest";
import { parseAppsample, resolveIds, type AppsampleTable } from "./appsampleImport";

describe("parseAppsample", () => {
  it("lê strings e números de dígitos, ignora repetidos e separa inválidos", () => {
    const r = parseAppsample(JSON.stringify(["37794", 1229, " 38035 ", "37794", "abc", null, 1.5]));
    expect(r.ids).toEqual(["37794", "1229", "38035"]);
    expect(r.invalid).toEqual(['"abc"', "null", "1.5"]);
  });

  it("recusa o que não é array JSON", () => {
    expect(() => parseAppsample("[")).toThrow(/JSON/);
    expect(() => parseAppsample('{"ids":[]}')).toThrow(/array/);
  });
});

describe("resolveIds", () => {
  const table: AppsampleTable = {
    built: "",
    ids: {
      "1": ["overworld", "e10", 2.5],
      "2": ["overworld", "e11", 40],
      "3": ["lahai-roi", "e20", 0.4],
      "4": ["overworld", "e30", 1, ["e31", "e32"]],
    },
  };

  it("agrupa por mapa e lista os que a tabela não conhece", () => {
    const r = resolveIds(["1", "3", "9", "2"], table);
    expect([...r.byMap.keys()]).toEqual(["overworld", "lahai-roi"]);
    expect(r.byMap.get("overworld")!.map((x) => x.id)).toEqual(["e10", "e11"]);
    expect(r.byMap.get("lahai-roi")![0]).toEqual({ map: "lahai-roi", id: "e20", dist: 0.4, source: "3" });
    expect(r.missing).toEqual(["9"]);
    expect(r.tooFar).toBe(0);
  });

  it("marca junto as variantes do mesmo baú", () => {
    const r = resolveIds(["4"], table);
    expect(r.byMap.get("overworld")!.map((x) => x.id)).toEqual(["e30", "e31", "e32"]);
    expect(r.byMap.get("overworld")!.every((x) => x.source === "4" && x.dist === 1)).toBe(true);
  });

  it("corta pelo limite de distância", () => {
    const r = resolveIds(["1", "2"], table, 10);
    expect(r.byMap.get("overworld")!.map((x) => x.id)).toEqual(["e10"]);
    expect(r.tooFar).toBe(1);
  });
});
