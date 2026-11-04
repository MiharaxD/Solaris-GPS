/** Mensagens web↔tracker. Espelho de tracker/protocol.py — mude os dois juntos. */

export const PROTOCOL_VERSION = 1;

/** Dados versionados de um mapa (data/maps/<name>.json). O formato cresce nos tickets 09+. */
export type MapData = Record<string, unknown>;

export type ClientMessage =
  | { type: "hello"; client: "web"; version: number }
  | { type: "set_active_map"; map: string }
  | { type: "save_map_data"; requestId: string; map: string; data: MapData }
  | { type: "get_map_data"; requestId: string; map: string };

export type ServerMessage =
  | { type: "welcome"; server: string; version: number; activeMap: string | null; maps: string[] }
  | { type: "active_map"; map: string | null }
  | { type: "saved"; requestId: string; map: string; path: string }
  | { type: "map_data"; requestId: string; map: string; data: MapData | null }
  | { type: "error"; requestId: string | null; message: string };

const SERVER_TYPES = new Set(["welcome", "active_map", "saved", "map_data", "error"]);

export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const msg: unknown = JSON.parse(raw);
    if (typeof msg === "object" && msg !== null && SERVER_TYPES.has((msg as { type?: unknown }).type as string)) {
      return msg as ServerMessage;
    }
  } catch {
    /* ignora lixo */
  }
  return null;
}
