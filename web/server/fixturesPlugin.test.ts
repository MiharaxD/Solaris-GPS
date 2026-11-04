import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixturesHandler } from "./fixturesPlugin.ts";
import { CLIENT_HEADER } from "./guards.ts";

let root: string;
let server: Server;
let base: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "solaris-fx-"));
  const handler = createFixturesHandler({ root });
  server = createServer((req, res) => void handler(req, res, () => {
    res.statusCode = 404;
    res.end("next");
  }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const put = (name: string, body: string | Uint8Array, type: string, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/fixtures/${name}`, { method: "PUT", headers: { "Content-Type": type, [CLIENT_HEADER]: "web", ...headers }, body });

describe("/api/fixtures", () => {
  it("grava imagem e anotação e lista", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    expect((await put("overworld-1.png", png, "image/png")).status).toBe(200);
    const ann = { version: 1, map: "overworld", px: [10, 20], image: "overworld-1.png" };
    const r = await put("overworld-1.json", JSON.stringify(ann), "application/json");
    expect(await r.json()).toEqual({ path: "tracker/fixtures/overworld-1.json" });
    expect([...(await readFile(path.join(root, "tracker/fixtures/overworld-1.png")))]).toEqual([...png]);
    const list = await (await fetch(`${base}/api/fixtures`)).json();
    expect(list).toEqual({ fixtures: [ann] });
  });

  it.each(["..%2Fx.json", "a.exe", "A.png", "x%5C..%5Cy.json", "ok.json.png.txt"])("recusa nome %s", async (bad) => {
    const r = await put(bad, "{}", "application/json");
    expect([400, 404]).toContain(r.status);
    expect(await readdir(root)).toEqual([]);
  });

  it("exige header, tipo certo e origem local", async () => {
    expect((await put("a.json", "{}", "application/json", { [CLIENT_HEADER]: "" })).status).toBe(403);
    expect((await put("a.png", "x", "image/jpeg")).status).toBe(415);
    expect((await put("a.json", "[1]", "application/json")).status).toBe(400);
    expect((await put("a.json", "{}", "application/json", { Origin: "https://evil.example" })).status).toBe(403);
  });
});
