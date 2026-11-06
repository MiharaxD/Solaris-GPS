/**
 * Estado do rastreio ao vivo (ticket 25), um frame por vez: recorte → direção → ícones → posição
 * (local em volta da última; global sem posição ou depois de perder) → fusão. Roda no Worker;
 * o leitor de tiles e o relógio vêm de fora pra dar pra testar.
 */
import { DEFAULT_FUSE, fuseGlobal, fuseLocal, guidedCandidates, iconAtCenter, type Confidence, type Fused } from "./fuse";
import { GlobalLocator, type Rect } from "./globalSearch";
import { arrowHeading, type Heading } from "./heading";
import { detectIcons, type DetectedIcon } from "./icons";
import { ImageLocator } from "./imageLocator";
import { cameraView, DEFAULT_MASK } from "./locate";
import { DEFAULT_JUMP, JumpGate, MotionFilter, type JumpOptions } from "./motion";
import { type MinimapRegion, type MinimapShape } from "./minimap";
import { DEFAULT_PRESENCE, minimapPresence, PresenceGate, type PresenceOptions } from "./presence";
import { processFrame, type ReadRect } from "./pipeline";
import type { LocatedResult, MapConfig, ResultMessage, TrackState } from "./protocol";
import { locateByRefs, type RefFix } from "./references";
import { lruTileReader, type TileReader } from "./tiles";

export interface SessionOptions {
  /** Sem posição aceita há mais que isso (ms) = perdido: volta a busca global. */
  lostAfter: number;
  /** Intervalo mínimo entre buscas globais automáticas (ms); cada uma custa ~0,3 s. */
  globalEvery: number;
  /**
   * Raio da busca local (px do zoom máximo): curto com o rastreio firme (posição aceita há menos
   * de `firmFor` ms; a 10 Hz, 64 px por frame é muito mais que qualquer corrida) e longo depois
   * de uma falha.
   */
  searchFirm: number;
  searchLoose: number;
  firmFor: number;
  /** Saltos (ticket 26): ver `JumpGate`. */
  jump: JumpOptions;
  /** Erro esperado da medição por confiança (px), pro filtro. */
  sigma: Record<Confidence, number>;
  /** Presença do minimapa (ticket 27): ver `PresenceGate`. */
  presence: PresenceOptions;
}

export const DEFAULT_SESSION: SessionOptions = {
  lostAfter: 1500,
  globalEvery: 2000,
  searchFirm: 64,
  searchLoose: 160,
  firmFor: 300,
  jump: DEFAULT_JUMP,
  sigma: { alta: 2, média: 4, baixa: 8 },
  presence: DEFAULT_PRESENCE,
};

/** Parte do resultado que a sessão calcula (o Worker põe o recorte e as medições). */
export type StepResult = Omit<ResultMessage, "type" | "crop" | "track"> & { cropRgba: { width: number; height: number; data: Uint8ClampedArray } | null };

export class TrackSession {
  region: MinimapRegion | null = null;
  shape: MinimapShape = "circle";
  private detectOnce = false;
  private map: MapConfig | null = null;
  private locator: ImageLocator | null = null;
  private global: GlobalLocator | null = null;
  pos: [number, number] | null = null;
  private wantGlobal = false;
  /** Região escolhida no web: limita a busca no mapa inteiro (a guiada por ícones não). */
  private area: Rect | null = null;
  private hold = false;
  private lastOk = 0;
  private lastGlobal = -Infinity;
  /** Próxima posição passa direto (Find me). */
  private forceAccept = false;
  private readonly gate: JumpGate;
  private readonly filter = new MotionFilter();
  /** Posição suavizada pra exibir. */
  display: [number, number] | null = null;
  private readonly presence: PresenceGate;
  /** Início da pausa sem minimapa (null = rodando). */
  private pausedAt: number | null = null;

  constructor(
    private readonly readerFor: (map: MapConfig) => TileReader,
    private readonly now: () => number = () => performance.now(),
    private readonly opt: SessionOptions = DEFAULT_SESSION,
  ) {
    this.gate = new JumpGate(opt.jump);
    this.presence = new PresenceGate(opt.presence);
  }

