/**
 * Proteções comuns das APIs locais do Vite contra sites abertos no mesmo navegador: Host
 * precisa ser localhost (DNS rebinding), Origin (se vier) precisa ser o próprio servidor, e
 * escrita exige o header X-Solaris-Client (força preflight CORS; o CORS está desligado).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export const CLIENT_HEADER = "x-solaris-client";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function hostOk(req: IncomingMessage): boolean {
  const host = req.headers.host ?? "";
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0]!;
  return LOCAL_HOSTS.has(name);
}

export function originOk(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // navegação/fetch same-origin GET pode não mandar Origin
  try {
    const u = new URL(origin);
    return LOCAL_HOSTS.has(u.hostname.includes(":") ? `[${u.hostname}]` : u.hostname) && u.host === req.headers.host;
  } catch {
    return false;
  }
}

/** Lança 403 se a requisição não vier do próprio app (e, pra escrita, sem o header). */
export function guard(req: IncomingMessage, write: boolean): void {
  if (!hostOk(req) || !originOk(req)) throw new ApiError("origem não permitida", 403);
  if (write && req.headers[CLIENT_HEADER] !== "web") throw new ApiError("header de cliente ausente", 403);
}

export function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export async function readRaw(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) throw new ApiError("corpo grande demais", 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
    throw new ApiError("Content-Type precisa ser application/json", 415);
  }
  const buf = await readRaw(req, maxBytes);
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    throw new ApiError("JSON inválido", 400);
  }
}
