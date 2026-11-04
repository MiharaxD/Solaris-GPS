import L from "leaflet";
import type { MapInfo } from "./maps";
import type { MapView } from "./mapView";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Anotação gravada ao lado da imagem em tracker/fixtures/ (formato lido pelo runner da Fase 2). */
export interface FixtureAnnotation {
  version: 1;
  id: string;
  map: string;
  /** Posição real do jogador, em pixel do zoom máximo do mapa. */
  px: [number, number];
  /** Ícones de teleporte/Nexus visíveis no minimapa: 0, 1 ou 2 (= 2 ou mais). */
  icons: 0 | 1 | 2;
  /** Direção da seta em graus (0 = norte, sentido horário), se anotada. */
  direction?: number;
  notes?: string;
  image: string;
  width: number;
  height: number;
  source: "file" | "capture";
  createdAt: string;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const CLIENT = { "X-Solaris-Client": "web" };

async function put(name: string, body: Blob | string, type: string): Promise<string> {
  const res = await fetch(`/api/fixtures/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": type, ...CLIENT },
    body,
  });
  const out = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out.path ?? name;
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Modo "anotar fixture": abre um print de tela cheia, o usuário clica no mapa web onde estava e
 * grava imagem + anotação via API local. Capturar da tela compartilhada chega no ticket 17
 * (`setFrameSource`).
 */
export class FixturePanel {
  readonly root: HTMLElement;
  private open = false;
  private info: MapInfo | null = null;
  private image: { blob: Blob; width: number; height: number; source: "file" | "capture" } | null = null;
  private px: [number, number] | null = null;
  private previewUrl: string | null = null;
  private frameSource: (() => Promise<Blob | null>) | null = null;
  private readonly marker = L.circleMarker([0, 0], { radius: 9, className: "fx-pos", interactive: false });

  private readonly file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
  private readonly captureBtn = h("button", { type: "button", textContent: "Capturar da tela", disabled: true });
  private readonly preview = h("img", { className: "fx-preview", alt: "Print selecionado" });
  private readonly imgInfo = h("p", { className: "calib-hint" });
  private readonly posInfo = h("p", { className: "calib-hint" });
  private readonly icons = h("select", {});
  private readonly direction = h("input", { type: "number", min: "0", max: "359", step: "1", placeholder: "graus (opcional)" });
  private readonly notes = h("textarea", { rows: 2, placeholder: "Observações (ex.: cidade, noite, chuva)" });
  private readonly saveBtn = h("button", { type: "button", textContent: "Salvar fixture", disabled: true });
  private readonly status = h("p", { className: "calib-status", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly count = h("p", { className: "calib-hint" });

  constructor(private readonly view: MapView) {
    for (const [v, label] of [["0", "0"], ["1", "1"], ["2", "2 ou mais"]] as const) {
      this.icons.append(h("option", { value: v, textContent: label }));
    }
    this.icons.value = "1";
    const openBtn = h("button", { type: "button", textContent: "Abrir print…" });
    openBtn.addEventListener("click", () => this.file.click());
    this.file.addEventListener("change", () => {
      const f = this.file.files?.[0];
      this.file.value = "";
      if (f) void this.setImage(f, "file");
    });
    this.captureBtn.title = "Disponível quando o compartilhamento de tela existir (ticket 17)";
    this.captureBtn.addEventListener("click", () => void this.capture());
    this.saveBtn.addEventListener("click", () => void this.save());
    const close = h("button", { type: "button", className: "calib-close", textContent: "✕", title: "Fechar" });
    close.addEventListener("click", () => this.toggle(false));

    this.root = h(
      "aside",
      { className: "calib-panel fx-panel", hidden: true },
      h("header", {}, h("h2", { textContent: "Anotar fixture" }), close),
      h("p", {
        className: "calib-hint",
        textContent: "1) abra um print de tela cheia do jogo · 2) clique no mapa onde você estava · 3) preencha e salve. " +
          "Fica em tracker/fixtures/ (fora do git).",
      }),
      h("div", { className: "calib-actions" }, openBtn, this.captureBtn, this.file),
      this.preview,
      this.imgInfo,
      this.posInfo,
      h("label", { className: "calib-field" }, "Ícones de teleporte/Nexus visíveis no minimapa", this.icons),
      h("label", { className: "calib-field" }, "Direção da seta (0 = norte)", this.direction),
      h("label", { className: "calib-field" }, "Observações", this.notes),
      h("div", { className: "calib-actions" }, this.saveBtn),
      this.status,
      this.count,
    );
    this.preview.hidden = true;

    view.leaflet.on("click", (e) => {
      if (!this.open) return;
      const p = this.view.toPixel(e.latlng);
      this.px = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
      this.marker.setLatLng(e.latlng).addTo(this.view.leaflet);
      this.render();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.hidden = !this.open;
    this.view.leaflet.getContainer().classList.toggle("calibrating", this.open);
    if (this.open) {
      if (this.px) this.marker.addTo(this.view.leaflet);
      void this.refreshCount();
    } else {
      this.marker.remove();
    }
    this.render();
  }

  setMap(info: MapInfo): void {
    if (this.info && this.info.name !== info.name) {
      this.px = null;
      this.marker.remove();
    }
    this.info = info;
    this.render();
  }

  /** Ticket 17: quem tem a tela compartilhada fornece o frame atual. */
  setFrameSource(fn: (() => Promise<Blob | null>) | null): void {
    this.frameSource = fn;
    this.captureBtn.disabled = fn === null;
    this.captureBtn.title = fn ? "Usa o frame atual da tela compartilhada" : "Disponível quando o compartilhamento de tela existir (ticket 17)";
  }

  private async capture(): Promise<void> {
    const blob = await this.frameSource?.();
    if (blob) await this.setImage(blob, "capture");
    else this.status.textContent = "Não há frame da tela compartilhada.";
  }

  private async setImage(blob: Blob, source: "file" | "capture"): Promise<void> {
    if (!EXT[blob.type]) {
      this.status.textContent = "Use PNG, JPG ou WebP.";
      return;
    }
    try {
      const bmp = await createImageBitmap(blob);
      this.image = { blob, width: bmp.width, height: bmp.height, source };
      bmp.close();
    } catch {
      this.status.textContent = "Não consegui abrir a imagem.";
      return;
    }
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = URL.createObjectURL(blob);
    this.preview.src = this.previewUrl;
    this.preview.hidden = false;
    this.status.textContent = "";
    this.render();
  }

  private render(): void {
    const img = this.image;
    this.imgInfo.textContent = img ? `Imagem: ${img.width}×${img.height}${img.width !== 2560 ? " (a tela configurada é 2560×1440)" : ""}` : "Nenhum print aberto.";
    this.posInfo.textContent = this.px
      ? `Posição: px ${Math.round(this.px[0])}, ${Math.round(this.px[1])} em ${this.info?.name ?? "?"}`
      : "Clique no mapa onde você estava.";
    this.saveBtn.disabled = !(img && this.px && this.info);
  }

  private async refreshCount(): Promise<void> {
    try {
      const res = await fetch("/api/fixtures", { cache: "no-store" });
      const body = (await res.json()) as { fixtures?: unknown[] };
      const n = body.fixtures?.length ?? 0;
      this.count.textContent = `${n} fixture${n === 1 ? "" : "s"} em tracker/fixtures/.`;
    } catch {
      this.count.textContent = "";
    }
  }

  private async save(): Promise<void> {
    const img = this.image;
    const px = this.px;
    const info = this.info;
    if (!img || !px || !info) return;
    const created = new Date();
    const id = `${info.name}-${stamp(created)}`;
    const ext = EXT[img.blob.type]!;
    const ann: FixtureAnnotation = {
      version: 1,
      id,
      map: info.name,
      px,
      icons: Number(this.icons.value) as 0 | 1 | 2,
      image: `${id}.${ext}`,
      width: img.width,
      height: img.height,
      source: img.source,
      createdAt: created.toISOString(),
    };
    const dir = this.direction.valueAsNumber;
    if (Number.isFinite(dir)) ann.direction = ((Math.round(dir) % 360) + 360) % 360;
    if (this.notes.value.trim()) ann.notes = this.notes.value.trim().slice(0, 2000);
    this.saveBtn.disabled = true;
    try {
      await put(ann.image, img.blob, img.blob.type);
      const path = await put(`${id}.json`, JSON.stringify(ann), "application/json");
      this.status.textContent = `Salvo: ${path}.`;
      // próximo fixture: mantém o mapa, limpa imagem e posição
      this.image = null;
      this.px = null;
      this.marker.remove();
      this.preview.hidden = true;
      this.notes.value = "";
      this.direction.value = "";
      void this.refreshCount();
    } catch (e) {
      this.status.textContent = `Não salvou (${(e as Error).message}).`;
    }
    this.render();
  }
}
