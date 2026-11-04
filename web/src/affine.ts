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
