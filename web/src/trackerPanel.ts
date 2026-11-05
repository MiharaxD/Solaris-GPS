/**
 * Compartilhar tela (getDisplayMedia) + recorte do minimapa. Os frames vão pro Web Worker do
 * tracker; nada sai do PC. O ajuste do recorte fica salvo por resolução no localStorage, com
 * padrão vindo do config.json.
 * Posição (ticket 20): "Achar no mapa" roda a busca global no próximo frame; "Find me" usa o
 * clique no mapa como posição anterior. Achada a posição, cada frame segue com a camada imagem
 * em volta da última (seguir o jogador com a câmera, seta e confiança ficam pro ticket 25).
 */
import L from "leaflet";
import { CONFIG } from "./config";
import type { Affine } from "./affine";
import { loadMapData, manualMarkersOf, minimapScaleOf } from "./mapData";
import { loadRefs } from "./refs";
import { refPoints, type RefPoint } from "./tracker/references";
import type { MapInfo } from "./maps";
import type { MapView } from "./mapView";
import type { MinimapRegion, MinimapShape } from "./tracker/minimap";
import { scaleRegion } from "./tracker/minimap";
import type { FromWorker, LocatedResult, ToWorker } from "./tracker/protocol";
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
/** Abaixo desse NCC, a camada imagem não move a posição (mantém a última). Pior acerto nos fixtures: 0,35. */
const MIN_LOCAL_SCORE = 0.3;

interface SavedRegion extends MinimapRegion {
  /** true = veio da detecção automática (redetecta se a resolução mudar). */
  auto: boolean;
}

const prefKey = (w: number, h: number) => `minimap.${w}x${h}`;

