/** Padrões do config.json da raiz, embutidos no bundle pelo vite.config (define). */
export interface AppConfig {
  screen: { width: number; height: number; uiScale: number | null };
  minimap: { shape: "circle" | "square"; centerX: number | null; centerY: number | null; radius: number | null };
}

declare const __SOLARIS_CONFIG__: AppConfig;

export const CONFIG: AppConfig = __SOLARIS_CONFIG__;
