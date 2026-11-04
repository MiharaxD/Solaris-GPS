/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { fixturesPlugin } from "./server/fixturesPlugin.ts";
import { mapDataPlugin } from "./server/mapDataPlugin.ts";

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, "..");
const config = JSON.parse(readFileSync(path.join(repoRoot, "config.json"), "utf8")) as {
  mapDataDir?: string;
  fixturesDir?: string;
  screen?: unknown;
  minimap?: unknown;
};

// Só localhost: nada do app fica exposto na rede. CORS desligado: nenhum outro site
// consegue chamar a API local (/api/map-data) a partir do navegador.
export default defineConfig({
  plugins: [
    mapDataPlugin({ root: repoRoot, mapDataDir: config.mapDataDir ?? "data/maps" }),
    fixturesPlugin({ root: repoRoot, fixturesDir: config.fixturesDir ?? "tracker/fixtures" }),
  ],
  // Só os padrões de tela e minimapa vão pro bundle (web/src/config.ts).
  define: { __SOLARIS_CONFIG__: JSON.stringify({ screen: config.screen, minimap: config.minimap }) },
  build: { rollupOptions: { input: { main: path.join(webRoot, "index.html"), lab: path.join(webRoot, "lab.html") } } },
  server: { host: "127.0.0.1", port: 5173, strictPort: true, cors: false },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true, cors: false },
  test: { include: ["server/**/*.test.ts", "src/**/*.test.ts"] },
});
