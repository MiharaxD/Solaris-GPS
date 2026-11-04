/**
 * Dados versionados de cada mapa (data/maps/<name>.json), lidos e gravados pela API local do
 * servidor do Vite (web/server/mapDataPlugin.ts). O formato cresce nos tickets 09+.
 */
export type MapData = Record<string, unknown>;

const CLIENT_HEADER = "X-Solaris-Client";

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === "string") return body.error;
  } catch {
    /* corpo não-JSON */
  }
  return `HTTP ${res.status}`;
}

export async function loadMapData(map: string): Promise<MapData | null> {
  const res = await fetch(`/api/map-data/${encodeURIComponent(map)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await errorText(res));
  const body = (await res.json()) as { data: MapData | null };
  return body.data;
}

/** Grava e devolve o caminho relativo do arquivo (ex.: data/maps/overworld.json). */
export async function saveMapData(map: string, data: MapData): Promise<string> {
  const res = await fetch(`/api/map-data/${encodeURIComponent(map)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", [CLIENT_HEADER]: "web" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await errorText(res));
  return ((await res.json()) as { path: string }).path;
}

/** Alternativa quando a API não está disponível (ex.: build estático): baixa o JSON. */
export function downloadMapData(map: string, data: MapData): void {
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${map}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
