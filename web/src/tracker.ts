import {
  PROTOCOL_VERSION,
  parseServerMessage,
  type ClientMessage,
  type MapData,
  type ServerMessage,
} from "./protocol";

export type TrackerStatus = "connecting" | "connected" | "disconnected";

const DEFAULT_URL = "ws://127.0.0.1:8765";
const REQUEST_TIMEOUT_MS = 5000;
const MAX_BACKOFF_MS = 10_000;

interface Pending {
  resolve: (msg: ServerMessage) => void;
  reject: (err: Error) => void;
  timer: number;
}

/**
 * Cliente do WebSocket do tracker com reconexão automática. O web funciona sem o tracker:
 * quem usa `request` precisa tratar a rejeição (ex.: oferecer download do JSON).
 */
export class TrackerClient {
  private ws: WebSocket | null = null;
  private backoff = 1000;
  private seq = 0;
  private pending = new Map<string, Pending>();
  private activeMap: string | null = null;
  private statusListeners = new Set<(s: TrackerStatus) => void>();
  private _status: TrackerStatus = "disconnected";

  constructor(private readonly url: string = import.meta.env.VITE_TRACKER_URL ?? DEFAULT_URL) {}

  get status(): TrackerStatus {
    return this._status;
  }

  onStatus(fn: (s: TrackerStatus) => void): () => void {
    this.statusListeners.add(fn);
    fn(this._status);
    return () => this.statusListeners.delete(fn);
  }

  start(): void {
    this.open();
  }

  /** Lembra o mapa ativo e avisa o tracker (agora, ou assim que conectar). */
  setActiveMap(name: string): void {
    this.activeMap = name;
    this.send({ type: "set_active_map", map: name });
  }

  async saveMapData(map: string, data: MapData): Promise<string> {
    const reply = await this.request({ type: "save_map_data", requestId: this.nextId(), map, data });
    if (reply.type !== "saved") throw new Error("resposta inesperada do tracker");
    return reply.path;
  }

  async getMapData(map: string): Promise<MapData | null> {
    const reply = await this.request({ type: "get_map_data", requestId: this.nextId(), map });
    if (reply.type !== "map_data") throw new Error("resposta inesperada do tracker");
    return reply.data;
  }

  private nextId(): string {
    this.seq += 1;
    return `w${Date.now().toString(36)}-${this.seq}`;
  }

  private request(msg: Extract<ClientMessage, { requestId: string }>): Promise<ServerMessage> {
    if (this._status !== "connected") return Promise.reject(new Error("tracker desconectado"));
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(msg.requestId);
        reject(new Error("tracker não respondeu"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(msg.requestId, { resolve, reject, timer });
      this.send(msg);
    });
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setStatus(s: TrackerStatus): void {
    if (s === this._status) return;
    this._status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  private open(): void {
    this.setStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.backoff = 1000;
      this.send({ type: "hello", client: "web", version: PROTOCOL_VERSION });
      if (this.activeMap) this.send({ type: "set_active_map", map: this.activeMap });
      this.setStatus("connected");
    });
    ws.addEventListener("message", (ev) => this.onMessage(ev.data));
    ws.addEventListener("close", () => {
      if (this.ws === ws) this.ws = null;
      this.failPending("conexão com o tracker caiu");
      this.setStatus("disconnected");
      this.scheduleReconnect();
    });
  }

  private onMessage(raw: unknown): void {
    const msg = parseServerMessage(raw);
    if (!msg) return;
    if (msg.type === "error") console.warn("[tracker]", msg.message);
    const rid = "requestId" in msg ? msg.requestId : null;
    if (rid && this.pending.has(rid)) {
      const p = this.pending.get(rid)!;
      this.pending.delete(rid);
      window.clearTimeout(p.timer);
      if (msg.type === "error") p.reject(new Error(msg.message));
      else p.resolve(msg);
    }
  }

  private failPending(reason: string): void {
    for (const [id, p] of this.pending) {
      window.clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(id);
    }
  }

  private scheduleReconnect(): void {
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    window.setTimeout(() => this.open(), delay);
  }
}
