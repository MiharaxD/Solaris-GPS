/**
 * Ícones de teleporte e Nexus no minimapa (ticket 21), pela cor e pela forma. Os ícones têm um
 * azul-claro saturado (~RGB 60,155,200) que o terreno do minimapa não tem.
 *  - Nexus: anel de ~21,5 px de raio a 1440p (raio do minimapa 126), achado por Hough com raio
 *    fixo. Perto do centro tolera a seta por cima (basta ~30% do anel); longe dela o anel aparece
 *    inteiro, e exigir ~70% evita que o Hough "ache" um anel encostado num teleporte.
 *  - Teleporte: "pilha" vertical ~14×36 px; o que sobra de azul depois dos anéis, agrupado.
 * Código puro: roda no Worker e no runner.
 */
import type { Rgba } from "./image";

export type IconKind = "beacon" | "nexus";

export interface DetectedIcon {
  kind: IconKind;
  /** Centro relativo ao centro do minimapa, em px da tela. */
  dx: number;
  dy: number;
  /** Nexus: fração do anel visível; teleporte: pixels azuis / esperado (até 1). */
  score: number;
}

export interface IconOptions {
  /** Raio do minimapa a que as medidas abaixo se referem (1440p). */
  refRadius: number;
  nexusRadius: number;
  /** Fração mínima do anel (36 setores) com azul pra aceitar um Nexus que a seta pode cobrir. */
  minRing: number;
  /** Idem, com o centro do anel além de `arrowZone` (a seta não alcança o anel). */
  minRingFar: number;
  /** Raio em volta do centro (1440p) em que a seta pode cobrir parte do anel. */
  arrowZone: number;
  /** Pixels azuis mínimos (na escala de referência) pra aceitar um teleporte. */
  minBeaconPixels: number;
}

export const DEFAULT_ICONS: IconOptions = { refRadius: 126, nexusRadius: 21.5, minRing: 0.3, minRingFar: 0.7, arrowZone: 30, minBeaconPixels: 18 };

/**
 * Cor dos ícones (só dentro da máscara do recorte): o azul da borda e o branco-azulado do
 * miolo do anel. Prédios do minimapa são brancos neutros (B ≈ R) e ficam de fora.
 */
export function azureMask(crop: Rgba): Uint8Array {
  const n = crop.width * crop.height;
  const m = new Uint8Array(n);
  const d = crop.data;
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const R = d[i]!;
    const G = d[i + 1]!;
    const B = d[i + 2]!;
    if (d[i + 3] === 0) continue;
    const azure = B >= 140 && G >= 100 && B - R >= 70 && G - R >= 45;
    const pale = B >= 170 && B - R >= 25 && G - R >= 10 && B >= G;
    if (azure || pale) m[p] = 1;
  }
  return m;
}

