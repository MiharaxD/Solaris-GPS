import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_HEADER, createMapDataHandler } from "./mapDataPlugin.ts";

let root: string;
let server: Server;
let base: string;
let port: number;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "solaris-"));
  await mkdir(path.join(root, "web/public"), { recursive: true });
  await writeFile(
    path.join(root, "web/public/maps.json"),
    JSON.stringify({ maps: [{ name: "overworld" }, { name: "lahai-roi" }] }),
  );
  const handler = createMapDataHandler({ root });
  server = createServer((req, res) => void handler(req, res, () => {
    res.statusCode = 404;
    res.end("next");
  }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const put = (name: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/map-data/${name}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", [CLIENT_HEADER]: "web", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("/api/map-data", () => {
  it("grava e lê de volta", async () => {
    const data = { calibration: { points: [{ px: [1, 2], game: [3, 4] }] } };
    const r = await put("overworld", data);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ map: "overworld", path: "data/maps/overworld.json" });
    expect(JSON.parse(await readFile(path.join(root, "data/maps/overworld.json"), "utf8"))).toEqual(data);
    const g = await fetch(`${base}/api/map-data/overworld`);
    expect(await g.json()).toEqual({ map: "overworld", data });
  });

  it("mapa sem arquivo devolve data null", async () => {
    const g = await fetch(`${base}/api/map-data/lahai-roi`);
    expect(g.status).toBe(200);
    expect(await g.json()).toEqual({ map: "lahai-roi", data: null });
  });

  it.each(["..%2Fconfig", "..%5Cx", "Overworld", "nao-existe", "a%2Fb"])("recusa nome %s", async (bad) => {
    const r = await put(bad, {});
    expect(r.status).toBe(404);
    const files = await readdir(root);
    expect(files).not.toContain("config.json");
  });

  it("exige header do cliente e JSON objeto", async () => {
    expect((await put("overworld", {}, { [CLIENT_HEADER]: "" })).status).toBe(403);
    expect((await put("overworld", [1, 2])).status).toBe(400);
    expect((await put("overworld", "não é json")).status).toBe(400);
    expect((await put("overworld", {}, { "Content-Type": "text/plain" })).status).toBe(415);
  });

  it("recusa origem estrangeira e Host não-local", async () => {
    expect((await put("overworld", {}, { Origin: "https://site-qualquer.example" })).status).toBe(403);
    expect((await put("overworld", {}, { Origin: `http://127.0.0.1:${port}` })).status).toBe(200);
    // fetch não deixa trocar o Host; http.request deixa (simula DNS rebinding).
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, path: "/api/map-data/overworld", headers: { Host: `evil.example:${port}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("deixa outras rotas passarem", async () => {
    const r = await fetch(`${base}/qualquer`);
    expect(await r.text()).toBe("next");
  });
});
