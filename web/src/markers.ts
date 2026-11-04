/**
 * Marcadores de cada mapa, gerados localmente por tools/extract_markers.py a partir do
 * WutheringData (web/public/markers/<name>.json, fora do git). Coordenadas em unidade do jogo:
 * a conversão pra pixel usa a calibração do mapa (data/maps/<name>.json).
 */
export interface GameMarker {
  id: string;
  cat: string;
  /** Subcategoria: tier do baú ou espécie do coletável. */
  sub: string;
  name: string;
  x: number;
  y: number;
  z: number;
  area: string[];
}

export type Shape = "diamond" | "hexagon" | "square" | "triangle" | "circle";

export interface Category {
  id: string;
  label: string;
  color: string;
  shape: Shape;
  /** Visível na primeira vez (as categorias com milhares de pontos começam desligadas). */
  defaultOn: boolean;
  /** Rótulos das subcategorias fixas (as outras usam o próprio nome). */
  subs?: Record<string, { label: string; color: string }>;
}

export const CATEGORIES: readonly Category[] = [
  { id: "beacon", label: "Teleportes", color: "#5ab4ff", shape: "diamond", defaultOn: true },
  { id: "nexus", label: "Nexus", color: "#c58bff", shape: "hexagon", defaultOn: true },
  {
    id: "chest", label: "Baús", color: "#f5c542", shape: "square", defaultOn: true,
    subs: {
      basic: { label: "Básico", color: "#c9d1d6" },
      standard: { label: "Padrão", color: "#6fd08c" },
      advanced: { label: "Avançado", color: "#5ab4ff" },
      premium: { label: "Premium", color: "#f5c542" },
      illusive: { label: "Ilusório", color: "#ff8fd0" },
    },
  },
  { id: "casket", label: "Sonance Caskets", color: "#ff9f43", shape: "triangle", defaultOn: true },
  { id: "plant", label: "Plantas", color: "#7bd389", shape: "circle", defaultOn: false },
  { id: "ore", label: "Minérios", color: "#e0a36b", shape: "circle", defaultOn: false },
  { id: "collectible", label: "Outros coletáveis", color: "#f78fb3", shape: "circle", defaultOn: false },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
const FALLBACK: Category = { id: "?", label: "Outros", color: "#9fb0bc", shape: "circle", defaultOn: false };

export function category(id: string): Category {
  return BY_ID.get(id) ?? FALLBACK;
}

export function subLabel(m: Pick<GameMarker, "cat" | "sub">): string {
  return category(m.cat).subs?.[m.sub]?.label ?? m.sub;
}

export function markerColor(m: Pick<GameMarker, "cat" | "sub">): string {
  const c = category(m.cat);
  return c.subs?.[m.sub]?.color ?? c.color;
}

/** O que está escondido: categorias inteiras e subcategorias ("cat/sub"). */
export interface FilterState {
  hiddenCats: string[];
  hiddenSubs: string[];
}

export function defaultFilter(): FilterState {
  return { hiddenCats: CATEGORIES.filter((c) => !c.defaultOn).map((c) => c.id), hiddenSubs: [] };
}

export function parseFilter(raw: string | null): FilterState {
  try {
    const v = JSON.parse(raw ?? "") as Partial<FilterState>;
    const strings = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []);
    if (v && typeof v === "object") return { hiddenCats: strings(v.hiddenCats), hiddenSubs: strings(v.hiddenSubs) };
  } catch {
    /* preferência ausente ou corrompida */
  }
  return defaultFilter();
}

export function makeVisibility(f: FilterState, ignored: ReadonlySet<string>): (m: GameMarker) => boolean {
  const cats = new Set(f.hiddenCats);
  const subs = new Set(f.hiddenSubs);
  return (m) => !ignored.has(m.id) && !cats.has(m.cat) && !subs.has(`${m.cat}/${m.sub}`);
}

/** Minúsculas e sem acentos, pra busca tolerante ("bau" acha "Baú"). */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function markerText(m: GameMarker): string {
  return fold([m.name, subLabel(m), category(m.cat).label, ...m.area].join(" "));
}

/**
 * Busca por nome, subcategoria, categoria ou área. Todas as palavras precisam aparecer.
 * `texts` é o índice paralelo a `markers` (markerText), pra não recalcular a cada tecla.
 */
export function searchMarkers(markers: readonly GameMarker[], texts: readonly string[], query: string, limit = 50): GameMarker[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const out: GameMarker[] = [];
  for (let i = 0; i < markers.length && out.length < limit; i++) {
    const t = texts[i]!;
    if (words.every((w) => t.includes(w))) out.push(markers[i]!);
  }
  return out;
}

const cache = new Map<string, Promise<GameMarker[]>>();

export function loadMarkers(map: string): Promise<GameMarker[]> {
  let p = cache.get(map);
  if (!p) {
    p = fetch(`/markers/${encodeURIComponent(map)}.json`)
      .then(async (res) => {
        // O Vite devolve index.html (200) pra arquivo inexistente: confira o tipo.
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return [];
        const body = (await res.json()) as { markers?: GameMarker[] };
        return Array.isArray(body.markers) ? body.markers : [];
      })
      .catch(() => []);
    cache.set(map, p);
  }
  return p;
}
