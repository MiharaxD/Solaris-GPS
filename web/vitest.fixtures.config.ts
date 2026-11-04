/// <reference types="vitest/config" />
// Runner dos fixtures do tracker (npm run fixtures): fora do `npm test` porque depende de
// prints locais e é lento. Herda o define do vite.config e troca só a lista de testes.
import { defineConfig } from "vite";
import base from "./vite.config.ts";

export default defineConfig({
  ...base,
  test: { include: ["src/tracker/runFixtures.fixture.ts"], testTimeout: 600_000 },
});
