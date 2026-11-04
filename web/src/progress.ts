/**
 * Dados pessoais do usuário no IndexedDB do navegador: marcadores encontrados e marcadores
 * pessoais (criados à mão), por mapa. Backup/Restore em JSON (o arquivo fica com o usuário;
 * nada sai do PC). Sem IndexedDB (modo privado/bloqueado), funciona só em memória e avisa.
 */
const DB_NAME = "solaris";
const DB_VERSION = 2;
const FOUND = "found";
const PERSONAL = "personal";
export const BACKUP_FORMAT = "solaris-gps-backup";

interface FoundRow {
  key: string; // "<mapa>:<id do marcador>"
  map: string;
  id: string;
  at: number;
}

/** Marcador criado à mão, posicionado em pixel do zoom máximo do mapa. */
export interface ManualMarker {
  id: string;
  cat: string;
  name: string;
  note?: string;
  px: [number, number];
}

interface PersonalRow {
  key: string;
  map: string;
  marker: ManualMarker;
}

/** Arquivo de backup. `found` = ids encontrados por mapa; `personal` = marcadores pessoais. */
export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  found: Record<string, string[]>;
  personal?: Record<string, ManualMarker[]>;
}

const MAP_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID_RE = /^[\w.:@-]{1,80}$/;

/** Valida um marcador manual vindo de fora (disco, backup). null se inválido. */
export function asManualMarker(v: unknown): ManualMarker | null {
  const m = v as Partial<ManualMarker> | null;
  if (!m || typeof m !== "object") return null;
  if (typeof m.id !== "string" || !ID_RE.test(m.id) || typeof m.cat !== "string" || !/^[a-z]{1,32}$/.test(m.cat)) return null;
  if (typeof m.name !== "string" || m.name.length > 200) return null;
  const px = m.px;
  if (!Array.isArray(px) || px.length !== 2 || !px.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  const out: ManualMarker = { id: m.id, cat: m.cat, name: m.name, px: [px[0]!, px[1]!] };
  if (typeof m.note === "string" && m.note) out.note = m.note.slice(0, 2000);
  return out;
}

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
  const out: Backup = { format: BACKUP_FORMAT, version: 1, exportedAt: String(b.exportedAt ?? ""), found };
  if (b.personal !== undefined) {
    if (!b.personal || typeof b.personal !== "object" || Array.isArray(b.personal)) throw new Error("marcadores pessoais inválidos");
    out.personal = {};
    for (const [map, list] of Object.entries(b.personal)) {
      if (!MAP_RE.test(map) || !Array.isArray(list)) throw new Error(`marcadores pessoais inválidos no mapa ${map.slice(0, 40)}`);
      const ok = list.map(asManualMarker);
      if (ok.some((m) => m === null)) throw new Error(`marcador pessoal inválido no mapa ${map}`);
      out.personal[map] = ok as ManualMarker[];
    }
  }
  return out;
}

