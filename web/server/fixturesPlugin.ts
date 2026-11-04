/**
 * Plugin do Vite: fixtures do tracker (prints de tela cheia + anotação) em tracker/fixtures/,
 * pasta ignorada pelo git (são prints do jogo).
 *   GET /api/fixtures              → { fixtures: [<anotações>] }
 *   PUT /api/fixtures/<id>.<ext>   → grava a imagem (png/jpg/webp, corpo binário)
 *   PUT /api/fixtures/<id>.json    → grava a anotação (objeto JSON)
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { ApiError, guard, readJson, readRaw, send } from "./guards.ts";

const ROUTE = /^\/api\/fixtures(?:\/([^/?#]+))?$/;
export const FIXTURE_FILE_RE = /^([a-z0-9][a-z0-9_-]{0,80})\.(png|jpg|webp|json)$/;
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
const MAX_IMAGE = 40_000_000;
const MAX_JSON = 200_000;

export interface FixturesPluginOptions {
  root: string;
  fixturesDir?: string;
}

async function atomicWrite(dir: string, name: string, data: Buffer | string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  const tmp = path.join(dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
  return file;
}

async function list(dir: string): Promise<unknown[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: unknown[] = [];
  for (const n of names.filter((n) => n.endsWith(".json") && FIXTURE_FILE_RE.test(n)).sort()) {
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir, n), "utf8")));
    } catch {
      /* anotação corrompida: fica de fora da lista */
    }
  }
  return out;
}

export function createFixturesHandler(opts: FixturesPluginOptions) {
  const dir = path.resolve(opts.root, opts.fixturesDir ?? "tracker/fixtures");

  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const match = ROUTE.exec((req.url ?? "").split("?")[0]!);
    if (!match) return next();
    try {
      guard(req, req.method !== "GET");
      const fileName = match[1] ? decodeURIComponent(match[1]) : null;
      if (req.method === "GET" && !fileName) {
        send(res, 200, { fixtures: await list(dir) });
        return;
      }
      if (req.method !== "PUT" || !fileName) {
        res.setHeader("Allow", "GET, PUT");
        throw new ApiError("método não permitido", 405);
      }
      const m = FIXTURE_FILE_RE.exec(fileName);
      if (!m) throw new ApiError(`nome de fixture inválido: ${JSON.stringify(fileName.slice(0, 90))}`, 400);
      const ext = m[2]!;
      let file: string;
      if (ext === "json") {
        const body = await readJson(req, MAX_JSON);
        if (typeof body !== "object" || body === null || Array.isArray(body)) throw new ApiError("a anotação precisa ser um objeto", 400);
        file = await atomicWrite(dir, fileName, JSON.stringify(body, null, 2) + "\n");
      } else {
        const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim();
        if (type !== IMAGE_TYPES[ext]) throw new ApiError(`Content-Type precisa ser ${IMAGE_TYPES[ext]}`, 415);
        file = await atomicWrite(dir, fileName, await readRaw(req, MAX_IMAGE));
      }
      send(res, 200, { path: path.relative(opts.root, file).split(path.sep).join("/") });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 500;
      send(res, status, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

export function fixturesPlugin(opts: FixturesPluginOptions): Plugin {
  return {
    name: "solaris-fixtures",
    configureServer(server) {
      const handler = createFixturesHandler(opts);
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}
