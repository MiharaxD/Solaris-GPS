/**
 * Atalhos do mapa, configuráveis nas Configurações. Só ESCUTAM o teclado da própria página:
 * com o jogo em foco o navegador não recebe as teclas (atalho global fica pra extensão do
 * ticket 28). A combinação usa a tecla física (`KeyboardEvent.code`), então não muda com o
 * layout do teclado.
 */
import { loadPref, savePref } from "./storage";

export type HotkeyAction = "collect" | "undo" | "follow" | "rescan";

export const HOTKEY_ACTIONS: readonly { id: HotkeyAction; label: string; help: string }[] = [
  { id: "collect", label: "Coletar o mais próximo", help: "Marca como encontrado o marcador visível mais próximo do jogador (o da linha pontilhada)." },
  { id: "undo", label: "Desfazer marcação", help: "Desmarca o último marcador marcado como encontrado." },
  { id: "follow", label: "Seguir o jogador", help: "Liga ou desliga o mapa centralizado no jogador." },
  { id: "rescan", label: "Reescanear", help: "Procura o jogador de novo no mapa (ou só na região escolhida)." },
];

export const DEFAULT_HOTKEYS: Readonly<Record<HotkeyAction, string | null>> = {
  collect: "Alt+KeyF",
  undo: "Alt+KeyZ",
  follow: "Alt+KeyS",
  rescan: "Alt+KeyR",
};

const PREF = "hotkeys";
const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight"]);

type KeyLike = Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

/** Combinação canônica ("Ctrl+Alt+Shift+KeyF"); null se só tem modificador. */
export function comboOf(e: KeyLike): string | null {
  if (!e.code || MODIFIER_CODES.has(e.code)) return null;
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta"].filter(Boolean);
  return [...mods, e.code].join("+");
}

/** Texto pra mostrar: "Alt+F", "Ctrl+Shift+1", "F2", "Espaço". */
export function comboLabel(combo: string | null): string {
  if (!combo) return "";
  return combo
    .split("+")
    .map((p) => {
      if (p.startsWith("Key")) return p.slice(3);
      if (p.startsWith("Digit")) return p.slice(5);
      if (p.startsWith("Numpad")) return `Num ${p.slice(6)}`;
      if (p.startsWith("Arrow")) return { Up: "↑", Down: "↓", Left: "←", Right: "→" }[p.slice(5)] ?? p;
      return { Space: "Espaço", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backslash: "\\", Escape: "Esc" }[p] ?? p;
    })
    .join("+");
}

/** Atalhos salvos por cima dos padrões (ação ausente = padrão; null = sem atalho). */
export function parseHotkeys(raw: string | null): Record<HotkeyAction, string | null> {
  const out = { ...DEFAULT_HOTKEYS };
  try {
    const v = JSON.parse(raw ?? "") as Record<string, unknown>;
    if (v && typeof v === "object") {
      for (const a of HOTKEY_ACTIONS) {
        const c = v[a.id];
        if (c === null || (typeof c === "string" && c.length < 60)) out[a.id] = c;
      }
    }
  } catch {
    /* sem preferência */
  }
  return out;
}

/** Ações que dividem a mesma combinação. */
export function conflicts(map: Readonly<Record<HotkeyAction, string | null>>): Set<HotkeyAction> {
  const seen = new Map<string, HotkeyAction[]>();
  for (const a of HOTKEY_ACTIONS) {
    const c = map[a.id];
    if (c) seen.set(c, [...(seen.get(c) ?? []), a.id]);
  }
  return new Set([...seen.values()].filter((v) => v.length > 1).flat());
}

function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t instanceof HTMLInputElement && !["checkbox", "radio", "button", "range", "color", "file"].includes(t.type);
}

export class Hotkeys {
  private map = parseHotkeys(loadPref(PREF));
  private listeners = new Set<() => void>();
  /** true enquanto as Configurações esperam uma tecla nova (não dispara ações). */
  capturing = false;

  constructor(handlers: Record<HotkeyAction, () => void>) {
    window.addEventListener(
      "keydown",
      (e) => {
        if (this.capturing || e.repeat) return;
        const combo = comboOf(e);
        if (!combo) return;
        // digitando num campo, só valem combinações com Ctrl/Alt/Meta
        if (isTyping(e.target) && !(e.ctrlKey || e.altKey || e.metaKey)) return;
        const action = HOTKEY_ACTIONS.find((a) => this.map[a.id] === combo);
        if (!action) return;
        e.preventDefault();
        e.stopPropagation();
        handlers[action.id]();
      },
      true,
    );
  }

  get(action: HotkeyAction): string | null {
    return this.map[action];
  }

  label(action: HotkeyAction): string {
    return comboLabel(this.map[action]);
  }

  get all(): Readonly<Record<HotkeyAction, string | null>> {
    return this.map;
  }

  set(action: HotkeyAction, combo: string | null): void {
    this.map = { ...this.map, [action]: combo };
    savePref(PREF, JSON.stringify(this.map));
    for (const fn of this.listeners) fn();
  }

  reset(): void {
    this.map = { ...DEFAULT_HOTKEYS };
    savePref(PREF, JSON.stringify(this.map));
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }
}