  /** Há quanto tempo está pausado (ms); 0 = rodando. */
  get pausedFor(): number {
    return this.pausedAt === null ? 0 : this.now() - this.pausedAt;
  }

  setRegion(region: MinimapRegion | null, shape: MinimapShape): void {
    this.region = region;
    this.shape = shape;
  }

  detect(): void {
    this.detectOnce = true;
  }

  setMap(map: MapConfig | null): void {
    if (map?.info.name !== this.map?.info.name) {
      this.pos = null;
      this.display = null;
      this.filter.clear();
      this.gate.clear();
      this.locator = null;
      this.global = null;
      if (map) {
        const read = this.readerFor(map);
        this.locator = new ImageLocator(map.info, read);
        this.global = new GlobalLocator(map.info, lruTileReader(read, 64), this.locator, DEFAULT_MASK);
      }
    }
    this.map = map;
  }

  setArea(area: Rect | null): void {
    this.area = area;
  }

  findGlobal(): void {
    this.hold = false;
    this.wantGlobal = true;
  }

  holdForClick(): void {
    this.hold = true;
  }

  findHere(px: [number, number]): void {
    this.hold = false;
    this.wantGlobal = false;
    this.pos = px;
    this.forceAccept = true;
    this.lastOk = this.now();
  }

  get state(): TrackState {
    if (!this.map) return "sem-mapa";
    if (!this.map.radiusPx) return "sem-escala";
    if (this.hold) return "esperando-clique";
    if (this.pausedAt !== null) return "pausado";
    if (!this.pos) return "procurando";
    return this.now() - this.lastOk > this.opt.lostAfter ? "perdido" : "seguindo";
  }

