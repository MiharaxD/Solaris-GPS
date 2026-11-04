/**
 * Compartilhar tela (getDisplayMedia) + recorte do minimapa. Os frames vão pro Web Worker do
 * tracker; nada sai do PC. O ajuste do recorte fica salvo por resolução no localStorage, com
 * padrão vindo do config.json.
 */
import { CONFIG } from "./config";
import type { MinimapRegion, MinimapShape } from "./tracker/minimap";
import { scaleRegion } from "./tracker/minimap";
import type { FromWorker, ToWorker } from "./tracker/protocol";
import { loadPref, savePref } from "./storage";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Frequência dos frames enquanto só recorta (o rastreio ao vivo, ticket 25, mede e ajusta). */
const FPS = 4;

interface SavedRegion extends MinimapRegion {
  /** true = veio da detecção automática (redetecta se a resolução mudar). */
  auto: boolean;
}

const prefKey = (w: number, h: number) => `minimap.${w}x${h}`;

function loadRegion(w: number, h: number): SavedRegion | null {
  try {
    const v = JSON.parse(loadPref(prefKey(w, h)) ?? "null") as Partial<SavedRegion> | null;
    if (v && [v.cx, v.cy, v.r].every((n) => typeof n === "number" && Number.isFinite(n)) && (v.shape === "circle" || v.shape === "square")) {
      return v as SavedRegion;
    }
  } catch {
    /* sem ajuste salvo */
  }
  return null;
}

/** Padrão do config.json (definido em 2560×1440 de referência), escalado pro frame. */
function configRegion(h: number): MinimapRegion | null {
  const m = CONFIG.minimap;
  if (m.centerX === null || m.centerY === null || m.radius === null) return null;
  return scaleRegion({ cx: m.centerX, cy: m.centerY, r: m.radius, shape: m.shape }, CONFIG.screen.height, h);
}

export class TrackerPanel {
  readonly root: HTMLElement;
  readonly preview: HTMLElement;
  private stream: MediaStream | null = null;
  private readonly video = h("video", { muted: true, playsInline: true });
  private worker: Worker | null = null;
  private seq = 0;
  private busy = false;
  private timer = 0;
  private region: SavedRegion | null = null;
  private frameSize: { w: number; h: number } | null = null;
  private wantDetect = false;
  private shape: MinimapShape = CONFIG.minimap.shape;
  private listeners = new Set<(sharing: boolean) => void>();

