import L from "leaflet";
import { apply, fitAffine, type Affine } from "./affine";
import { manualMarkersOf, type MapDataV1 } from "./mapData";
import { MarkerCanvasLayer, type PlacedItem } from "./markerLayer";
import {
  CATEGORIES,
  MAP_FILE_CATS,
  category,
  fold,
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
import { markerIconEl, uiIcon, type MarkerIcon } from "./icons";
import { loadMapData } from "./mapData";
import { mapLabel } from "./mapPicker";
import { computeRegions, type Region } from "./regions";
import { ImportDialog } from "./importDialog";
import { AppsampleDialog } from "./appsampleDialog";
import { parseBackup, percent, tallyMarkers, type ManualMarker, type ProgressStore, type Tally } from "./progress";
import type { MapView } from "./mapView";
import { loadPref, savePref } from "./storage";

const FILTER_PREF = "markers.filter";
const OPEN_PREF = "markers.open";
const HIDE_FOUND_PREF = "markers.hideFound";
const HIDE_FOUND_CATS_PREF = "markers.hideFoundCats";
/** Grupos do "esconder coletados" nas configurações: baús, caskets e o resto. */
export type HideFoundGroup = "chest" | "casket" | "other";
const groupOf = (cat: string): HideFoundGroup => (cat === "chest" || cat === "casket" ? cat : "other");
/** Quantas marcações o desfazer guarda. */
const UNDO_LIMIT = 50;

function loadHideFound(): Set<HideFoundGroup> {
  const raw = loadPref(HIDE_FOUND_CATS_PREF);
  if (raw === null) return new Set(loadPref(HIDE_FOUND_PREF) === "1" ? ["chest", "casket", "other"] : []); // pref antiga: tudo
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return new Set(v.filter((x): x is HideFoundGroup => x === "chest" || x === "casket" || x === "other"));
  } catch {
    /* corrompida */
  }
  return new Set();
}

const fmtTally = (t: Tally) => `${t.found}/${t.total}`;

