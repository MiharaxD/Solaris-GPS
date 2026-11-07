import type { GameMarker } from "./markers";
import { matchEntries, parseThgl, type MatchResult } from "./thglImport";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export interface ImportContext {
  mapLabel: string;
  /** Marcadores do WutheringData do mapa (coordenada de jogo), já sem os ignorados. */
  markers: GameMarker[];
  isFound: (id: string) => boolean;
  apply: (ids: string[]) => Promise<void>;
}

const MAX_LIST = 3000;
/** Unidade do jogo nos marcadores (Transform do WutheringData): 10 000 por metro. */
const GAME_UNITS_PER_M = 10_000;

/** Diálogo: colar/abrir o backup do th.gl → prévia dos casamentos → aplicar com confirmação. */
export class ImportDialog {
  private readonly dialog = h("dialog", { className: "imp-dialog" });
  private readonly text = h("textarea", { rows: 4, placeholder: '["id@x:y", …]' });
  private readonly radius = h("input", { type: "number", value: "3", min: "0.5", max: "50", step: "0.5" });
  private readonly summary = h("p", { className: "imp-summary", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly list = h("ul", { className: "imp-list" });
  private readonly unmatched = h("details", { className: "imp-unmatched" });
  private readonly applyBtn = h("button", { type: "button", className: "mk-btn", textContent: "Aplicar", disabled: true });
  private readonly title = h("h2", {});
  private ctx: ImportContext | null = null;
  private result: MatchResult<GameMarker> | null = null;
  private boxes: { box: HTMLInputElement; id: string }[] = [];

  constructor() {
    const file = h("input", { type: "file", accept: ".json,.txt,application/json", hidden: true });
    const openBtn = h("button", { type: "button", className: "mk-btn", textContent: "Abrir arquivo…" });
    openBtn.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      file.value = "";
      if (!f) return;
      if (f.size > 20_000_000) {
        this.summary.textContent = "Arquivo grande demais.";
        return;
      }
      this.text.value = await f.text();
      this.analyze();
    });
    const analyzeBtn = h("button", { type: "button", className: "mk-btn", textContent: "Analisar" });
    analyzeBtn.addEventListener("click", () => this.analyze());
    this.radius.addEventListener("change", () => this.result && this.analyze());
    const close = h("button", { type: "button", className: "mk-btn", textContent: "Fechar" });
    close.addEventListener("click", () => this.dialog.close());
    this.applyBtn.addEventListener("click", () => void this.applySelected());
    const all = h("button", { type: "button", className: "mk-link", textContent: "marcar todos" });
    const none = h("button", { type: "button", className: "mk-link", textContent: "desmarcar todos" });
    all.addEventListener("click", () => this.setAll(true));
    none.addEventListener("click", () => this.setAll(false));

    this.dialog.append(
      this.title,
      h("p", {
        className: "imp-help",
        textContent:
          'Cole o array do backup do th.gl ("id@x:y", coordenada de jogo) ou abra o arquivo. Casa por proximidade só com ' +
          "os marcadores deste mapa; nada do arquivo é guardado. Revise e aplique.",
      }),
      this.text,
      h("div", { className: "mk-actions" }, openBtn, h("label", { className: "imp-radius" }, "Raio (m)", this.radius), analyzeBtn),
      this.summary,
      h("div", { className: "mk-sub-actions" }, all, none),
      this.list,
      this.unmatched,
      h("div", { className: "mk-actions" }, this.applyBtn, close),
    );
    document.body.append(this.dialog);
  }

  open(ctx: ImportContext): void {
    this.ctx = ctx;
    this.title.textContent = `Importar do th.gl · ${ctx.mapLabel}`;
    this.reset();
    this.dialog.showModal();
  }

  private reset(): void {
    this.result = null;
    this.boxes = [];
    this.list.replaceChildren();
    this.unmatched.replaceChildren();
    this.summary.textContent = "";
    this.applyBtn.disabled = true;
  }

