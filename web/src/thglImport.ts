/**
 * Importador do backup de encontrados do th.gl: um array JSON de strings "id@x:y" em
 * coordenada de jogo. Nada do arquivo é guardado: só os ids dos NOSSOS marcadores que casarem
 * por proximidade viram "encontrado" (depois da revisão do usuário).
 */
export interface ThglEntry {
  raw: string;
  id: string;
  x: number;
  y: number;
}

export interface ParseResult {
  entries: ThglEntry[];
  invalid: string[];
}

const NUM = String.raw`[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;
const TAIL = new RegExp(`@\\s*(${NUM})\\s*:\\s*(${NUM})\\s*$`);

/** Aceita o array direto ou texto com ele; ignora repetidos. Lança Error se não for JSON/array. */
export function parseThgl(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    throw new Error("não é JSON válido");
  }
  if (!Array.isArray(raw)) throw new Error('esperava um array de strings "id@x:y"');
  const entries: ThglEntry[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") {
      invalid.push(JSON.stringify(item)?.slice(0, 80) ?? String(item));
      continue;
    }
    const s = item.trim();
    const m = TAIL.exec(s);
    const id = m ? s.slice(0, m.index).trim() : "";
    const x = m ? Number(m[1]) : NaN;
    const y = m ? Number(m[2]) : NaN;
    if (!m || !id || !Number.isFinite(x) || !Number.isFinite(y)) {
      invalid.push(s.slice(0, 80));
      continue;
    }
    if (seen.has(s)) continue;
    seen.add(s);
    entries.push({ raw: s, id, x, y });
  }
  return { entries, invalid };
}

export interface Candidate {
  id: string;
  x: number;
  y: number;
}

export interface Match<T extends Candidate> {
  entry: ThglEntry;
  marker: T;
  /** Distância em unidade do jogo. */
  dist: number;
}

export interface MatchResult<T extends Candidate> {
  matches: Match<T>[];
  unmatched: ThglEntry[];
  /** Fator aplicado às coordenadas do arquivo (o th.gl usa cm; o jogo, 10 000 por metro). */
  scale: number;
  swapped: boolean;
}

/** Escalas testadas: unidade do jogo, cm (×100), mm (×10) e ×0,01. */
const SCALES = [1, 100, 10, 0.01];

/**
 * Casa cada entrada com o marcador mais próximo dentro do raio (unidade do jogo), um pra um,
 * do par mais próximo pro mais distante. Testa escalas e troca de eixos e fica com a que mais
 * casa (o formato exato do th.gl não é documentado).
 */
export function matchEntries<T extends Candidate>(entries: readonly ThglEntry[], markers: readonly T[], radius: number): MatchResult<T> {
  let best: MatchResult<T> | null = null;
  for (const scale of SCALES) {
    for (const swapped of [false, true]) {
      const r = matchOnce(entries, markers, radius, scale, swapped);
      if (!best || r.matches.length > best.matches.length) best = r;
    }
  }
  return best ?? { matches: [], unmatched: [...entries], scale: 1, swapped: false };
}

function matchOnce<T extends Candidate>(
  entries: readonly ThglEntry[],
  markers: readonly T[],
  radius: number,
  scale: number,
  swapped: boolean,
): MatchResult<T> {
  const cell = Math.max(radius, 1);
  const grid = new Map<string, T[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  for (const m of markers) {
    const k = key(Math.floor(m.x / cell), Math.floor(m.y / cell));
    const list = grid.get(k);
    if (list) list.push(m);
    else grid.set(k, [m]);
  }
  const pairs: { e: number; m: T; d: number }[] = [];
  entries.forEach((en, i) => {
    const x = (swapped ? en.y : en.x) * scale;
    const y = (swapped ? en.x : en.y) * scale;
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const m of grid.get(key(cx + dx, cy + dy)) ?? []) {
          const d = Math.hypot(m.x - x, m.y - y);
          if (d <= radius) pairs.push({ e: i, m, d });
        }
      }
    }
  });
  pairs.sort((a, b) => a.d - b.d);
  const usedE = new Set<number>();
  const usedM = new Set<string>();
  const matches: Match<T>[] = [];
  for (const p of pairs) {
    if (usedE.has(p.e) || usedM.has(p.m.id)) continue;
    usedE.add(p.e);
    usedM.add(p.m.id);
    matches.push({ entry: entries[p.e]!, marker: p.m, dist: p.d });
  }
  const unmatched = entries.filter((_, i) => !usedE.has(i));
  return { matches, unmatched, scale, swapped };
}