export function detectIcons(crop: Rgba, r: number, opt: IconOptions = DEFAULT_ICONS): DetectedIcon[] {
  const W = crop.width;
  const H = crop.height;
  const k = r / opt.refRadius;
  const c = (W - 1) / 2;
  const mask = azureMask(crop);
  const pts: number[] = [];
  for (let p = 0; p < mask.length; p++) if (mask[p]) pts.push(p);
  const out: DetectedIcon[] = [];
  if (pts.length === 0) return out;

  // Nexus: Hough com raio fixo (±2 px), votos por pixel da cor dos ícones
  const RN = opt.nexusRadius * k;
  const acc = new Float32Array(W * H);
  const STEPS = 90;
  for (const p of pts) {
    const x = p % W;
    const y = (p - x) / W;
    for (const rad of [RN - 2, RN - 1, RN, RN + 1, RN + 2]) {
      for (let t = 0; t < STEPS; t++) {
        const a = (t / STEPS) * 2 * Math.PI;
        const cx = Math.round(x - rad * Math.cos(a));
        const cy = Math.round(y - rad * Math.sin(a));
        if (cx >= 0 && cy >= 0 && cx < W && cy < H) acc[cy * W + cx]! += 1;
      }
    }
  }
  // picos do acumulador, do maior pro menor, separados por um diâmetro
  const order = Array.from(acc.keys()).filter((i) => acc[i]! > 0).sort((a, b) => acc[b]! - acc[a]!).slice(0, 40);
  const nexus: { x: number; y: number }[] = [];
  for (const i of order) {
    const x = i % W;
    const y = (i - x) / W;
    if (nexus.some((n) => Math.hypot(n.x - x, n.y - y) < 2 * RN)) continue;
    const ring = ringCoverage(mask, crop, x, y, RN);
    const far = Math.hypot(x - c, y - c) > opt.arrowZone * k;
    if (ring >= (far ? opt.minRingFar : opt.minRing)) {
      const fit = refineCenter(mask, W, H, x, y, RN);
      nexus.push(fit);
      out.push({ kind: "nexus", dx: fit.x - c, dy: fit.y - c, score: ring });
    }
  }

  // teleportes: azul que sobra fora dos anéis, agrupado (vizinhança com folga de 3 px)
  const left = new Uint8Array(mask.length);
  for (const p of pts) {
    const x = p % W;
    const y = (p - x) / W;
    if (!nexus.some((n) => Math.hypot(n.x - x, n.y - y) < RN + 3)) left[p] = 1;
  }
  const seen = new Uint8Array(mask.length);
  const gap = Math.max(2, Math.round(3 * k));
  for (const p0 of pts) {
    if (!left[p0] || seen[p0]) continue;
    const comp: number[] = [];
    const stack = [p0];
    seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % W;
      const y = (p - x) / W;
      for (let dy = -gap; dy <= gap; dy++) {
        for (let dx = -gap; dx <= gap; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (left[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    const minPx = opt.minBeaconPixels * k * k;
    if (comp.length < minPx) continue;
    let x0 = W;
    let x1 = 0;
    let y0 = H;
    let y1 = 0;
    for (const p of comp) {
      const x = p % W;
      const y = (p - x) / W;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    // forma da pilha: do tamanho esperado (~17×43 a 1440p; com o brilho de destaque, até ~24×50),
    // tolerando o corte pela seta
    const bw = (x1 - x0 + 1) / k;
    const bh = (y1 - y0 + 1) / k;
    if (bw > 28 || bh > 54 || bh < 8) continue;
    out.push({ kind: "beacon", dx: (x0 + x1) / 2 - c, dy: (y0 + y1) / 2 - c, score: Math.min(1, comp.length / (minPx * 4)) });
  }
  return out;
}

/**
 * Fração dos 36 setores do anel (raio ±1,5 px) que têm azul, contando só os setores dentro do
 * minimapa (um Nexus cortado pela borda não perde pontos pelo que não aparece).
 */
function ringCoverage(mask: Uint8Array, crop: Rgba, cx: number, cy: number, R: number): number {
  const W = crop.width;
  const H = crop.height;
  const SECT = 36;
  const hit = new Uint8Array(SECT);
  const seen = new Uint8Array(SECT);
  const r0 = Math.floor(R - 1.5);
  const r1 = Math.ceil(R + 1.5);
  for (let y = Math.max(0, cy - r1); y <= Math.min(H - 1, cy + r1); y++) {
    for (let x = Math.max(0, cx - r1); x <= Math.min(W - 1, cx + r1); x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d < r0 || d > r1) continue;
      const s = Math.floor(((Math.atan2(y - cy, x - cx) + Math.PI) / (2 * Math.PI)) * SECT) % SECT;
      if (crop.data[(y * W + x) * 4 + 3] !== 0) seen[s] = 1;
      if (mask[y * W + x]) hit[s] = 1;
    }
  }
  let n = 0;
  let v = 0;
  for (let i = 0; i < SECT; i++) {
    n += hit[i]!;
    v += seen[i]!;
  }
  // metade do anel fora do minimapa: pouco pra dizer que é anel
  return v < SECT / 2 ? 0 : n / v;
}

/** Ajuste fino do centro (passo de 0,25 px): minimiza o desvio das distâncias dos pixels do anel ao raio. */
function refineCenter(mask: Uint8Array, W: number, H: number, cx: number, cy: number, R: number): { x: number; y: number } {
  const ring: [number, number][] = [];
  const r1 = Math.ceil(R + 3);
  for (let y = Math.max(0, cy - r1); y <= Math.min(H - 1, cy + r1); y++) {
    for (let x = Math.max(0, cx - r1); x <= Math.min(W - 1, cx + r1); x++) {
      if (!mask[y * W + x]) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(d - R) <= 3) ring.push([x, y]);
    }
  }
  let best = { x: cx, y: cy, e: Infinity };
  for (let oy = -2; oy <= 2; oy += 0.25) {
    for (let ox = -2; ox <= 2; ox += 0.25) {
      let e = 0;
      for (const [x, y] of ring) {
        const d = Math.hypot(x - cx - ox, y - cy - oy) - R;
        e += Math.min(d * d, 9);
      }
      if (e < best.e) best = { x: cx + ox, y: cy + oy, e };
    }
  }
  return { x: best.x, y: best.y };
}
