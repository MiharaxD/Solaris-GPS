/**
 * Runner dos fixtures: `npm --prefix web run fixtures`. Roda o MESMO pipeline do Worker sobre
 * tracker/fixtures/ (prints anotados pelo botão "Fixture") e tracker/samples/ (recortes do
 * minimapa colados num frame sintético), em 1440p e reduzido pra 1080p, e imprime a tabela.
 * Nos prints anotados, mede também a escala (ticket 18): raio do minimapa em px do zoom máximo,
 * NCC e onde casou em relação à anotação. As colunas de erro das outras camadas entram nos
 * tickets 19–23. Com SOLARIS_DUMP=<pasta>, grava o recorte mascarado de cada caso em PNG.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import sharp from "sharp";
import { expect, it } from "vitest";
import type { MapInfo } from "../maps";
import { embedInFrame, resize, subImage, type Rgba } from "./image";
import { processFrame } from "./pipeline";
import { median, sweepScale, sweepWindow, type SweepOptions } from "./scale";
import { grayWindow, type TileReader } from "./tiles";

const repo = path.resolve(__dirname, "../../..");
const fixturesDir = path.join(repo, "tracker/fixtures");
const samplesDir = path.join(repo, "tracker/samples");
const tilesDir = path.join(repo, "web/public/tiles");
const mapDataDir = path.join(repo, "data/maps");

interface Case {
  name: string;
  frame: Rgba;
  /** Só nos prints anotados. */
  map?: string;
  px?: [number, number];
}

function mapInfos(): Map<string, MapInfo> {
  const file = path.join(repo, "web/public/maps.json");
  if (!existsSync(file)) return new Map();
  const list = (JSON.parse(readFileSync(file, "utf8")) as { maps: MapInfo[] }).maps;
  return new Map(list.map((m) => [m.name, m]));
}

/** Raio salvo em data/maps/<map>.json (vira o centro da busca), se houver. */
function savedRadius(map: string): number | undefined {
  const file = path.join(mapDataDir, `${map}.json`);
  if (!existsSync(file)) return undefined;
  const r = (JSON.parse(readFileSync(file, "utf8")) as { minimapScale?: { radiusPx?: unknown } }).minimapScale?.radiusPx;
  return typeof r === "number" ? r : undefined;
}

function nodeTileReader(info: MapInfo): TileReader {
  const cache = new Map<string, Promise<Rgba | null>>();
  return (row, col) => {
    const key = `${row}_${col}`;
    let p = cache.get(key);
    if (!p) {
      const file = path.join(tilesDir, info.name, String(info.maxZoom), `${key}.webp`);
      p = !existsSync(file) || statSync(file).size === 0
        ? Promise.resolve(null)
        : sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info: i }) => ({
            width: i.width,
            height: i.height,
            data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
          }));
      cache.set(key, p);
    }
    return p;
  };
}

function readPng(file: string): Rgba {
  const png = PNG.sync.read(readFileSync(file));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length) };
}

function cases(): { list: Case[]; skipped: string[] } {
  const list: Case[] = [];
  const skipped: string[] = [];
  if (existsSync(fixturesDir)) {
    for (const f of readdirSync(fixturesDir).filter((n) => n.endsWith(".json")).sort()) {
      const ann = JSON.parse(readFileSync(path.join(fixturesDir, f), "utf8")) as { image?: string; map?: string; px?: [number, number] };
      const img = ann.image ? path.join(fixturesDir, ann.image) : "";
      if (!img.endsWith(".png") || !existsSync(img)) {
        skipped.push(`${f} (só PNG por enquanto)`);
        continue;
      }
      list.push({ name: f.replace(/\.json$/, ""), frame: readPng(img), map: ann.map, px: ann.px });
    }
  }
  if (existsSync(samplesDir)) {
    for (const f of readdirSync(samplesDir).filter((n) => n.endsWith(".png")).sort()) {
      list.push({ name: `amostra:${f}`, frame: embedInFrame(readPng(path.join(samplesDir, f))) });
    }
  }
  return { list, skipped };
}

