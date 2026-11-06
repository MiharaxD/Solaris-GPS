/**
 * Jogador no mapa (ticket 25): seta girada pela direção, cor pela confiança, cinza quando o
 * rastreio está perdido, apagada quando pausado sem minimapa e tracejada quando é só um palpite.
 * "Seguir" centraliza o mapa a cada posição; arrastar o mapa desliga.
 */
import L from "leaflet";
import type { MapView } from "./mapView";
import { loadPref, savePref } from "./storage";
import type { Confidence } from "./tracker/fuse";

const FOLLOW_PREF = "tracker.follow";

export type PlayerLook = Confidence | "perdido" | "pausado" | "palpite";

export class TrackerView {
  private readonly arrow = document.createElement("div");
  private readonly marker: L.Marker;
  private follow = loadPref(FOLLOW_PREF) !== "0";
  private listeners = new Set<(on: boolean) => void>();

  constructor(private readonly view: MapView) {
    this.arrow.className = "trk-arrow";
    // seta apontando pro norte; gira pelo `transform` do próprio elemento
    this.arrow.innerHTML =
      '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><path d="M16 2 L27 28 L16 21 L5 28 Z"/></svg>';
    const icon = L.divIcon({ html: this.arrow, className: "trk-player", iconSize: [32, 32], iconAnchor: [16, 16] });
    this.marker = L.marker([0, 0], { icon, interactive: false, keyboard: false, zIndexOffset: 1000 });
    view.leaflet.on("dragstart", () => this.setFollow(false));
  }

  get following(): boolean {
    return this.follow;
  }

  onFollowChange(fn: (on: boolean) => void): void {
    this.listeners.add(fn);
  }

  setFollow(on: boolean): void {
    if (on === this.follow) return;
    this.follow = on;
    savePref(FOLLOW_PREF, on ? "1" : "0");
    for (const fn of this.listeners) fn(on);
    if (on && this.view.leaflet.hasLayer(this.marker)) this.view.leaflet.panTo(this.marker.getLatLng(), { animate: true, duration: 0.3 });
  }

  /** `deg` = direção (0 = norte, horário); null mantém a anterior. */
  show(px: [number, number], deg: number | null, look: PlayerLook): void {
    const ll = this.view.toLatLng({ x: px[0], y: px[1] });
    this.marker.setLatLng(ll);
    if (!this.view.leaflet.hasLayer(this.marker)) this.marker.addTo(this.view.leaflet);
    if (deg !== null) this.arrow.style.transform = `rotate(${deg}deg)`;
    this.arrow.dataset.look = look;
    if (this.follow && look !== "palpite") this.view.leaflet.panTo(ll, { animate: true, duration: 0.25, noMoveStart: true });
  }

  hide(): void {
    this.marker.remove();
  }
}
