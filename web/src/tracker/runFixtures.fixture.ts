/**
 * Runner dos fixtures: `npm --prefix web run fixtures`. Roda o MESMO pipeline do Worker sobre
 * tracker/fixtures/ (prints anotados pelo botão "Fixture") e tracker/samples/ (recortes do
 * minimapa colados num frame sintético), em 1440p e reduzido pra 1080p, e imprime a tabela.
 * Nos prints anotados, uma tabela por camada: escala (ticket 18) e imagem (ticket 19, com a
 * escala salva em data/maps). As outras camadas entram nos tickets 20–23. Com
 * SOLARIS_DUMP=<pasta>, grava o recorte mascarado de cada caso em PNG.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import sharp from "sharp";
import { expect, it } from "vitest";
import type { MapInfo } from "../maps";
import { embedInFrame, resize, subImage, type Rgba } from "./image";
import type { MinimapRegion } from "./minimap";
import { processFrame, type ReadRect } from "./pipeline";
import { ImageLocator } from "./imageLocator";
import type { Located } from "./locate";
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
const row = (cells: [string, number][]) => cells.map(([t, n]) => pad(t, n)).join(" ").trimEnd();

/** Posições anteriores simuladas pra camada imagem (deslocamento da anotação, px do zoom máximo). */
const PREV: [number, number][] = [[0, 0], [100, 0], [0, -100], [-70, 70]];

