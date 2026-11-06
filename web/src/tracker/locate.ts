/**
 * Camada "imagem" do tracker (ticket 19): com a posição anterior conhecida, acha o recorte do
 * minimapa no mapa ativo por NCC mascarada (só translação, escala calibrada) numa janela
 * montada das tiles. Grossa (reduzida f×) em toda a busca, depois fina (1 px do mapa) em volta
 * dos melhores candidatos, com ajuste subpixel. Código puro: roda no Worker e no runner.
 */
import type { Gray, Rgba } from "./image";
import { azureMask } from "./icons";
import { resizeGray } from "./match";

/** Imagem em canais separados (cinza = 1 canal, cor = 3) + validade por pixel (1 = conta). */
export interface Planes {
  width: number;
  height: number;
  chans: Float32Array[];
  valid: Uint8Array | null;
}

export interface MinimapMaskOptions {
  /** Raio do furo central (seta), em fração do raio. */
  hole: number;
  /** Raio útil (a borda tem vinheta escura), em fração do raio. */
  rMax: number;
  /** Mascara o cone de visão claro (detectado pelo perfil angular). */
  cone: boolean;
  /** Mascara pixels muito claros (ícones, setas de missão), em luminância 0–255; 0 = desliga. */
  bright: number;
  /**
   * Mascara os ícones de teleporte/Nexus (grupos da cor deles com até ~60 px a 1440p, pela caixa
   * inteira + 3 px): são sobrepostos ao minimapa e não existem nas tiles.
   */
  icons: boolean;
  color: boolean;
}

export const DEFAULT_MASK: MinimapMaskOptions = { hole: 0.24, rMax: 0.95, cone: true, bright: 230, icons: true, color: false };

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;

/**
 * Cone de visão: setor claro de bordas retas que gira com a câmera. As bordas viram degraus no
 * perfil angular da luminância (passos de 2°), iguais em todos os anéis (0,3–0,9 do raio);
 * bordas do terreno não se repetem assim. Procura a subida e a descida, 46–120° uma da outra,
 * com o maior degrau (mediana dos anéis). Devolve [início, fim] em radianos (atan2, y pra
 * baixo) ou null se o degrau for pequeno.
 */
export function detectCone(crop: Rgba, minStep = 12): { a0: number; a1: number; contrast: number } | null {
  const BINS = 180;
  const RINGS = 4;
  const sum = new Float64Array(BINS * RINGS);
  const cnt = new Float64Array(BINS * RINGS);
  const c = (crop.width - 1) / 2;
  const R = crop.width / 2;
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const i = (y * crop.width + x) * 4;
      if (crop.data[i + 3] === 0) continue;
      const d = Math.hypot(x - c, y - c) / R;
      if (d < 0.3 || d >= 0.9) continue;
      const ring = Math.floor(((d - 0.3) / 0.6) * RINGS);
      const b = Math.floor(((Math.atan2(y - c, x - c) + Math.PI) / (2 * Math.PI)) * BINS) % BINS;
      sum[ring * BINS + b]! += lum(crop.data, i);
      cnt[ring * BINS + b]!++;
    }
  }
  const mean = (ring: number, b: number) => {
    const k = ring * BINS + (((b % BINS) + BINS) % BINS);
    return cnt[k]! ? sum[k]! / cnt[k]! : NaN;
  };
  // degrau na borda entre os bins b-1 e b: média de 2 bins de cada lado, mediana dos anéis
  const step = new Float64Array(BINS);
  const tmp: number[] = [];
  for (let b = 0; b < BINS; b++) {
    tmp.length = 0;
    for (let ring = 0; ring < RINGS; ring++) {
      const v = (mean(ring, b) + mean(ring, b + 1)) / 2 - (mean(ring, b - 2) + mean(ring, b - 1)) / 2;
      if (Number.isFinite(v)) tmp.push(v);
    }
    tmp.sort((p, q) => p - q);
    step[b] = tmp.length ? tmp[tmp.length >> 1]! : 0;
  }
  // contraste do setor (média de todos os anéis) contra o resto
  const bs = new Float64Array(BINS);
  const bn = new Float64Array(BINS);
  let totS = 0;
  let totN = 0;
  for (let ring = 0; ring < RINGS; ring++) {
    for (let b = 0; b < BINS; b++) {
      bs[b]! += sum[ring * BINS + b]!;
      bn[b]! += cnt[ring * BINS + b]!;
      totS += sum[ring * BINS + b]!;
      totN += cnt[ring * BINS + b]!;
    }
  }
  // largura quase fixa nos prints (~60°): 52–80°
  let best: { s: number; w: number; v: number } | null = null;
  for (let s = 0; s < BINS; s++) {
    if (step[s]! <= 0) continue;
    let is = 0;
    let inN = 0;
    for (let k = 0; k < 26; k++) {
      is += bs[(s + k) % BINS]!;
      inN += bn[(s + k) % BINS]!;
    }
    for (let w = 26; w <= 40; w++) {
      const e = (s + w) % BINS;
      if (w > 26) {
        is += bs[(s + w - 1) % BINS]!;
        inN += bn[(s + w - 1) % BINS]!;
      }
      if (inN === 0 || totN - inN === 0) continue;
      const contrast = is / inN - (totS - is) / (totN - inN);
      const v = Math.min(step[s]!, -step[e]!) + contrast;
      if (!best || v > best.v) best = { s, w, v };
    }
  }
  if (!best || best.v < minStep) return null;
  const a0 = (best.s / BINS) * 2 * Math.PI - Math.PI;
  return { a0, a1: a0 + (best.w / BINS) * 2 * Math.PI, contrast: best.v };
}

