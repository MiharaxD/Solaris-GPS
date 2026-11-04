import L from "leaflet";
import { apply, fitAffine, type Affine } from "./affine";
import type { MapDataV1 } from "./mapData";
import { MarkerCanvasLayer, type PlacedItem } from "./markerLayer";
import {
  CATEGORIES,
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
import type { MapView } from "./mapView";
import { loadPref, savePref } from "./storage";

const FILTER_PREF = "markers.filter";
const OPEN_PREF = "markers.open";

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

/** Transformação jogo→pixel salva no mapa (3+ pontos), ou null. */
export function savedTransform(data: MapDataV1 | null): Affine | null {
  const pts = data?.calibration?.points ?? [];
  return fitAffine(pts)?.affine ?? null;
}

/**
 * Painel de marcadores: filtro por categoria/subcategoria, busca e popup ao clicar.
 * Recebe os dados do mapa (calibração e referências ignoradas) de quem os carrega.
 */
export class MarkerPanel {
  readonly root: HTMLElement;
  private info: MapInfo | null = null;
  private markers: GameMarker[] = [];
  private texts: string[] = [];
  private placed = new Map<string, PlacedItem<GameMarker>>();
  private transform: Affine | null = null;
  private ignored = new Set<string>();
  private filter: FilterState = parseFilter(loadPref(FILTER_PREF));
  private open = loadPref(OPEN_PREF) !== "0";
  private loadSeq = 0;
  private readonly layer: MarkerCanvasLayer<GameMarker>;

  private readonly status = h("p", { className: "mk-status", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly search = h("input", { type: "search", placeholder: "Buscar (ex.: baú premium jinzhou)…" });
  private readonly results = h("ul", { className: "mk-results" });
  private readonly cats = h("div", { className: "mk-cats" });

  constructor(
    private readonly view: MapView,
    /** true enquanto outro modo (calibração) usa os cliques no mapa. */
    private readonly busy: () => boolean,
  ) {
    this.layer = new MarkerCanvasLayer(() => this.info?.maxZoom ?? 0);
    this.layer.addTo(view.leaflet);
    const close = h("button", { type: "button", className: "mk-close", textContent: "✕", title: "Fechar" });
    close.addEventListener("click", () => this.toggle(false));
    this.search.addEventListener("input", () => this.renderResults());
    this.root = h(
      "aside",
      { className: "mk-panel", hidden: !this.open },
      h("header", {}, h("h2", { textContent: "Marcadores" }), close),
      this.status,
      this.search,
      this.results,
      this.cats,
    );

    const map = view.leaflet;
    map.on("click", (e) => {
      if (this.busy()) return;
      const hit = this.layer.hitTest(e.containerPoint);
      if (hit) this.popup(hit);
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

  async setMap(info: MapInfo): Promise<void> {
    const seq = ++this.loadSeq;
    this.info = info;
    this.markers = [];
    this.texts = [];
    this.transform = null;
    this.ignored = new Set();
    this.view.leaflet.closePopup();
    this.search.value = "";
    this.rebuild();
    const markers = await loadMarkers(info.name);
    if (seq !== this.loadSeq) return;
    this.markers = markers;
    this.texts = markers.map(markerText);
    this.rebuild();
  }

  /** Dados do mapa carregados ou salvos (calibração nova → marcadores reposicionados). */
  setMapData(map: string, data: MapDataV1 | null): void {
    if (map !== this.info?.name) return;
    this.transform = savedTransform(data);
    const ign = data?.ignoredRefs;
    this.ignored = new Set(Array.isArray(ign) ? ign.filter((x): x is string => typeof x === "string") : []);
    this.rebuild();
  }

  private rebuild(): void {
    this.placed.clear();
    const t = this.transform;
    if (t) {
      for (const m of this.markers) {
        const [px, py] = apply(t, [m.x, m.y]);
        const c = category(m.cat);
        this.placed.set(m.id, { data: m, px, py, color: markerColor(m), shape: c.shape, size: SIZE[m.cat] ?? 4 });
      }
    }
    this.renderStatus();
    this.renderCats();
    this.renderResults();
    this.applyFilter();
  }

  private applyFilter(): void {
    const visible = makeVisibility(this.filter, this.ignored);
    // ordem de desenho: categorias menos numerosas por cima (último desenhado fica no topo)
    const order = new Map(CATEGORIES.map((c, i) => [c.id, CATEGORIES.length - i]));
    const items = [...this.placed.values()].filter((p) => visible(p.data));
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

  private renderStatus(): void {
    const name = this.info?.name ?? "";
    if (!this.markers.length) {
      this.status.textContent = `Sem marcadores para ${name}. Gere com tools/extract_markers.py.`;
    } else if (!this.transform) {
      this.status.textContent = `${this.markers.length} marcadores, mas o mapa não está calibrado (3+ pontos).`;
    } else {
      this.status.textContent = `${this.markers.length - this.countIgnored()} marcadores neste mapa.`;
    }
  }

  private countIgnored(): number {
    return this.markers.filter((m) => this.ignored.has(m.id)).length;
  }

  private renderCats(): void {
    const counts = new Map<string, Map<string, number>>();
    for (const m of this.markers) {
      if (this.ignored.has(m.id)) continue;
      const subs = counts.get(m.cat) ?? new Map<string, number>();
      subs.set(m.sub, (subs.get(m.sub) ?? 0) + 1);
      counts.set(m.cat, subs);
    }
    const hiddenCats = new Set(this.filter.hiddenCats);
    const hiddenSubs = new Set(this.filter.hiddenSubs);
    const rows: HTMLElement[] = [];
    for (const c of CATEGORIES) {
      const subs = counts.get(c.id);
      if (!subs) continue;
      const total = [...subs.values()].reduce((a, b) => a + b, 0);
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
        h("span", { className: "mk-count", textContent: String(total) }),
      );
      if (subs.size < 2) {
        rows.push(head);
        continue;
      }
      // subcategorias (tier do baú, espécie da planta…), mais numerosas primeiro
      const list = h("div", { className: "mk-subs" });
      const sorted = [...subs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
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
            h("span", { className: "mk-count", textContent: String(n) }),
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
      const details = h("details", { className: "mk-group" }, h("summary", {}, head), h("div", { className: "mk-sub-actions" }, all, none), list);
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
    const body = h(
      "div",
      { className: "mk-popup" },
      h("strong", { textContent: m.name }),
      h("div", { className: "mk-pop-cat", textContent: sub !== m.name ? `${category(m.cat).label} · ${sub}` : category(m.cat).label }),
      h("div", { textContent: m.area.join(" › ") || "Área desconhecida" }),
      h("div", { className: "mk-pop-coord", textContent: `jogo ${Math.round(m.x)}, ${Math.round(m.y)}, ${Math.round(m.z)}` }),
    );
    this.layer.setHighlight(item);
    L.popup({ offset: [0, -4] })
      .setLatLng(this.view.toLatLng({ x: item.px, y: item.py }))
      .setContent(body)
      .on("remove", () => this.layer.setHighlight(null))
      .openOn(this.view.leaflet);
  }
}
