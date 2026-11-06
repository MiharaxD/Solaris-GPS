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
  /** Marcadores manuais já vêm em pixel do zoom máximo (sem calibração). */
  px?: [number, number];
  note?: string;
  /** "map" = arquivo do mapa (teleportes do tracker), "personal" = IndexedDB. Ausente = WutheringData. */
  source?: "map" | "personal";
}

import type { MarkerIcon } from "./icons";

export interface Category {
  id: string;
  label: string;
  color: string;
  icon: MarkerIcon;
  /** Visível na primeira vez (as categorias com milhares de pontos começam desligadas). */
  defaultOn: boolean;
  /** Rótulos das subcategorias fixas (as outras usam o próprio nome). */
  subs?: Record<string, { label: string; color: string }>;
}

// Cores do dossiê visual: raridade em cinza → verde → azul → roxo → ouro (ouro só no que é raro)
// e o resto nas famílias dos atributos (Aero, Glacio, Havoc...).
export const CATEGORIES: readonly Category[] = [
  { id: "beacon", label: "Teleportes", color: "#3FD3F2", icon: "beacon", defaultOn: true },
  { id: "nexus", label: "Nexus", color: "#41AEFB", icon: "nexus", defaultOn: true },
  {
    id: "chest", label: "Baús", color: "#E8C46A", icon: "chest", defaultOn: true,
    subs: {
      basic: { label: "Básico", color: "#8A8F98" },
      standard: { label: "Padrão", color: "#5FB36B" },
      advanced: { label: "Avançado", color: "#4C8DE0" },
      premium: { label: "Premium", color: "#E8C46A" },
      illusive: { label: "Ilusório", color: "#A767D8" },
    },
  },
  { id: "casket", label: "Sonance Caskets", color: "#F8E56C", icon: "casket", defaultOn: true },
  { id: "plant", label: "Plantas", color: "#44C4A3", icon: "plant", defaultOn: false },
  { id: "ore", label: "Minérios", color: "#D9925B", icon: "ore", defaultOn: false },
  { id: "collectible", label: "Outros coletáveis", color: "#BE4981", icon: "collectible", defaultOn: false },
  { id: "personal", label: "Pessoais", color: "#EDEFF2", icon: "personal", defaultOn: true },
];

/** Categorias que viram referência do tracker e vão pro arquivo do mapa (não pro IndexedDB). */
export const MAP_FILE_CATS: ReadonlySet<string> = new Set(["beacon", "nexus"]);

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));
const FALLBACK: Category = { id: "?", label: "Outros", color: "#9AA3B2", icon: "dot", defaultOn: false };

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
  return fold([m.name, subLabel(m), category(m.cat).label, ...m.area, m.note ?? ""].join(" "));
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
