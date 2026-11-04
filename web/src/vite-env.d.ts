/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL do WebSocket do tracker (padrão ws://127.0.0.1:8765, igual ao config.json). */
  readonly VITE_TRACKER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
