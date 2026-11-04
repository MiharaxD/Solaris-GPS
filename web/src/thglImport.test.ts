import { describe, expect, it } from "vitest";
import { matchEntries, parseThgl } from "./thglImport";

describe("parseThgl", () => {
  it("lê id@x:y com negativos, decimais e espaços; separa inválidos", () => {
    const r = parseThgl(JSON.stringify(["chest_1@-123.5:456", " a@b@1e3 : -2 ", "sem-coord", 7, "x@1:", "chest_1@-123.5:456"]));
    expect(r.entries).toEqual([
      { raw: "chest_1@-123.5:456", id: "chest_1", x: -123.5, y: 456 },
      { raw: "a@b@1e3 : -2", id: "a@b", x: 1000, y: -2 },
    ]);
    expect(r.invalid).toEqual(["sem-coord", "7", "x@1:"]);
  });

  it("recusa o que não é array JSON", () => {
    expect(() => parseThgl("{")).toThrow(/JSON/);
    expect(() => parseThgl('{"a":1}')).toThrow(/array/);
  });
});

describe("matchEntries", () => {
  const markers = [
    { id: "e1", x: 10000, y: 20000 },
    { id: "e2", x: 10150, y: 20000 },
    { id: "e3", x: 50000, y: -30000 },
  ];

  it("casa um pra um pelo mais próximo, dentro do raio", () => {
    const { entries } = parseThgl(JSON.stringify(["a@10010:20000", "b@10140:20010", "c@90000:0"]));
    const r = matchEntries(entries, markers, 100);
    expect(r.scale).toBe(1);
    expect(r.matches.map((m) => [m.entry.id, m.marker.id])).toEqual([["a", "e1"], ["b", "e2"]]);
    expect(r.unmatched.map((e) => e.id)).toEqual(["c"]);
  });

  it("detecta coordenadas em metros e eixos trocados", () => {
    const { entries } = parseThgl(JSON.stringify(["a@200:100", "b@-300:500"]));
    const r = matchEntries(entries, markers, 100);
    expect([r.scale, r.swapped]).toEqual([100, true]);
    expect(r.matches.map((m) => m.marker.id).sort()).toEqual(["e1", "e3"]);
  });
});