/** Pra onde a câmera olha: o meio do cone de visão. */
export interface CameraView {
  /** 0 = norte, sentido horário, em graus. */
  deg: number;
  /** Abertura do cone em graus. */
  width: number;
}

/** Direção da câmera pelo cone de visão; null se o cone não aparece (ou está fraco demais). */
export function cameraView(crop: Rgba): CameraView | null {
  const cone = detectCone(crop);
  if (!cone) return null;
  const mid = ((cone.a0 + cone.a1) / 2) * (180 / Math.PI) + 90; // atan2 (0 = leste, y pra baixo) → norte horário
  return { deg: ((mid % 360) + 360) % 360, width: (cone.a1 - cone.a0) * (180 / Math.PI) };
}

/** Canais + máscara do recorte (resolução da tela). */
export function minimapPlanes(crop: Rgba, opt: MinimapMaskOptions): Planes {
  const n = crop.width * crop.height;
  const nc = opt.color ? 3 : 1;
  const chans = Array.from({ length: nc }, () => new Float32Array(n));
  const valid = new Uint8Array(n);
  const c = (crop.width - 1) / 2;
  const R = crop.width / 2;
  const cone = opt.cone ? detectCone(crop) : null;
  const pad = (5 / 180) * Math.PI;
  const inCone = (a: number) => {
    if (!cone) return false;
    let t = a - (cone.a0 - pad);
    while (t < 0) t += 2 * Math.PI;
    while (t >= 2 * Math.PI) t -= 2 * Math.PI;
    return t <= cone.a1 - cone.a0 + 2 * pad;
  };
  const d = crop.data;
  for (let y = 0; y < crop.height; y++) {
    for (let x = 0; x < crop.width; x++) {
      const p = y * crop.width + x;
      const i = p * 4;
      if (nc === 3) {
        chans[0]![p] = d[i]!;
        chans[1]![p] = d[i + 1]!;
        chans[2]![p] = d[i + 2]!;
      } else chans[0]![p] = lum(d, i);
      const r = Math.hypot(x - c, y - c);
      valid[p] = d[i + 3] !== 0 && r >= opt.hole * R && r <= opt.rMax * R && !inCone(Math.atan2(y - c, x - c)) ? 1 : 0;
    }
  }
  if (opt.bright > 0) {
    // claro demais = ícone; tira com 2 px de folga
    const kill = new Uint8Array(n);
    for (let p = 0; p < n; p++) if (lum(d, p * 4) >= opt.bright) kill[p] = 1;
    for (let y = 0; y < crop.height; y++) {
      for (let x = 0; x < crop.width; x++) {
        if (!kill[y * crop.width + x]) continue;
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < crop.width && yy < crop.height) valid[yy * crop.width + xx] = 0;
          }
        }
      }
    }
  }
  if (opt.icons) maskIcons(crop, valid);
  return { width: crop.width, height: crop.height, chans, valid };
}

