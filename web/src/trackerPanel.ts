/**
 * Tracker ao vivo (tickets 17–25). Compartilha a tela (getDisplayMedia, só vídeo) e entrega os
 * frames ao Web Worker: direto pelo MediaStreamTrackProcessor quando existe (segue rodando com a
 * aba em segundo plano) ou, sem ele, um bitmap por vez a partir de um <video>. O Worker guarda o
 * estado do rastreio; aqui ficam a configuração (recorte do minimapa por resolução, frequência,
 * mapa ativo), os comandos ("Achar no mapa", "Find me") e a exibição (seta no mapa, seguir,
 * confiança, camada, Hz e ocupação do Worker). Nada sai do PC.
 */
import type { Affine } from "./affine";
import { CONFIG } from "./config";
import { loadMapData, manualMarkersOf, minimapScaleOf } from "./mapData";
import type { MapInfo } from "./maps";
import type { MapView } from "./mapView";
import { loadRefs } from "./refs";
import { loadPref, savePref } from "./storage";
import type { MinimapRegion, MinimapShape } from "./tracker/minimap";
import { scaleRegion } from "./tracker/minimap";
import type { FromWorker, MapConfig, ResultMessage, ToWorker } from "./tracker/protocol";
import { refPoints } from "./tracker/references";
import { TrackerView, type PlayerLook } from "./trackerView";

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** Frequências oferecidas; a spec pede ~10 Hz com CPU baixa. */
const HZ_OPTIONS = [5, 10, 15, 20, 30];
const HZ_PREF = "tracker.hz";

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

/** MediaStreamTrackProcessor (Chrome/Edge); fora do lib.dom do TypeScript. */
type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

const STATE_TEXT: Record<string, string> = {
  "sem-mapa": "Sem mapa ativo.",
  "procurando": "Procurando no mapa…",
  "esperando-clique": "Clique no mapa onde você está.",
};

export class TrackerPanel {
  readonly root: HTMLElement;
  readonly preview: HTMLElement;
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  /** Modo sem MediaStreamTrackProcessor: <video> + um bitmap por vez. */
  private video: HTMLVideoElement | null = null;
  private pumpTimer = 0;
  private pumpBusy = false;
  private region: SavedRegion | null = null;
  private frameSize: { w: number; h: number } | null = null;
  private shape: MinimapShape = CONFIG.minimap.shape;
  private hz = Number(loadPref(HZ_PREF)) || 10;
  private listeners = new Set<(sharing: boolean) => void>();
  private grabWaiters: ((b: Blob | null) => void)[] = [];

  private info: MapInfo | null = null;
  private mapConfig: MapConfig | null = null;
  private lastDeg: number | null = null;
  /** Medição com a aba em segundo plano: resultados e tempo enquanto `document.hidden`. */
  private hidden: { since: number; results: number } | null = null;

