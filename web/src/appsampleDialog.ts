import {
  APPSAMPLE_SNIPPET,
  loadAppsampleTable,
  parseAppsample,
  resolveIds,
  type AppsampleTable,
  type Resolution,
} from "./appsampleImport";
import { category, loadMarkers } from "./markers";
import { mapLabel } from "./mapPicker";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export interface AppsampleContext {
  isFound: (map: string, id: string) => boolean;
  apply: (map: string, ids: string[]) => Promise<void>;
}

interface MapRow {
  map: string;
  box: HTMLInputElement;
  /** Ids ainda não encontrados (os que o Aplicar marca). */
  ids: string[];
}

/**
 * Diálogo: script do console → arquivo do appsample → prévia por mapa e categoria → aplicar.
 * Marca todos os mapas de uma vez (o export cobre a conta inteira).
 */
export class AppsampleDialog {
  private readonly dialog = h("dialog", { className: "imp-dialog" });
  private readonly text = h("textarea", { rows: 3, placeholder: '["37794", "37796", …]' });
  private readonly maxDist = h("input", { type: "number", value: "50", min: "1", max: "50", step: "1" });
  private readonly summary = h("p", { className: "imp-summary", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly list = h("ul", { className: "imp-list" });
  private readonly unmatched = h("details", { className: "imp-unmatched" });
  private readonly applyBtn = h("button", { type: "button", className: "mk-btn", textContent: "Aplicar", disabled: true });
  private ctx: AppsampleContext | null = null;
  private table: AppsampleTable | null = null;
  private rows: MapRow[] = [];
  private run = 0;

  constructor() {
    const file = h("input", { type: "file", accept: ".json,.txt,application/json", hidden: true });
    const openBtn = h("button", { type: "button", className: "mk-btn", textContent: "Abrir arquivo…" });
    openBtn.addEventListener("click", () => file.click());
    file.addEventListener("change", async () => {
      const f = file.files?.[0];
      file.value = "";
      if (!f) return;
      if (f.size > 5_000_000) {
        this.summary.textContent = "Arquivo grande demais.";
        return;
      }
      this.text.value = await f.text();
      void this.analyze();
    });
    const copyBtn = h("button", { type: "button", className: "mk-btn", textContent: "Copiar script" });
    copyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(APPSAMPLE_SNIPPET).then(
        () => (copyBtn.textContent = "Script copiado"),
        () => (this.summary.textContent = "Não copiou; selecione o texto do script abaixo."),
      );
    });
    const analyzeBtn = h("button", { type: "button", className: "mk-btn", textContent: "Analisar" });
    analyzeBtn.addEventListener("click", () => void this.analyze());
    this.maxDist.addEventListener("change", () => this.rows.length && void this.analyze());
    const close = h("button", { type: "button", className: "mk-btn", textContent: "Fechar" });
    close.addEventListener("click", () => this.dialog.close());
    this.applyBtn.addEventListener("click", () => void this.applySelected());

    const steps = h(
      "ol",
      { className: "imp-steps" },
      h("li", {}, "Abra o mapa do appsample no navegador, logado com a sua conta Google."),
      h("li", {}, "Aperte F12, vá em Console e cole o script (se o navegador bloquear, digite “allow pasting” antes)."),
      h("li", {}, "Ele baixa appsample-progresso.json: abra aqui ou cole o array."),
    );
    const snippet = h("details", { className: "imp-unmatched" }, h("summary", { textContent: "Ver o script" }), h("pre", { textContent: APPSAMPLE_SNIPPET }));

    this.dialog.append(
      h("h2", { textContent: "Importar do appsample" }),
      steps,
      h("div", { className: "mk-actions" }, copyBtn),
      snippet,
      this.text,
      h("div", { className: "mk-actions" }, openBtn, h("label", { className: "imp-radius" }, "Distância máx. (m)", this.maxDist), analyzeBtn),
      this.summary,
      this.list,
      this.unmatched,
      h("div", { className: "mk-actions" }, this.applyBtn, close),
    );
    document.body.append(this.dialog);
  }

  open(ctx: AppsampleContext): void {
    this.ctx = ctx;
    this.reset();
    this.dialog.showModal();
  }

  private reset(): void {
    this.rows = [];
    this.list.replaceChildren();
    this.unmatched.replaceChildren();
    this.summary.textContent = "";
    this.applyBtn.disabled = true;
    this.applyBtn.textContent = "Aplicar";
  }