/** Meio-lado do ícone em px de tela, no zoom nativo. */
const SIZE: Record<string, number> = { nexus: 13, beacon: 12, chest: 10, casket: 10 };

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function swatch(icon: MarkerIcon, color: string): HTMLImageElement {
  return markerIconEl(icon, color, 20);
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
  private appsampleImporter: AppsampleDialog | null = null;
  private texts: string[] = [];
  private placed = new Map<string, PlacedItem<GameMarker>>();
  private transform: Affine | null = null;
  private ignored = new Set<string>();
  private filter: FilterState = parseFilter(loadPref(FILTER_PREF));
  private open = loadPref(OPEN_PREF) !== "0";
  private loadSeq = 0;
  private hideFound = loadHideFound();
  /** Marcações de encontrado feitas nesta sessão, pro desfazer (mais recente no fim). */
  private history: { map: string; id: string }[] = [];
  /** Posição do jogador (tracker), pro "mais próximo". */
  private player: [number, number] | null = null;
  private nearest: PlacedItem<GameMarker> | null = null;
  private readonly link: L.Polyline;
  private readonly linkEnd: L.CircleMarker;
  private nearestListeners = new Set<(m: GameMarker | null) => void>();
  private regionListeners = new Set<(r: Region[]) => void>();
  private regionList: Region[] = [];
  /** O que está desenhado agora (filtro + esconder coletados): a base do "mais próximo". */
  private visibleItems: PlacedItem<GameMarker>[] = [];
  /** Grupos de subcategoria abertos (sobrevivem ao redesenho do painel). */
  private openGroups = new Set<string>();
  /** Texto do filtro de tipos de cada menu (sobrevive ao redesenho). */
  private readonly subQuery = new Map<string, string>();
  private maps: MapInfo[] = [];
  private readonly layer: MarkerCanvasLayer<GameMarker>;

  private readonly status = h("p", { className: "mk-status", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly search = h("input", { type: "search", placeholder: "Buscar (ex.: baú premium jinzhou)…" });
  private readonly results = h("ul", { className: "mk-results" });
  private readonly cats = h("div", { className: "mk-cats" });
  private readonly progressLine = h("p", { className: "mk-progress" });
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
    const close = h("button", { type: "button", className: "mk-close", title: "Fechar" }, uiIcon("close", 14));
    close.setAttribute("aria-label", "Fechar");
    close.addEventListener("click", () => this.toggle(false));
    this.search.addEventListener("input", () => this.renderResults());
    this.allMaps.append(h("summary", { textContent: "Progresso em todos os mapas" }), this.allMapsList);
    this.allMaps.addEventListener("toggle", () => {
      if (this.allMaps.open) void this.renderAllMaps();
    });

    this.root = h(
      "aside",
      { className: "mk-panel", hidden: !this.open },
      h("header", { className: "panel-head" }, uiIcon("markers", 18), h("h2", { textContent: "Marcadores" }), close),
      this.status,
      this.progressLine,
      h("div", { className: "mk-actions" }, this.addBtn),
      h("label", { className: "mk-search" }, uiIcon("search", 15), this.search),
      this.results,
      this.cats,
      this.allMaps,
    );
    // linha pontilhada jogador → marcador mais próximo (o que o atalho marcaria)
    this.link = L.polyline([], { className: "nearest-link", interactive: false, dashArray: "2 7", weight: 2.5, lineCap: "round" });
    this.linkEnd = L.circleMarker([0, 0], { className: "nearest-ring", interactive: false, radius: 15, weight: 1.5, fill: false, dashArray: "3 4" });
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
      const size = (SIZE[m.cat] ?? 8) + (m.source ? 1 : 0);
      this.placed.set(m.id, { data: m, px: pos[0], py: pos[1], color: markerColor(m), icon: c.icon, size });
    }
    this.regionList = computeRegions([...this.placed.values()].map((p) => ({ area: p.data.area, px: p.px, py: p.py })));
    for (const fn of this.regionListeners) fn(this.regionList);
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
    const items = [...this.placed.values()].filter((p) => visible(p.data) && !(p.dim && this.hideFound.has(groupOf(p.data.cat))));
    items.sort((a, b) => (order.get(a.data.cat) ?? 0) - (order.get(b.data.cat) ?? 0));
    this.layer.setItems(items);
    this.visibleItems = items;
    this.updateNearest();
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
      if (value) this.remember(this.info.name, m.id);
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
    const bar = h("span", { className: "mk-bar" });
    bar.style.setProperty("--p", String(all.total ? all.found / all.total : 0));
    this.progressLine.replaceChildren(
      h("span", { className: "mk-progress-label", textContent: "Encontrados" }),
      h("span", { className: "mk-progress-value", textContent: `${fmtTally(all)} · ${percent(all)}` }),
      bar,
    );
    if (!this.progress.persistent) this.progressLine.append(h("span", { className: "mk-progress-warn", textContent: "Sem IndexedDB: o progresso não será salvo." }));
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

  /** Importador do backup do th.gl pro mapa ativo; devolve um aviso quando não dá. */
  openImport(): string | null {
    const info = this.info;
    if (!info) return "Nenhum mapa ativo.";
    const markers = this.dataMarkers.filter((m) => !this.ignored.has(m.id));
    if (!markers.length) return "Este mapa não tem marcadores do WutheringData pra casar.";
    this.importer ??= new ImportDialog();
    this.importer.open({
      mapLabel: mapLabel(info.name),
      markers,
      isFound: (id) => this.progress.isFound(info.name, id),
      apply: (ids) => this.progress.setFoundMany(info.name, ids, true),
    });
    return null;
  }

  /** Importador do progresso do appsample: marca em todos os mapas de uma vez. */
  openAppsampleImport(): void {
    this.appsampleImporter ??= new AppsampleDialog();
    this.appsampleImporter.open({
      isFound: (map, id) => this.progress.isFound(map, id),
      apply: (map, ids) => this.progress.setFoundMany(map, ids, true),
    });
  }

  downloadBackup(): void {
    const b = this.progress.backup();
    const blob = new Blob([JSON.stringify(b, null, 1) + "\n"], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `solaris-gps-backup-${b.exportedAt.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /** Restaura um backup (pede confirmação); devolve a mensagem pro usuário. */
  async restoreFrom(file: File): Promise<string> {
    try {
      if (file.size > 20_000_000) throw new Error("arquivo grande demais");
      const b = parseBackup(JSON.parse(await file.text()));
      const n = Object.values(b.found).reduce((a, ids) => a + ids.length, 0);
      const when = b.exportedAt ? ` (de ${b.exportedAt.slice(0, 10)})` : "";
      if (!confirm(`Restaurar ${n} encontrados${when}? O progresso atual será substituído.`)) return "Restauração cancelada.";
      await this.progress.restore(b);
      this.history = [];
      return `Restaurados ${n} encontrados.`;
    } catch (e) {
      return `Backup inválido: ${(e as Error).message}.`;
    }
  }

  // ---- Esconder coletados (configurações) ----

  isHidingFound(group: HideFoundGroup): boolean {
    return this.hideFound.has(group);
  }

  setHideFound(group: HideFoundGroup, on: boolean): void {
    if (on) this.hideFound.add(group);
    else this.hideFound.delete(group);
    savePref(HIDE_FOUND_CATS_PREF, JSON.stringify([...this.hideFound]));
    this.applyFilter();
  }

  // ---- Regiões ----

  get regions(): readonly Region[] {
    return this.regionList;
  }

  onRegions(fn: (r: Region[]) => void): void {
    this.regionListeners.add(fn);
  }

  // ---- Mais próximo do jogador, marcar e desfazer ----

  /** Posição do jogador vinda do tracker (px do zoom máximo); null = sem posição. */
  setPlayer(px: [number, number] | null): void {
    this.player = px;
    this.updateNearest();
  }

  onNearest(fn: (m: GameMarker | null) => void): void {
    this.nearestListeners.add(fn);
  }

  /** Marca como encontrado o marcador visível (e ainda não encontrado) mais próximo do jogador. */
  async collectNearest(): Promise<GameMarker | null> {
    const item = this.nearest;
    const map = this.info?.name;
    if (!item || !map) return null;
    await this.progress.setFound(map, item.data.id, true);
    this.remember(map, item.data.id);
    return item.data;
  }

  /** Desfaz a última marcação de encontrado (do atalho, do popup ou do botão direito). */
  async undoLast(): Promise<GameMarker | null> {
    for (;;) {
      const last = this.history.pop();
      if (!last) return null;
      if (!this.progress.isFound(last.map, last.id)) continue; // já desmarcado por outro caminho
      await this.progress.setFound(last.map, last.id, false);
      return this.markers.find((m) => m.id === last.id) ?? null;
    }
  }

  get canUndo(): boolean {
    return this.history.length > 0;
  }

  private remember(map: string, id: string): void {
    this.history.push({ map, id });
    if (this.history.length > UNDO_LIMIT) this.history.shift();
  }

  /** Recalcula o mais próximo entre os visíveis ainda não encontrados e redesenha a linha. */
  private updateNearest(): void {
    const p = this.player;
    let best: PlacedItem<GameMarker> | null = null;
    if (p) {
      let bd = Infinity;
      for (const it of this.visibleItems) {
        if (it.dim) continue;
        const d = (it.px - p[0]) ** 2 + (it.py - p[1]) ** 2;
        if (d < bd) {
          bd = d;
          best = it;
        }
      }
    }
    const map = this.view.leaflet;
    if (p && best) {
      const a = this.view.toLatLng({ x: p[0], y: p[1] });
      const b = this.view.toLatLng({ x: best.px, y: best.py });
      this.link.setLatLngs([a, b]);
      this.linkEnd.setLatLng(b);
      if (!map.hasLayer(this.link)) this.link.addTo(map);
      if (!map.hasLayer(this.linkEnd)) this.linkEnd.addTo(map);
    } else {
      this.link.remove();
      this.linkEnd.remove();
    }
    if (best !== this.nearest) {
      this.nearest = best;
      for (const fn of this.nearestListeners) fn(best?.data ?? null);
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
    // o redesenho não pode perder a rolagem nem a busca do menu aberto
    const scroll = this.cats.querySelector<HTMLElement>(".mk-subs")?.scrollTop ?? 0;
    const rows: HTMLElement[] = [];
    for (const c of CATEGORIES) {
      const ct = counts.get(c.id);
      if (!ct) continue;
      const subs = ct.subs;
      const catHidden = hiddenCats.has(c.id);
      const box = h("input", { type: "checkbox", checked: !catHidden });
      box.setAttribute("aria-label", `Mostrar ${c.label}`);
      box.addEventListener("change", () =>
        this.setFilter({ ...this.filter, hiddenCats: this.toggleIn(this.filter.hiddenCats, c.id, !box.checked) }),
      );
      const name = h("span", { className: "mk-name", textContent: c.label });
      const count = h("span", { className: "mk-count", textContent: fmtTally(ct.tally) });
      const hasMenu = subs.size >= 2;
      const boxLabel = h("label", { className: "mk-cat-box" }, box, swatch(c.icon, c.color));
      const row = h("div", { className: "mk-cat" }, boxLabel);
      row.title = `${percent(ct.tally)} encontrados`;
      if (!hasMenu) {
        // sem tipos: a linha inteira liga e desliga
        boxLabel.classList.add("wide");
        boxLabel.append(name, count);
        rows.push(row);
        continue;
      }
      // subcategorias (tier do baú, espécie da planta…), mais numerosas primeiro
      const sorted = [...subs.entries()].sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));
      const keys = sorted.map(([sub]) => `${c.id}/${sub}`);
      const shown = keys.filter((k) => !hiddenSubs.has(k)).length;
      const open = this.openGroups.has(c.id);
      const tag = h("span", { className: "mk-filter-tag", textContent: shown < keys.length ? `${shown}/${keys.length} tipos` : "" });
      const opener = h("button", { type: "button", className: "mk-cat-open" }, name, tag, count, uiIcon("chevron", 14));
      opener.setAttribute("aria-expanded", String(open));
      opener.title = `Escolher os tipos de ${c.label.toLowerCase()}`;
      opener.addEventListener("click", () => {
        // um menu aberto por vez
        if (this.openGroups.has(c.id)) this.openGroups.clear();
        else this.openGroups = new Set([c.id]);
        this.renderCats();
      });
      row.append(opener);
      row.classList.toggle("open", open);
      rows.push(row);
      if (!open) continue;

      const drop = h("div", { className: "mk-drop" });
      const showOnly = (keep: string[]) =>
        this.setFilter({
          hiddenCats: this.toggleIn(this.filter.hiddenCats, c.id, false),
          hiddenSubs: [...new Set([...this.filter.hiddenSubs.filter((k) => !keys.includes(k)), ...keys.filter((k) => !keep.includes(k))])].sort(),
        });
      const all = h("button", { type: "button", className: "mk-link", textContent: "todos" });
      const none = h("button", { type: "button", className: "mk-link", textContent: "nenhum" });
      all.addEventListener("click", () => showOnly(keys));
      none.addEventListener("click", () => showOnly([]));
      const list = h("div", { className: "mk-subs" });
      const query = h("input", { type: "search", placeholder: `Filtrar ${sorted.length} tipos…`, value: this.subQuery.get(c.id) ?? "" });
      const applyQuery = () => {
        const q = fold(query.value.trim());
        this.subQuery.set(c.id, query.value);
        for (const el of list.children) (el as HTMLElement).hidden = !!q && !fold(el.textContent ?? "").includes(q);
      };
      query.addEventListener("input", applyQuery);
      for (const [sub, n] of sorted) {
        const key = `${c.id}/${sub}`;
        const on = !hiddenSubs.has(key);
        const sb = h("input", { type: "checkbox", checked: on });
        sb.addEventListener("change", () =>
          this.setFilter({
            // ligar um tipo de categoria escondida mostra a categoria também
            hiddenCats: sb.checked ? this.toggleIn(this.filter.hiddenCats, c.id, false) : this.filter.hiddenCats,
            hiddenSubs: this.toggleIn(this.filter.hiddenSubs, key, !sb.checked),
          }),
        );
        const only = h("button", { type: "button", className: "mk-only", textContent: "só" });
        only.title = "Mostrar só este tipo";
        only.addEventListener("click", () => showOnly([key]));
        const color = c.subs?.[sub]?.color;
        list.append(
          h(
            "div",
            { className: "mk-sub" },
            h("label", {}, sb, color ? swatch(c.icon, color) : "", h("span", { className: "mk-name", textContent: subLabel({ cat: c.id, sub }) })),
            only,
            h("span", { className: "mk-count", textContent: fmtTally(n) }),
          ),
        );
      }
      if (catHidden) drop.append(h("p", { className: "mk-drop-note", textContent: "Categoria desligada: marcar um tipo liga ela de novo." }));
      drop.append(h("div", { className: "mk-sub-actions" }, all, none, h("span", { className: "mk-drop-sum", textContent: `${shown} de ${keys.length}` })));
      if (sorted.length > 8) drop.append(h("label", { className: "mk-search mk-drop-search" }, uiIcon("search", 14), query));
      drop.append(list);
      rows.push(drop);
      applyQuery();
      requestAnimationFrame(() => (list.scrollTop = scroll));
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
          swatch(category(m.cat).icon, markerColor(m)),
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
