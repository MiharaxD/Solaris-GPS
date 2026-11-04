import "leaflet/dist/leaflet.css";
import "./style.css";
import { loadMaps } from "./maps";
import { MapView } from "./mapView";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} não existe no index.html`);
  return node as T;
}

async function start(): Promise<void> {
  const hud = el<HTMLDivElement>("hud");
  const view = new MapView(el<HTMLDivElement>("map"));

  const maps = await loadMaps();
  const first = maps[0];
  if (!first) return;
  view.show(first);

  // Coordenada em pixel do zoom máximo sob o cursor (base da calibração e dos fixtures).
  view.leaflet.on("mousemove", (e) => {
    const p = view.toPixel(e.latlng);
    hud.textContent = `${view.active?.name ?? ""}  px ${Math.round(p.x)}, ${Math.round(p.y)}`;
  });
}

start().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  document.body.insertAdjacentHTML("beforeend", `<div class="fatal"></div>`);
  const box = document.querySelector<HTMLDivElement>(".fatal");
  if (box) box.textContent = msg;
  console.error(err);
});
