/**
 * Estado do rastreio ao vivo (ticket 25), um frame por vez: recorte → direção → ícones → posição
 * (local em volta da última; global sem posição ou depois de perder) → fusão. Roda no Worker;
 * o leitor de tiles e o relógio vêm de fora pra dar pra testar.
 */
import { centerCandidates, DEFAULT_FUSE, fuseGlobal, fuseLocal, type Fused } from "./fuse";
import { GlobalLocator } from "./globalSearch";
import { arrowHeading, type Heading } from "./heading";
import { detectIcons, type DetectedIcon } from "./icons";
import { ImageLocator } from "./imageLocator";
import { DEFAULT_MASK } from "./locate";
import type { MinimapRegion, MinimapShape } from "./minimap";
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
}

export const DEFAULT_SESSION: SessionOptions = { lostAfter: 1500, globalEvery: 2000, searchFirm: 64, searchLoose: 160, firmFor: 300 };

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
  private hold = false;
  private lastOk = 0;
  private lastGlobal = -Infinity;

  constructor(
    private readonly readerFor: (map: MapConfig) => TileReader,
    private readonly now: () => number = () => performance.now(),
    private readonly opt: SessionOptions = DEFAULT_SESSION,
  ) {}

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
    this.lastOk = this.now();
  }

  get state(): TrackState {
    if (!this.map) return "sem-mapa";
    if (!this.map.radiusPx) return "sem-escala";
    if (this.hold) return "esperando-clique";
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
      heading: null,
      timings,
    };
    const crop = res.crop;
    const r = res.region?.r;
    if (!crop || !r || crop.width === 0) return out;

    let t = this.now();
    const heading: Heading | null = arrowHeading(crop, r);
    timings.heading = this.now() - t;
    out.heading = heading;

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
    t = this.now();
    const lost = this.state === "perdido" || !this.pos;
    if (this.wantGlobal || (lost && t - this.lastGlobal >= this.opt.globalEvery)) {
      // global: com ícone no centro (logo após o TP), só os teleportes do tipo; senão o mapa inteiro
      this.wantGlobal = false;
      this.lastGlobal = t;
      const cands = centerCandidates(icons, radiusPx / r, r, map.refs);
      const guided = cands.length ? await this.global.locate(crop, r, radiusPx, cands) : null;
      const G = !guided || guided.score < DEFAULT_FUSE.minGuided ? await this.global.locate(crop, r, radiusPx) : null;
      const best = guided ?? G;
      located = best && { ...best, mode: "global" };
      fused = fuseGlobal(G, guided);
      timings.global = this.now() - t;
    } else if (this.pos) {
      const search = t - this.lastOk < this.opt.firmFor ? this.opt.searchFirm : this.opt.searchLoose;
      const L = await this.locator.locate(crop, r, radiusPx, this.pos, search);
      located = L && { ...L, mode: "local", confident: true };
      fused = fuseLocal(L, refFix);
      timings.locate = this.now() - t;
    }
    out.located = located;
    out.fused = fused;
    if (fused) {
      this.pos = fused.px;
      this.lastOk = this.now();
    }
    return out;
  }
}
