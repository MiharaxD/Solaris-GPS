import L from "leaflet";
import { loadMapData, minimapScaleOf, patchMapData, type MinimapScale } from "./mapData";
import type { MapInfo } from "./maps";
import type { MapView } from "./mapView";
import { median, type ScaleSample, type ScaleSweep } from "./tracker/scale";
import type { ScaleRequest, ScaleResponse } from "./tracker/scaleWorker";
import { loadRegion } from "./trackerPanel";

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

/** Medições guardadas por mapa (a escala salva é a mediana). */
const MAX_SAMPLES = 15;

/**
 * Modo "anotar fixture": abre um print de tela cheia, o usuário clica no mapa web onde estava e
 * grava imagem + anotação via API local (ou captura o frame da tela compartilhada). Com print e
 * posição, também mede a escala minimapa→mapa (ticket 18) e grava em data/maps/<name>.json.
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

  private scaleWorker: Worker | null = null;
  private measuring = false;
  private sweep: ScaleSweep | null = null;
  private savedScale: MinimapScale | null = null;
  private readonly measureBtn = h("button", { type: "button", className: "secondary", textContent: "Medir escala", disabled: true });
  private readonly saveScaleBtn = h("button", { type: "button", textContent: "Salvar escala", disabled: true });
  private readonly resetScaleBtn = h("button", { type: "button", className: "link", textContent: "zerar medições" });
  private readonly scaleInfo = h("span", {});
  private readonly scaleResult = h("p", { className: "calib-status", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly plot = h("canvas", { className: "fx-plot", width: 560, height: 160 });

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
    this.measureBtn.addEventListener("click", () => void this.measure());
    this.saveScaleBtn.addEventListener("click", () => void this.saveScale(false));
    this.resetScaleBtn.addEventListener("click", () => void this.saveScale(true));
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
      h("h3", { textContent: "Escala do minimapa" }),
      h("p", {
        className: "calib-hint",
        textContent: "Com um print aberto e a posição marcada, testa vários tamanhos do minimapa sobre o mapa e mostra o casamento (NCC) de cada um. " +
          "Salve 3 ou mais medições boas: vale a mediana.",
      }),
      h("div", { className: "calib-actions" }, this.measureBtn, this.saveScaleBtn),
      this.plot,
      this.scaleResult,
      h("p", { className: "calib-hint" }, this.scaleInfo, " ", this.resetScaleBtn),
    );
    this.preview.hidden = true;
    this.plot.hidden = true;

    view.leaflet.on("click", (e) => {
      if (!this.open) return;
      const p = this.view.toPixel(e.latlng);
      this.px = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
      this.clearSweep();
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
      void this.refreshScale();
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
    const changed = this.info?.name !== info.name;
    this.info = info;
    if (changed) {
      this.clearSweep();
      this.savedScale = null;
      if (this.open) void this.refreshScale();
    }
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
    this.clearSweep();
    this.render();
  }

  private render(): void {
    const img = this.image;
    this.imgInfo.textContent = img ? `Imagem: ${img.width}×${img.height}${img.width !== 2560 ? " (a tela configurada é 2560×1440)" : ""}` : "Nenhum print aberto.";
    this.posInfo.textContent = this.px
      ? `Posição: px ${Math.round(this.px[0])}, ${Math.round(this.px[1])} em ${this.info?.name ?? "?"}`
      : "Clique no mapa onde você estava.";
    this.saveBtn.disabled = !(img && this.px && this.info);
    this.measureBtn.disabled = this.measuring || !(img && this.px && this.info);
    this.measureBtn.textContent = this.measuring ? "Medindo…" : "Medir escala";
    this.saveScaleBtn.disabled = this.measuring || !this.sweep?.best;
    const sv = this.savedScale;
    const n = sv?.samples.length ?? 0;
    this.scaleInfo.textContent = sv
      ? `Salvo em ${this.info?.name ?? "?"}: raio ${sv.radiusPx.toFixed(1)} px (${n} ${n === 1 ? "medição" : "medições"}).`
      : `Sem escala salva em ${this.info?.name ?? "?"}.`;
    this.resetScaleBtn.hidden = !sv;
  }

  private clearSweep(): void {
    this.sweep = null;
    this.plot.hidden = true;
    this.scaleResult.textContent = "";
  }

  private async refreshScale(): Promise<void> {
    const name = this.info?.name;
    if (!name) return;
    try {
      const sv = minimapScaleOf(await loadMapData(name));
      if (this.info?.name === name) this.savedScale = sv;
    } catch {
      /* API indisponível: só não mostra o valor salvo */
    }
    this.render();
  }

  private async measure(): Promise<void> {
    const img = this.image;
    const px = this.px;
    const info = this.info;
    if (!img || !px || !info || this.measuring) return;
    this.measuring = true;
    this.clearSweep();
    this.scaleResult.textContent = "Medindo (alguns segundos)…";
    this.render();
    try {
      const bitmap = await createImageBitmap(img.blob);
      const saved = loadRegion(bitmap.width, bitmap.height);
      const req: ScaleRequest = {
        bitmap,
        info,
        px,
        region: saved && !saved.auto ? { cx: saved.cx, cy: saved.cy, r: saved.r, shape: saved.shape } : null,
        center: this.savedScale?.radiusPx,
      };
      this.scaleWorker ??= new Worker(new URL("./tracker/scaleWorker.ts", import.meta.url), { type: "module" });
      const worker = this.scaleWorker;
      const res = await new Promise<ScaleResponse>((resolve) => {
        worker.onmessage = (ev: MessageEvent<ScaleResponse>) => resolve(ev.data);
        worker.onerror = (ev) => resolve({ ok: false, message: ev.message || "erro no Worker" });
        worker.postMessage(req, [bitmap]);
      });
      if (!res.ok) throw new Error(res.message);
      if (this.px !== px || this.image !== img) return; // mudou no meio
      this.sweep = res.sweep;
      this.showSweep(res.sweep, res.r, res.ms);
    } catch (e) {
      this.scaleResult.textContent = `Não mediu (${(e as Error).message}).`;
    } finally {
      this.measuring = false;
      this.render();
    }
  }

  private showSweep(sw: ScaleSweep, r: number, ms: number): void {
    const b = sw.best;
    if (!b) {
      this.scaleResult.textContent = "Nenhuma escala casou.";
      return;
    }
    const notes: string[] = [];
    if (b.score < 0.5) notes.push("casamento fraco: confira a posição ou use outro print");
    const sv = this.savedScale?.radiusPx;
    if (sv && Math.abs(b.radiusPx / sv - 1) > 0.08) notes.push(`longe do salvo (${sv.toFixed(1)})`);
    this.scaleResult.textContent =
      `Raio ${b.radiusPx.toFixed(1)} px do mapa (minimapa com raio ${r.toFixed(0)} px na tela: ${(b.radiusPx / r).toFixed(3)} px do mapa por px). ` +
      `NCC ${b.score.toFixed(2)}; casou a (${b.dx.toFixed(0)}, ${b.dy.toFixed(0)}) px da posição marcada. ${(ms / 1000).toFixed(1)} s.` +
      (notes.length ? ` ⚠ ${notes.join("; ")}.` : "");
    this.drawPlot(sw.samples, b.radiusPx, sv);
  }

  /** NCC × raio (escala log): passada grossa em cinza, fina em amarelo; tracejado = salvo. */
  private drawPlot(samples: ScaleSample[], best: number, saved: number | undefined): void {
    const cv = this.plot;
    const ctx = cv.getContext("2d");
    if (!ctx || samples.length === 0) return;
    cv.hidden = false;
    const W = cv.width;
    const H = cv.height;
    const pad = { l: 40, r: 10, t: 10, b: 26 };
    const lr = samples.map((s) => Math.log(s.radiusPx));
    const x0 = Math.min(...lr);
    const x1 = Math.max(...lr);
    const ys = samples.map((s) => s.score);
    const y0 = Math.min(0, ...ys);
    const y1 = Math.max(...ys, 0.1);
    const X = (r: number) => pad.l + ((Math.log(r) - x0) / (x1 - x0 || 1)) * (W - pad.l - pad.r);
    const Y = (v: number) => H - pad.b - ((v - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
    const css = getComputedStyle(this.root);
    const muted = css.getPropertyValue("--muted").trim() || "#9fb0bc";
    const accent = css.getPropertyValue("--accent").trim() || "#f5c542";
    const vline = (x: number, color: string, dash: number[]) => {
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X(x), pad.t);
      ctx.lineTo(X(x), H - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    const curve = (list: ScaleSample[], color: string, width: number) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      list.forEach((s, i) => (i ? ctx.lineTo(X(s.radiusPx), Y(s.score)) : ctx.moveTo(X(s.radiusPx), Y(s.score))));
      ctx.stroke();
    };
    ctx.clearRect(0, 0, W, H);
    ctx.font = "16px system-ui, sans-serif";
    ctx.fillStyle = muted;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(0));
    ctx.lineTo(W - pad.r, Y(0));
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.fillText(y1.toFixed(1), pad.l - 6, Y(y1) + 6);
    ctx.fillText("0", pad.l - 6, Y(0) + 6);
    ctx.textAlign = "center";
    for (const t of [Math.exp(x0), best, Math.exp(x1)]) ctx.fillText(t.toFixed(0), X(t), H - 6);
    if (saved && saved >= Math.exp(x0) && saved <= Math.exp(x1)) vline(saved, muted, [6, 4]);
    vline(best, accent, []);
    curve(samples.filter((s) => s.pass === "coarse"), muted, 2);
    curve(samples.filter((s) => s.pass === "fine"), accent, 3);
  }

  /** Acrescenta a medição atual às salvas (ou zera) e grava a mediana em data/maps. */
  private async saveScale(reset: boolean): Promise<void> {
    const info = this.info;
    const b = this.sweep?.best;
    if (!info || (!reset && !b)) return;
    if (reset && !window.confirm(`Apagar a escala salva de ${info.name}?`)) return;
    try {
      const fresh = minimapScaleOf(await loadMapData(info.name));
      const samples = reset || !b ? [] : [...(fresh?.samples ?? []), Math.round(b.radiusPx * 10) / 10].slice(-MAX_SAMPLES);
      const radiusPx = median(samples);
      const minimapScale = radiusPx === null ? undefined : { radiusPx: Math.round(radiusPx * 10) / 10, samples };
      await patchMapData(info.name, { minimapScale });
      this.savedScale = minimapScale ?? null;
      this.sweep = null;
      this.scaleResult.textContent = reset ? "Medições apagadas." : `Salvo em data/maps/${info.name}.json.`;
    } catch (e) {
      this.scaleResult.textContent = `Não salvou (${(e as Error).message}).`;
    }
    this.render();
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
