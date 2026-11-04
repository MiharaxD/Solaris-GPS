/**
 * Arquivos versionados data/maps/<name>.json ("o que se sabe do mapa": calibração, teleportes
 * manuais, escala do minimapa). Lógica pura (sem HTTP) para poder testar com Vitest.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_BYTES = 2_000_000;

export class MapDataError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Nomes válidos = mapas do índice gerado pelo build_tiles (web/public/maps.json). */
export async function knownMaps(indexPath: string): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await fs.readFile(indexPath, "utf8")) as { maps?: { name?: unknown }[] };
    return new Set(
      (raw.maps ?? []).map((m) => m.name).filter((n): n is string => typeof n === "string" && NAME_RE.test(n)),
    );
  } catch {
    return new Set();
  }
}

export class MapDataStore {
  constructor(
    readonly dir: string,
    private readonly allowed: () => Promise<Set<string>>,
  ) {}

  /** Valida contra regex E contra a lista de mapas reais: impede path traversal. */
  private async file(name: string): Promise<string> {
    if (!NAME_RE.test(name) || !(await this.allowed()).has(name)) {
      throw new MapDataError(`mapa desconhecido: ${JSON.stringify(name)}`, 404);
    }
    return path.join(this.dir, `${name}.json`);
  }

  async load(name: string): Promise<Record<string, unknown> | null> {
    const file = await this.file(name);
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    const data: unknown = JSON.parse(text);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new MapDataError(`${name}.json não contém um objeto JSON`, 500);
    }
    return data as Record<string, unknown>;
  }

  async save(name: string, data: unknown): Promise<string> {
    const file = await this.file(name);
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new MapDataError("o corpo precisa ser um objeto JSON", 400);
    }
    const text = JSON.stringify(data, null, 2) + "\n";
    if (Buffer.byteLength(text) > MAX_BYTES) throw new MapDataError(`dados acima de ${MAX_BYTES} bytes`, 413);
    await fs.mkdir(this.dir, { recursive: true });
    // Escrita atômica: nunca deixa um JSON pela metade.
    const tmp = path.join(this.dir, `.${name}.${process.pid}.${Date.now()}.tmp`);
    try {
      await fs.writeFile(tmp, text, "utf8");
      await fs.rename(tmp, file);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    return file;
  }
}
