import "leaflet/dist/leaflet.css";
// Fontes empacotadas pelo Vite (nada vem de CDN): Inter pra UI, Chakra Petch pros rótulos técnicos.
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/chakra-petch/latin-500.css";
import "@fontsource/chakra-petch/latin-600.css";
import "./style.css";
import { uiIcon, type UiIcon } from "./icons";
import { loadMaps, type MapInfo } from "./maps";
import { MapView } from "./mapView";
import { createMapPicker } from "./mapPicker";
import { loadPref, savePref } from "./storage";
import { downloadMapData, loadMapData, patchMapData, saveMapData } from "./mapData";
import { CalibrationPanel } from "./calibration";
import { FixturePanel } from "./fixturePanel";
import { TrackerPanel } from "./trackerPanel";
import { MarkerPanel } from "./markerPanel";
import { ProgressStore } from "./progress";
import { UndergroundLayer } from "./underground";

const ACTIVE_MAP_PREF = "activeMap";
const UNDERGROUND_PREF = "underground";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} não existe no index.html`);
  return node as T;
}

/** Botão da barra superior: glifo de sistema + rótulo técnico. */
function toolButton(label: string, icon: UiIcon, title?: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "tool-btn";
  b.append(uiIcon(icon, 15), label);
  if (title) b.title = title;
  b.setAttribute("aria-pressed", "false");
  return b;
}

function brand(): HTMLElement {
  const b = document.createElement("div");
  b.className = "brand";
  const sub = document.createElement("small");
  sub.textContent = "GPS";
  b.append(uiIcon("logo", 18), "Solaris", sub);
  return b;
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
  const fixtures = new FixturePanel(view);
  const tracker = new TrackerPanel(view);
  tracker.onSharingChange((on) => fixtures.setFrameSource(on ? () => tracker.grabPng() : null));
  const progress = await ProgressStore.open();
  const markers = new MarkerPanel(view, () => calibration.isOpen || fixtures.isOpen, progress, async (map, patch) => {
    const merged = await patchMapData(map, patch);
    calibration.mergeExternal(map, patch);
    markers.setMapData(map, merged);
  });
  markers.setMaps(maps);
  calibration.onData = (map, data) => markers.setMapData(map, data);
  document.body.append(calibration.root, fixtures.root, tracker.root, tracker.preview, markers.root);
  const toolbar = el<HTMLDivElement>("toolbar");
  const underground = new UndergroundLayer(view);

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
    void markers.setMap(info);
    fixtures.setMap(info);
    void tracker.setMap(info);
    void underground.setMap(info);
  };

  toolbar.append(brand());
  picker = createMapPicker(toolbar, maps, initial.name, activate);
  const markersBtn = toolButton("Marcadores", "markers");
  markersBtn.setAttribute("aria-pressed", String(markers.isOpen));
  markersBtn.addEventListener("click", () => {
    markers.toggle();
    markersBtn.setAttribute("aria-pressed", String(markers.isOpen));
  });
  toolbar.append(markersBtn);
  const ugBtn = toolButton("Subterrâneo", "layers", "Mostrar as cavernas e áreas subterrâneas por cima do mapa");
  ugBtn.hidden = true;
  ugBtn.addEventListener("click", () => {
    underground.toggle();
    ugBtn.setAttribute("aria-pressed", String(underground.isOn));
    savePref(UNDERGROUND_PREF, underground.isOn ? "1" : "0");
  });
  underground.onAvailability = (available) => (ugBtn.hidden = !available);
  underground.toggle(loadPref(UNDERGROUND_PREF) === "1");
  ugBtn.setAttribute("aria-pressed", String(underground.isOn));
  toolbar.append(ugBtn);
  const calibBtn = toolButton("Calibrar", "crosshair");
  const fixtureBtn = toolButton("Fixture", "camera", "Anotar um print de tela cheia com a posição real (pra testar o tracker)");
  // Calibrar e Fixture usam o clique no mapa: só um aberto por vez.
  const syncModes = () => {
    calibBtn.setAttribute("aria-pressed", String(calibration.isOpen));
    fixtureBtn.setAttribute("aria-pressed", String(fixtures.isOpen));
    trackerBtn.setAttribute("aria-pressed", String(tracker.isOpen));
  };
  calibBtn.addEventListener("click", () => {
    if (!calibration.isOpen && fixtures.isOpen) fixtures.toggle(false);
    if (!calibration.isOpen && tracker.isOpen) tracker.toggle(false);
    calibration.toggle();
    syncModes();
  });
  toolbar.append(calibBtn);
  fixtureBtn.addEventListener("click", () => {
    if (!fixtures.isOpen && calibration.isOpen) calibration.toggle(false);
    if (!fixtures.isOpen && tracker.isOpen) tracker.toggle(false);
    fixtures.toggle();
    syncModes();
  });
  toolbar.append(fixtureBtn);
  const trackerBtn = toolButton("Tracker", "radar", "Compartilhar a tela do jogo e recortar o minimapa");
  trackerBtn.addEventListener("click", () => {
    if (!tracker.isOpen) {
      if (calibration.isOpen) calibration.toggle(false);
      if (fixtures.isOpen) fixtures.toggle(false);
    }
    tracker.toggle();
    syncModes();
  });
  toolbar.append(trackerBtn);
  // os ✕ dos painéis fecham sem passar pelos botões
  for (const r of [calibration.root, fixtures.root, tracker.root]) new MutationObserver(syncModes).observe(r, { attributes: true, attributeFilter: ["hidden"] });
  activate(initial.name);
  // Os painéis da direita começam logo abaixo da barra, que pode quebrar em duas linhas.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--toolbar-h", `${toolbar.offsetHeight}px`);
  }).observe(toolbar);

  // Coordenada em pixel do zoom máximo sob o cursor (base da calibração e dos fixtures).
  view.leaflet.on("mousemove", (e) => {
    const p = view.toPixel(e.latlng);
    const label = document.createElement("span");
    label.className = "hud-label";
    label.textContent = "px";
    hud.replaceChildren(label, `${Math.round(p.x)} · ${Math.round(p.y)}`);
  });

  // Exposto só para depuração no console do navegador.
  (window as unknown as { solaris?: unknown }).solaris = {
    view,
    calibration,
    markers,
    progress,
    fixtures,
    tracker,
    underground,
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
