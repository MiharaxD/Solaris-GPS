/**
 * Busca global (ticket 20): sem posição anterior, acha o minimapa no mapa inteiro.
 *  1. Visão geral: o mapa todo num zoom reduzido (minimapa com ~13 px), NCC só onde há terra
 *     sob o template; guarda os K melhores picos.
 *  2. Meio: cada pico num zoom 4× maior, busca local pequena; ficam os 3 melhores.
 *  3. Fim: a camada imagem (zoom máximo) em volta de cada um; vence o maior NCC.
 * Usa os zooms da pirâmide do web, então funciona também nos mapas que só tinham o zoom máximo.
 */
import type { MapInfo } from "../maps";
import type { Rgba } from "./image";
import type { ImageLocator } from "./imageLocator";
import { compact, minimapPlanes, nccAt, offsets, resizePlanes, type Located, type MinimapMaskOptions, type Planes } from "./locate";
import { planesWindow, type TileReader } from "./tiles";

export interface GlobalOptions {
  /** Picos da visão geral levados ao zoom do meio. */
  candidates: number;
  /** Fração mínima de terra (não fundo) sob o template na visão geral. */
  minLand: number;
  /** Tamanho mínimo do template na visão geral (px). */
  minTemplate: number;
  /**
   * Abaixo disso o resultado é incerto (pede "Find me"). Nos fixtures: acertos com margem ≥ 0,11
   * e NCC ≥ 0,69; o único erro (204708) com margem 0,02–0,04. Mais candidatos não salvam esse
   * caso: lugares errados chegam a NCC maior que o certo.
   */
  minMargin: number;
  minScore: number;
}

export const DEFAULT_GLOBAL: GlobalOptions = { candidates: 40, minLand: 0.1, minTemplate: 12, minMargin: 0.08, minScore: 0.5 };

interface Overview {
  z: number;
  /** px do zoom máximo por px da visão geral. */
  F: number;
  x0: number;
  y0: number;
  planes: Planes;
  /** Imagem integral da terra ((w+1)×(h+1)). */
  land: Float64Array;
}

export interface GlobalResult extends Located {
  /** Quantos picos a visão geral achou, e o lugar do vencedor entre eles (0 = melhor). */
  peaks: number;
  rank: number;
  /** Margem e NCC acima dos limiares. */
  confident: boolean;
}

export class GlobalLocator {
  private overview: Promise<Overview> | null = null;
  private overviewZ = -1;

  constructor(
    readonly info: MapInfo,
    private readonly read: TileReader,
    private readonly fine: ImageLocator,
    private readonly mask: MinimapMaskOptions,
    private readonly opt: GlobalOptions = DEFAULT_GLOBAL,
  ) {}

  /** Zoom da visão geral: o menor em que o minimapa ainda tem `minTemplate` px. */
  zoomFor(radiusPx: number): number {
    const F = Math.max(1, (2 * radiusPx) / this.opt.minTemplate);
    return Math.max(this.info.minZoom, this.info.maxZoom - Math.floor(Math.log2(F)));
  }

