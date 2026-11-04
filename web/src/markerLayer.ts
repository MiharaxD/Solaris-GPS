import L from "leaflet";
import type { Shape } from "./markers";

/** Um marcador já convertido pra pixel do zoom máximo. */
export interface PlacedItem<T> {
  data: T;
  px: number;
  py: number;
  color: string;
  shape: Shape;
  /** Raio base em px de tela, no zoom nativo. */
  size: number;
  /** Desenhado apagado (ex.: já encontrado). */
  dim?: boolean;
}

const PANE = "solaris-markers";

/**
 * Desenha milhares de marcadores num único canvas (DOM por marcador não aguenta o Overworld).
 * O canvas fica num pane próprio, recomposto a cada movimento; durante a animação de zoom fica
 * escondido e é redesenhado no fim.
 */
export class MarkerCanvasLayer<T> extends L.Layer {
  private readonly canvas = document.createElement("canvas");
  private items: PlacedItem<T>[] = [];
  private drawn: { item: PlacedItem<T>; x: number; y: number; r: number }[] = [];
  private highlight: PlacedItem<T> | null = null;
  private frame = 0;
  private lmap: L.Map | null = null;

  constructor(private readonly maxZoom: () => number) {
    super();
    this.canvas.className = "marker-canvas";
  }

  setItems(items: PlacedItem<T>[]): void {
    this.items = items;
    if (this.highlight && !items.includes(this.highlight)) this.highlight = null;
    this.schedule();
  }

  setHighlight(item: PlacedItem<T> | null): void {
    this.highlight = item;
    this.schedule();
  }

  override onAdd(map: L.Map): this {
    this.lmap = map;
    const pane = map.getPane(PANE) ?? map.createPane(PANE);
    pane.append(this.canvas);
    map.on("move zoom resize viewreset", this.schedule, this);
    map.on("zoomanim", this.hide, this);
    map.on("zoomend", this.show, this);
    this.redraw();
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off("move zoom resize viewreset", this.schedule, this);
    map.off("zoomanim", this.hide, this);
    map.off("zoomend", this.show, this);
    this.canvas.remove();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lmap = null;
    return this;
  }

  /** O item desenhado sob um ponto da tela (container), ou null. */
  hitTest(p: L.Point): PlacedItem<T> | null {
    for (let i = this.drawn.length - 1; i >= 0; i--) {
      const d = this.drawn[i]!;
      const dx = d.x - p.x;
      const dy = d.y - p.y;
      if (dx * dx + dy * dy <= (d.r + 4) ** 2) return d.item;
    }
    return null;
  }

  private hide(): void {
    this.canvas.style.visibility = "hidden";
  }

  private show(): void {
    this.canvas.style.visibility = "";
    this.schedule();
  }

  private schedule(): void {
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.redraw();
      });
    }
  }

  private redraw(): void {
    const map = this.lmap;
    if (!map) return;
    const size = map.getSize();
    const dpr = window.devicePixelRatio || 1;
    const c = this.canvas;
    if (c.width !== Math.round(size.x * dpr) || c.height !== Math.round(size.y * dpr)) {
      c.width = Math.round(size.x * dpr);
      c.height = Math.round(size.y * dpr);
      c.style.width = `${size.x}px`;
      c.style.height = `${size.y}px`;
    }
    // O pane anda com o mapa; o canvas volta pro canto da tela a cada desenho.
    const tl = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(c, tl);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.x, size.y);

    const zoom = map.getZoom();
    const scale = map.getZoomScale(zoom, this.maxZoom());
    const origin = map.getPixelOrigin();
    const ox = origin.x + tl.x;
    const oy = origin.y + tl.y;
    const k = Math.min(1.25, Math.max(0.6, 1 + 0.12 * (zoom - this.maxZoom())));
    const drawn: typeof this.drawn = [];
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    for (const item of this.items) {
      const x = item.px * scale - ox;
      const y = item.py * scale - oy;
      const r = item.size * k;
      if (x < -r || y < -r || x > size.x + r || y > size.y + r) continue;
      ctx.globalAlpha = item.dim ? 0.3 : 1;
      ctx.fillStyle = item.color;
      drawShape(ctx, item.shape, x, y, r);
      ctx.fill();
      ctx.stroke();
      drawn.push({ item, x, y, r });
    }
    ctx.globalAlpha = 1;
    const hl = this.highlight;
    if (hl) {
      const x = hl.px * scale - ox;
      const y = hl.py * scale - oy;
      ctx.beginPath();
      ctx.arc(x, y, hl.size * k + 6, 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#f5c542";
      ctx.stroke();
    }
    this.drawn = drawn;
  }
}

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, r: number): void {
  ctx.beginPath();
  switch (shape) {
    case "diamond":
      ctx.moveTo(x, y - r * 1.25);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r * 1.25);
      ctx.lineTo(x - r, y);
      break;
    case "hexagon":
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
      }
      break;
    case "square":
      ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
      return;
    case "triangle":
      ctx.moveTo(x, y - r * 1.15);
      ctx.lineTo(x + r, y + r * 0.75);
      ctx.lineTo(x - r, y + r * 0.75);
      break;
    case "circle":
      ctx.arc(x, y, r, 0, Math.PI * 2);
      return;
  }
  ctx.closePath();
}
