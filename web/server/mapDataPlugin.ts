/**
 * Plugin do Vite: GET/PUT /api/map-data/<name> lendo e gravando data/maps/<name>.json.
 *
 * Só existe no servidor de desenvolvimento local (127.0.0.1). Proteções contra sites abertos no
 * mesmo navegador: Host precisa ser localhost (DNS rebinding), Origin (se vier) precisa ser o
 * próprio servidor, escrita exige o header X-Solaris-Client (força preflight CORS, e o CORS
 * está desligado no vite.config).
 */
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { MAX_BYTES, MapDataError, MapDataStore, knownMaps } from "./mapData";

export const CLIENT_HEADER = "x-solaris-client";
const ROUTE = /^\/api\/map-data\/([^/?#]+)$/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface MapDataPluginOptions {
  /** Raiz do repositório (onde fica data/maps). */
  root: string;
  mapDataDir?: string;
  indexPath?: string;
}

function hostOk(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  return LOCAL_HOSTS.has(name);
}

function originOk(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // navegação/fetch same-origin GET pode não mandar Origin
  try {
    const u = new URL(origin);
    return LOCAL_HOSTS.has(u.hostname.includes(":") ? `[${u.hostname}]` : u.hostname) && u.host === req.headers.host;
  } catch {
    return false;
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BYTES) throw new MapDataError("corpo grande demais", 413);
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new MapDataError("JSON inválido", 400);
  }
}

export function createMapDataHandler(opts: MapDataPluginOptions) {
  const dataDir = path.resolve(opts.root, opts.mapDataDir ?? "data/maps");
  const indexPath = opts.indexPath ?? path.resolve(opts.root, "web/public/maps.json");
  const store = new MapDataStore(dataDir, () => knownMaps(indexPath));

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const match = ROUTE.exec((req.url ?? "").split("?")[0]!);
    if (!match) return next();
    try {
      if (!hostOk(req) || !originOk(req)) throw new MapDataError("origem não permitida", 403);
      const name = decodeURIComponent(match[1]!);
      if (req.method === "GET") {
        send(res, 200, { map: name, data: await store.load(name) });
      } else if (req.method === "PUT") {
        if (req.headers[CLIENT_HEADER] !== "web") throw new MapDataError("header de cliente ausente", 403);
        if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
          throw new MapDataError("Content-Type precisa ser application/json", 415);
        }
        const file = await store.save(name, await readBody(req));
        send(res, 200, { map: name, path: path.relative(opts.root, file).split(path.sep).join("/") });
      } else {
        res.setHeader("Allow", "GET, PUT");
        throw new MapDataError("método não permitido", 405);
      }
    } catch (e) {
      const status = e instanceof MapDataError ? e.status : 500;
      send(res, status, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

export function mapDataPlugin(opts: MapDataPluginOptions): Plugin {
  return {
    name: "solaris-map-data",
    configureServer(server) {
      const handler = createMapDataHandler(opts);
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}