  async locate(crop: Rgba, r: number, radiusPx: number): Promise<GlobalResult | null> {
    const timings: Record<string, number> = {};
    let t0 = performance.now();
    const ov = await this.getOverview(this.zoomFor(radiusPx));
    timings.overviewLoad = performance.now() - t0;

    // 1) visão geral
    t0 = performance.now();
    const mini = minimapPlanes(crop, this.mask);
    const s = radiusPx / r; // px do zoom máximo por px do minimapa
    const fw = Math.max(6, Math.round((mini.width * s) / ov.F));
    const t = compact(resizePlanes(mini, fw, fw));
    const W = ov.planes.width;
    const H = ov.planes.height;
    const off = offsets(t, W);
    const gw = W - fw + 1;
    const gh = H - fw + 1;
    const grid = new Float32Array(Math.max(0, gw * gh)).fill(-2);
    const area = fw * fw;
    const L = ov.land;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const land = L[(y + fw) * (W + 1) + x + fw]! - L[y * (W + 1) + x + fw]! - L[(y + fw) * (W + 1) + x]! + L[y * (W + 1) + x]!;
        if (land < this.opt.minLand * area) continue;
        grid[y * gw + x] = nccAt(ov.planes, t, off, x, y, 0);
      }
    }
    const peaks = localMaxima(grid, gw, gh, 2).slice(0, this.opt.candidates);
    timings.overview = performance.now() - t0;
    if (peaks.length === 0) return null;

    // 2) meio: zoom 4× maior (ou o máximo), busca de ±1,5 px da visão geral
    t0 = performance.now();
    const zm = Math.min(this.info.maxZoom, ov.z + 2);
    const Fm = Math.pow(2, this.info.maxZoom - zm);
    const fm = Math.max(6, Math.round((mini.width * s) / Fm));
    const tm = compact(resizePlanes(mini, fm, fm));
    const rad = Math.ceil((1.5 * ov.F) / Fm) + 1;
    const mids: { px: [number, number]; v: number; rank: number }[] = [];
    for (let i = 0; i < peaks.length; i++) {
      const p = peaks[i]!;
      // centro do pico em px do zoom do meio
      const cx = ((ov.x0 + p.x + fw / 2) * ov.F) / Fm;
      const cy = ((ov.y0 + p.y + fw / 2) * ov.F) / Fm;
      const wx0 = Math.floor(cx - fm / 2 - rad);
      const wy0 = Math.floor(cy - fm / 2 - rad);
      const size = fm + 2 * rad + 1;
      const win = await planesWindow(this.read, this.info, wx0, wy0, size, size, { color: this.mask.color, mask: "none", z: zm });
      const offM = offsets(tm, size);
      let best = { x: 0, y: 0, v: -2 };
      for (let y = 0; y + fm <= size; y++) {
        for (let x = 0; x + fm <= size; x++) {
          const v = nccAt(win, tm, offM, x, y, 0);
          if (v > best.v) best = { x, y, v };
        }
      }
      mids.push({ px: [(wx0 + best.x + fm / 2) * Fm, (wy0 + best.y + fm / 2) * Fm], v: best.v, rank: i });
    }
    mids.sort((a, b) => b.v - a.v);
    timings.mid = performance.now() - t0;

    // 3) fim: camada imagem no zoom máximo em volta dos 3 melhores
    t0 = performance.now();
    const finals: GlobalResult[] = [];
    for (const m of mids.slice(0, 3)) {
      const res = await this.fine.locate(crop, r, radiusPx, m.px, 2 * Fm + 4);
      if (res) finals.push({ ...res, peaks: peaks.length, rank: m.rank, confident: false });
    }
    timings.final = performance.now() - t0;
    finals.sort((a, b) => b.score - a.score);
    const best = finals[0];
    if (!best) return null;
    // margem contra o melhor de OUTRO lugar, medido no mesmo nível (zoom máximo); candidatos que
    // convergem pro mesmo ponto não contam
    const far = (q: { px: [number, number] }) => Math.hypot(q.px[0] - best.px[0], q.px[1] - best.px[1]) > 0.75 * radiusPx;
    let rival = Math.max(-2, ...finals.filter(far).map((q) => q.score));
    if (rival === -2) {
      for (const m of mids.slice(3).filter(far).slice(0, 2)) {
        const res = await this.fine.locate(crop, r, radiusPx, m.px, 2 * Fm + 4);
        if (res && far(res)) rival = Math.max(rival, res.score);
      }
    }
    best.margin = rival > -2 ? best.score - rival : 1;
    best.confident = best.margin >= this.opt.minMargin && best.score >= this.opt.minScore;
    best.timings = { ...timings, ...Object.fromEntries(Object.entries(best.timings).map(([k, v]) => [`final.${k}`, v])) };
    return best;
  }

  private getOverview(z: number): Promise<Overview> {
    if (!this.overview || this.overviewZ !== z) {
      this.overviewZ = z;
      this.overview = this.buildOverview(z);
    }
    return this.overview;
  }

  private async buildOverview(z: number): Promise<Overview> {
    const F = Math.pow(2, this.info.maxZoom - z);
    const b = this.info.bounds;
    const x0 = Math.floor(b.x0 / F);
    const y0 = Math.floor(b.y0 / F);
    const w = Math.ceil(b.x1 / F) - x0;
    const h = Math.ceil(b.y1 / F) - y0;
    const planes = await planesWindow(this.read, this.info, x0, y0, w, h, { color: this.mask.color, mask: "bg", z });
    const land = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += planes.valid![y * w + x]!;
        land[(y + 1) * (w + 1) + x + 1] = land[y * (w + 1) + x + 1]! + row;
      }
    }
    // o NCC usa o mapa inteiro (o fundo também casa); a validade só serve pra achar terra
    return { z, F, x0, y0, planes: { ...planes, valid: null }, land };
  }
}

/** Máximos locais (vizinhança (2n+1)²) de uma grade, do maior pro menor. Valores ≤ -1 = sem dado. */
function localMaxima(grid: Float32Array, w: number, h: number, n: number): { x: number; y: number; v: number }[] {
  const out: { x: number; y: number; v: number }[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = grid[y * w + x]!;
      if (v <= -1) continue;
      let peak = true;
      for (let dy = -n; dy <= n && peak; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -n; dx <= n; dx++) {
          const xx = x + dx;
          if ((dx || dy) && xx >= 0 && xx < w && grid[yy * w + xx]! > v) {
            peak = false;
            break;
          }
        }
      }
      if (peak) out.push({ x, y, v });
    }
  }
  return out.sort((a, b) => b.v - a.v);
}
