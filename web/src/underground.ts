import L from "leaflet";
import type { MapInfo } from "./maps";
import type { MapView } from "./mapView";

/** Um overlay subterrâneo (gerado por `tools/build_overlays.py`). */
export interface UndergroundOverlay {
  id: string;
  label: string;
  file: string;
  /** [x0, y0, x1, y1] em pixel do zoom máximo do mapa. */
  rect: [number, number, number, number];
  /** Centroide da parte visível, pro rótulo. */
  center: [number, number];
}

const PANE = "solaris-underground";
/** Rótulos só aparecem a partir de `maxZoom - LABEL_ZOOM_DROP`. */
const LABEL_ZOOM_DROP = 2;

function isOverlay(v: unknown): v is UndergroundOverlay {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const nums = (a: unknown, n: number) => Array.isArray(a) && a.length === n && a.every((x) => typeof x === "number");
  return typeof o.id === "string" && typeof o.label === "string" && typeof o.file === "string" && nums(o.rect, 4) && nums(o.center, 2);
}

/** Lê `/overlays/<name>.json`. Mapa sem subterrâneo (404) devolve lista vazia. */
export async function loadUnderground(name: string): Promise<UndergroundOverlay[]> {
  try {
    const res = await fetch(`/overlays/${encodeURIComponent(name)}.json`);
    if (!res.ok) return [];
    const data = (await res.json()) as { overlays?: unknown };
    return Array.isArray(data.overlays) ? data.overlays.filter(isOverlay) : [];
  } catch {
    return [];
  }
}

/**
 * Modo subterrâneo: escurece o mapa de cima e desenha as imagens das cavernas por cima das
 * tiles (abaixo dos marcadores), com o nome de cada área quando o zoom está perto.
 */
export class UndergroundLayer {
  private readonly group = L.layerGroup();
  private overlays: UndergroundOverlay[] = [];
  private on = false;
  private mapName: string | null = null;
  /** Chamado quando o mapa ativo passa a ter (ou deixa de ter) subterrâneo. */
  onAvailability: (available: boolean) => void = () => {};

  constructor(private readonly view: MapView) {
    const map = view.leaflet;
    const pane = map.getPane(PANE) ?? map.createPane(PANE);
    pane.style.zIndex = "250"; // tiles = 200, marcadores = 400
    pane.style.pointerEvents = "none";
    map.on("zoomend", this.syncLabels, this);
  }

  get available(): boolean {
    return this.overlays.length > 0;
  }

  get isOn(): boolean {
    return this.on;
  }

  async setMap(info: MapInfo): Promise<void> {
    this.mapName = info.name;
    this.clear();
    const list = await loadUnderground(info.name);
    if (this.mapName !== info.name) return; // trocou de mapa no meio do fetch
    this.overlays = list;
    this.build(info);
    this.onAvailability(this.available);
    this.apply();
  }

  toggle(force?: boolean): void {
    this.on = force ?? !this.on;
    this.apply();
  }

  private clear(): void {
    this.group.clearLayers();
    this.overlays = [];
    this.apply();
  }

  private build(info: MapInfo): void {
    for (const o of this.overlays) {
      const [x0, y0, x1, y1] = o.rect;
      const bounds = L.latLngBounds(this.view.toLatLng({ x: x0, y: y1 }), this.view.toLatLng({ x: x1, y: y0 }));
      L.imageOverlay(`/overlays/${encodeURIComponent(info.name)}/${encodeURIComponent(o.file)}`, bounds, {
        pane: PANE,
        interactive: false,
        className: "ug-image",
      }).addTo(this.group);
      const icon = L.divIcon({ className: "ug-label", html: "", iconSize: undefined });
      const label = L.marker(this.view.toLatLng({ x: o.center[0], y: o.center[1] }), {
        icon,
        pane: PANE,
        interactive: false,
        keyboard: false,
      });
      label.on("add", () => {
        const node = label.getElement();
        if (node) node.textContent = o.label;
      });
      label.addTo(this.group);
    }
  }

  private apply(): void {
    const map = this.view.leaflet;
    const show = this.on && this.available;
    if (show && !map.hasLayer(this.group)) this.group.addTo(map);
    if (!show && map.hasLayer(this.group)) map.removeLayer(this.group);
    map.getContainer().classList.toggle("ug-on", show);
    this.syncLabels();
  }

  private syncLabels(): void {
    const info = this.view.active;
    const near = !!info && this.view.leaflet.getZoom() >= info.maxZoom - LABEL_ZOOM_DROP;
    this.view.leaflet.getContainer().classList.toggle("ug-labels", near);
  }
}