it("roda todos os fixtures", async () => {
  const { list, skipped } = cases();
  const infos = mapInfos();
  const readers = new Map<string, TileReader>();
  const locators = new Map<string, ImageLocator>();
  const radii = new Map<string, number[]>();
  const det: string[] = [row([["caso", 44], ["res", 10], ["minimapa (cx, cy, r)", 22], ["conf", 5], ["detect ms", 10], ["crop ms", 8]])];
  const scale: string[] = [row([["caso", 44], ["raio px", 8], ["NCC", 5], ["casou em (dx, dy)", 18], ["ms", 6]])];
  const img: string[] = [
    row([["caso", 44], ["res", 10], ["erro px", 8], ["espalh.", 8], ["NCC", 5], ["margem", 7], ["ms", 6], ["janela ms", 9]]),
  ];
  // 1) detecção em cada print e resolução
  const runs: { c: Case; frame: Rgba; read: ReadRect; region: MinimapRegion | null }[] = [];
  const byRes = new Map<string, MinimapRegion[]>();
  for (const c of list) {
    const variants: Rgba[] = [c.frame];
    if (c.frame.height > 1080) variants.push(resize(c.frame, Math.round((c.frame.width * 1080) / c.frame.height), 1080));
    for (const frame of variants) {
      const read: ReadRect = (x, y, w, h) => subImage(frame, x, y, w, h);
      const res = processFrame(read, frame.width, frame.height, { region: null, detect: true, shape: "circle" });
      const d = res.detection;
      det.push(row([
        [c.name, 44], [`${frame.width}×${frame.height}`, 10],
        [d ? `${d.region.cx.toFixed(0)}, ${d.region.cy.toFixed(0)}, ${d.region.r.toFixed(0)}` : "—", 22],
        [d ? `${Math.round(d.score * 100)}%` : "—", 5], [(res.timings.detect ?? 0).toFixed(1), 10], [(res.timings.crop ?? 0).toFixed(1), 8],
      ]));
      expect(res.crop === null || res.crop.width > 0).toBe(true);
      if (dump && res.crop) {
        mkdirSync(dump, { recursive: true });
        writePng(path.join(dump, `${c.name.replace(/[^\w.-]+/g, "_")}-${frame.height}p.png`), res.crop);
      }
      runs.push({ c, frame, read, region: res.region });
      if (c.px && res.region) {
        const k = `${frame.width}x${frame.height}`;
        byRes.set(k, [...(byRes.get(k) ?? []), res.region]);
      }
    }
  }
  // 2) camadas com uma região só por resolução (mediana das detecções), como o ajuste salvo do
  //    painel Tracker: a detecção oscila uns px no raio e isso vira erro de escala.
  const stable = new Map<string, MinimapRegion>();
  for (const [k, regs] of byRes) {
    const m = (f: (r: MinimapRegion) => number) => median(regs.map(f))!;
    stable.set(k, { cx: m((r) => r.cx), cy: m((r) => r.cy), r: m((r) => r.r), shape: "circle" });
  }
  for (const { c, frame, read, region: detected } of runs) {
    {
      const res_ = `${frame.width}×${frame.height}`;
      const region = stable.get(`${frame.width}x${frame.height}`) ?? detected;
      const res = processFrame(read, frame.width, frame.height, { region, detect: false, shape: "circle" });
      const info = c.map ? infos.get(c.map) : undefined;
      if (!info || !c.px || !res.crop || !res.region) continue;
      let tiles = readers.get(info.name);
      if (!tiles) readers.set(info.name, (tiles = nodeTileReader(info)));

      // escala (ticket 18): só na resolução nativa (a reduzida dá o mesmo raio)
      const saved = savedRadius(info.name);
      if (frame === c.frame) {
        const opts: SweepOptions = { center: saved };
        const w = sweepWindow(c.px, opts);
        const win = await grayWindow(tiles, info, w.x0, w.y0, w.w, w.h);
        const t0 = performance.now();
        const b = sweepScale(res.crop, res.region.r, c.px, win, w.x0, w.y0, opts).best;
        const ms = performance.now() - t0;
        if (b) radii.set(info.name, [...(radii.get(info.name) ?? []), b.radiusPx]);
        scale.push(row([[c.name, 44], [b ? b.radiusPx.toFixed(1) : "—", 8], [b ? b.score.toFixed(2) : "—", 5],
          [b ? `${b.dx.toFixed(0)}, ${b.dy.toFixed(0)}` : "—", 18], [ms.toFixed(0), 6]]));
      }

      // imagem (ticket 19): com a escala salva, partindo de posições anteriores deslocadas
      if (saved === undefined) continue;
      let loc = locators.get(info.name);
      if (!loc) locators.set(info.name, (loc = new ImageLocator(info, tiles)));
      const found: Located[] = [];
      let winMs = 0;
      for (const o of PREV) {
        const L = await loc.locate(res.crop, res.region.r, saved, [c.px[0] + o[0], c.px[1] + o[1]]);
        if (!L) continue;
        found.push(L);
        winMs = Math.max(winMs, L.timings.window ?? 0);
      }
      if (found.length === 0) {
        img.push(row([[c.name, 44], [res_, 10], ["—", 8]]));
        continue;
      }
      const errs = found.map((L) => Math.hypot(L.px[0] - c.px![0], L.px[1] - c.px![1])).sort((a, b) => a - b);
      let spread = 0;
      for (const a of found) for (const b of found) spread = Math.max(spread, Math.hypot(a.px[0] - b.px[0], a.px[1] - b.px[1]));
      const ms = found.map((L) => (L.timings.mask ?? 0) + (L.timings.template ?? 0) + (L.timings.coarse ?? 0) + (L.timings.fine ?? 0));
      img.push(row([
        [c.name, 44], [res_, 10], [errs[errs.length >> 1]!.toFixed(1), 8], [spread.toFixed(1), 8],
        [Math.min(...found.map((L) => L.score)).toFixed(2), 5], [Math.min(...found.map((L) => L.margin)).toFixed(2), 7],
        [(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(0), 6], [winMs.toFixed(0), 9],
      ]));
    }
  }
  for (const [map, found] of radii) {
    const s = [...found].sort((a, b) => a - b);
    scale.push(`escala ${map}: mediana ${median(s)!.toFixed(1)} px de raio (${s.length} prints: ${s.map((r) => r.toFixed(1)).join(", ")})`);
  }
  const prev = PREV.map((o) => `(${o.join(",")})`).join(" ");
  console.log(
    [
      "",
      `${list.length} casos${skipped.length ? `; ignorados: ${skipped.join(", ")}` : ""}`,
      "",
      "DETECÇÃO DO MINIMAPA",
      ...det,
      `As camadas abaixo usam uma região por resolução (mediana das detecções, como o ajuste salvo): ` +
        [...stable].map(([k, r]) => `${k} → ${r.cx}, ${r.cy}, r ${r.r}`).join("; "),
      "",
      "ESCALA (ticket 18; raio do minimapa em px do zoom máximo)",
      ...scale,
      "",
      `IMAGEM (ticket 19; anterior = anotação deslocada ${prev}; erro = mediana da distância à anotação;`,
      "espalh. = maior distância entre os resultados; NCC e margem = os piores)",
      ...img,
      "",
    ].join("\n"),
  );
});
