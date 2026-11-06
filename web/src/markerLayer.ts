import L from "leaflet";
import { markerSprite, type MarkerIcon } from "./icons";

/** Um marcador já convertido pra pixel do zoom máximo. */
export interface PlacedItem<T> {
  data: T;
  px: number;
  py: number;
  color: string;
  icon: MarkerIcon;
  /** Meio-lado do ícone em px de tela, no zoom nativo. */
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
    // longe do zoom nativo os ícones encolhem (até 55%) pra não virar uma massa só
    const k = Math.min(1.15, Math.max(0.55, 1 + 0.1 * (zoom - this.maxZoom())));
    const drawn: typeof this.drawn = [];
    const redraw = () => this.schedule();
    ctx.imageSmoothingQuality = "high";
    for (const item of this.items) {
      const x = item.px * scale - ox;
      const y = item.py * scale - oy;
      const r = item.size * k;
      if (x < -r || y < -r || x > size.x + r || y > size.y + r) continue;
      ctx.globalAlpha = item.dim ? 0.35 : 1;
      const sprite = markerSprite(item.icon, item.color, redraw);
      if (sprite) {
        ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
      } else {
        // o SVG ainda está decodificando: um ponto na cor até o próximo quadro
        ctx.beginPath();
        ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = item.color;
        ctx.fill();
      }
      drawn.push({ item, x, y, r: r * 0.8 });
    }
    ctx.globalAlpha = 1;
    const hl = this.highlight;
    if (hl) {
      const x = hl.px * scale - ox;
      const y = hl.py * scale - oy;
      const r = hl.size * k + 5;
      // seleção: anel branco com quatro cantos técnicos, como o foco da UI do jogo
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#FFFFFF";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      const c = r + 5;
      const t = 5;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
        ctx.moveTo(x + sx * c, y + sy * (c - t));
        ctx.lineTo(x + sx * c, y + sy * c);
        ctx.lineTo(x + sx * (c - t), y + sy * c);
      }
      ctx.stroke();
    }
    this.drawn = drawn;
  }
}
