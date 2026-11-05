/// <reference lib="webworker" />
/**
 * Web Worker do tracker (ticket 25). Lê os frames da tela compartilhada direto do
 * MediaStreamTrackProcessor (segue rodando com a aba em segundo plano, onde timers e o <video>
 * da página são freados) ou, sem ele, recebe um bitmap por vez da página. Fica só com o frame
 * mais recente, processa na frequência alvo e mede Hz e ocupação (o custo de CPU do rastreio).
 */
import { TrackSession } from "./session";
import type { FromWorker, ResultMessage, ToWorker } from "./protocol";
import { browserTileReader } from "./tiles";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const canvas = new OffscreenCanvas(1, 1);
const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
const session = new TrackSession((m) => browserTileReader(m.info));

/** Frame a processar: VideoFrame (stream) ou ImageBitmap (página). */
interface Source {
  image: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}

let interval = 100;
let latest: Source | null = null;
let busy = false;
let timer = 0;
let lastStart = -Infinity;
let lastMs = 0;
let lastPreview = -Infinity;
let hzEma = 0;
let busyEma = 0;
let dropped = 0;
let wantGrab = false;
const PREVIEW_EVERY = 250;

const post = (msg: FromWorker, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);
const ema = (prev: number, v: number, a = 0.2) => (prev === 0 ? v : prev + a * (v - prev));

function fromVideoFrame(f: VideoFrame): Source {
  return { image: f, width: f.displayWidth, height: f.displayHeight, close: () => f.close() };
}

function fromBitmap(b: ImageBitmap): Source {
  return { image: b, width: b.width, height: b.height, close: () => b.close() };
}

function offer(src: Source): void {
  if (latest) {
    latest.close();
    dropped++;
  }
  latest = src;
  schedule();
}

function schedule(): void {
  if (busy || !latest) return;
  const wait = lastStart + interval - performance.now();
  if (wait > 1) {
    scope.clearTimeout(timer);
    timer = scope.setTimeout(schedule, wait);
    return;
  }
  const src = latest;
  latest = null;
  void process(src);
}

async function process(src: Source): Promise<void> {
  busy = true;
  const t0 = performance.now();
  if (Number.isFinite(lastStart)) {
    const dt = t0 - lastStart;
    hzEma = ema(hzEma, 1000 / dt);
    busyEma = ema(busyEma, Math.min(1, lastMs / dt));
  }
  lastStart = t0;
  try {
    const read = (x: number, y: number, w: number, h: number) => {
      canvas.width = Math.max(1, w);
      canvas.height = Math.max(1, h);
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(src.image, x, y, w, h, 0, 0, w, h);
      const img = ctx.getImageData(0, 0, Math.max(1, w), Math.max(1, h));
      return { width: img.width, height: img.height, data: img.data };
    };
    const step = await session.step(read, src.width, src.height);
    if (wantGrab) {
      wantGrab = false;
      const full = new OffscreenCanvas(src.width, src.height);
      full.getContext("2d")!.drawImage(src.image, 0, 0);
      post({ type: "grab", blob: await full.convertToBlob({ type: "image/png" }) });
    }
    let crop: ImageBitmap | null = null;
    const c = step.cropRgba;
    if (c && c.width > 0 && t0 - lastPreview >= PREVIEW_EVERY) {
      lastPreview = t0;
      crop = await createImageBitmap(new ImageData(new Uint8ClampedArray(c.data), c.width, c.height));
    }
    lastMs = performance.now() - t0;
    step.timings.total = lastMs;
    const { cropRgba: _drop, ...rest } = step;
    void _drop;
    const msg: ResultMessage = {
      type: "result",
      ...rest,
      crop,
      track: { state: session.state, pos: session.display ?? session.pos, hz: hzEma, busy: busyEma, dropped },
    };
    post(msg, crop ? [crop] : []);
  } catch (e) {
    lastMs = performance.now() - t0;
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  } finally {
    src.close();
    busy = false;
    schedule();
  }
}

async function readStream(readable: ReadableStream<VideoFrame>): Promise<void> {
  const reader = readable.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done || !value) break;
    offer(fromVideoFrame(value));
  }
}

scope.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  switch (msg.type) {
    case "stream":
      void readStream(msg.readable).catch((e: unknown) => post({ type: "error", message: `stream: ${String(e)}` }));
      break;
    case "frame":
      offer(fromBitmap(msg.bitmap));
      break;
    case "config":
      session.setRegion(msg.region, msg.shape);
      interval = 1000 / Math.max(1, msg.hz);
      break;
    case "detect":
      session.detect();
      break;
    case "map":
      session.setMap(msg.map);
      break;
    case "find":
      if (msg.mode === "global") session.findGlobal();
      else if (msg.mode === "hold") session.holdForClick();
      else if (msg.mode === "here") session.findHere(msg.px);
      break;
    case "grab":
      wantGrab = true;
      break;
  }
};
