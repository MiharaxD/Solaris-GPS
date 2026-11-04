/**
 * Teleportes e Nexus de cada mapa, gerados localmente por tools/extract_refs.py a partir do
 * WutheringData (web/public/refs/<name>.json, fora do git). Mapas sem dados: lista vazia.
 */
export interface GameRef {
  id: string;
  kind: "beacon" | "nexus";
  entityId: number;
  x: number;
  y: number;
  z: number;
  area: string[];
  label: string;
}

const cache = new Map<string, Promise<GameRef[]>>();

export function loadRefs(map: string): Promise<GameRef[]> {
  let p = cache.get(map);
  if (!p) {
    p = fetch(`/refs/${encodeURIComponent(map)}.json`)
      .then(async (res) => {
        // O Vite devolve index.html (200) pra arquivo inexistente: confira o tipo.
        if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return [];
        const body = (await res.json()) as { refs?: GameRef[] };
        return Array.isArray(body.refs) ? body.refs : [];
      })
      .catch(() => []);
    cache.set(map, p);
  }
  return p;
}