  private readonly status = h("p", { className: "calib-status", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly startBtn = h("button", { type: "button", textContent: "Compartilhar tela" });
  private readonly detectBtn = h("button", { type: "button", className: "secondary", textContent: "Detectar minimapa", disabled: true });
  private readonly cx = h("input", { type: "number", step: "1" });
  private readonly cy = h("input", { type: "number", step: "1" });
  private readonly r = h("input", { type: "number", step: "1", min: "10" });
  private readonly shapeSel = h("select", {});
  private readonly canvas = h("canvas", { width: 180, height: 180 });
  private readonly stats = h("div", { className: "trk-stats" });

  constructor() {
    this.shapeSel.append(h("option", { value: "circle", textContent: "Circular" }), h("option", { value: "square", textContent: "Quadrado" }));
    this.shapeSel.value = this.shape;
    this.startBtn.addEventListener("click", () => void (this.stream ? this.stop() : this.start()));
    this.detectBtn.addEventListener("click", () => {
      this.wantDetect = true;
      this.status.textContent = "Procurando o minimapa…";
    });
    for (const el of [this.cx, this.cy, this.r]) el.addEventListener("change", () => this.manualEdit());
    this.shapeSel.addEventListener("change", () => {
      this.shape = this.shapeSel.value as MinimapShape;
      this.manualEdit();
    });
    const close = h("button", { type: "button", className: "calib-close", textContent: "✕", title: "Fechar" });
    close.addEventListener("click", () => {
      this.root.hidden = true;
    });

    this.root = h(
      "aside",
      { className: "calib-panel trk-panel", hidden: true },
      h("header", {}, h("h2", { textContent: "Tracker" }), close),
      h("p", {
        className: "calib-hint",
        textContent:
          "Escolha a janela do jogo (ou a tela, se o jogo estiver em tela cheia sem bordas). O app só lê a imagem, " +
          "como uma gravação; nada sai do PC.",
      }),
      h("div", { className: "calib-actions" }, this.startBtn, this.detectBtn),
      h("p", { className: "calib-hint", textContent: "Recorte do minimapa (pixels do frame):" }),
      h("div", { className: "trk-grid" },
        h("label", {}, "centro X", this.cx), h("label", {}, "centro Y", this.cy),
        h("label", {}, "raio", this.r), h("label", {}, "formato", this.shapeSel)),
      this.status,
    );
    this.preview = h("div", { className: "trk-preview", hidden: true }, this.canvas, this.stats);
    this.renderInputs();
  }

  get sharing(): boolean {
    return this.stream !== null;
  }

  onSharingChange(fn: (sharing: boolean) => void): void {
    this.listeners.add(fn);
  }

  toggle(force?: boolean): void {
    this.root.hidden = !(force ?? this.root.hidden);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Frame atual inteiro em PNG (pro modo anotar fixture). */
  async grabPng(): Promise<Blob | null> {
    if (!this.stream || !this.video.videoWidth) return null;
    const c = h("canvas", { width: this.video.videoWidth, height: this.video.videoHeight });
    c.getContext("2d")!.drawImage(this.video, 0, 0);
    return new Promise((r) => c.toBlob(r, "image/png"));
  }

  private async start(): Promise<void> {
    try {
      // Só vídeo, sem áudio nem cursor: o app lê a imagem como uma gravação de tela.
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, cursor: "never" } as MediaTrackConstraints,
        audio: false,
      });
    } catch (e) {
      this.status.textContent = `Compartilhamento cancelado (${(e as Error).message}).`;
      return;
    }
    const track = this.stream.getVideoTracks()[0];
    track?.addEventListener("ended", () => this.stop());
    this.video.srcObject = this.stream;
    await this.video.play();
    this.worker = new Worker(new URL("./tracker/worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onResult(ev.data);
    this.startBtn.textContent = "Parar";
    this.detectBtn.disabled = false;
    this.preview.hidden = false;
    this.frameSize = null;
    this.status.textContent = "Compartilhando.";
    for (const fn of this.listeners) fn(true);
    this.loop();
  }

  private stop(): void {
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.startBtn.textContent = "Compartilhar tela";
    this.detectBtn.disabled = true;
    this.preview.hidden = true;
    this.status.textContent = "Compartilhamento encerrado.";
    for (const fn of this.listeners) fn(false);
  }

  private loop(): void {
    if (!this.stream) return;
    this.timer = window.setTimeout(() => this.loop(), 1000 / FPS);
    if (this.busy || !this.worker || this.video.readyState < 2) return;
    void this.sendFrame();
  }

  private async sendFrame(): Promise<void> {
    const w = this.video.videoWidth;
    const hgt = this.video.videoHeight;
    if (!w || !hgt || !this.worker) return;
    if (!this.frameSize || this.frameSize.w !== w || this.frameSize.h !== hgt) {
      // resolução nova (ou primeira): ajuste salvo > config.json > detecção automática
      this.frameSize = { w, h: hgt };
      const saved = loadRegion(w, hgt);
      const fromConfig = configRegion(hgt);
      this.region = saved ?? (fromConfig ? { ...fromConfig, auto: false } : null);
      this.wantDetect = !saved && !fromConfig;
      if (this.region) this.shape = this.region.shape;
      this.renderInputs();
    }
    this.busy = true;
    try {
      const bitmap = await createImageBitmap(this.video);
      const msg: ToWorker = { type: "frame", seq: ++this.seq, bitmap, region: this.region, detect: this.wantDetect, shape: this.shape };
      this.wantDetect = false;
      this.worker.postMessage(msg, [bitmap]);
    } catch {
      this.busy = false;
    }
  }

  private onResult(msg: FromWorker): void {
    this.busy = false;
    if (msg.type === "error") {
      this.status.textContent = `Erro no tracker: ${msg.message}`;
      return;
    }
    if (msg.detection) {
      const d = msg.detection;
      if (d.score >= 0.35) {
        this.region = { ...d.region, auto: true };
        this.save();
        this.status.textContent = `Minimapa encontrado (confiança ${Math.round(d.score * 100)}%). Ajuste à mão se precisar.`;
      } else {
        this.status.textContent = `Não achei o minimapa com segurança (${Math.round(d.score * 100)}%). Ajuste à mão.`;
        if (!this.region) this.region = { ...d.region, auto: true };
      }
      this.renderInputs();
    }
    this.drawPreview(msg.crop, msg.timings, msg.frameW, msg.frameH);
  }

  private drawPreview(crop: ImageBitmap | null, t: Record<string, number>, fw: number, fh: number): void {
    const ctx = this.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (crop) {
      ctx.drawImage(crop, 0, 0, this.canvas.width, this.canvas.height);
      crop.close();
      // marca o centro (seta do jogador)
      ctx.strokeStyle = "rgba(245, 197, 66, 0.9)";
      ctx.beginPath();
      ctx.moveTo(this.canvas.width / 2 - 6, this.canvas.height / 2);
      ctx.lineTo(this.canvas.width / 2 + 6, this.canvas.height / 2);
      ctx.moveTo(this.canvas.width / 2, this.canvas.height / 2 - 6);
      ctx.lineTo(this.canvas.width / 2, this.canvas.height / 2 + 6);
      ctx.stroke();
    }
    const ms = Object.entries(t).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" · ");
    this.stats.textContent = `${fw}×${fh} · ms: ${ms}`;
  }

  private manualEdit(): void {
    const cx = this.cx.valueAsNumber;
    const cy = this.cy.valueAsNumber;
    const r = this.r.valueAsNumber;
    if (![cx, cy, r].every(Number.isFinite) || r < 10) return;
    this.region = { cx, cy, r, shape: this.shape, auto: false };
    this.save();
    this.status.textContent = "Ajuste manual salvo pra esta resolução.";
  }

  private save(): void {
    if (this.frameSize && this.region) savePref(prefKey(this.frameSize.w, this.frameSize.h), JSON.stringify(this.region));
  }

  private renderInputs(): void {
    const reg = this.region;
    this.cx.value = reg ? String(Math.round(reg.cx)) : "";
    this.cy.value = reg ? String(Math.round(reg.cy)) : "";
    this.r.value = reg ? String(Math.round(reg.r)) : "";
    this.shapeSel.value = this.shape;
  }
}
