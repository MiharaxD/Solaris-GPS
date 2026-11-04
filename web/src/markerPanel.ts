import L from "leaflet";
import { apply, fitAffine, type Affine } from "./affine";
import { manualMarkersOf, type MapDataV1 } from "./mapData";
import { MarkerCanvasLayer, type PlacedItem } from "./markerLayer";
import {
  CATEGORIES,
  MAP_FILE_CATS,
  category,
  loadMarkers,
  makeVisibility,
  markerColor,
  markerText,
  parseFilter,
  searchMarkers,
  subLabel,
  type FilterState,
  type GameMarker,
} from "./markers";
import type { MapInfo } from "./maps";
import { loadMapData } from "./mapData";
import { mapLabel } from "./mapPicker";
import { ImportDialog } from "./importDialog";
import { parseBackup, percent, tallyMarkers, type ManualMarker, type ProgressStore, type Tally } from "./progress";
import type { MapView } from "./mapView";
import { loadPref, savePref } from "./storage";

const FILTER_PREF = "markers.filter";
const OPEN_PREF = "markers.open";
const HIDE_FOUND_PREF = "markers.hideFound";

const fmtTally = (t: Tally) => `${t.found}/${t.total}`;

const SIZE: Record<string, number> = { nexus: 7, beacon: 6, chest: 5, casket: 5.5 };

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function swatch(shape: string, color: string): HTMLSpanElement {
  const el = h("span", { className: `mk-swatch ${shape}` });
  el.style.setProperty("--c", color);
  return el;
}

/** Marcador manual → formato comum do painel. */
export function fromManual(m: ManualMarker, source: "map" | "personal"): GameMarker {
  const out: GameMarker = {
    id: m.id, cat: m.cat, sub: m.cat === "personal" ? "personal" : "Manual", name: m.name,
    x: 0, y: 0, z: 0, area: [], px: m.px, source,
  };
  if (m.note) out.note = m.note;
  return out;
}

