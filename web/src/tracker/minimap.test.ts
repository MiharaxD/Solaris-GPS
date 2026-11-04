import { describe, expect, it } from "vitest";
import { resize, subImage, type Rgba } from "./image";
import { cropMinimap, detectMinimap, searchCorner } from "./minimap";

/** Frame sintético: fundo com ruído e retângulos, minimapa = disco escuro com anel claro. */
function synthFrame(w: number, h: number, cx: number, cy: number, r: number, seed = 1): Rgba {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = 60 + rnd() * 50;
    data[i * 4] = v;
    data[i * 4 + 1] = v + 20;
    data[i * 4 + 2] = v + 10;
    data[i * 4 + 3] = 255;
  }
  const rect = (x0: number, y0: number, rw: number, rh: number, v: number) => {
    for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) data.fill(v, (y * w + x) * 4, (y * w + x) * 4 + 3);
  };
  rect(Math.round(w * 0.02), Math.round(h * 0.02), Math.round(h * 0.03), Math.round(h * 0.03), 230); // ícones da UI
  rect(Math.round(w * 0.2), Math.round(h * 0.3), Math.round(h * 0.06), Math.round(h * 0.02), 20);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      const i = (y * w + x) * 4;
      if (d < r - 2) {
        // conteúdo do minimapa: estradas claras em linhas
        const road = Math.abs(((x - cx) * 0.7 + (y - cy) * 0.3) % 40) < 3 || Math.abs((y - cy) % 55) < 2;
        const v = road ? 140 : 45 + rnd() * 15;
        data[i] = v;
        data[i + 1] = v + 8;
        data[i + 2] = v;
      } else if (d < r + 1) {
        data[i] = data[i + 1] = data[i + 2] = 215; // anel
      }
    }
  }
  return { width: w, height: h, data };
}

function detectIn(frame: Rgba) {
  const c = searchCorner(frame.width, frame.height);
  return detectMinimap(subImage(frame, 0, 0, c.w, c.h), frame.width, frame.height);
}

describe("detectMinimap", () => {
  it("acha o minimapa a 1440p", () => {
    const f = synthFrame(2560, 1440, 172, 178, 120);
    const d = detectIn(f);
    expect(d).not.toBeNull();
    expect(Math.abs(d!.region.cx - 172)).toBeLessThanOrEqual(2);
    expect(Math.abs(d!.region.cy - 178)).toBeLessThanOrEqual(2);
    expect(Math.abs(d!.region.r - 120)).toBeLessThanOrEqual(2);
    expect(d!.score).toBeGreaterThan(0.5);
  });

  it("acha o mesmo frame reduzido pra 1080p", () => {
    const f = resize(synthFrame(2560, 1440, 172, 178, 120, 7), 1920, 1080);
    const d = detectIn(f)!;
    expect(Math.abs(d.region.cx - 129)).toBeLessThanOrEqual(2);
    expect(Math.abs(d.region.cy - 133.5)).toBeLessThanOrEqual(2);
    expect(Math.abs(d.region.r - 90)).toBeLessThanOrEqual(2);
  });

  it("score baixo quando não há minimapa", () => {
    const f = synthFrame(1920, 1080, -500, -500, 10, 3);
    const d = detectIn(f);
    expect(d === null || d.score < 0.35).toBe(true);
  });
});

describe("cropMinimap", () => {
  it("recorta 2r×2r e zera o alpha fora do círculo", () => {
    const f = synthFrame(400, 400, 200, 200, 50);
    const c = cropMinimap(f, { cx: 200, cy: 200, r: 50, shape: "circle" });
    expect([c.width, c.height]).toEqual([100, 100]);
    expect(c.data[3]).toBe(0); // canto
    expect(c.data[(50 * 100 + 50) * 4 + 3]).toBe(255); // centro
    const sq = cropMinimap(f, { cx: 200, cy: 200, r: 50, shape: "square" });
    expect(sq.data[3]).toBe(255);
  });
});
