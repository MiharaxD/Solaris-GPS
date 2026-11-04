/**
 * Runner dos fixtures: `npm --prefix web run fixtures`. Roda o MESMO pipeline do Worker sobre
 * tracker/fixtures/ (prints anotados pelo botão "Fixture") e tracker/samples/ (recortes do
 * minimapa colados num frame sintético), em 1440p e reduzido pra 1080p, e imprime a tabela.
 * As colunas de erro (px) das camadas de posição entram nos tickets 19–23.
 * Com SOLARIS_DUMP=<pasta>, grava o recorte mascarado de cada caso em PNG (pra conferir).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { expect, it } from "vitest";
import { embedInFrame, resize, subImage, type Rgba } from "./image";
import { processFrame } from "./pipeline";

const repo = path.resolve(__dirname, "../../..");
const fixturesDir = path.join(repo, "tracker/fixtures");
const samplesDir = path.join(repo, "tracker/samples");

interface Case {
  name: string;
  frame: Rgba;
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
      const ann = JSON.parse(readFileSync(path.join(fixturesDir, f), "utf8")) as { image?: string };
      const img = ann.image ? path.join(fixturesDir, ann.image) : "";
      if (!img.endsWith(".png") || !existsSync(img)) {
        skipped.push(`${f} (só PNG por enquanto)`);
        continue;
      }
      list.push({ name: f.replace(/\.json$/, ""), frame: readPng(img) });
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

it("roda todos os fixtures", () => {
  const { list, skipped } = cases();
  const rows: string[] = [];
  rows.push(`${pad("caso", 44)} ${pad("res", 10)} ${pad("minimapa (cx, cy, r)", 24)} ${pad("conf", 5)} ${pad("detect ms", 10)} crop ms`);
  for (const c of list) {
    const variants: Rgba[] = [c.frame];
    if (c.frame.height > 1080) variants.push(resize(c.frame, Math.round((c.frame.width * 1080) / c.frame.height), 1080));
    for (const frame of variants) {
      const read = (x: number, y: number, w: number, h: number) => subImage(frame, x, y, w, h);
      const res = processFrame(read, frame.width, frame.height, { region: null, detect: true, shape: "circle" });
      const d = res.detection;
      rows.push(
        `${pad(c.name, 44)} ${pad(`${frame.width}×${frame.height}`, 10)} ` +
          `${pad(d ? `${d.region.cx.toFixed(0)}, ${d.region.cy.toFixed(0)}, ${d.region.r.toFixed(0)}` : "—", 24)} ` +
          `${pad(d ? `${Math.round(d.score * 100)}%` : "—", 5)} ${pad((res.timings.detect ?? 0).toFixed(1), 10)} ${(res.timings.crop ?? 0).toFixed(1)}`,
      );
      expect(res.crop === null || res.crop.width > 0).toBe(true);
      if (dump && res.crop) {
        mkdirSync(dump, { recursive: true });
        writePng(path.join(dump, `${c.name.replace(/[^\w.-]+/g, "_")}-${frame.height}p.png`), res.crop);
      }
    }
  }
  console.log(`\n${list.length} casos${skipped.length ? `; ignorados: ${skipped.join(", ")}` : ""}\n${rows.join("\n")}\n`);
});
