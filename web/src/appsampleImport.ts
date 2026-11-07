/**
 * Importador do progresso do appsample (wuthering-waves-map.appsample.com). O export deles é só
 * uma lista de ids próprios (`["37794", ...]`); quem diz a que marcador nosso cada id corresponde
 * é a tabela local `/appsample.json`, gerada por `tools/build_appsample.py` (fora do git). Nada
 * do arquivo do usuário é guardado: só os nossos ids viram "encontrado".
 */

/** Script pra colar no console do site do appsample: baixa os ids encontrados da conta Google. */
export const APPSAMPLE_SNIPPET = `(async () => {
  try {
    const db = await new Promise((res, rej) => { const o = indexedDB.open('firebaseLocalStorageDb'); o.onsuccess = () => res(o.result); o.onerror = () => rej(o.error); });
    const rows = await new Promise((res, rej) => { const t = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll(); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
    const e = rows.find(x => x.value && x.value.stsTokenManager && x.value.stsTokenManager.accessToken);
    if (!e) { alert('Sem login. Entre no mapa do appsample com o Google e rode de novo.'); return; }
    const r = await fetch('https://firestore.googleapis.com/v1/projects/hotgames-gg/databases/(default)/documents/ww-users/' + e.value.uid, { headers: { Authorization: 'Bearer ' + e.value.stsTokenManager.accessToken } });
    const doc = await r.json();
    const ids = ((doc.fields && doc.fields.markerIds && doc.fields.markerIds.arrayValue.values) || []).map(v => v.stringValue);
    const payload = JSON.stringify(ids);
    console.log('Solaris GPS: ' + ids.length + ' marcadores. Copie o array abaixo se o download falhar:');
    console.log(payload);
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
      a.download = 'appsample-progresso.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      alert(ids.length + ' marcadores salvos em appsample-progresso.json. Abra esse arquivo no Solaris GPS.');
    } catch (dlErr) {
      alert(ids.length + ' marcadores. O download foi bloqueado: copie a linha [ ... ] do Console.');
    }
  } catch (err) { alert('Falhou: ' + err.message); }
})();`;

export interface AppsampleTable {
  built: string;
  /** id do appsample → [nosso mapa, nosso id, distância em metros]. */
  ids: Record<string, [string, string, number]>;
}

export interface ParsedIds {
  ids: string[];
  invalid: string[];
}

/** Aceita o array do export (strings ou números de dígitos); ignora repetidos. */
export function parseAppsample(text: string): ParsedIds {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim());
  } catch {
    throw new Error("não é JSON válido");
  }
  if (!Array.isArray(raw)) throw new Error('esperava um array de ids, como ["37794", ...]');
  const ids: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const s = typeof item === "string" ? item.trim() : typeof item === "number" ? String(item) : "";
    if (!/^\d{1,12}$/.test(s)) {
      invalid.push((JSON.stringify(item) ?? String(item)).slice(0, 80));
      continue;
    }
    if (seen.has(s)) continue;
    seen.add(s);
    ids.push(s);
  }
  return { ids, invalid };
}

export interface Resolved {
  map: string;
  id: string;
  /** Distância (m) entre a posição do appsample e o nosso marcador. */
  dist: number;
  source: string;
}

export interface Resolution {
  /** Por mapa nosso, na ordem do arquivo. */
  byMap: Map<string, Resolved[]>;
  /** Ids sem correspondência na tabela (tipo que não temos, mapa sem ajuste, longe demais). */
  missing: string[];
  /** Cortados pelo limite de distância. */
  tooFar: number;
}

export function resolveIds(ids: readonly string[], table: AppsampleTable, maxDist = Infinity): Resolution {
  const byMap = new Map<string, Resolved[]>();
  const missing: string[] = [];
  let tooFar = 0;
  for (const source of ids) {
    const hit = table.ids[source];
    if (!hit) {
      missing.push(source);
      continue;
    }
    const [map, id, dist] = hit;
    if (dist > maxDist) {
      tooFar++;
      continue;
    }
    let list = byMap.get(map);
    if (!list) byMap.set(map, (list = []));
    list.push({ map, id, dist, source });
  }
  return { byMap, missing, tooFar };
}

function isTable(v: unknown): v is AppsampleTable {
  if (!v || typeof v !== "object") return false;
  const ids = (v as { ids?: unknown }).ids;
  return !!ids && typeof ids === "object" && !Array.isArray(ids);
}

/** Lê a tabela local; null se ela não foi gerada (o Vite devolve index.html pra arquivo ausente). */
export async function loadAppsampleTable(url = "/appsample.json"): Promise<AppsampleTable | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    const body: unknown = await res.json();
    return isTable(body) ? body : null;
  } catch {
    return null;
  }
}