  private async analyze(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const run = ++this.run;
    this.reset();
    let parsed;
    try {
      parsed = parseAppsample(this.text.value);
    } catch (e) {
      this.summary.textContent = `Não li o arquivo: ${(e as Error).message}.`;
      return;
    }
    this.table ??= await loadAppsampleTable();
    if (run !== this.run) return;
    if (!this.table) {
      this.summary.textContent =
        "Falta a tabela do appsample. Gere com: .venv/Scripts/python tools/build_appsample.py --download";
      return;
    }
    const max = Math.min(50, Math.max(1, this.maxDist.valueAsNumber || 50));
    const r = resolveIds(parsed.ids, this.table, max);
    await this.render(ctx, parsed.ids.length, parsed.invalid, r, run);
  }

  private async render(ctx: AppsampleContext, total: number, invalid: string[], r: Resolution, run: number): Promise<void> {
    const maps = [...r.byMap.keys()];
    const markers = await Promise.all(maps.map((m) => loadMarkers(m)));
    if (run !== this.run) return;
    let matched = 0;
    let already = 0;
    maps.forEach((map, i) => {
      const cats = new Map(markers[i]!.map((m) => [m.id, m.cat]));
      const list = r.byMap.get(map)!;
      matched += list.length;
      const fresh = list.filter((x) => !ctx.isFound(map, x.id));
      already += list.length - fresh.length;
      const counts = new Map<string, number>();
      for (const x of fresh) {
        const c = cats.get(x.id) ?? "?";
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      const detail = [...counts].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${category(c).label} ${n}`).join(" · ");
      const box = h("input", { type: "checkbox", checked: fresh.length > 0, disabled: fresh.length === 0 });
      box.addEventListener("change", () => this.syncApply());
      this.rows.push({ map, box, ids: fresh.map((x) => x.id) });
      const skipped = list.length - fresh.length;
      this.list.append(
        h(
          "li",
          {},
          h(
            "label",
            {},
            box,
            h("span", { className: "mk-name", textContent: mapLabel(map) }),
            h("span", {
              className: "mk-count",
              textContent: `${fresh.length} novos${skipped ? ` (+${skipped} já encontrados)` : ""}`,
            }),
          ),
          detail ? h("div", { className: "imp-detail", textContent: detail }) : "",
        ),
      );
    });
    this.summary.textContent =
      `${total} ids (${invalid.length} inválidos). Casaram ${matched} (${already} já encontrados); ` +
      `sem correspondência ${r.missing.length}` +
      (r.tooFar ? `; ${r.tooFar} cortados pela distância` : "") +
      ".";
    if (r.missing.length || invalid.length) {
      const lines = [...invalid.map((s) => `inválido: ${s}`), ...r.missing].slice(0, 500);
      this.unmatched.append(
        h("summary", { textContent: `Sem correspondência (${r.missing.length + invalid.length})` }),
        h("p", {
          className: "imp-help",
          textContent:
            "Tipos que não temos (inimigos, missões, Windchimers…), mapas que os nossos dados não cobrem " +
            "(Mengzhou, Dimmr Plains) ou posição longe demais de qualquer marcador nosso.",
        }),
        h("pre", { textContent: lines.join("\n") }),
      );
    }
    this.syncApply();
  }

  private selected(): MapRow[] {
    return this.rows.filter((r) => r.box.checked && r.ids.length);
  }

  private syncApply(): void {
    const n = this.selected().reduce((a, r) => a + r.ids.length, 0);
    this.applyBtn.textContent = `Aplicar (${n})`;
    this.applyBtn.disabled = n === 0;
  }

  private async applySelected(): Promise<void> {
    const ctx = this.ctx;
    const rows = this.selected();
    if (!ctx || !rows.length) return;
    const n = rows.reduce((a, r) => a + r.ids.length, 0);
    const where = rows.map((r) => mapLabel(r.map)).join(", ");
    if (!confirm(`Marcar ${n} marcadores como encontrados (${where})?`)) return;
    this.applyBtn.disabled = true;
    try {
      for (const r of rows) await ctx.apply(r.map, r.ids);
      this.summary.textContent = `Aplicado: ${n} marcados como encontrados.`;
      this.list.replaceChildren();
      this.rows = [];
      this.applyBtn.textContent = "Aplicar";
    } catch (e) {
      this.summary.textContent = `Não aplicou tudo (${(e as Error).message}).`;
      this.applyBtn.disabled = false;
    }
  }
}
