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
import { Hotkeys } from "./hotkeys";
import { SettingsDialog } from "./settingsDialog";
import { RegionPicker } from "./regionPicker";
import { markerTitle, type GameMarker } from "./markers";
import { toast } from "./toast";
import L from "leaflet";

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

  // dois grupos: marca + seletores e os botões; em tela estreita viram duas linhas alinhadas
  const tbMain = document.createElement("div");
  tbMain.className = "tb-main";
  const tbTools = document.createElement("div");
  tbTools.className = "tb-tools";
  toolbar.append(tbMain, tbTools);
  tbMain.append(brand());
  picker = createMapPicker(tbMain, maps, initial.name, activate);

  // Região onde o jogador está (Overworld): limita a busca do tracker e enquadra a região.
  const regionPicker = new RegionPicker((region, byUser) => {
    tracker.setSearchArea(region?.rect ?? null);
    if (!byUser) return;
    if (region) {
      const r = region.rect;
      view.leaflet.flyToBounds(L.latLngBounds(view.toLatLng({ x: r.x0, y: r.y0 }), view.toLatLng({ x: r.x1, y: r.y1 })), { duration: 0.6 });
    }
    const rescanned = tracker.rescan();
    toast(region ? `Tracker procurando só em ${region.label}${rescanned ? "" : " (quando estiver rastreando)"}.` : "Tracker procurando no mapa inteiro.");
  });
  picker.after(regionPicker.root);
  markers.onRegions((regions) => regionPicker.setRegions(view.active?.name ?? "", regions));
  const markersBtn = toolButton("Marcadores", "markers");
  markersBtn.setAttribute("aria-pressed", String(markers.isOpen));
  markersBtn.addEventListener("click", () => {
    markers.toggle();
    markersBtn.setAttribute("aria-pressed", String(markers.isOpen));
  });
  tbTools.append(markersBtn);
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
  tbTools.append(ugBtn);
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
  tbTools.append(calibBtn);
  fixtureBtn.addEventListener("click", () => {
    if (!fixtures.isOpen && calibration.isOpen) calibration.toggle(false);
    if (!fixtures.isOpen && tracker.isOpen) tracker.toggle(false);
    fixtures.toggle();
    syncModes();
  });
  tbTools.append(fixtureBtn);
  const trackerBtn = toolButton("Tracker", "radar", "Compartilhar a tela do jogo e recortar o minimapa");
  trackerBtn.addEventListener("click", () => {
    if (!tracker.isOpen) {
      if (calibration.isOpen) calibration.toggle(false);
      if (fixtures.isOpen) fixtures.toggle(false);
    }
    tracker.toggle();
    syncModes();
  });
  tbTools.append(trackerBtn);
  // Atalhos do mapa e configurações (backup, esconder coletados, teclas).
  const describe = markerTitle;
  const collect = async () => {
    const m = await markers.collectNearest();
    if (m) toast(`Coletado: ${describe(m)}${hotkeys.label("undo") ? ` · ${hotkeys.label("undo")} desfaz` : ""}`);
    else toast("Nenhum marcador visível perto do jogador (o tracker está rastreando?).", "warn");
  };
  const hotkeys: Hotkeys = new Hotkeys({
    collect: () => void collect(),
    undo: () =>
      void markers.undoLast().then((m) => toast(m ? `Desfeito: ${describe(m)}` : "Nada pra desfazer.", m ? "ok" : "warn")),
    follow: () => {
      tracker.toggleFollow();
      toast(tracker.following ? "Seguindo o jogador." : "Parou de seguir.");
    },
    rescan: () => {
      if (tracker.rescan()) toast("Procurando o jogador…");
      else toast("O tracker não está rastreando (compartilhe a tela no painel Tracker).", "warn");
    },
  });
  tracker.onCollect = () => void collect();
  tracker.onPlayer((px) => markers.setPlayer(px));
  let nearest: GameMarker | null = null;
  const syncNearest = () => tracker.setNearest(nearest, hotkeys.label("collect"));
  markers.onNearest((m) => {
    nearest = m;
    syncNearest();
  });
  hotkeys.onChange(syncNearest);
  const settings = new SettingsDialog(markers, hotkeys);
  const settingsBtn = toolButton("Config.", "gear", "Configurações: backup, esconder coletados e atalhos");
  settingsBtn.addEventListener("click", () => settings.open());
  tbTools.append(settingsBtn);

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
    hotkeys,
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