function writePng(file: string, img: Rgba): void {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data);
  writeFileSync(file, PNG.sync.write(png));
}

const dump = process.env.SOLARIS_DUMP;

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

it("roda todos os fixtures", async () => {
  const { list, skipped } = cases();
  const infos = mapInfos();
  const readers = new Map<string, TileReader>();
  const radii = new Map<string, number[]>();
  const rows: string[] = [];
  rows.push(
    `${pad("caso", 44)} ${pad("res", 10)} ${pad("minimapa (cx, cy, r)", 24)} ${pad("conf", 5)} ${pad("detect ms", 10)} ${pad("crop ms", 8)} ` +
      `${pad("raio px", 8)} ${pad("NCC", 5)} ${pad("casou em (dx, dy)", 18)} escala ms`,
  );
  for (const c of list) {
    const variants: Rgba[] = [c.frame];
    if (c.frame.height > 1080) variants.push(resize(c.frame, Math.round((c.frame.width * 1080) / c.frame.height), 1080));
    for (const frame of variants) {
      const read = (x: number, y: number, w: number, h: number) => subImage(frame, x, y, w, h);
      const res = processFrame(read, frame.width, frame.height, { region: null, detect: true, shape: "circle" });
      const d = res.detection;
      let scaleCols = "";
      const info = c.map ? infos.get(c.map) : undefined;
      if (info && c.px && res.crop && res.region) {
        let read = readers.get(info.name);
        if (!read) readers.set(info.name, (read = nodeTileReader(info)));
        const opts: SweepOptions = { center: savedRadius(info.name) };
        const w = sweepWindow(c.px, opts);
        const win = await grayWindow(read, info, w.x0, w.y0, w.w, w.h);
        const t0 = performance.now();
        const sw = sweepScale(res.crop, res.region.r, c.px, win, w.x0, w.y0, opts);
        const ms = performance.now() - t0;
        const b = sw.best;
        if (b) {
          if (frame === c.frame) radii.set(info.name, [...(radii.get(info.name) ?? []), b.radiusPx]);
          scaleCols = `${pad(b.radiusPx.toFixed(1), 8)} ${pad(b.score.toFixed(2), 5)} ${pad(`${b.dx.toFixed(0)}, ${b.dy.toFixed(0)}`, 18)} ${ms.toFixed(0)}`;
        } else scaleCols = "—";
      }
      rows.push(
        `${pad(c.name, 44)} ${pad(`${frame.width}×${frame.height}`, 10)} ` +
          `${pad(d ? `${d.region.cx.toFixed(0)}, ${d.region.cy.toFixed(0)}, ${d.region.r.toFixed(0)}` : "—", 24)} ` +
          `${pad(d ? `${Math.round(d.score * 100)}%` : "—", 5)} ${pad((res.timings.detect ?? 0).toFixed(1), 10)} ${pad((res.timings.crop ?? 0).toFixed(1), 8)} ${scaleCols}`,
      );
      expect(res.crop === null || res.crop.width > 0).toBe(true);
      if (dump && res.crop) {
        mkdirSync(dump, { recursive: true });
        writePng(path.join(dump, `${c.name.replace(/[^\w.-]+/g, "_")}-${frame.height}p.png`), res.crop);
      }
    }
  }
  for (const [map, found] of radii) {
    const s = [...found].sort((a, b) => a - b);
    rows.push(`\nescala ${map}: mediana ${median(s)!.toFixed(1)} px de raio (${s.length} prints em resolução nativa: ${s.map((r) => r.toFixed(1)).join(", ")})`);
  }
  console.log(`\n${list.length} casos${skipped.length ? `; ignorados: ${skipped.join(", ")}` : ""}\n${rows.join("\n")}\n`);
});
