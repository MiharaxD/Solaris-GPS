/**
 * Preferências simples do viewer (mapa ativo, etc.). Progresso e marcadores NÃO ficam aqui:
 * vão pro IndexedDB (ticket 12). localStorage pode falhar (modo privado/bloqueado), então
 * toda leitura/escrita é tolerante.
 */
const PREFIX = "solaris.";

export function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(PREFIX + key, value);
  } catch {
    /* sem persistência: segue funcionando */
  }
}
