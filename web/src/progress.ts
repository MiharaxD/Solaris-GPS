/**
 * Progresso do usuário: marcadores encontrados, por mapa, no IndexedDB do navegador.
 * Backup/Restore em JSON (o arquivo fica com o usuário; nada sai do PC).
 * Sem IndexedDB (modo privado/bloqueado), funciona só em memória e avisa.
 */
const DB_NAME = "solaris";
const DB_VERSION = 1;
const STORE = "found";
export const BACKUP_FORMAT = "solaris-gps-backup";

interface FoundRow {
  key: string; // "<mapa>:<id do marcador>"
  map: string;
  id: string;
  at: number;
}

/** Arquivo de backup. `found` = ids encontrados por mapa. */
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  found: Record<string, string[]>;
}

const MAP_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID_RE = /^[\w.:@-]{1,80}$/;

/** Valida um backup lido do disco. Lança Error com mensagem pro usuário. */
export function parseBackup(raw: unknown): Backup {
  const b = raw as Partial<Backup> | null;
  if (!b || typeof b !== "object" || b.format !== BACKUP_FORMAT) {
    throw new Error("não é um backup do Solaris GPS");
  }
  if (b.version !== 1) throw new Error(`versão de backup não suportada (${String(b.version)})`);
  if (!b.found || typeof b.found !== "object" || Array.isArray(b.found)) throw new Error("backup sem a lista de encontrados");
  const found: Record<string, string[]> = {};
  for (const [map, ids] of Object.entries(b.found)) {
    if (!MAP_RE.test(map)) throw new Error(`nome de mapa inválido no backup: ${map.slice(0, 40)}`);
    if (!Array.isArray(ids)) throw new Error(`lista inválida para o mapa ${map}`);
    const ok = ids.filter((x): x is string => typeof x === "string" && ID_RE.test(x));
    if (ok.length !== ids.length) throw new Error(`ids inválidos no mapa ${map}`);
    found[map] = [...new Set(ok)].sort();
  }
  return { format: BACKUP_FORMAT, version: 1, exportedAt: String(b.exportedAt ?? ""), found };
}

export function makeBackup(found: Map<string, Set<string>>, now = new Date()): Backup {
  const out: Record<string, string[]> = {};
  for (const [map, ids] of [...found.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (ids.size) out[map] = [...ids].sort();
  }
  return { format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), found: out };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("erro no IndexedDB"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("transação abortada"));
  });
}

export class ProgressStore {
  /** Cópia em memória de tudo (são poucos milhares de ids). */
  private found = new Map<string, Set<string>>();
  private listeners = new Set<() => void>();

  private constructor(private readonly db: IDBDatabase | null) {}

  /** true se está salvando de verdade (IndexedDB abriu). */
  get persistent(): boolean {
    return this.db !== null;
  }

  static async open(): Promise<ProgressStore> {
    let db: IDBDatabase | null = null;
    try {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const store = r.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("map", "map");
      };
      db = await req(r);
    } catch (e) {
      console.warn("IndexedDB indisponível; progresso só nesta aba.", e);
    }
    const s = new ProgressStore(db);
    if (db) {
      const rows = await req(db.transaction(STORE).objectStore(STORE).getAll() as IDBRequest<FoundRow[]>);
      for (const r of rows) s.set(r.map).add(r.id);
    }
    return s;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private set(map: string): Set<string> {
    let s = this.found.get(map);
    if (!s) {
      s = new Set();
      this.found.set(map, s);
    }
    return s;
  }

  forMap(map: string): ReadonlySet<string> {
    return this.found.get(map) ?? new Set();
  }

  isFound(map: string, id: string): boolean {
    return this.found.get(map)?.has(id) ?? false;
  }

  async setFound(map: string, id: string, value: boolean): Promise<void> {
    if (value) this.set(map).add(id);
    else this.found.get(map)?.delete(id);
    this.emit();
    if (!this.db) return;
    const tx = this.db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (value) store.put({ key: `${map}:${id}`, map, id, at: Date.now() } satisfies FoundRow);
    else store.delete(`${map}:${id}`);
    await done(tx);
  }

  backup(): Backup {
    return makeBackup(this.found);
  }

  /** Substitui todo o progresso pelo do backup. Devolve quantos ids entraram. */
  async restore(b: Backup): Promise<number> {
    const next = new Map<string, Set<string>>();
    let n = 0;
    for (const [map, ids] of Object.entries(b.found)) {
      next.set(map, new Set(ids));
      n += ids.length;
    }
    if (this.db) {
      const tx = this.db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      store.clear();
      const at = Date.now();
      for (const [map, ids] of next) for (const id of ids) store.put({ key: `${map}:${id}`, map, id, at } satisfies FoundRow);
      await done(tx);
    }
    this.found = next;
    this.emit();
    return n;
  }
}

/** Contagem encontrados/total. */
export interface Tally {
  found: number;
  total: number;
}

export function percent(t: Tally): string {
  return t.total ? `${Math.floor((t.found / t.total) * 100)}%` : "–";
}

export interface CategoryTally {
  tally: Tally;
  subs: Map<string, Tally>;
}

/** Encontrados/total do mapa inteiro, por categoria e por subcategoria (sem os ignorados). */
export function tallyMarkers(
  markers: readonly { id: string; cat: string; sub: string }[],
  found: ReadonlySet<string>,
  ignored: ReadonlySet<string>,
): { all: Tally; cats: Map<string, CategoryTally> } {
  const all: Tally = { found: 0, total: 0 };
  const cats = new Map<string, CategoryTally>();
  for (const m of markers) {
    if (ignored.has(m.id)) continue;
    const f = found.has(m.id) ? 1 : 0;
    let c = cats.get(m.cat);
    if (!c) {
      c = { tally: { found: 0, total: 0 }, subs: new Map() };
      cats.set(m.cat, c);
    }
    let s = c.subs.get(m.sub);
    if (!s) {
      s = { found: 0, total: 0 };
      c.subs.set(m.sub, s);
    }
    for (const t of [all, c.tally, s]) {
      t.total++;
      t.found += f;
    }
  }
  return { all, cats };
}
