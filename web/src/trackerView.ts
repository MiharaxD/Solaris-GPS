/**
 * Jogador no mapa (ticket 25): seta girada pela direção, cor pela confiança, cinza quando o
 * rastreio está perdido, apagada quando pausado sem minimapa e tracejada quando é só um palpite.
 * Atrás dela, o cone de visão: pra onde a câmera olha (o mesmo setor claro do minimapa).
 * "Seguir" centraliza o mapa a cada posição; arrastar o mapa desliga.
 */
import L from "leaflet";
import type { MapView } from "./mapView";
import { loadPref, savePref } from "./storage";
import type { Confidence } from "./tracker/fuse";
import type { CameraView } from "./tracker/locate";

const FOLLOW_PREF = "tracker.follow";
/** Raio do cone no mapa, em px da tela. */
const CONE_R = 70;
/** Sem cone por mais que isso (ms), some do mapa; antes disso fica o último. */
const CONE_HOLD = 1000;

/** Ângulo `deg` levado pro mais perto de `prev` (±180), pra transição CSS não dar a volta. */
function unwrap(prev: number | null, deg: number): number {
  if (prev === null) return deg;
  return prev + ((((deg - prev) % 360) + 540) % 360) - 180;
}

/** Setor de `width` graus apontando pro norte, com centro em (c, c). */
function wedge(c: number, r: number, width: number): string {
  const h = ((width / 2) * Math.PI) / 180;
  const x = (r * Math.sin(h)).toFixed(1);
  const y = (r * Math.cos(h)).toFixed(1);
  return `M${c} ${c} L${c - Number(x)} ${c - Number(y)} A${r} ${r} 0 0 1 ${c + Number(x)} ${c - Number(y)} Z`;
}

export type PlayerLook = Confidence | "perdido" | "pausado" | "palpite";

export class TrackerView {
  private readonly arrow = document.createElement("div");
  private readonly cone = document.createElement("div");
  private arrowDeg: number | null = null;
  private coneDeg: number | null = null;
  private coneWidth = 0;
  private coneSeen = 0;
  private readonly marker: L.Marker;
  private follow = loadPref(FOLLOW_PREF) !== "0";
  private listeners = new Set<(on: boolean) => void>();

  constructor(private readonly view: MapView) {
    this.arrow.className = "trk-arrow";
    // seta apontando pro norte; gira pelo `transform` do próprio elemento
    this.arrow.innerHTML =
      '<svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true"><path d="M16 2 L27 28 L16 21 L5 28 Z"/></svg>';
    this.cone.className = "trk-cone";
    this.cone.hidden = true;
    const box = document.createElement("div");
    box.className = "trk-player-box";
    box.append(this.cone, this.arrow);
    const icon = L.divIcon({ html: box, className: "trk-player", iconSize: [32, 32], iconAnchor: [16, 16] });
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
    if (deg !== null) {
      this.arrowDeg = unwrap(this.arrowDeg, deg);
      this.arrow.style.transform = `rotate(${this.arrowDeg}deg)`;
    }
    this.arrow.dataset.look = look;
    this.cone.dataset.look = look;
    if (this.follow && look !== "palpite") this.view.leaflet.panTo(ll, { animate: true, duration: 0.25, noMoveStart: true });
  }

  /** Cone de visão da câmera; null = não achado neste frame (o último fica um pouco). */
  setCamera(cam: CameraView | null, now = performance.now()): void {
    if (!cam) {
      if (now - this.coneSeen > CONE_HOLD) this.cone.hidden = true;
      return;
    }
    this.coneSeen = now;
    this.cone.hidden = false;
    if (Math.abs(cam.width - this.coneWidth) > 3) {
      this.coneWidth = cam.width;
      const s = 2 * CONE_R;
      this.cone.innerHTML =
        `<svg viewBox="0 0 ${s} ${s}" width="${s}" height="${s}" aria-hidden="true">` +
        `<defs><radialGradient id="trk-cone-g" cx="${CONE_R}" cy="${CONE_R}" r="${CONE_R}" gradientUnits="userSpaceOnUse">` +
        '<stop offset="0" stop-color="#fff" stop-opacity="0.55"/><stop offset="1" stop-color="#fff" stop-opacity="0.05"/></radialGradient></defs>' +
        `<path d="${wedge(CONE_R, CONE_R, cam.width)}" fill="url(#trk-cone-g)"/></svg>`;
    }
    this.coneDeg = unwrap(this.coneDeg, cam.deg);
    this.cone.style.transform = `rotate(${this.coneDeg}deg)`;
  }

  hide(): void {
    this.marker.remove();
  }
}
