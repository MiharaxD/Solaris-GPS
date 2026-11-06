import { describe, expect, it } from "vitest";
import { comboLabel, comboOf, conflicts, DEFAULT_HOTKEYS, parseHotkeys } from "./hotkeys";

const key = (code: string, mods: Partial<Record<"ctrlKey" | "altKey" | "shiftKey" | "metaKey", boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe("atalhos", () => {
  it("monta a combinação pela tecla física, modificadores em ordem fixa", () => {
    expect(comboOf(key("KeyF", { altKey: true }))).toBe("Alt+KeyF");
    expect(comboOf(key("Digit1", { shiftKey: true, ctrlKey: true }))).toBe("Ctrl+Shift+Digit1");
    expect(comboOf(key("AltLeft", { altKey: true }))).toBeNull();
  });

  it("mostra a combinação de um jeito legível", () => {
    expect(comboLabel("Alt+KeyF")).toBe("Alt+F");
    expect(comboLabel("Ctrl+Shift+Digit1")).toBe("Ctrl+Shift+1");
    expect(comboLabel("Space")).toBe("Espaço");
    expect(comboLabel(null)).toBe("");
  });

  it("lê a preferência por cima dos padrões e aceita atalho desligado", () => {
    expect(parseHotkeys(null)).toEqual(DEFAULT_HOTKEYS);
    expect(parseHotkeys("lixo")).toEqual(DEFAULT_HOTKEYS);
    const p = parseHotkeys(JSON.stringify({ collect: "F2", undo: null, follow: 3 }));
    expect(p.collect).toBe("F2");
    expect(p.undo).toBeNull();
    expect(p.follow).toBe(DEFAULT_HOTKEYS.follow);
  });

  it("aponta ações com a mesma combinação", () => {
    expect(conflicts(DEFAULT_HOTKEYS).size).toBe(0);
    expect([...conflicts({ ...DEFAULT_HOTKEYS, undo: "Alt+KeyF" })].sort()).toEqual(["collect", "undo"]);
  });
});