function newId(source: "map" | "personal"): string {
  return `${source === "map" ? "m" : "p"}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Modo de clique no mapa: criar marcador ou mover um existente. */
type ClickMode = { kind: "add" } | { kind: "move"; id: string } | null;

/** Transformação jogo→pixel salva no mapa (3+ pontos), ou null. */
export function savedTransform(data: MapDataV1 | null): Affine | null {
  const pts = data?.calibration?.points ?? [];
  return fitAffine(pts)?.affine ?? null;
}

/**
 * Painel de marcadores: filtro por categoria/subcategoria, busca, popup ao clicar e progresso
 * (encontrados no IndexedDB; botão direito no marcador alterna). Recebe os dados do mapa
 * (calibração e referências ignoradas) de quem os carrega.
 */
export class MarkerPanel {
  readonly root: HTMLElement;
  private info: MapInfo | null = null;
  /** Todos os marcadores do mapa: WutheringData + manuais do arquivo + pessoais. */
  private markers: GameMarker[] = [];
  private dataMarkers: GameMarker[] = [];
  private mapManual: ManualMarker[] = [];
  private mode: ClickMode = null;
  private importer: ImportDialog | null = null;
  private texts: string[] = [];
  private placed = new Map<string, PlacedItem<GameMarker>>();
  private transform: Affine | null = null;
  private ignored = new Set<string>();
  private filter: FilterState = parseFilter(loadPref(FILTER_PREF));
  private open = loadPref(OPEN_PREF) !== "0";
  private loadSeq = 0;
  private hideFound = loadPref(HIDE_FOUND_PREF) === "1";
  /** Grupos de subcategoria abertos (sobrevivem ao redesenho do painel). */
  private openGroups = new Set<string>();
  private maps: MapInfo[] = [];
  private readonly layer: MarkerCanvasLayer<GameMarker>;

  private readonly status = h("p", { className: "mk-status", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly search = h("input", { type: "search", placeholder: "Buscar (ex.: baú premium jinzhou)…" });
  private readonly results = h("ul", { className: "mk-results" });
  private readonly cats = h("div", { className: "mk-cats" });
  private readonly progressLine = h("p", { className: "mk-progress" });
  private readonly hideFoundBox = h("input", { type: "checkbox" });
  private readonly allMaps = h("details", { className: "mk-allmaps" });
  private readonly allMapsList = h("ul", { className: "mk-allmaps-list" });
  private readonly addBtn = h("button", { type: "button", className: "mk-btn", textContent: "+ Novo marcador" });

  constructor(
    private readonly view: MapView,
    /** true enquanto outro modo (calibração) usa os cliques no mapa. */
    private readonly busy: () => boolean,
    private readonly progress: ProgressStore,
    /** Grava campos no arquivo do mapa (data/maps) sem mexer no resto. */
    private readonly saveMapPatch: (map: string, patch: Partial<MapDataV1>) => Promise<void>,
  ) {
    this.layer = new MarkerCanvasLayer(() => this.info?.maxZoom ?? 0);
    this.layer.addTo(view.leaflet);
    const close = h("button", { type: "button", className: "mk-close", textContent: "✕", title: "Fechar" });
    close.addEventListener("click", () => this.toggle(false));
    this.search.addEventListener("input", () => this.renderResults());
    this.hideFoundBox.checked = this.hideFound;
    this.hideFoundBox.addEventListener("change", () => {
      this.hideFound = this.hideFoundBox.checked;
      savePref(HIDE_FOUND_PREF, this.hideFound ? "1" : "0");
      this.applyFilter();
    });
    this.allMaps.append(h("summary", { textContent: "Progresso em todos os mapas" }), this.allMapsList);
    this.allMaps.addEventListener("toggle", () => {
      if (this.allMaps.open) void this.renderAllMaps();
    });

    const backupBtn = h("button", { type: "button", className: "mk-btn", textContent: "Backup" });
    backupBtn.title = "Baixa um JSON com todos os encontrados";
    backupBtn.addEventListener("click", () => this.downloadBackup());
    const file = h("input", { type: "file", accept: ".json,application/json", hidden: true });
    file.addEventListener("change", () => {
      const f = file.files?.[0];
      file.value = "";
      if (f) void this.restoreFrom(f);
    });
    const restoreBtn = h("button", { type: "button", className: "mk-btn", textContent: "Restaurar…" });
    restoreBtn.title = "Substitui o progresso pelo de um backup";
    restoreBtn.addEventListener("click", () => file.click());
    const importBtn = h("button", { type: "button", className: "mk-btn", textContent: "Importar th.gl…" });
    importBtn.title = 'Marca encontrados a partir do backup do th.gl ("id@x:y")';
    importBtn.addEventListener("click", () => this.openImport());

    this.root = h(
      "aside",
      { className: "mk-panel", hidden: !this.open },
      h("header", {}, h("h2", { textContent: "Marcadores" }), close),
      this.status,
      this.progressLine,
      h("div", { className: "mk-actions" }, this.addBtn),
      this.search,
      this.results,
      this.cats,
      h("label", { className: "mk-check" }, this.hideFoundBox, "Esconder encontrados"),
      this.allMaps,
      h("div", { className: "mk-actions" }, backupBtn, restoreBtn, importBtn, file),
    );
    this.addBtn.title = "Clique no botão e depois no mapa (Esc cancela)";
    this.addBtn.addEventListener("click", () => this.setMode(this.mode?.kind === "add" ? null : { kind: "add" }));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.mode) this.setMode(null);
    });
    progress.onChange(() => {
      const personal = this.info ? progress.personalFor(this.info.name) : [];
      const before = this.markers.filter((m) => m.source === "personal");
      if (personal.length !== before.length || personal.some((m, i) => before[i]?.id !== m.id || before[i]?.px !== m.px)) {
        this.recombine();
        return;
      }
      this.renderProgress();
      this.renderCats();
      this.applyFilter();
      if (this.allMaps.open) void this.renderAllMaps();
    });

    const map = view.leaflet;
    map.on("click", (e) => {
      if (this.busy()) return;
      if (this.mode) {
        this.handleModeClick(e.latlng);
        return;
      }
      const hit = this.layer.hitTest(e.containerPoint);
      if (hit) this.popup(hit);
    });
    // botão direito: alterna encontrado sem abrir popup
    map.on("contextmenu", (e) => {
      if (this.busy()) return;
      const hit = this.layer.hitTest(e.containerPoint);
      if (hit) void this.toggleFound(hit.data);
    });
    map.on("mousemove", (e) => {
      const hit = this.busy() ? null : this.layer.hitTest(e.containerPoint);
      map.getContainer().classList.toggle("mk-hover", hit !== null);
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.hidden = !this.open;
    savePref(OPEN_PREF, this.open ? "1" : "0");
  }

  /** Lista de mapas, pro resumo de progresso de todos. */
  setMaps(maps: MapInfo[]): void {
    this.maps = maps;
  }

  async setMap(info: MapInfo): Promise<void> {
    const seq = ++this.loadSeq;
    this.info = info;
    this.setMode(null);
    this.dataMarkers = [];
    this.mapManual = [];
    this.markers = [];
    this.texts = [];
    this.transform = null;
    this.ignored = new Set();
    this.view.leaflet.closePopup();
    this.search.value = "";
    this.rebuild();
    this.recombine();
    const markers = await loadMarkers(info.name);
    if (seq !== this.loadSeq) return;
    this.dataMarkers = markers;
    this.recombine();
  }

  /** Junta as três fontes e redesenha. */
  private recombine(): void {
    const map = this.info?.name;
    const personal = map ? this.progress.personalFor(map) : [];
    this.markers = [
      ...this.dataMarkers,
      ...this.mapManual.map((m) => fromManual(m, "map")),
      ...personal.map((m) => fromManual(m, "personal")),
    ];
    this.texts = this.markers.map(markerText);
    this.rebuild();
  }

  private setMode(mode: ClickMode): void {
    this.mode = mode;
    this.view.leaflet.getContainer().classList.toggle("mk-placing", mode !== null);
    this.addBtn.setAttribute("aria-pressed", String(mode?.kind === "add"));
    if (mode?.kind === "add") this.status.textContent = "Clique no mapa onde fica o marcador (Esc cancela).";
    else if (mode?.kind === "move") this.status.textContent = "Clique na nova posição (Esc cancela).";
    else this.renderStatus();
  }

  private handleModeClick(latlng: L.LatLng): void {
    const mode = this.mode;
    const p = this.view.toPixel(latlng);
    const px: [number, number] = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
    this.setMode(null);
    if (mode?.kind === "add") {
      this.openForm(px, null);
    } else if (mode?.kind === "move") {
      const m = this.markers.find((x) => x.id === mode.id);
      if (m?.source) void this.saveManual({ ...this.toManual(m), px }, m.source);
    }
  }

  private toManual(m: GameMarker): ManualMarker {
    const out: ManualMarker = { id: m.id, cat: m.cat, name: m.name, px: m.px ?? [0, 0] };
    if (m.note) out.note = m.note;
    return out;
  }

  /** Grava um marcador manual no lugar certo (arquivo do mapa ou IndexedDB), tirando do outro. */
  private async saveManual(m: ManualMarker, previous: "map" | "personal" | null): Promise<void> {
    const map = this.info?.name;
    if (!map) return;
    const target = MAP_FILE_CATS.has(m.cat) ? "map" : "personal";
    try {
      if (previous === "personal" && target === "map") await this.progress.deletePersonal(map, m.id);
      if (target === "personal") await this.progress.putPersonal(map, m);
      if (target === "map" || previous === "map") {
        const rest = this.mapManual.filter((x) => x.id !== m.id);
        const next = target === "map" ? [...rest, m] : rest;
        await this.saveMapPatch(map, { manualMarkers: next });
        if (this.info?.name === map) this.mapManual = next;
      }
      this.recombine();
      this.status.textContent = target === "map" ? `Salvo em data/maps/${map}.json.` : "Salvo no navegador.";
    } catch (e) {
      this.recombine();
      this.status.textContent = `Não salvou o marcador (${(e as Error).message}).`;
    }
  }

  private async deleteManual(m: GameMarker): Promise<void> {
    const map = this.info?.name;
    if (!map || !m.source || !confirm(`Apagar o marcador "${m.name || category(m.cat).label}"?`)) return;
    this.view.leaflet.closePopup();
    try {
      if (m.source === "personal") await this.progress.deletePersonal(map, m.id);
      else {
        const next = this.mapManual.filter((x) => x.id !== m.id);
        await this.saveMapPatch(map, { manualMarkers: next });
        this.mapManual = next;
      }
      if (this.progress.isFound(map, m.id)) await this.progress.setFound(map, m.id, false);
    } catch (e) {
      this.status.textContent = `Não apagou (${(e as Error).message}).`;
    }
    this.recombine();
  }

  /** Formulário de criar/editar (num popup no ponto). */
  private openForm(px: [number, number], existing: GameMarker | null): void {
    const cat = h("select", {});
    for (const c of CATEGORIES) {
      const label = MAP_FILE_CATS.has(c.id) ? `${c.label} (referência do tracker)` : c.label;
      cat.append(h("option", { value: c.id, textContent: label }));
    }
    cat.value = existing?.cat ?? "personal";
    const name = h("input", { type: "text", value: existing?.name ?? "", placeholder: "Nome (opcional)", maxLength: 200 });
    const note = h("textarea", { value: existing?.note ?? "", placeholder: "Nota (opcional)", rows: 2, maxLength: 2000 });
    const where = h("p", { className: "mk-form-hint" });
    const sync = () => {
      where.textContent = MAP_FILE_CATS.has(cat.value)
        ? "Vai para data/maps (versionado no repositório)."
        : "Fica só no navegador (entra no backup).";
    };
    cat.addEventListener("change", sync);
    sync();
    const save = h("button", { type: "button", className: "mk-btn", textContent: "Salvar" });
    const cancel = h("button", { type: "button", className: "mk-btn", textContent: "Cancelar" });
    const form = h(
      "div",
      { className: "mk-form" },
      h("strong", { textContent: existing ? "Editar marcador" : "Novo marcador" }),
      h("label", {}, "Categoria", cat),
      name,
      note,
      where,
      h("div", { className: "mk-actions" }, save, cancel),
    );
    const popup = L.popup({ offset: [0, -4], closeOnClick: false })
      .setLatLng(this.view.toLatLng({ x: px[0], y: px[1] }))
      .setContent(form)
      .openOn(this.view.leaflet);
    cancel.addEventListener("click", () => popup.remove());
    save.addEventListener("click", () => {
      const m: ManualMarker = {
        id: existing?.id ?? newId(MAP_FILE_CATS.has(cat.value) ? "map" : "personal"),
        cat: cat.value,
        name: name.value.trim() || category(cat.value).label,
        px,
      };
      if (note.value.trim()) m.note = note.value.trim();
      popup.remove();
      void this.saveManual(m, existing?.source ?? null);
    });
    setTimeout(() => name.focus(), 0);
  }

  /** Dados do mapa carregados ou salvos (calibração nova → marcadores reposicionados). */
  setMapData(map: string, data: MapDataV1 | null): void {
    if (map !== this.info?.name) return;
    this.transform = savedTransform(data);
    const ign = data?.ignoredRefs;
    this.ignored = new Set(Array.isArray(ign) ? ign.filter((x): x is string => typeof x === "string") : []);
    this.mapManual = manualMarkersOf(data);
    this.recombine();
  }

  private rebuild(): void {
    this.placed.clear();
    const t = this.transform;
    for (const m of this.markers) {
      // manuais já estão em pixel; os do WutheringData precisam da calibração
      const pos = m.px ?? (t ? apply(t, [m.x, m.y]) : null);
      if (!pos) continue;
      const c = category(m.cat);
      const size = (SIZE[m.cat] ?? 4) + (m.source ? 1 : 0);
      this.placed.set(m.id, { data: m, px: pos[0], py: pos[1], color: markerColor(m), shape: c.shape, size });
    }
    this.renderStatus();
    this.renderProgress();
    this.renderCats();
    this.renderResults();
    this.applyFilter();
  }

  private applyFilter(): void {
    const visible = makeVisibility(this.filter, this.ignored);
    const found = this.foundHere();
    for (const p of this.placed.values()) p.dim = found.has(p.data.id);
    // ordem de desenho: categorias menos numerosas por cima (último desenhado fica no topo)
    const order = new Map(CATEGORIES.map((c, i) => [c.id, CATEGORIES.length - i]));
    const items = [...this.placed.values()].filter((p) => visible(p.data) && !(this.hideFound && p.dim));
    items.sort((a, b) => (order.get(a.data.cat) ?? 0) - (order.get(b.data.cat) ?? 0));
    this.layer.setItems(items);
  }

  private setFilter(next: FilterState): void {
    this.filter = next;
    savePref(FILTER_PREF, JSON.stringify(next));
    this.renderCats();
    this.applyFilter();
  }

  private toggleIn(list: string[], key: string, hidden: boolean): string[] {
    const s = new Set(list);
    if (hidden) s.add(key);
    else s.delete(key);
    return [...s].sort();
  }

  private foundHere(): ReadonlySet<string> {
    return this.info ? this.progress.forMap(this.info.name) : new Set();
  }

  private async toggleFound(m: GameMarker): Promise<void> {
    if (!this.info) return;
    const value = !this.progress.isFound(this.info.name, m.id);
    try {
      await this.progress.setFound(this.info.name, m.id, value);
    } catch (e) {
      this.status.textContent = `Não salvou o progresso (${(e as Error).message}).`;
    }
  }

  private renderProgress(): void {
    if (!this.markers.length) {
      this.progressLine.textContent = "";
      return;
    }
    const { all } = tallyMarkers(this.markers, this.foundHere(), this.ignored);
    this.progressLine.textContent = `Encontrados: ${fmtTally(all)} (${percent(all)})`;
    if (!this.progress.persistent) this.progressLine.textContent += " · sem IndexedDB: não será salvo";
  }

  private async renderAllMaps(): Promise<void> {
    const rows = await Promise.all(
      this.maps.map(async (info) => {
        const [markers, data] = await Promise.all([loadMarkers(info.name), loadMapData(info.name).catch(() => null)]);
        const ign: unknown[] = Array.isArray(data?.ignoredRefs) ? data.ignoredRefs : [];
        const ignored = new Set(ign.filter((x): x is string => typeof x === "string"));
        return { info, t: tallyMarkers(markers, this.progress.forMap(info.name), ignored).all };
      }),
    );
    this.allMapsList.replaceChildren(
      ...rows
        .filter((r) => r.t.total > 0)
        .map((r) =>
          h(
            "li",
            {},
            h("span", { className: "mk-name", textContent: mapLabel(r.info.name) }),
            h("span", { className: "mk-count", textContent: `${fmtTally(r.t)} · ${percent(r.t)}` }),
          ),
        ),
    );
  }

  private openImport(): void {
    const info = this.info;
    if (!info) return;
    const markers = this.dataMarkers.filter((m) => !this.ignored.has(m.id));
    if (!markers.length) {
      this.status.textContent = "Este mapa não tem marcadores do WutheringData pra casar.";
      return;
    }
    this.importer ??= new ImportDialog();
    this.importer.open({
      mapLabel: mapLabel(info.name),
      markers,
      isFound: (id) => this.progress.isFound(info.name, id),
      apply: (ids) => this.progress.setFoundMany(info.name, ids, true),
    });
  }

  private downloadBackup(): void {
    const b = this.progress.backup();
    const blob = new Blob([JSON.stringify(b, null, 1) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `solaris-gps-backup-${b.exportedAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private async restoreFrom(file: File): Promise<void> {
    try {
      if (file.size > 20_000_000) throw new Error("arquivo grande demais");
      const b = parseBackup(JSON.parse(await file.text()));
      const n = Object.values(b.found).reduce((a, ids) => a + ids.length, 0);
      const when = b.exportedAt ? ` (de ${b.exportedAt.slice(0, 10)})` : "";
      if (!confirm(`Restaurar ${n} encontrados${when}? O progresso atual será substituído.`)) return;
      await this.progress.restore(b);
      this.status.textContent = `Restaurados ${n} encontrados.`;
    } catch (e) {
      this.status.textContent = `Backup inválido: ${(e as Error).message}.`;
    }
  }

  private renderStatus(): void {
    const name = this.info?.name ?? "";
    if (!this.markers.length) {
      this.status.textContent = `Sem marcadores para ${name}. Gere com tools/extract_markers.py ou crie à mão.`;
    } else if (!this.transform && this.dataMarkers.length) {
      this.status.textContent = `${this.dataMarkers.length} marcadores do WutheringData, mas o mapa não está calibrado (3+ pontos).`;
    } else {
      this.status.textContent = `${this.markers.length - this.countIgnored()} marcadores neste mapa.`;
    }
  }

  private countIgnored(): number {
    return this.markers.filter((m) => this.ignored.has(m.id)).length;
  }

  private renderCats(): void {
    const counts = tallyMarkers(this.markers, this.foundHere(), this.ignored).cats;
    const hiddenCats = new Set(this.filter.hiddenCats);
    const hiddenSubs = new Set(this.filter.hiddenSubs);
    const rows: HTMLElement[] = [];
    for (const c of CATEGORIES) {
      const ct = counts.get(c.id);
      if (!ct) continue;
      const subs = ct.subs;
      const box = h("input", { type: "checkbox", checked: !hiddenCats.has(c.id) });
      box.addEventListener("change", () =>
        this.setFilter({ ...this.filter, hiddenCats: this.toggleIn(this.filter.hiddenCats, c.id, !box.checked) }),
      );
      const head = h(
        "label",
        { className: "mk-cat" },
        box,
        swatch(c.shape, c.color),
        h("span", { className: "mk-name", textContent: c.label }),
        h("span", { className: "mk-count", textContent: fmtTally(ct.tally) }),
      );
      head.title = `${percent(ct.tally)} encontrados`;
      if (subs.size < 2) {
        rows.push(head);
        continue;
      }
      // subcategorias (tier do baú, espécie da planta…), mais numerosas primeiro
      const list = h("div", { className: "mk-subs" });
      const sorted = [...subs.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
      for (const [sub, n] of sorted) {
        const key = `${c.id}/${sub}`;
        const sb = h("input", { type: "checkbox", checked: !hiddenSubs.has(key), disabled: hiddenCats.has(c.id) });
        sb.addEventListener("change", () =>
          this.setFilter({ ...this.filter, hiddenSubs: this.toggleIn(this.filter.hiddenSubs, key, !sb.checked) }),
        );
        list.append(
          h(
            "label",
            { className: "mk-sub" },
            sb,
            h("span", { className: "mk-name", textContent: subLabel({ cat: c.id, sub }) }),
            h("span", { className: "mk-count", textContent: fmtTally(n) }),
          ),
        );
      }
      const all = h("button", { type: "button", className: "mk-link", textContent: "todos" });
      const none = h("button", { type: "button", className: "mk-link", textContent: "nenhum" });
      const keys = sorted.map(([sub]) => `${c.id}/${sub}`);
      all.addEventListener("click", () =>
        this.setFilter({ ...this.filter, hiddenSubs: this.filter.hiddenSubs.filter((k) => !keys.includes(k)) }),
      );
      none.addEventListener("click", () =>
        this.setFilter({ ...this.filter, hiddenSubs: [...new Set([...this.filter.hiddenSubs, ...keys])].sort() }),
      );
      const details = h("details", { className: "mk-group", open: this.openGroups.has(c.id) },
        h("summary", {}, head), h("div", { className: "mk-sub-actions" }, all, none), list);
      details.addEventListener("toggle", () => {
        if (details.open) this.openGroups.add(c.id);
        else this.openGroups.delete(c.id);
      });
      rows.push(details);
    }
    this.cats.replaceChildren(...rows);
  }

  private renderResults(): void {
    const q = this.search.value;
    if (!q.trim()) {
      this.results.replaceChildren();
      return;
    }
    const found = searchMarkers(this.markers, this.texts, q).filter((m) => !this.ignored.has(m.id));
    if (!found.length) {
      this.results.replaceChildren(h("li", { className: "mk-empty", textContent: "Nada encontrado." }));
      return;
    }
    this.results.replaceChildren(
      ...found.map((m) => {
        const btn = h(
          "button",
          { type: "button" },
          swatch(category(m.cat).shape, markerColor(m)),
          h("span", { className: "mk-name", textContent: m.name }),
          h("span", { className: "mk-area", textContent: m.area.slice(-2).join(" › ") }),
        );
        btn.addEventListener("click", () => this.focus(m));
        return h("li", {}, btn);
      }),
    );
  }

  /** Centraliza no marcador e abre o popup (mesmo se a categoria estiver filtrada). */
  private focus(m: GameMarker): void {
    const item = this.placed.get(m.id);
    if (!item) {
      this.status.textContent = "Esse marcador não tem posição: calibre o mapa primeiro.";
      return;
    }
    const latlng = this.view.toLatLng({ x: item.px, y: item.py });
    const map = this.view.leaflet;
    map.setView(latlng, Math.max(map.getZoom(), (this.info?.maxZoom ?? 0) - 1));
    this.popup(item);
  }

  private popup(item: PlacedItem<GameMarker>): void {
    const m = item.data;
    const sub = subLabel(m);
    const map = this.info?.name ?? "";
    const foundBtn = h("button", { type: "button", className: "mk-found-btn" });
    const sync = () => {
      const f = this.progress.isFound(map, m.id);
      foundBtn.textContent = f ? "✓ Encontrado (desmarcar)" : "Marcar como encontrado";
      foundBtn.classList.toggle("on", f);
    };
    sync();
    foundBtn.addEventListener("click", () => void this.toggleFound(m).then(sync));
    const body = h(
      "div",
      { className: "mk-popup" },
      h("strong", { textContent: m.name }),
      h("div", { className: "mk-pop-cat", textContent: sub !== m.name ? `${category(m.cat).label} · ${sub}` : category(m.cat).label }),
      m.source
        ? h("div", { textContent: m.note ?? "", className: "mk-pop-note" })
        : h("div", { textContent: m.area.join(" › ") || "Área desconhecida" }),
      h("div", {
        className: "mk-pop-coord",
        textContent: m.source
          ? `${m.source === "map" ? "arquivo do mapa" : "pessoal"} · px ${Math.round(item.px)}, ${Math.round(item.py)}`
          : `jogo ${Math.round(m.x)}, ${Math.round(m.y)}, ${Math.round(m.z)}`,
      }),
      foundBtn,
    );
    if (m.source) {
      const edit = h("button", { type: "button", className: "mk-link", textContent: "editar" });
      const move = h("button", { type: "button", className: "mk-link", textContent: "mover" });
      const del = h("button", { type: "button", className: "mk-link", textContent: "apagar" });
      edit.addEventListener("click", () => this.openForm([item.px, item.py], m));
      move.addEventListener("click", () => {
        this.view.leaflet.closePopup();
        this.setMode({ kind: "move", id: m.id });
      });
      del.addEventListener("click", () => void this.deleteManual(m));
      body.append(h("div", { className: "mk-sub-actions" }, edit, move, del));
    }
    this.layer.setHighlight(item);
    L.popup({ offset: [0, -4] })
      .setLatLng(this.view.toLatLng({ x: item.px, y: item.py }))
      .setContent(body)
      .on("remove", () => this.layer.setHighlight(null))
      .openOn(this.view.leaflet);
  }
}
