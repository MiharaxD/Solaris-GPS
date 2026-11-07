/**
 * Configurações: aba "Geral" (backup, restaurar, importar do th.gl e esconder coletados) e aba
 * "Atalhos" (editar as teclas do mapa). Tudo fica no navegador.
 */
import { comboLabel, comboOf, conflicts, HOTKEY_ACTIONS, type HotkeyAction, type Hotkeys } from "./hotkeys";
import { uiIcon } from "./icons";
import type { HideFoundGroup, MarkerPanel } from "./markerPanel";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

type Tab = "geral" | "atalhos";

const HIDE_GROUPS: readonly { id: HideFoundGroup; label: string }[] = [
  { id: "chest", label: "Baús já coletados" },
  { id: "casket", label: "Sonance Caskets já coletados" },
  { id: "other", label: "Outros marcadores já encontrados" },
];

export class SettingsDialog {
  readonly root = h("dialog", { className: "set-dialog" });
  private tab: Tab = "geral";
  private readonly body = h("div", { className: "set-body" });
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private readonly status = h("p", { className: "set-status", role: "status" } as Partial<HTMLParagraphElement>);
  /** Ação esperando a tecla nova. */
  private capturing: HotkeyAction | null = null;

  constructor(
    private readonly markers: MarkerPanel,
    private readonly hotkeys: Hotkeys,
  ) {
    const close = h("button", { type: "button", className: "mk-close", title: "Fechar" }, uiIcon("close", 14));
    close.setAttribute("aria-label", "Fechar");
    close.addEventListener("click", () => this.root.close());
    const tabBar = h("div", { className: "set-tabs", role: "tablist" } as Partial<HTMLDivElement>);
    for (const [id, label] of [["geral", "Geral"], ["atalhos", "Atalhos"]] as [Tab, string][]) {
      const b = h("button", { type: "button", className: "set-tab", textContent: label });
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => this.show(id));
      this.tabs.set(id, b);
      tabBar.append(b);
    }
    this.root.append(
      h("header", { className: "panel-head" }, uiIcon("gear", 18), h("h2", { textContent: "Configurações" }), close),
      tabBar,
      this.body,
      this.status,
    );
    this.root.addEventListener("close", () => this.stopCapture());
    // captura da tecla nova: antes do listener dos atalhos
    window.addEventListener("keydown", (e) => this.onCaptureKey(e), true);
    hotkeys.onChange(() => {
      if (this.root.open && this.tab === "atalhos") this.render();
    });
    document.body.append(this.root);
  }

  open(tab: Tab = this.tab): void {
    this.status.textContent = "";
    this.show(tab);
    if (!this.root.open) this.root.showModal();
  }

  private show(tab: Tab): void {
    this.stopCapture();
    this.tab = tab;
    for (const [id, b] of this.tabs) b.setAttribute("aria-selected", String(id === tab));
    this.render();
  }

  private render(): void {
    this.body.replaceChildren(...(this.tab === "geral" ? this.general() : this.shortcuts()));
  }

  private general(): HTMLElement[] {
    const backup = h("button", { type: "button", className: "mk-btn", textContent: "Backup" });
    backup.title = "Baixa um JSON com todos os encontrados";
    backup.addEventListener("click", () => {
      this.markers.downloadBackup();
      this.status.textContent = "Backup baixado.";
    });
    const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      file.value = "";
      if (f) void this.markers.restoreFrom(f).then((msg) => (this.status.textContent = msg));
    });
    const restore = h("button", { type: "button", className: "mk-btn", textContent: "Restaurar…" });
    restore.title = "Substitui o progresso pelo de um backup";
    restore.addEventListener("click", () => file.click());
    const imp = h("button", { type: "button", className: "mk-btn", textContent: "Importar th.gl…" });
    imp.title = 'Marca encontrados a partir do backup do th.gl ("id@x:y")';
    imp.addEventListener("click", () => {
      const warn = this.markers.openImport();
      if (warn) this.status.textContent = warn;
      else this.root.close();
    });
    const impApp = h("button", { type: "button", className: "mk-btn", textContent: "Importar appsample…" });
    impApp.title = "Marca encontrados a partir do progresso do mapa do appsample (todos os mapas)";
    impApp.addEventListener("click", () => {
      this.markers.openAppsampleImport();
      this.root.close();
    });

    const checks = HIDE_GROUPS.map((g) => {
      const box = h("input", { type: "checkbox", checked: this.markers.isHidingFound(g.id) });
      box.addEventListener("change", () => this.markers.setHideFound(g.id, box.checked));
      return h("label", { className: "mk-check" }, box, g.label);
    });

    return [
      h("section", { className: "set-section" },
        h("h3", { textContent: "Progresso" }),
        h("p", { className: "set-help", textContent: "O progresso fica só neste navegador. Faça backup de vez em quando." }),
        h("div", { className: "mk-actions" }, backup, restore, imp, impApp, file)),
      h("section", { className: "set-section" },
        h("h3", { textContent: "Esconder do mapa" }),
        h("p", { className: "set-help", textContent: "Os encontrados somem em vez de ficar apagados. Desligado, continuam no mapa, mais claros." }),
        ...checks),
    ];
  }

  private shortcuts(): HTMLElement[] {
    const bad = conflicts(this.hotkeys.all);
    const rows = HOTKEY_ACTIONS.map((a) => {
      const combo = this.hotkeys.get(a.id);
      const keyBtn = h("button", { type: "button", className: "set-key" });
      if (this.capturing === a.id) {
        keyBtn.textContent = "Pressione as teclas…";
        keyBtn.classList.add("capturing");
      } else {
        keyBtn.append(combo ? h("kbd", { textContent: comboLabel(combo) }) : h("span", { className: "set-none", textContent: "sem atalho" }));
      }
      keyBtn.title = "Clique e pressione a nova combinação (Esc cancela, Backspace remove)";
      keyBtn.addEventListener("click", () => this.startCapture(a.id));
      const clear = h("button", { type: "button", className: "mk-link", textContent: "remover" });
      clear.addEventListener("click", () => this.hotkeys.set(a.id, null));
      return h("div", { className: `set-row${bad.has(a.id) ? " conflict" : ""}` },
        h("div", { className: "set-row-text" },
          h("strong", { textContent: a.label }),
          h("span", { className: "set-help", textContent: bad.has(a.id) ? "Mesma tecla de outra ação: só a primeira da lista vale." : a.help })),
        keyBtn,
        clear);
    });
    const reset = h("button", { type: "button", className: "mk-btn", textContent: "Voltar aos padrões" });
    reset.addEventListener("click", () => this.hotkeys.reset());
    return [
      h("p", { className: "set-help set-note",
        textContent: "Os atalhos funcionam com o site em foco (ou o pop-out, quando existir). Com o jogo em foco o navegador não recebe as teclas." }),
      ...rows,
      h("div", { className: "mk-actions" }, reset),
    ];
  }

  private startCapture(action: HotkeyAction): void {
    this.capturing = action;
    this.hotkeys.capturing = true;
    this.render();
  }

  private stopCapture(): void {
    if (!this.capturing) return;
    this.capturing = null;
    this.hotkeys.capturing = false;
    if (this.root.open) this.render();
  }

  private onCaptureKey(e: KeyboardEvent): void {
    const action = this.capturing;
    if (!action) return;
    if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault(); // Esc cancela a captura, não fecha o diálogo
      e.stopPropagation();
      this.stopCapture();
      return;
    }
    if (e.code === "Backspace" || e.code === "Delete") {
      e.preventDefault();
      this.capturing = null;
      this.hotkeys.capturing = false;
      this.hotkeys.set(action, null);
      return;
    }
    const combo = comboOf(e);
    if (!combo) return; // só modificador: espera a tecla
    e.preventDefault();
    e.stopPropagation();
    this.capturing = null;
    this.hotkeys.capturing = false;
    this.hotkeys.set(action, combo);
    this.status.textContent = `${HOTKEY_ACTIONS.find((a) => a.id === action)?.label}: ${comboLabel(combo)}.`;
  }
}