  private analyze(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.reset();
    let parsed;
    try {
      parsed = parseThgl(this.text.value);
    } catch (e) {
      this.summary.textContent = `Não li o backup: ${(e as Error).message}.`;
      return;
    }
    const meters = Math.min(50, Math.max(0.5, this.radius.valueAsNumber || 3));
    const r = matchEntries(parsed.entries, ctx.markers, meters * GAME_UNITS_PER_M);
    this.result = r;
    const already = r.matches.filter((m) => ctx.isFound(m.marker.id)).length;
    const scale = r.scale === 1 ? "unidade do jogo" : r.scale === 100 ? "centímetros" : `×${r.scale}`;
    this.summary.textContent =
      `${parsed.entries.length} entradas (${parsed.invalid.length} inválidas). Casaram ${r.matches.length}` +
      ` (${already} já encontrados), não casaram ${r.unmatched.length}. Escala: ${scale}${r.swapped ? ", eixos trocados" : ""}.`;

    const sorted = [...r.matches].sort((a, b) => a.marker.name.localeCompare(b.marker.name) || a.dist - b.dist);
    for (const m of sorted.slice(0, MAX_LIST)) {
      const found = ctx.isFound(m.marker.id);
      const box = h("input", { type: "checkbox", checked: !found, disabled: found });
      this.boxes.push({ box, id: m.marker.id });
      const where = m.marker.area.slice(-1)[0];
      const name = where ? `${m.marker.name} · ${where}` : m.marker.name;
      this.list.append(
        h(
          "li",
          {},
          h(
            "label",
            {},
            box,
            h("span", { className: "mk-name", textContent: name }),
            h("span", { className: "mk-count", textContent: found ? "já encontrado" : `${(m.dist / GAME_UNITS_PER_M).toFixed(1)} m` }),
          ),
        ),
      );
    }
    if (r.matches.length > MAX_LIST) {
      this.list.append(h("li", { className: "mk-empty", textContent: `… e mais ${r.matches.length - MAX_LIST} (entram no Aplicar).` }));
    }
    if (r.unmatched.length || parsed.invalid.length) {
      const lines = [...parsed.invalid.map((s) => `inválida: ${s}`), ...r.unmatched.map((e) => e.raw)].slice(0, 300);
      this.unmatched.append(
        h("summary", { textContent: `Não casaram / inválidas (${r.unmatched.length + parsed.invalid.length})` }),
        h("pre", { textContent: lines.join("\n") }),
      );
    }
    this.syncApply();
    for (const b of this.boxes) b.box.addEventListener("change", () => this.syncApply());
  }

  private selectedIds(): string[] {
    const r = this.result;
    const ctx = this.ctx;
    if (!r || !ctx) return [];
    const unchecked = new Set(this.boxes.filter((b) => !b.box.checked).map((b) => b.id));
    return r.matches.map((m) => m.marker.id).filter((id) => !unchecked.has(id) && !ctx.isFound(id));
  }

  private syncApply(): void {
    const n = this.selectedIds().length;
    this.applyBtn.textContent = `Aplicar (${n})`;
    this.applyBtn.disabled = n === 0;
  }

  private setAll(value: boolean): void {
    for (const b of this.boxes) if (!b.box.disabled) b.box.checked = value;
    this.syncApply();
  }

  private async applySelected(): Promise<void> {
    const ids = this.selectedIds();
    const ctx = this.ctx;
    if (!ctx || !ids.length) return;
    if (!confirm(`Marcar ${ids.length} marcadores como encontrados em ${ctx.mapLabel}?`)) return;
    this.applyBtn.disabled = true;
    try {
      await ctx.apply(ids);
      this.summary.textContent = `Aplicado: ${ids.length} marcados como encontrados.`;
      this.list.replaceChildren();
      this.boxes = [];
    } catch (e) {
      this.summary.textContent = `Não aplicou (${(e as Error).message}).`;
      this.applyBtn.disabled = false;
    }
  }
}
