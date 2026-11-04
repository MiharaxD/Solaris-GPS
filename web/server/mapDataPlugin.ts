/**
 * Plugin do Vite: GET/PUT /api/map-data/<name> lendo e gravando data/maps/<name>.json.
 * Só existe no servidor de desenvolvimento local (127.0.0.1); as proteções estão em guards.ts.
 */
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { ApiError, guard, readJson, send } from "./guards.ts";
import { MAX_BYTES, MapDataError, MapDataStore, knownMaps } from "./mapData.ts";

export { CLIENT_HEADER } from "./guards.ts";
const ROUTE = /^\/api\/map-data\/([^/?#]+)$/;

export interface MapDataPluginOptions {
  /** Raiz do repositório (onde fica data/maps). */
  root: string;
  mapDataDir?: string;
  indexPath?: string;
}

export function createMapDataHandler(opts: MapDataPluginOptions) {
  const dataDir = path.resolve(opts.root, opts.mapDataDir ?? "data/maps");
  const indexPath = opts.indexPath ?? path.resolve(opts.root, "web/public/maps.json");
  const store = new MapDataStore(dataDir, () => knownMaps(indexPath));

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const match = ROUTE.exec((req.url ?? "").split("?")[0]!);
    if (!match) return next();
    try {
      guard(req, req.method !== "GET");
      const name = decodeURIComponent(match[1]!);
      if (req.method === "GET") {
        send(res, 200, { map: name, data: await store.load(name) });
      } else if (req.method === "PUT") {
        const file = await store.save(name, await readJson(req, MAX_BYTES));
        send(res, 200, { map: name, path: path.relative(opts.root, file).split(path.sep).join("/") });
      } else {
        res.setHeader("Allow", "GET, PUT");
        throw new ApiError("método não permitido", 405);
      }
    } catch (e) {
      const status = e instanceof MapDataError || e instanceof ApiError ? e.status : 500;
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
