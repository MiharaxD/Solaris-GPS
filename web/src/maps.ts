/** Índice de mapas gerado por `tools/build_tiles.py build` (web/public/maps.json). */

/** Limites em pixel do zoom máximo: x = coluna * tileSize, y = linha * tileSize. */
export interface PixelBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface MapInfo {
  /** `name` do manifest: identifica o mapa no app e no tracker. */
  name: string;
  map_id: string;
  tileSize: number;
  minZoom: number;
  maxZoom: number;
  bounds: PixelBounds;
}

interface MapsIndex {
  maps: MapInfo[];
}

function isMapInfo(v: unknown): v is MapInfo {
  if (typeof v !== "object" || v === null) return false;
  const m = v as Record<string, unknown>;
  const b = m.bounds as Record<string, unknown> | undefined;
  return (
    typeof m.name === "string" &&
    typeof m.map_id === "string" &&
    typeof m.tileSize === "number" &&
    typeof m.minZoom === "number" &&
    typeof m.maxZoom === "number" &&
    typeof b === "object" &&
    b !== null &&
    ["x0", "y0", "x1", "y1"].every((k) => typeof b[k] === "number")
  );
}

export async function loadMaps(url = "/maps.json"): Promise<MapInfo[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Não achei ${url} (HTTP ${res.status}). Rode: .venv/Scripts/python tools/build_tiles.py build`,
    );
  }
  const data = (await res.json()) as MapsIndex;
  const maps = Array.isArray(data.maps) ? data.maps.filter(isMapInfo) : [];
  if (maps.length === 0) throw new Error(`${url} não tem mapas válidos`);
  return maps;
}
