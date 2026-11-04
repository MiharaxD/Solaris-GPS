import "leaflet/dist/leaflet.css";
import "./style.css";
import { loadMaps, type MapInfo } from "./maps";
import { MapView } from "./mapView";
import { createMapPicker } from "./mapPicker";
import { loadPref, savePref } from "./storage";
import { downloadMapData, loadMapData, saveMapData } from "./mapData";
import { CalibrationPanel } from "./calibration";

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

  const calibration = new CalibrationPanel(view);
  document.body.append(calibration.root);
  const toolbar = el<HTMLDivElement>("toolbar");

  let picker: HTMLSelectElement | null = null;
  const activate = (name: string): void => {
    const info = byName.get(name);
    if (!info) return;
    if (view.active && view.active.name !== name && !calibration.canLeave()) {
      if (picker) picker.value = view.active.name; // usuário cancelou: volta o seletor
      return;
    }
    view.show(info);
    savePref(ACTIVE_MAP_PREF, name);
    hud.textContent = "";
    void calibration.setMap(info);
  };

  picker = createMapPicker(toolbar, maps, initial.name, activate);
  const calibBtn = document.createElement("button");
  calibBtn.type = "button";
  calibBtn.className = "tool-btn";
  calibBtn.textContent = "Calibrar";
  calibBtn.setAttribute("aria-pressed", "false");
  calibBtn.addEventListener("click", () => {
    calibration.toggle();
    calibBtn.setAttribute("aria-pressed", String(calibration.isOpen));
  });
  toolbar.append(calibBtn);
  activate(initial.name);

  // Coordenada em pixel do zoom máximo sob o cursor (base da calibração e dos fixtures).
  view.leaflet.on("mousemove", (e) => {
    const p = view.toPixel(e.latlng);
    hud.textContent = `px ${Math.round(p.x)}, ${Math.round(p.y)}`;
  });

  // Exposto só para depuração no console do navegador.
  (window as unknown as { solaris?: unknown }).solaris = {
    view,
    calibration,
    mapData: { load: loadMapData, save: saveMapData, download: downloadMapData },
  };
}

start().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  const box = document.createElement("div");
  box.className = "fatal";
  box.textContent = msg;
  document.body.append(box);
  console.error(err);
});
