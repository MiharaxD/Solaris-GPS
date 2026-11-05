/**
 * Camada "imagem" com estado (ticket 19): guarda a janela do mapa (3×3 tiles em volta da posição
 * anterior, montada das tiles com cache LRU) e só remonta quando a busca sai dela. Usada no
 * Worker do tracker e no runner de fixtures.
 */
import type { MapInfo } from "../maps";
import type { Rgba } from "./image";
import { DEFAULT_LOCATE, DEFAULT_MASK, locateByImage, makeMapWindow, minimapPlanes, type Located, type LocateOptions, type MapWindow, type MinimapMaskOptions } from "./locate";
import { lruTileReader, planesWindow, type TileReader } from "./tiles";

export interface ImageLocatorOptions {
  mask: MinimapMaskOptions;
  locate: LocateOptions;
  /** Redução da passada grossa. */
  f: number;
}

export const DEFAULT_IMAGE_LOCATOR: ImageLocatorOptions = { mask: DEFAULT_MASK, locate: DEFAULT_LOCATE, f: 4 };

export class ImageLocator {
  private readonly read: TileReader;
  private win: MapWindow | null = null;
  private winKey = "";

  constructor(
    readonly info: MapInfo,
    read: TileReader,
    private readonly opt: ImageLocatorOptions = DEFAULT_IMAGE_LOCATOR,
  ) {
    this.read = lruTileReader(read, 36);
  }

  /**
   * `crop` = saída de `cropMinimap` com raio `r` na tela; `radiusPx` = escala salva do mapa;
   * `prev` = posição anterior (px do zoom máximo).
   */
  async locate(crop: Rgba, r: number, radiusPx: number, prev: [number, number], search = this.opt.locate.search): Promise<Located | null> {
    const t0 = performance.now();
    const win = await this.window(prev, search + radiusPx * 1.1 + 2 * this.opt.f + 4);
    const tw = performance.now() - t0;
    const t1 = performance.now();
    const mini = minimapPlanes(crop, this.opt.mask);
    const tm = performance.now() - t1;
    const res = locateByImage(mini, radiusPx / r, prev, win, { ...this.opt.locate, search });
    if (res) {
      res.timings.window = tw;
      res.timings.mask = tm;
    }
    return res;
  }

  /** Janela de tiles inteiras: 3×3 em volta da tile de `prev`, ampliada se `prev ± need` sair dela. */
  private async window(prev: [number, number], need: number): Promise<MapWindow> {
    const ts = this.info.tileSize;
    const pr = Math.floor(prev[1] / ts);
    const pc = Math.floor(prev[0] / ts);
    const r0 = Math.min(pr - 1, Math.floor((prev[1] - need) / ts));
    const r1 = Math.max(pr + 1, Math.floor((prev[1] + need) / ts));
    const c0 = Math.min(pc - 1, Math.floor((prev[0] - need) / ts));
    const c1 = Math.max(pc + 1, Math.floor((prev[0] + need) / ts));
    const key = `${r0},${r1},${c0},${c1}`;
    const cur = this.win;
    // reaproveita se a janela atual já cobre a busca
    if (cur && cur.x0 <= prev[0] - need && cur.y0 <= prev[1] - need && cur.x0 + cur.full.width >= prev[0] + need && cur.y0 + cur.full.height >= prev[1] + need) {
      return cur;
    }
    if (cur && key === this.winKey) return cur;
    const x0 = c0 * ts;
    const y0 = r0 * ts;
    const full = await planesWindow(this.read, this.info, x0, y0, (c1 - c0 + 1) * ts, (r1 - r0 + 1) * ts, { color: this.opt.mask.color, mask: "none" });
    this.win = makeMapWindow(full, x0, y0, this.opt.f);
    this.winKey = key;
    return this.win;
  }
}
