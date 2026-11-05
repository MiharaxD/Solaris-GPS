/**
 * Dados versionados de cada mapa (data/maps/<name>.json), lidos e gravados pela API local do
 * servidor do Vite (web/server/mapDataPlugin.ts). O formato cresce nos tickets 09+.
 */
import { asManualMarker, type ManualMarker } from "./progress";

export type MapData = Record<string, unknown>;

/** Um ponto de calibração: coordenada de jogo ↔ pixel do zoom máximo. */
export interface CalibrationPoint {
  id: string;
  game: [number, number];
  px: [number, number];
  /** Referência do WutheringData usada (ex.: "tp-300011"), se houver. */
  refId?: string;
  label?: string;
}

export interface Calibration {
  points: CalibrationPoint[];
  /** Derivada dos pontos (recalculada ao salvar), pra ferramentas que não refazem o ajuste. */
  affine?: [number, number, number, number, number, number];
  rms?: number;
}

/** Formato de data/maps/<name>.json. Campos desconhecidos são preservados ao salvar. */
export interface MapDataV1 extends MapData {
  version: 1;
  calibration?: Calibration;
  /** Referências do WutheringData que não existem neste mapa no jogo (ids, ex.: "tp-315005"). */
  ignoredRefs?: string[];
  /** Teleportes/Nexus cadastrados à mão (pixel do zoom máximo), referência do tracker. */
  manualMarkers?: ManualMarker[];
  minimapScale?: MinimapScale;
}

/**
 * Escala minimapa→mapa (ticket 18): raio do minimapa em pixel do zoom máximo. Vale pra qualquer
 * resolução e escala de UI (px do mapa por px do minimapa = radiusPx / raio na tela).
 */
export interface MinimapScale {
  /** Mediana de `samples`. */
  radiusPx: number;
  /** Medições aceitas (uma por print), as mais recentes no fim. */
  samples: number[];
}

export function minimapScaleOf(data: MapData | null): MinimapScale | null {
  const s = data?.minimapScale as Partial<MinimapScale> | undefined;
  if (typeof s?.radiusPx !== "number" || !Number.isFinite(s.radiusPx)) return null;
  const samples = Array.isArray(s.samples) ? s.samples.filter((n): n is number => typeof n === "number" && Number.isFinite(n)) : [];
  return { radiusPx: s.radiusPx, samples };
}

/** Marcadores manuais válidos do arquivo do mapa. */
export function manualMarkersOf(data: MapData | null): ManualMarker[] {
  const list = data?.manualMarkers;
  return Array.isArray(list) ? list.map(asManualMarker).filter((m): m is ManualMarker => m !== null) : [];
}

function isPoint(v: unknown): v is CalibrationPoint {
  const p = v as CalibrationPoint;
  const vec = (a: unknown) => Array.isArray(a) && a.length === 2 && a.every((n) => typeof n === "number");
  return typeof v === "object" && v !== null && typeof p.id === "string" && vec(p.game) && vec(p.px);
}

/** Normaliza o que veio do disco (ou nada) para MapDataV1, sem perder campos extras. */
export function asMapDataV1(raw: MapData | null): MapDataV1 {
  const base: MapData = raw ?? {};
  const cal = base.calibration as Partial<Calibration> | undefined;
  const points = Array.isArray(cal?.points) ? cal.points.filter(isPoint) : [];
  return { ...base, version: 1, calibration: { ...cal, points } };
}

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

/**
 * Lê o arquivo do mapa do disco, aplica `patch` por cima e grava. Usado por quem só mexe em
 * uma parte (ex.: marcadores manuais) sem levar junto pontos de calibração não salvos.
 */
export async function patchMapData(map: string, patch: Partial<MapDataV1>): Promise<MapDataV1> {
  const merged: MapDataV1 = { ...asMapDataV1(await loadMapData(map)), ...patch, version: 1 };
  await saveMapData(map, merged);
  return merged;
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