/** Zera em `valid` a caixa (+3 px) de cada grupo da cor dos ícones com tamanho de ícone. */
function maskIcons(crop: Rgba, valid: Uint8Array): void {
  const W = crop.width;
  const H = crop.height;
  const az = azureMask(crop);
  const k = W / 2 / 126;
  const maxSide = 60 * k;
  const pad = Math.max(2, Math.round(3 * k));
  const seen = new Uint8Array(az.length);
  const stack: number[] = [];
  for (let p0 = 0; p0 < az.length; p0++) {
    if (!az[p0] || seen[p0]) continue;
    let x0 = W;
    let x1 = -1;
    let y0 = H;
    let y1 = -1;
    seen[p0] = 1;
    stack.push(p0);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const q = yy * W + xx;
          if (az[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (x1 - x0 + 1 > maxSide || y1 - y0 + 1 > maxSide) continue;
    for (let y = Math.max(0, y0 - pad); y <= Math.min(H - 1, y1 + pad); y++) {
      for (let x = Math.max(0, x0 - pad); x <= Math.min(W - 1, x1 + pad); x++) valid[y * W + x] = 0;
    }
  }
}

/** Reamostra (por área) canais e máscara; pixel novo só vale se ≥ 99% dele era válido. */
export function resizePlanes(p: Planes, w: number, h: number): Planes {
  const chans = p.chans.map((ch) => resizeGray({ width: p.width, height: p.height, data: ch }, w, h).data);
  let valid: Uint8Array | null = null;
  if (p.valid) {
    const m = new Float32Array(p.valid.length);
    for (let i = 0; i < m.length; i++) m[i] = p.valid[i]!;
    const r = resizeGray({ width: p.width, height: p.height, data: m }, w, h).data;
    valid = new Uint8Array(w * h);
    for (let i = 0; i < r.length; i++) valid[i] = r[i]! >= 0.99 ? 1 : 0;
  }
  return { width: w, height: h, chans, valid };
}

/** Template compacto: só os pixels válidos, por canal, com média zero (usado sem máscara no mapa). */
export interface Tpl {
  width: number;
  height: number;
  xs: Int32Array;
  ys: Int32Array;
  raw: Float32Array[];
  zm: Float32Array[];
  energy: number[];
}

export function compact(p: Planes): Tpl {
  const idx: number[] = [];
  for (let i = 0; i < p.width * p.height; i++) if (!p.valid || p.valid[i]) idx.push(i);
  const xs = Int32Array.from(idx, (i) => i % p.width);
  const ys = Int32Array.from(idx, (i) => Math.floor(i / p.width));
  const raw = p.chans.map((ch) => Float32Array.from(idx, (i) => ch[i]!));
  const zm: Float32Array[] = [];
  const energy: number[] = [];
  for (const r of raw) {
    const mean = r.reduce((a, b) => a + b, 0) / Math.max(1, r.length);
    const z = Float32Array.from(r, (v) => v - mean);
    zm.push(z);
    energy.push(z.reduce((a, b) => a + b * b, 0));
  }
  return { width: p.width, height: p.height, xs, ys, raw, zm, energy };
}

/** NCC (média dos canais) com o canto do template em (x, y). Com máscara no mapa, renormaliza. */
export function nccAt(img: Planes, t: Tpl, off: Int32Array, x: number, y: number, minFrac: number): number {
  const base = y * img.width + x;
  const n = off.length;
  let total = 0;
  if (!img.valid) {
    for (let c = 0; c < t.zm.length; c++) {
      const d = img.chans[c]!;
      const z = t.zm[c]!;
      let s = 0;
      let s2 = 0;
      let st = 0;
      for (let k = 0; k < n; k++) {
        const v = d[base + off[k]!]!;
        s += v;
        s2 += v * v;
        st += v * z[k]!;
      }
      const varI = s2 - (s * s) / n;
      if (varI <= 1e-6 || t.energy[c]! <= 0) return -1;
      total += st / Math.sqrt(varI * t.energy[c]!);
    }
    return total / t.zm.length;
  }
  const m = img.valid;
  for (let c = 0; c < t.raw.length; c++) {
    const d = img.chans[c]!;
    const tr = t.raw[c]!;
    let cnt = 0;
    let si = 0;
    let si2 = 0;
    let st = 0;
    let st2 = 0;
    let sit = 0;
    for (let k = 0; k < n; k++) {
      const o = base + off[k]!;
      if (!m[o]) continue;
      const v = d[o]!;
      const tv = tr[k]!;
      cnt++;
      si += v;
      si2 += v * v;
      st += tv;
      st2 += tv * tv;
      sit += v * tv;
    }
    if (cnt < minFrac * n) return -1;
    const vi = si2 - (si * si) / cnt;
    const vt = st2 - (st * st) / cnt;
    if (vi <= 1e-6 || vt <= 1e-6) return -1;
    total += (sit - (si * st) / cnt) / Math.sqrt(vi * vt);
  }
  return total / t.raw.length;
}

export function offsets(t: Tpl, w: number): Int32Array {
  const off = new Int32Array(t.xs.length);
  for (let k = 0; k < off.length; k++) off[k] = t.ys[k]! * w + t.xs[k]!;
  return off;
}

/** Janela do mapa já pronta pro matching: resolução cheia (px do zoom máximo) e reduzida f×. */
export interface MapWindow {
  x0: number;
  y0: number;
  full: Planes;
  f: number;
  small: Planes;
}

export function makeMapWindow(full: Planes, x0: number, y0: number, f = 4): MapWindow {
  const small = resizePlanes(full, Math.floor(full.width / f), Math.floor(full.height / f));
  return { x0, y0, full, f, small };
}

export interface LocateOptions {
  /** Raio da busca em volta da posição anterior (px do zoom máximo). */
  search: number;
  /** Candidatos da passada grossa refinados na fina. */
  candidates: number;
  /** Fração mínima de pixels válidos sob o template (com máscara no mapa). */
  minValid: number;
}

export const DEFAULT_LOCATE: LocateOptions = { search: 160, candidates: 3, minValid: 0.4 };

export interface Located {
  /** Posição do jogador (centro do minimapa), px do zoom máximo. */
  px: [number, number];
  score: number;
  coarseScore: number;
  /** Diferença entre o melhor e o 2º candidato da grossa (ambiguidade). */
  margin: number;
  timings: Record<string, number>;
}

/**
 * Localiza o minimapa. `mini` = canais do recorte (tela); `s` = px do mapa por px do minimapa
 * (`radiusPx / r`). A janela precisa cobrir prev ± (search + raio).
 */
export function locateByImage(mini: Planes, s: number, prev: [number, number], win: MapWindow, opt: LocateOptions = DEFAULT_LOCATE): Located | null {
  const timings: Record<string, number> = {};
  let t0 = performance.now();
  // template em px do mapa (cheio) e reduzido f×
  const fw = Math.max(8, Math.round(mini.width * s));
  const fullP = resizePlanes(mini, fw, fw);
  const sw = Math.max(4, Math.round(fw / win.f));
  const smallP = resizePlanes(fullP, sw, sw);
  const tf = compact(fullP);
  const ts = compact(smallP);
  timings.template = performance.now() - t0;

  // grossa: canto do template tal que o centro caia em prev ± search
  t0 = performance.now();
  const f = win.f;
  const cx0 = (prev[0] - win.x0) / f - sw / 2;
  const cy0 = (prev[1] - win.y0) / f - sw / 2;
  const rs = opt.search / f;
  const ax = Math.max(0, Math.floor(cx0 - rs));
  const ay = Math.max(0, Math.floor(cy0 - rs));
  const bx = Math.min(win.small.width - sw, Math.ceil(cx0 + rs));
  const by = Math.min(win.small.height - sw, Math.ceil(cy0 + rs));
  if (bx < ax || by < ay) return null;
  const gw = bx - ax + 1;
  const grid = new Float32Array(gw * (by - ay + 1)).fill(-2);
  const offS = offsets(ts, win.small.width);
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      if (Math.hypot(x - cx0, y - cy0) > rs + 1) continue;
      grid[(y - ay) * gw + (x - ax)] = nccAt(win.small, ts, offS, x, y, opt.minValid);
    }
  }
  timings.coarse = performance.now() - t0;

  // candidatos: máximos locais (vizinhança 5×5 na grossa), os melhores primeiro
  const cands: { x: number; y: number; v: number }[] = [];
  const gh = by - ay + 1;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const v = grid[y * gw + x]!;
      if (v <= -1) continue;
      let peak = true;
      for (let dy = -2; dy <= 2 && peak; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if ((dx || dy) && xx >= 0 && yy >= 0 && xx < gw && yy < gh && grid[yy * gw + xx]! > v) {
            peak = false;
            break;
          }
        }
      }
      if (peak) cands.push({ x: x + ax, y: y + ay, v });
    }
  }
  cands.sort((a, b) => b.v - a.v);
  if (cands.length === 0) return null;
  const margin = cands.length > 1 ? cands[0]!.v - cands[1]!.v : 1;

  // fina: em volta dos candidatos, resolução cheia (px do zoom máximo)
  t0 = performance.now();
  const offF = offsets(tf, win.full.width);
  let best: { x: number; y: number; v: number; coarse: number } | null = null;
  // só candidatos perto do melhor; cada um cobre a célula da grossa (±f/2) com folga de 1 px
  for (const c of cands.slice(0, opt.candidates).filter((c) => c.v >= cands[0]!.v - 0.15)) {
    const fx = Math.round((c.x + sw / 2) * f - fw / 2);
    const fy = Math.round((c.y + sw / 2) * f - fw / 2);
    const R = Math.ceil(f / 2) + 1;
    for (let y = fy - R; y <= fy + R; y++) {
      for (let x = fx - R; x <= fx + R; x++) {
        if (x < 0 || y < 0 || x > win.full.width - fw || y > win.full.height - fw) continue;
        const v = nccAt(win.full, tf, offF, x, y, opt.minValid);
        if (!best || v > best.v) best = { x, y, v, coarse: c.v };
      }
    }
  }
  if (!best) return null;
  // subpixel: parábola em x e em y
  const at = (x: number, y: number) => nccAt(win.full, tf, offF, x, y, opt.minValid);
  const para = (m: number, z: number, p: number) => {
    const den = m - 2 * z + p;
    return den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (m - p)) / den)) : 0;
  };
  const ok = best.x > 0 && best.y > 0 && best.x < win.full.width - fw && best.y < win.full.height - fw;
  const sx = ok ? para(at(best.x - 1, best.y), best.v, at(best.x + 1, best.y)) : 0;
  const sy = ok ? para(at(best.x, best.y - 1), best.v, at(best.x, best.y + 1)) : 0;
  timings.fine = performance.now() - t0;
  return {
    px: [win.x0 + best.x + sx + fw / 2, win.y0 + best.y + sy + fw / 2],
    score: best.v,
    coarseScore: best.coarse,
    margin,
    timings,
  };
}

/** Gray (1 canal) → Planes. */
export function planesFromGray(g: Gray, valid: Uint8Array | null = null): Planes {
  return { width: g.width, height: g.height, chans: [g.data], valid };
}