  private readonly playerView: TrackerView;
  private readonly status = h("p", { className: "calib-status", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly startBtn = h("button", { type: "button", textContent: "Compartilhar tela" });
  private readonly detectBtn = h("button", { type: "button", className: "secondary", textContent: "Detectar minimapa", disabled: true });
  private readonly cx = h("input", { type: "number", step: "1" });
  private readonly cy = h("input", { type: "number", step: "1" });
  private readonly r = h("input", { type: "number", step: "1", min: "10" });
  private readonly shapeSel = h("select", {});
  private readonly hzSel = h("select", {});
  private readonly canvas = h("canvas", { width: 180, height: 180 });
  private readonly hud = h("div", { className: "trk-hud" });
  private readonly stats = h("div", { className: "trk-stats" });
  private readonly followBtn = h("button", { type: "button", className: "trk-follow", textContent: "Seguir" });
  private readonly findBtn = h("button", { type: "button", className: "secondary", textContent: "Achar no mapa", disabled: true });
  private readonly findMeBtn = h("button", { type: "button", className: "secondary", textContent: "Find me", disabled: true });
  private readonly posInfo = h("p", { className: "calib-status", role: "status" } as Partial<HTMLParagraphElement>);
  private armed = false;

  constructor(private readonly view: MapView) {
    this.playerView = new TrackerView(view);
    this.findBtn.title = "Procura o minimapa no mapa inteiro (alguns décimos de segundo)";
    this.findMeBtn.title = "Clique no mapa onde você está; o tracker procura em volta e volta a seguir";
    this.findBtn.addEventListener("click", () => {
      this.setArmed(false);
      this.send({ type: "find", mode: "global" });
      this.posInfo.textContent = "Procurando no mapa inteiro…";
    });
    this.findMeBtn.addEventListener("click", () => {
      this.setArmed(!this.armed);
      this.send(this.armed ? { type: "find", mode: "hold" } : { type: "find", mode: "global" });
    });
    view.leaflet.on("click", (e) => {
      if (!this.armed) return;
      this.setArmed(false);
      const p = this.view.toPixel(e.latlng);
      this.send({ type: "find", mode: "here", px: [p.x, p.y] });
      this.playerView.show([p.x, p.y], this.lastDeg, "palpite");
      this.posInfo.textContent = "Procurando em volta do clique…";
    });
    this.followBtn.addEventListener("click", () => this.playerView.setFollow(!this.playerView.following));
    this.playerView.onFollowChange(() => this.renderFollow());
    this.renderFollow();

    this.shapeSel.append(h("option", { value: "circle", textContent: "Circular" }), h("option", { value: "square", textContent: "Quadrado" }));
    this.shapeSel.value = this.shape;
    for (const v of HZ_OPTIONS) this.hzSel.append(h("option", { value: String(v), textContent: `${v} Hz` }));
    this.hzSel.value = String(HZ_OPTIONS.includes(this.hz) ? this.hz : 10);
    this.hz = Number(this.hzSel.value);
    this.hzSel.addEventListener("change", () => {
      this.hz = Number(this.hzSel.value);
      savePref(HZ_PREF, String(this.hz));
      this.sendConfig();
    });
    this.startBtn.addEventListener("click", () => void (this.stream ? this.stop() : this.start()));
    this.detectBtn.addEventListener("click", () => {
      this.send({ type: "detect" });
      this.status.textContent = "Procurando o minimapa…";
    });
    for (const el of [this.cx, this.cy, this.r]) el.addEventListener("change", () => this.manualEdit());
    this.shapeSel.addEventListener("change", () => {
      this.shape = this.shapeSel.value as MinimapShape;
      this.manualEdit();
    });
    document.addEventListener("visibilitychange", () => this.onVisibility());
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
        h("label", {}, "raio", this.r), h("label", {}, "formato", this.shapeSel),
        h("label", {}, "frequência", this.hzSel)),
      this.status,
      h("h3", { textContent: "Posição" }),
      h("div", { className: "calib-actions" }, this.findBtn, this.findMeBtn),
      this.posInfo,
    );
    this.preview = h("div", { className: "trk-preview", hidden: true }, this.canvas, this.hud, this.stats, this.followBtn);
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

  /** Frame atual inteiro em PNG (pro modo anotar fixture), pedido ao Worker. */
  grabPng(): Promise<Blob | null> {
    if (!this.worker) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.grabWaiters.push(resolve);
      this.send({ type: "grab" });
      setTimeout(() => {
        const i = this.grabWaiters.indexOf(resolve);
        if (i >= 0) {
          this.grabWaiters.splice(i, 1);
          resolve(null);
        }
      }, 3000);
    });
  }

  /** Mapa ativo: carrega a escala e as referências e manda pro Worker (que zera a posição). */
  async setMap(info: MapInfo): Promise<void> {
    if (this.info?.name === info.name) return;
    this.info = info;
    this.mapConfig = null;
    this.playerView.hide();
    this.renderPosButtons();
    let config: MapConfig = { info, radiusPx: null, refs: [] };
    try {
      const [data, refs] = await Promise.all([loadMapData(info.name), loadRefs(info.name)]);
      const affine = ((data?.calibration as { affine?: Affine } | undefined)?.affine) ?? null;
      const ignored = new Set(Array.isArray(data?.ignoredRefs) ? (data.ignoredRefs as string[]) : []);
      config = { info, radiusPx: minimapScaleOf(data)?.radiusPx ?? null, refs: refPoints(refs, affine, manualMarkersOf(data), ignored) };
    } catch {
      /* API indisponível: sem escala */
    }
    if (this.info?.name !== info.name) return;
    this.mapConfig = config;
    this.send({ type: "map", map: config });
    this.renderPosButtons();
  }

  private send(msg: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private sendConfig(): void {
    this.send({ type: "config", region: this.region, shape: this.shape, hz: this.hz });
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
    if (!track) return this.stop();
    track.addEventListener("ended", () => this.stop());
    this.worker = new Worker(new URL("./tracker/worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onMessage(ev.data);
    const { width, height } = track.getSettings();
    if (width && height) this.useFrameSize(width, height);
    this.sendConfig();
    if (this.mapConfig) this.send({ type: "map", map: this.mapConfig });

    const Processor = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor }).MediaStreamTrackProcessor;
    if (Processor) {
      const { readable } = new Processor({ track });
      this.send({ type: "stream", readable }, [readable as unknown as Transferable]);
    } else {
      this.video = h("video", { muted: true, playsInline: true });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.pump();
    }
    this.startBtn.textContent = "Parar";
    this.detectBtn.disabled = false;
    this.renderPosButtons();
    this.preview.hidden = false;
    this.status.textContent = Processor ? "Compartilhando (frames direto no Worker)." : "Compartilhando (modo compatível: pausa com a aba em segundo plano).";
    for (const fn of this.listeners) fn(true);
  }

  private stop(): void {
    clearTimeout(this.pumpTimer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    this.video = null;
    this.worker?.terminate();
    this.worker = null;
    this.pumpBusy = false;
    for (const w of this.grabWaiters.splice(0)) w(null);
    this.startBtn.textContent = "Compartilhar tela";
    this.detectBtn.disabled = true;
    this.setArmed(false);
    this.renderPosButtons();
    this.preview.hidden = true;
    this.playerView.hide();
    this.posInfo.textContent = "";
    this.status.textContent = "Compartilhamento encerrado.";
    for (const fn of this.listeners) fn(false);
  }

  /** Modo compatível: manda um bitmap quando o Worker termina o anterior, na frequência escolhida. */
  private pump(): void {
    if (!this.stream || !this.video) return;
    this.pumpTimer = window.setTimeout(() => this.pump(), 1000 / this.hz);
    if (this.pumpBusy || this.video.readyState < 2) return;
    this.pumpBusy = true;
    createImageBitmap(this.video)
      .then((bitmap) => this.send({ type: "frame", bitmap }, [bitmap]))
      .catch(() => {
        this.pumpBusy = false;
      });
  }

  /** Resolução nova (ou primeira): ajuste salvo > config.json > detecção automática no Worker. */
  private useFrameSize(w: number, hgt: number): void {
    this.frameSize = { w, h: hgt };
    const saved = loadRegion(w, hgt);
    const fromConfig = configRegion(hgt);
    this.region = saved ?? (fromConfig ? { ...fromConfig, auto: false } : null);
    if (this.region) this.shape = this.region.shape;
    this.renderInputs();
  }

  private onMessage(msg: FromWorker): void {
    if (msg.type === "grab") {
      for (const w of this.grabWaiters.splice(0)) w(msg.blob);
      return;
    }
    this.pumpBusy = false;
    if (msg.type === "error") {
      this.status.textContent = `Erro no tracker: ${msg.message}`;
      return;
    }
    if (!this.frameSize || this.frameSize.w !== msg.frameW || this.frameSize.h !== msg.frameH) {
      this.useFrameSize(msg.frameW, msg.frameH);
      this.sendConfig();
    }
    if (msg.detection) {
      const d = msg.detection;
      if (d.score >= 0.35) {
        this.region = { ...d.region, shape: this.shape, auto: true };
        this.save();
        this.status.textContent = `Minimapa encontrado (confiança ${Math.round(d.score * 100)}%). Ajuste à mão se precisar.`;
      } else {
        this.status.textContent = `Não achei o minimapa com segurança (${Math.round(d.score * 100)}%). Ajuste à mão.`;
        if (!this.region) this.region = { ...d.region, shape: this.shape, auto: true };
      }
      this.renderInputs();
    }
    if (this.hidden) this.hidden.results++;
    if (msg.heading) this.lastDeg = msg.heading.deg;
    if (msg.track.state !== "pausado") this.playerView.setCamera(msg.camera);
    this.showPosition(msg);
    this.drawPreview(msg);
  }

  private showPosition(msg: ResultMessage): void {
    const t = msg.track;
    const f = msg.fused;
    if (t.state === "sem-escala") {
      this.posInfo.textContent = `Sem escala do minimapa em ${this.info?.name ?? "?"}: meça no painel Fixture.`;
      return;
    }
    if (t.state === "pausado") {
      if (t.pos) this.playerView.show(t.pos, this.lastDeg, "pausado");
      const sec = Math.floor(t.pausedFor / 1000);
      this.posInfo.textContent =
        `Minimapa fora da tela (menu, mapa aberto ou cutscene): pausado${sec >= 1 ? ` há ${sec} s` : ""}. Retomo sozinho quando ele voltar.`;
      return;
    }
    if (f) {
      const look: PlayerLook = f.confidence;
      this.playerView.show(t.pos ?? f.px, this.lastDeg, look);
      const ncc = msg.located ? ` · NCC ${msg.located.score.toFixed(2)}` : "";
      const icons = msg.icons.length ? ` · ícones: ${msg.icons.map((i) => (i.kind === "nexus" ? "Nexus" : "teleporte")).join(", ")}` : "";
      this.posInfo.textContent =
        `px ${Math.round(f.px[0])}, ${Math.round(f.px[1])} · ${f.layer} · confiança ${f.confidence}${ncc}${icons}${f.note ? ` (${f.note})` : ""}`;
      return;
    }
    if (msg.located?.mode === "global" && !msg.located.confident) {
      // incerto: mostra o palpite, mas não segue
      this.playerView.show(msg.located.px, this.lastDeg, "palpite");
      this.posInfo.textContent = `Não tenho certeza (NCC ${msg.located.score.toFixed(2)}, margem ${msg.located.margin.toFixed(2)}); o palpite está no mapa. Use o Find me.`;
      return;
    }
    if (msg.rejected && t.pos) {
      this.playerView.show(t.pos, this.lastDeg, "baixa");
      this.posInfo.textContent = `Descartei um ${msg.rejected.reason} (px ${Math.round(msg.rejected.px[0])}, ${Math.round(msg.rejected.px[1])}); mantendo a posição.`;
      return;
    }
    if (t.state === "perdido" && t.pos) {
      this.playerView.show(t.pos, this.lastDeg, "perdido");
      this.posInfo.textContent = "Perdi o rastreio; procurando no mapa a cada 2 s (ou use o Find me).";
      return;
    }
    const text = STATE_TEXT[t.state];
    if (text) this.posInfo.textContent = text;
  }

  private drawPreview(msg: ResultMessage): void {
    const crop = msg.crop;
    if (crop) {
      const ctx = this.canvas.getContext("2d")!;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(crop, 0, 0, this.canvas.width, this.canvas.height);
      crop.close();
      ctx.strokeStyle = "rgba(245, 197, 66, 0.9)";
      ctx.beginPath();
      ctx.moveTo(this.canvas.width / 2 - 6, this.canvas.height / 2);
      ctx.lineTo(this.canvas.width / 2 + 6, this.canvas.height / 2);
      ctx.moveTo(this.canvas.width / 2, this.canvas.height / 2 - 6);
      ctx.lineTo(this.canvas.width / 2, this.canvas.height / 2 + 6);
      ctx.stroke();
    }
    const t = msg.track;
    const layer = msg.fused ? ` · ${msg.fused.layer} · ${msg.fused.confidence}` : "";
    this.hud.textContent = `${t.state}${layer} · ${t.hz.toFixed(1)} Hz · Worker ${Math.round(t.busy * 100)}%`;
    this.hud.dataset.state = t.state;
    const ms = Object.entries(msg.timings).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(" · ");
    this.stats.textContent = `${msg.frameW}×${msg.frameH}${msg.heading ? ` · direção ${Math.round(msg.heading.deg)}°` : ""}${msg.camera ? ` · câmera ${Math.round(msg.camera.deg)}°` : ""} · ms: ${ms}`;
  }

  /** Mede quantos resultados chegam com a aba em segundo plano e mostra ao voltar. */
  private onVisibility(): void {
    if (!this.stream) return;
    if (document.hidden) this.hidden = { since: performance.now(), results: 0 };
    else if (this.hidden) {
      const s = (performance.now() - this.hidden.since) / 1000;
      if (s >= 2) this.status.textContent = `Em segundo plano por ${s.toFixed(0)} s: ${(this.hidden.results / s).toFixed(1)} resultados/s.`;
      this.hidden = null;
    }
  }

  private setArmed(on: boolean): void {
    this.armed = on;
    this.view.leaflet.getContainer().classList.toggle("calibrating", on);
    this.findMeBtn.setAttribute("aria-pressed", String(on));
  }

  private renderFollow(): void {
    this.followBtn.setAttribute("aria-pressed", String(this.playerView.following));
    this.followBtn.title = this.playerView.following ? "Seguindo o jogador (arraste o mapa pra parar)" : "Centralizar o mapa no jogador";
  }

  private renderPosButtons(): void {
    const ok = this.stream !== null && !!this.mapConfig?.radiusPx;
    this.findBtn.disabled = !ok;
    this.findMeBtn.disabled = !ok;
  }

  private manualEdit(): void {
    const cx = this.cx.valueAsNumber;
    const cy = this.cy.valueAsNumber;
    const r = this.r.valueAsNumber;
    if (![cx, cy, r].every(Number.isFinite) || r < 10) return;
    this.region = { cx, cy, r, shape: this.shape, auto: false };
    this.save();
    this.sendConfig();
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
