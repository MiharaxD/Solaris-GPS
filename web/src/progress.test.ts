import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, makeBackup, parseBackup, percent, tallyMarkers } from "./progress";

describe("backup", () => {
  it("ida e volta preserva os encontrados", () => {
    const b = makeBackup(new Map([["overworld", new Set(["e2", "e1"])], ["vazio", new Set<string>()]]), new Date(0));
    expect(b.found).toEqual({ overworld: ["e1", "e2"] });
    expect(parseBackup(JSON.parse(JSON.stringify(b)))).toEqual(b);
  });

  it("recusa arquivo que não é backup ou tem dados inválidos", () => {
    expect(() => parseBackup({ foo: 1 })).toThrow(/não é um backup/);
    expect(() => parseBackup({ format: BACKUP_FORMAT, version: 2, found: {} })).toThrow(/versão/);
    expect(() => parseBackup({ format: BACKUP_FORMAT, version: 1, found: { "../x": [] } })).toThrow(/mapa inválido/);
    expect(() => parseBackup({ format: BACKUP_FORMAT, version: 1, found: { overworld: ["ok", 3] } })).toThrow(/ids/);
    expect(() => parseBackup({ format: BACKUP_FORMAT, version: 1, found: [] })).toThrow(/encontrados/);
  });

  it("remove ids repetidos", () => {
    const b = parseBackup({ format: BACKUP_FORMAT, version: 1, found: { overworld: ["e1", "e1", "tp-3"] } });
    expect(b.found.overworld).toEqual(["e1", "tp-3"]);
  });
});

describe("tallyMarkers", () => {
  const M = [
    { id: "a", cat: "chest", sub: "basic" },
    { id: "b", cat: "chest", sub: "premium" },
    { id: "c", cat: "plant", sub: "Angelica" },
    { id: "tp-1", cat: "beacon", sub: "beacon" },
  ];

  it("conta por mapa, categoria e subcategoria, sem os ignorados", () => {
    const { all, cats } = tallyMarkers(M, new Set(["a", "c", "tp-1"]), new Set(["tp-1"]));
    expect(all).toEqual({ found: 2, total: 3 });
    expect(cats.get("chest")?.tally).toEqual({ found: 1, total: 2 });
    expect(cats.get("chest")?.subs.get("premium")).toEqual({ found: 0, total: 1 });
    expect(cats.has("beacon")).toBe(false);
    expect(percent(all)).toBe("66%");
    expect(percent({ found: 0, total: 0 })).toBe("–");
  });
});
