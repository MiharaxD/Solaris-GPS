import { defineConfig } from "vite";

// Só localhost: nada do app fica exposto na rede.
export default defineConfig({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
});
