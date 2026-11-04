import "leaflet/dist/leaflet.css";
import "./style.css";
import { loadMaps, type MapInfo } from "./maps";
import { MapView } from "./mapView";
import { createMapPicker } from "./mapPicker";
import { loadPref, savePref } from "./storage";
import { TrackerClient, type TrackerStatus } from "./tracker";

const ACTIVE_MAP_PREF = "activeMap";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} não existe no index.html`);
  return node as T;
}

async function start(): Promise<void> {
  const hud = el<HTMLDivElement>("hud");
  const view = new MapView(el<HTMLDivElement>("map"));

  const maps = await loadMaps();
  const byName = new Map<string, MapInfo>(maps.map((m) => [m.name, m]));
  const saved = loadPref(ACTIVE_MAP_PREF);
  const initial = (saved && byName.get(saved)) || maps[0];
  if (!initial) return;

  const tracker = new TrackerClient();
  const toolbar = el<HTMLDivElement>("toolbar");

  const activate = (name: string): void => {
    const info = byName.get(name);
    if (!info) return;
    view.show(info);
    savePref(ACTIVE_MAP_PREF, name);
    tracker.setActiveMap(name);
    hud.textContent = "";
  };

  createMapPicker(toolbar, maps, initial.name, activate);
  toolbar.append(createTrackerBadge(tracker));
  activate(initial.name);
  tracker.start();
  // Exposto só para depuração no console do navegador.
  (window as unknown as { solaris?: unknown }).solaris = { tracker, view };

  // Coordenada em pixel do zoom máximo sob o cursor (base da calibração e dos fixtures).
  view.leaflet.on("mousemove", (e) => {
    const p = view.toPixel(e.latlng);
    hud.textContent = `px ${Math.round(p.x)}, ${Math.round(p.y)}`;
  });
}

const STATUS_TEXT: Record<TrackerStatus, string> = {
  connected: "Tracker conectado",
  connecting: "Conectando ao tracker…",
  disconnected: "Tracker desligado",
};

function createTrackerBadge(tracker: TrackerClient): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "tracker-badge";
  badge.setAttribute("role", "status");
  tracker.onStatus((s) => {
    badge.dataset.status = s;
    badge.textContent = STATUS_TEXT[s];
  });
  return badge;
}

start().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const box = document.createElement("div");
  box.className = "fatal";
  box.textContent = msg;
  document.body.append(box);
  console.error(err);
});
