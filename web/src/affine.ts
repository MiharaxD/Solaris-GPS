/**
 * Transformação afim coordenada de jogo → pixel do zoom máximo do mapa.
 *   px = a·X + b·Y + c
 *   py = d·X + e·Y + f
 * Ajuste por mínimos quadrados com 3+ pontos. As coordenadas do jogo chegam a ~1e8, então
 * normalizamos (centro e escala) antes de resolver pra não perder precisão.
 */
export type Vec2 = readonly [number, number];
export type Affine = readonly [a: number, b: number, c: number, d: number, e: number, f: number];

export interface Pair {
  game: Vec2;
  px: Vec2;
}

export interface FitResult {
  affine: Affine;
  /** Distância (px) entre o previsto e o clicado, na ordem dos pontos. */
  residuals: number[];
  rms: number;
  max: number;
}

export function apply(t: Affine, [x, y]: Vec2): [number, number] {
  return [t[0] * x + t[1] * y + t[2], t[3] * x + t[4] * y + t[5]];
}

export function invert(t: Affine): Affine | null {
  const [a, b, c, d, e, f] = t;
  const det = a * e - b * d;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) return null;
  const ia = e / det;
  const ib = -b / det;
  const id = -d / det;
  const ie = a / det;
  return [ia, ib, -(ia * c + ib * f), id, ie, -(id * c + ie * f)];
}

/** Resolve M·v = r (3x3) por eliminação de Gauss com pivotamento. */
function solve3(m: number[][], r: number[]): number[] | null {
  const A = m.map((row, i) => [...row, r[i]!]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let i = col + 1; i < 3; i++) if (Math.abs(A[i]![col]!) > Math.abs(A[piv]![col]!)) piv = i;
    if (Math.abs(A[piv]![col]!) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    for (let i = 0; i < 3; i++) {
      if (i === col) continue;
      const k = A[i]![col]! / A[col]![col]!;
      for (let j = col; j < 4; j++) A[i]![j]! -= k * A[col]![j]!;
    }
  }
  return [0, 1, 2].map((i) => A[i]![3]! / A[i]![i]!);
}

/** Resolve M·v = r (NxN) por eliminação de Gauss com pivotamento. */
function solveN(m: number[][], r: number[]): number[] | null {
  const n = r.length;
  const A = m.map((row, i) => [...row, r[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let i = col + 1; i < n; i++) if (Math.abs(A[i]![col]!) > Math.abs(A[piv]![col]!)) piv = i;
    if (Math.abs(A[piv]![col]!) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    for (let i = 0; i < n; i++) {
      if (i === col) continue;
      const k = A[i]![col]! / A[col]![col]!;
      for (let j = col; j <= n; j++) A[i]![j]! -= k * A[col]![j]!;
    }
  }
  return A.map((row, i) => row[n]! / row[i]!);
}

/** true se a parte linear inverte orientação (espelhada). */
export function isMirrored(t: Affine): boolean {
  return t[0] * t[4] - t[1] * t[3] < 0;
}

/**
 * Similaridade (escala uniforme + rotação + translação, opcionalmente espelhada) por mínimos
 * quadrados. Precisa de 2+ pontos distintos. Usada antes de haver 3 pontos para a afim.
 *   normal:    px = a·X − b·Y + c,  py = b·X + a·Y + f
 *   espelhada: px = a·X + b·Y + c,  py = b·X − a·Y + f
 */
export function fitSimilarity(pairs: readonly Pair[], mirrored: boolean): Affine | null {
  if (pairs.length < 2) return null;
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p.game[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p.game[1], 0) / n;
  const scale = Math.max(...pairs.map((p) => Math.max(Math.abs(p.game[0] - mx), Math.abs(p.game[1] - my)))) || 1;
  const ata = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  const atb = [0, 0, 0, 0];
  for (const p of pairs) {
    const x = (p.game[0] - mx) / scale;
    const y = (p.game[1] - my) / scale;
    // incógnitas [a, b, c, f]; uma linha por eixo
    const rows: [number[], number][] = mirrored
      ? [[[x, y, 1, 0], p.px[0]], [[-y, x, 0, 1], p.px[1]]]
      : [[[x, -y, 1, 0], p.px[0]], [[y, x, 0, 1], p.px[1]]];
    for (const [row, rhs] of rows) {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) ata[i]![j]! += row[i]! * row[j]!;
        atb[i]! += row[i]! * rhs;
      }
    }
  }
  const v = solveN(ata, atb);
  if (!v) return null;
  const [a, b, c, f] = v as [number, number, number, number];
  // monta a matriz linear no espaço normalizado e desfaz a normalização
  const L: [number, number, number, number] = mirrored ? [a, b, b, -a] : [a, -b, b, a];
  const t: Affine = [
    L[0] / scale,
    L[1] / scale,
    c - (L[0] * mx + L[1] * my) / scale,
    L[2] / scale,
    L[3] / scale,
    f - (L[2] * mx + L[3] * my) / scale,
  ];
  return t;
}

/** Move a transformação para que `pair.game` caia exatamente em `pair.px`. */
export function anchorAt(t: Affine, pair: Pair): Affine {
  const [x, y] = apply(t, pair.game);
  return [t[0], t[1], t[2] + pair.px[0] - x, t[3], t[4], t[5] + pair.px[1] - y];
}

export function fitAffine(pairs: readonly Pair[]): FitResult | null {
  if (pairs.length < 3) return null;
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p.game[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p.game[1], 0) / n;
  const scale = Math.max(...pairs.map((p) => Math.max(Math.abs(p.game[0] - mx), Math.abs(p.game[1] - my)))) || 1;
  const norm = pairs.map((p) => [(p.game[0] - mx) / scale, (p.game[1] - my) / scale] as const);

  // Equações normais: (AᵀA) v = Aᵀb, com linhas A = [xn, yn, 1].
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atbx = [0, 0, 0];
  const atby = [0, 0, 0];
  norm.forEach(([xn, yn], i) => {
    const row = [xn, yn, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) ata[r]![c]! += row[r]! * row[c]!;
      atbx[r]! += row[r]! * pairs[i]!.px[0];
      atby[r]! += row[r]! * pairs[i]!.px[1];
    }
  });
  const vx = solve3(ata, atbx);
  const vy = solve3(ata, atby);
  if (!vx || !vy) return null; // pontos colineares/repetidos

  // Desfaz a normalização: xn = (X - mx)/s.
  const [ax, bx, cx] = vx as [number, number, number];
  const [ay, by, cy] = vy as [number, number, number];
  const affine: Affine = [
    ax / scale,
    bx / scale,
    cx - (ax * mx + bx * my) / scale,
    ay / scale,
    by / scale,
    cy - (ay * mx + by * my) / scale,
  ];
  const residuals = pairs.map((p) => {
    const [x, y] = apply(affine, p.game);
    return Math.hypot(x - p.px[0], y - p.px[1]);
  });
  const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n);
  return { affine, residuals, rms, max: Math.max(...residuals) };
}