  async step(read: ReadRect, frameW: number, frameH: number): Promise<StepResult> {
    const timings: Record<string, number> = {};
    const res = processFrame(read, frameW, frameH, { region: this.region, detect: this.detectOnce || !this.region, shape: this.shape });
    this.detectOnce = false;
    Object.assign(timings, res.timings);
    // detecção boa vira a região; fraca só se não houver outra (a página mostra e o usuário ajusta)
    if (res.detection && (res.detection.score >= 0.35 || !this.region)) this.region = { ...res.detection.region, shape: this.shape };
    const out: StepResult = {
      frameW,
      frameH,
      region: res.region,
      detection: res.detection,
      cropRgba: res.crop,
      located: null,
      icons: [],
      refFix: null,
      fused: null,
      rejected: null,
      heading: null,
      camera: null,
      presence: null,
      timings,
    };
    const crop = res.crop;
    const r = res.region?.r;
    if (!crop || !r || crop.width === 0) return out;
    if (!this.checkPresence(read, frameW, frameH, out)) return out;

    let t = this.now();
    const heading: Heading | null = arrowHeading(crop, r);
    timings.heading = this.now() - t;
    out.heading = heading;
    t = this.now();
    out.camera = cameraView(crop);
    timings.camera = this.now() - t;

    const map = this.map;
    if (!map?.radiusPx || !this.locator || !this.global || this.hold) return out;
    const radiusPx = map.radiusPx;

    t = this.now();
    const icons: DetectedIcon[] = map.refs.length ? detectIcons(crop, r) : [];
    const refFix: RefFix | null = icons.length ? locateByRefs(icons, radiusPx / r, map.refs, this.pos) : null;
    timings.refs = this.now() - t;
    out.icons = icons;
    out.refFix = refFix;

    let fused: Fused | null = null;
    let located: LocatedResult | null = null;
    let teleport = false;
    t = this.now();
    const lost = this.state === "perdido" || !this.pos;
    if (this.wantGlobal || (lost && t - this.lastGlobal >= this.opt.globalEvery)) {
      // global: com ícones à vista, primeiro só as posições que os explicam; senão o mapa inteiro
      this.wantGlobal = false;
      this.lastGlobal = t;
      const guide = guidedCandidates(icons, radiusPx / r, r, map.refs);
      const guided = guide.candidates.length ? await this.global.locate(crop, r, radiusPx, guide.candidates) : null;
      const G = !guided || guided.score < DEFAULT_FUSE.minGuided ? await this.global.locate(crop, r, radiusPx, undefined, this.area) : null;
      const best = guided ?? G;
      located = best && { ...best, mode: "global" };
      fused = fuseGlobal(G, guided);
      teleport = guide.trusted && !!guided && !!fused && fused.px === guided.px;
      timings.global = this.now() - t;
    } else if (this.pos) {
      const search = t - this.lastOk < this.opt.firmFor ? this.opt.searchFirm : this.opt.searchLoose;
      const L = await this.locator.locate(crop, r, radiusPx, this.pos, search);
      located = L && { ...L, mode: "local", confident: true };
      fused = fuseLocal(L, refFix);
      // nada casou em volta e há ícone sob a seta: provável teleporte, busca guiada no próximo frame
      if (!fused && iconAtCenter(icons, r)) this.wantGlobal = true;
      // só a referência, sem a imagem confirmar: no modo "prev" ela escolhe o ícone do tipo mais
      // perto da posição anterior, então confirma um lugar errado pra sempre (teleporte pra outro
      // Nexus a mais de `maxJump` → o Nexus antigo "casa" de novo e o rastreio nunca se perde).
      // De tempos em tempos a busca guiada confere todos os ícones do tipo pela imagem.
      else if (fused?.layer === "referências" && refFix?.mode === "prev" && t - this.lastGlobal >= this.opt.globalEvery) this.wantGlobal = true;
      timings.locate = this.now() - t;
    }
    out.located = located;
    if (fused) {
      const now = this.now();
      const verdict = this.gate.check(fused.px, this.pos, now - this.lastOk, teleport || this.forceAccept, located?.mode === "global");
      this.forceAccept = false;
      if (verdict === "reject") {
        out.rejected = { px: fused.px, reason: "salto impossível" };
        fused = null;
      } else {
        this.pos = fused.px;
        this.lastOk = now;
        this.display = verdict === "reset" ? (this.filter.reset(fused.px, now), fused.px) : this.filter.update(fused.px, now, this.opt.sigma[fused.confidence]);
      }
    }
    out.fused = fused;
    return out;
  }

  /**
   * Presença do minimapa (ticket 27): pausa quando o anel some e retoma de onde parou. A pausa
   * não conta como tempo andando: o relógio do "perdido", o da busca global e o alcance dos
   * saltos continuam de onde estavam (num menu o jogador não anda; um teleporte pelo mapa
   * aberto é pego pela busca guiada, com o ícone sob a seta). Devolve se pode seguir o frame.
   */
  private checkPresence(read: ReadRect, frameW: number, frameH: number, out: StepResult): boolean {
    const region = this.region;
    if (!region || region.shape !== "circle") return true;
    let t = this.now();
    const p = minimapPresence(read, frameW, frameH, region, this.opt.presence);
    out.timings.presence = this.now() - t;
    // a região é fixa: o minimapa não muda de lugar no jogo. Anel fraco = minimapa fora da tela
    // (mapa aberto, menu, loading), nunca "minimapa em outro lugar". Procurar de novo aqui pegava
    // falsos anéis da tela do mapa e salvava a região errada.
    const visible = this.presence.update(p.score);
    out.presence = { score: p.score, visible };
    t = this.now();
    if (!visible) {
      this.pausedAt ??= t;
      return false;
    }
    if (this.pausedAt !== null) {
      const d = t - this.pausedAt;
      this.pausedAt = null;
      this.lastOk = Math.min(t, this.lastOk + d);
      this.lastGlobal = Math.min(t, this.lastGlobal + d);
      // a velocidade de antes da pausa não vale mais
      const p0 = this.display ?? this.pos;
      if (p0) this.filter.reset(p0, t);
    }
    return true;
  }
}