export function loadRegion(w: number, h: number): SavedRegion | null {
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

  private info: MapInfo | null = null;
  private radiusPx: number | null = null;
  /** Teleportes/Nexus do mapa em px (camada de referências). */
  private refs: RefPoint[] = [];
  /** Última posição aceita (px do zoom máximo); null = sem posição. */
  private pos: [number, number] | null = null;
  private wantGlobal = false;
  private armed = false;
  private readonly findBtn = h("button", { type: "button", className: "secondary", textContent: "Achar no mapa", disabled: true });
  private readonly findMeBtn = h("button", { type: "button", className: "secondary", textContent: "Find me", disabled: true });
  private readonly posInfo = h("p", { className: "calib-status", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly posMarker = L.circleMarker([0, 0], { radius: 8, className: "trk-pos", interactive: false });

  constructor(private readonly view: MapView) {
    this.findBtn.title = "Procura o minimapa no mapa inteiro (alguns décimos de segundo)";
    this.findMeBtn.title = "Clique no mapa onde você está; o tracker procura em volta e volta a seguir";
    this.findBtn.addEventListener("click", () => {
      this.wantGlobal = true;
      this.armed = false;
      this.posInfo.textContent = "Procurando no mapa inteiro…";
    });
    this.findMeBtn.addEventListener("click", () => {
      this.armed = !this.armed;
      this.view.leaflet.getContainer().classList.toggle("calibrating", this.armed);
      this.posInfo.textContent = this.armed ? "Clique no mapa onde você está." : "";
    });
    view.leaflet.on("click", (e) => {
      if (!this.armed) return;
      this.armed = false;
      this.view.leaflet.getContainer().classList.remove("calibrating");
      const p = this.view.toPixel(e.latlng);
      this.wantGlobal = false;
      this.setPos([p.x, p.y], true);
      this.posInfo.textContent = "Procurando em volta do clique…";
    });
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
      h("h3", { textContent: "Posição" }),
      h("div", { className: "calib-actions" }, this.findBtn, this.findMeBtn),
      this.posInfo,
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
    this.renderPosButtons();
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
    this.armed = false;
    this.wantGlobal = false;
    this.renderPosButtons();
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
      // com o Find me armado, espera o clique (não segue a posição antiga)
      if (this.info && this.radiusPx && !this.armed && (this.wantGlobal || this.pos)) {
        msg.locate = { info: this.info, radiusPx: this.radiusPx, prev: this.wantGlobal ? undefined : this.pos ?? undefined, refs: this.refs };
        this.wantGlobal = false;
      }
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
    if (msg.located) this.onLocated(msg.located);
    // camada de referências: só mostra (qual camada vale é a fusão, ticket 23)
    if (msg.located && msg.icons.length) {
      const kinds = msg.icons.map((i) => (i.kind === "nexus" ? "Nexus" : "teleporte")).join(", ");
      const f = msg.refFix;
      const by = f ? ` → px ${Math.round(f.px[0])}, ${Math.round(f.px[1])} (${f.mode === "constellation" ? "constelação" : "pela anterior"})` : " (ambíguo)";
      this.posInfo.textContent += ` · ícones: ${kinds}${by}`;
    }
    else if (msg.timings.global !== undefined) this.posInfo.textContent = "Não achei no mapa. Tente o Find me.";
    this.drawPreview(msg.crop, msg.timings, msg.frameW, msg.frameH);
    if (msg.heading) this.stats.textContent += ` · direção ${Math.round(msg.heading.deg)}°`;
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

  /** Mapa ativo: zera a posição e carrega a escala salva (data/maps). */
  async setMap(info: MapInfo): Promise<void> {
    const changed = this.info?.name !== info.name;
    this.info = info;
    if (changed) {
      this.setPos(null);
      this.radiusPx = null;
      this.refs = [];
      this.renderPosButtons();
      try {
        const [data, refs] = await Promise.all([loadMapData(info.name), loadRefs(info.name)]);
        if (this.info?.name === info.name) {
          this.radiusPx = minimapScaleOf(data)?.radiusPx ?? null;
          const affine = ((data?.calibration as { affine?: Affine } | undefined)?.affine) ?? null;
          const ignored = new Set(Array.isArray(data?.ignoredRefs) ? (data.ignoredRefs as string[]) : []);
          this.refs = refPoints(refs, affine, manualMarkersOf(data), ignored);
        }
      } catch {
        /* API indisponível: sem escala */
      }
      this.renderPosButtons();
    }
  }

  private renderPosButtons(): void {
    const ok = this.stream !== null && this.radiusPx !== null;
    this.findBtn.disabled = !ok;
    this.findMeBtn.disabled = !ok;
    if (this.stream && this.info && this.radiusPx === null) {
      this.posInfo.textContent = `Sem escala do minimapa em ${this.info.name}: meça no painel Fixture.`;
    }
  }

  private setPos(px: [number, number] | null, guess = false): void {
    this.pos = px;
    if (!px) {
      this.posMarker.remove();
      return;
    }
    this.posMarker.setLatLng(this.view.toLatLng({ x: px[0], y: px[1] })).addTo(this.view.leaflet);
    this.posMarker.getElement()?.classList.toggle("guess", guess);
  }

  private onLocated(loc: LocatedResult): void {
    const where = `${Math.round(loc.px[0])}, ${Math.round(loc.px[1])}`;
    const ms = Object.values(loc.timings).reduce((a, b) => a + b, 0);
    if (loc.mode === "global") {
      if (loc.confident) {
        this.setPos(loc.px);
        this.posInfo.textContent = `Achei em px ${where} (NCC ${loc.score.toFixed(2)}, margem ${loc.margin.toFixed(2)}). Seguindo.`;
      } else {
        // incerto: mostra o palpite, mas não segue
        this.setPos(null);
        this.posMarker.setLatLng(this.view.toLatLng({ x: loc.px[0], y: loc.px[1] })).addTo(this.view.leaflet);
        this.posMarker.getElement()?.classList.add("guess");
        this.posInfo.textContent = `Não tenho certeza (NCC ${loc.score.toFixed(2)}, margem ${loc.margin.toFixed(2)}); o palpite está no mapa. Use o Find me.`;
      }
      return;
    }
    if (loc.score >= MIN_LOCAL_SCORE) {
      this.setPos(loc.px);
      this.posInfo.textContent = `px ${where} · NCC ${loc.score.toFixed(2)} · ${ms.toFixed(0)} ms`;
    } else {
      this.posInfo.textContent = `Casamento fraco (NCC ${loc.score.toFixed(2)}); mantendo a última posição.`;
    }
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
