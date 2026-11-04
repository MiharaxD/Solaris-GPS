import L from "leaflet";
import type { MapInfo } from "./maps";

/** Quantos zooms acima do nativo o usuário pode ir (upscale das tiles). */
const EXTRA_ZOOM = 2;

/** Pixel do zoom máximo do mapa (px = coluna*512 + u, py = linha*512 + v). */
export interface MapPixel {
  x: number;
  y: number;
}

/**
 * Um mapa Leaflet (CRS.Simple) que exibe um MapInfo de cada vez.
 * Toda conversão pixel↔latlng passa por aqui, sempre no zoom máximo do mapa ativo.
 */
export class MapView {
  readonly leaflet: L.Map;
  private layer: L.TileLayer | null = null;
  private current: MapInfo | null = null;

  constructor(container: HTMLElement) {
    this.leaflet = L.map(container, {
      crs: L.CRS.Simple,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 90,
      attributionControl: false,
      maxBoundsViscosity: 0.8,
    });
  }

  get active(): MapInfo | null {
    return this.current;
  }

  show(info: MapInfo): void {
    const map = this.leaflet;
    if (this.layer) map.removeLayer(this.layer);
    this.current = info;

    const bounds = this.pixelBoundsToLatLng(info);
    this.layer = L.tileLayer(`/tiles/${info.name}/{z}/{y}_{x}.webp`, {
      tileSize: info.tileSize,
      minZoom: info.minZoom,
      maxNativeZoom: info.maxZoom,
      maxZoom: info.maxZoom + EXTRA_ZOOM,
      noWrap: true,
      bounds, // evita pedir tiles fora da grade (sem 404)
      keepBuffer: 4,
    });
    this.layer.addTo(map);

    map.setMinZoom(info.minZoom);
    map.setMaxZoom(info.maxZoom + EXTRA_ZOOM);
    map.setMaxBounds(bounds.pad(0.15));
    map.fitBounds(bounds);
  }

  toLatLng(p: MapPixel): L.LatLng {
    const info = this.requireActive();
    return this.leaflet.unproject([p.x, p.y], info.maxZoom);
  }

  toPixel(latlng: L.LatLngExpression): MapPixel {
    const info = this.requireActive();
    const p = this.leaflet.project(latlng, info.maxZoom);
    return { x: p.x, y: p.y };
  }

  private pixelBoundsToLatLng(info: MapInfo): L.LatLngBounds {
    const { x0, y0, x1, y1 } = info.bounds;
    return L.latLngBounds(
      this.leaflet.unproject([x0, y1], info.maxZoom),
      this.leaflet.unproject([x1, y0], info.maxZoom),
    );
  }

  private requireActive(): MapInfo {
    if (!this.current) throw new Error("Nenhum mapa ativo");
    return this.current;
  }
}