export function makeBackup(
  found: Map<string, Set<string>>,
  personal: Map<string, Map<string, ManualMarker>> = new Map(),
  now = new Date(),
): Backup {
  const sorted = <T>(m: Map<string, T>) => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const f: Record<string, string[]> = {};
  for (const [map, ids] of sorted(found)) if (ids.size) f[map] = [...ids].sort();
  const b: Backup = { format: BACKUP_FORMAT, version: 1, exportedAt: now.toISOString(), found: f };
  const p: Record<string, ManualMarker[]> = {};
  for (const [map, ms] of sorted(personal)) if (ms.size) p[map] = [...ms.values()].sort((a, c) => a.id.localeCompare(c.id));
  if (Object.keys(p).length) b.personal = p;
  return b;
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
  /** Cópia em memória de tudo (poucos milhares de itens). */
  private found = new Map<string, Set<string>>();
  private personal = new Map<string, Map<string, ManualMarker>>();
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
        const d = r.result;
        if (!d.objectStoreNames.contains(FOUND)) d.createObjectStore(FOUND, { keyPath: "key" }).createIndex("map", "map");
        if (!d.objectStoreNames.contains(PERSONAL)) d.createObjectStore(PERSONAL, { keyPath: "key" });
      };
      db = await req(r);
    } catch (e) {
      console.warn("IndexedDB indisponível; progresso só nesta aba.", e);
    }
    const s = new ProgressStore(db);
    if (db) {
      const tx = db.transaction([FOUND, PERSONAL]);
      const [found, personal] = await Promise.all([
        req(tx.objectStore(FOUND).getAll() as IDBRequest<FoundRow[]>),
        req(tx.objectStore(PERSONAL).getAll() as IDBRequest<PersonalRow[]>),
      ]);
      for (const r of found) s.foundSet(r.map).add(r.id);
      for (const r of personal) {
        const m = asManualMarker(r.marker);
        if (m) s.personalMap(r.map).set(m.id, m);
      }
    }
    return s;
  }

  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private foundSet(map: string): Set<string> {
    let s = this.found.get(map);
    if (!s) this.found.set(map, (s = new Set()));
    return s;
  }

  private personalMap(map: string): Map<string, ManualMarker> {
    let s = this.personal.get(map);
    if (!s) this.personal.set(map, (s = new Map()));
    return s;
  }

  forMap(map: string): ReadonlySet<string> {
    return this.found.get(map) ?? new Set();
  }

  isFound(map: string, id: string): boolean {
    return this.found.get(map)?.has(id) ?? false;
  }

  async setFound(map: string, id: string, value: boolean): Promise<void> {
    await this.setFoundMany(map, [id], value);
  }

  async setFoundMany(map: string, ids: readonly string[], value: boolean): Promise<void> {
    const set = this.foundSet(map);
    for (const id of ids) {
      if (value) set.add(id);
      else set.delete(id);
    }
    this.emit();
    if (!this.db) return;
    const tx = this.db.transaction(FOUND, "readwrite");
    const store = tx.objectStore(FOUND);
    const at = Date.now();
    for (const id of ids) {
      if (value) store.put({ key: `${map}:${id}`, map, id, at } satisfies FoundRow);
      else store.delete(`${map}:${id}`);
    }
    await done(tx);
  }

  personalFor(map: string): ManualMarker[] {
    return [...(this.personal.get(map)?.values() ?? [])];
  }

  async putPersonal(map: string, m: ManualMarker): Promise<void> {
    this.personalMap(map).set(m.id, m);
    this.emit();
    if (!this.db) return;
    const tx = this.db.transaction(PERSONAL, "readwrite");
    tx.objectStore(PERSONAL).put({ key: `${map}:${m.id}`, map, marker: m } satisfies PersonalRow);
    await done(tx);
  }

  async deletePersonal(map: string, id: string): Promise<void> {
    this.personal.get(map)?.delete(id);
    this.emit();
    if (!this.db) return;
    const tx = this.db.transaction(PERSONAL, "readwrite");
    tx.objectStore(PERSONAL).delete(`${map}:${id}`);
    await done(tx);
  }

  backup(): Backup {
    return makeBackup(this.found, this.personal);
  }

  /** Substitui tudo (encontrados e pessoais) pelo backup. Devolve quantos encontrados entraram. */
  async restore(b: Backup): Promise<number> {
    const found = new Map<string, Set<string>>();
    let n = 0;
    for (const [map, ids] of Object.entries(b.found)) {
      found.set(map, new Set(ids));
      n += ids.length;
    }
    const personal = new Map<string, Map<string, ManualMarker>>();
    for (const [map, list] of Object.entries(b.personal ?? {})) personal.set(map, new Map(list.map((m) => [m.id, m])));
    if (this.db) {
      const tx = this.db.transaction([FOUND, PERSONAL], "readwrite");
      const fs = tx.objectStore(FOUND);
      const ps = tx.objectStore(PERSONAL);
      fs.clear();
      ps.clear();
      const at = Date.now();
      for (const [map, ids] of found) for (const id of ids) fs.put({ key: `${map}:${id}`, map, id, at } satisfies FoundRow);
      for (const [map, ms] of personal) for (const m of ms.values()) ps.put({ key: `${map}:${m.id}`, map, marker: m } satisfies PersonalRow);
      await done(tx);
    }
    this.found = found;
    this.personal = personal;
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
