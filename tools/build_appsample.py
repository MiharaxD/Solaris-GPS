#!/usr/bin/env python3
"""Tabela appsample → marcadores do Solaris, pro importador de progresso do appsample.

O export do appsample (wuthering-waves-map.appsample.com) é só uma lista de ids deles
(`["37794", ...]`), sem posição. Este script lê a base de marcadores deles
(`markers_all.v3.json`), acha a posição de cada id em coordenada de jogo e casa com os
nossos marcadores (web/public/markers/<name>.json, do WutheringData).

Como a base deles funciona:
- `lng`/`lat` vêm cifrados quando `code` > 0: cada dígito 1–9 é trocado pela posição dele em
  "0" + produto(CODES[code]) (o próprio site decifra assim no navegador).
- Cada `mid` é um mapa deles (Huanglong, Rinascita, Lahai-Roi...) com escala própria. Em todos,
  x = s·lng + bx e y = −s·lat + by. Achamos s, bx, by com os teleportes (Nexus z1, Beacon z2),
  por pares de pontos vizinhos, e refinamos por mínimos quadrados em todos os marcadores.
- O tipo deles → nossa categoria é descoberto pela maioria dos vizinhos após o ajuste; tipos sem
  correspondência (inimigos, etc.) ficam de fora.

Saída (gitignored, derivada de dados de terceiros): web/public/appsample.json
    {"source": "appsample", "built": "...", "maps": {"<mid>": {...diagnóstico}},
     "ids": {"<id do appsample>": ["<nosso mapa>", "<nosso id>", <distância em m>]}}

Uso:
    .venv/Scripts/python tools/build_appsample.py --download   # baixa a base (rede, só com pedido)
    .venv/Scripts/python tools/build_appsample.py              # só lê o disco
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parent.parent
SRC_URL = "https://game-data.lemonapi.com/ww/markers_all.v3.json"
DEFAULT_SRC = ROOT / "assets" / "appsample" / "markers_all.v3.json"
DEFAULT_OUT = ROOT / "web" / "public" / "appsample.json"

# Chaves da cifra, copiadas do bundle do site (`codes`).
CODES: dict[int, list[int]] = {
    1: [4463, 127, 3, 3, 2, 31],
    2: [2, 3, 3, 3, 7, 11, 67, 773],
    3: [3, 3, 3, 7, 11, 67, 773],
}
# Nomes dos mapas deles (chave `key` do bundle), só pro diagnóstico.
MID_KEYS: dict[int, str] = {
    1: "main", 2: "tethys-deep", 3: "rinascita", 4: "riccioli", 5: "vault", 6: "beohr-waters",
    7: "avinoleum", 8: "septimont", 9: "fabricatorium-of-the-deep", 10: "sanguis-plateaus",
    30: "lahai-roi", 31: "frostlands-surface", 33: "dimmr-plains", 35: "mengzhou",
}
TELEPORT_TYPES = {"z1", "z2"}
TELEPORT_CATS = {"nexus", "beacon"}
# Tipos usados no ajuste, por espécie comparável dos dois lados.
FIT_KINDS_A = {"z1": "tp", "z2": "tp", "z7": "chest"}
FIT_KINDS_B = {"nexus": "tp", "beacon": "tp", "chest": "chest"}
# Tipos de nome conhecido (bundle do site): valem mesmo se a maioria não casar, porque o tipo
# deles junta coisas que não temos (z3 = "Sonance Casket / Windchimer").
FIXED_TYPES = {"z1": "nexus", "z2": "beacon", "z3": "casket", "z7": "chest"}

FIT_TOL = 150_000.0     # 15 m: tolerância pra contar inlier no ajuste (unidade do jogo)
TYPE_TOL = 100_000.0    # 10 m: raio usado pra descobrir a categoria de cada tipo
MATCH_TOL = 500_000.0   # 50 m: raio máximo do casamento final (o appsample erra a posição em
                        # dezenas de metros às vezes; os pares mais próximos casam primeiro)
MIN_TYPE_RATE = 0.5     # fração de um tipo que precisa casar pra ele valer
MIN_TYPE_SHARE = 0.7    # fração da categoria majoritária entre os casados
MIN_FIT_RATE = 0.4      # fração dos teleportes e baús que precisa casar pro ajuste valer


@dataclass
class Fit:
    map: str
    s: float
    bx: float
    by: float
    inliers: int
    total: int

    def apply(self, p: np.ndarray) -> np.ndarray:
        return np.c_[self.s * p[:, 0] + self.bx, -self.s * p[:, 1] + self.by]


def decipher(value: float | int | str, key: str) -> float:
    """Desfaz a troca de dígitos do appsample (mesma regra do site, sobre o texto do número)."""
    text = value if isinstance(value, str) else json.dumps(value)
    return float(re.sub(r"[1-9]", lambda m: str(key.index(m.group())), text))


def load_appsample(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    headers: list[str] = raw["headers"]
    code = int(raw.get("code") or 0)
    key = ""
    if code:
        if code not in CODES:
            raise SystemExit(f"code {code} desconhecido: atualize CODES a partir do bundle do site")
        prod = 1
        for f in CODES[code]:
            prod *= f
        key = "0" + str(prod)
    rows: list[dict[str, Any]] = []
    for r in raw["data"]:
        row = dict(zip(headers, r))
        if key:
            row["lng"] = decipher(row["lng"], key)
            row["lat"] = decipher(row["lat"], key)
        row["id"] = str(row["id"])
        rows.append(row)
    return rows


def load_ours(markers_dir: Path) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for f in sorted(markers_dir.glob("*.json")):
        out[f.stem] = json.loads(f.read_text(encoding="utf-8"))["markers"]
    return out


class Scorer:
    """Conta inliers só entre marcadores do mesmo tipo (teleporte com teleporte, baú com baú):
    contra todos os marcadores, a densidade de plantas do Overworld casa qualquer chute."""

    def __init__(self, rows: list[dict[str, Any]], ms: list[dict[str, Any]]) -> None:
        self.parts: list[tuple[np.ndarray, cKDTree, np.ndarray]] = []
        for kind in sorted(set(FIT_KINDS_A.values())):
            a = [r for r in rows if FIT_KINDS_A.get(r["type"]) == kind]
            b = [m for m in ms if FIT_KINDS_B.get(m["cat"]) == kind]
            if a and b:
                bxy = np.array([[m["x"], m["y"]] for m in b], float)
                self.parts.append((np.array([[r["lng"], r["lat"]] for r in a], float), cKDTree(bxy), bxy))
        self.total = sum(len(a) for a, _, _ in self.parts)

    def raw(self, s: np.ndarray, bx: np.ndarray, by: np.ndarray) -> np.ndarray:
        n = np.zeros(len(s), int)
        for a, tree, _ in self.parts:
            pts = np.stack([s[:, None] * a[None, :, 0] + bx[:, None], -s[:, None] * a[None, :, 1] + by[:, None]], -1)
            d, _ = tree.query(pts.reshape(-1, 2), distance_upper_bound=FIT_TOL)
            n += np.isfinite(d).reshape(len(s), len(a)).sum(1)
        return n

    def unique(self, fit: "Fit") -> int:
        n = 0
        for a, tree, _ in self.parts:
            d, j = tree.query(fit.apply(a), distance_upper_bound=FIT_TOL)
            n += len(set(j[np.isfinite(d)].tolist()))
        return n

    def refine(self, fit: "Fit") -> "Fit":
        """Mínimos quadrados de (s, bx, by) nos pares mais próximos, algumas iterações."""
        for _ in range(5):
            mats: list[np.ndarray] = []
            rhs: list[np.ndarray] = []
            for a, tree, bxy in self.parts:
                d, j = tree.query(fit.apply(a), distance_upper_bound=FIT_TOL)
                k = np.isfinite(d)
                if not k.any():
                    continue
                # x = s·lng + bx ; y = −s·lat + by  →  sistema linear em (s, bx, by)
                m = np.zeros((2 * int(k.sum()), 3))
                m[0::2, 0], m[0::2, 1] = a[k, 0], 1
                m[1::2, 0], m[1::2, 2] = -a[k, 1], 1
                mats.append(m)
                rhs.append(bxy[j[k]].reshape(-1))
            if sum(len(r) for r in rhs) < 6:
                break
            s, bx, by = np.linalg.lstsq(np.vstack(mats), np.concatenate(rhs), rcond=None)[0]
            fit = Fit(fit.map, float(s), float(bx), float(by), 0, self.total)
        fit.inliers = self.unique(fit)
        fit.total = self.total
        return fit


def search(p: np.ndarray, b: np.ndarray, b_pairs: np.ndarray, scorer: Scorer, name: str) -> Fit | None:
    """Melhor ajuste com orientação fixa, por pares (ponto, vizinho) de `p` contra os pares
    `b_pairs` (índices i→j) de `b`."""
    k = min(3, len(p))
    _, nbr = cKDTree(p).query(p, k)
    bi, bj = b_pairs[:, 0], b_pairs[:, 1]
    db = b[bj] - b[bi]
    lb = np.hypot(db[:, 0], db[:, 1])
    best: Fit | None = None
    for p1 in range(len(p)):
        for p2 in np.atleast_1d(nbr[p1])[1:]:
            dp = np.array([p[p2, 0] - p[p1, 0], -(p[p2, 1] - p[p1, 1])])
            n2 = float(dp @ dp)
            if n2 == 0:
                continue
            s = (db @ dp) / n2
            # Mesmo ângulo (orientação fixa): o resíduo perpendicular tem que ser pequeno.
            perp = np.abs(db[:, 0] * dp[1] - db[:, 1] * dp[0]) / np.sqrt(n2)
            hs = np.flatnonzero((s > 0) & (perp < 0.05 * lb + 1))
            if not len(hs):
                continue
            sh = s[hs]
            bx = b[bi[hs], 0] - sh * p[p1, 0]
            by = b[bi[hs], 1] + sh * p[p1, 1]
            raw = scorer.raw(sh, bx, by)
            # A contagem bruta deixa passar escalas degeneradas (tudo num ponto só); a final é
            # um pra um.
            for t in np.argsort(-raw)[:10]:
                if best is not None and raw[t] <= best.inliers:
                    break
                f = Fit(name, float(sh[t]), float(bx[t]), float(by[t]), 0, scorer.total)
                f.inliers = scorer.unique(f)
                if best is None or f.inliers > best.inliers:
                    best = f
    return best


def knn_pairs(b: np.ndarray, k: int) -> np.ndarray:
    _, nbr = cKDTree(b).query(b, min(k + 1, len(b)))
    pairs = [(i, j) for i in range(len(b)) for j in np.atleast_1d(nbr[i])[1:]]
    return np.array(pairs, dtype=int)


def fit_mid(mid: int, rows: list[dict[str, Any]], ours: dict[str, list[dict[str, Any]]]) -> Fit | None:
    tps = [r for r in rows if r["type"] in TELEPORT_TYPES]
    use_tp = len(tps) >= 4
    gen = tps if use_tp else [r for r in rows if r["type"] in FIT_KINDS_A]
    if len(gen) < 2:
        print(f"  mid {mid} ({MID_KEYS.get(mid, '?')}): sem teleportes nem baús pra ajustar")
        return None
    p = np.array([[r["lng"], r["lat"]] for r in gen], float)
    best: Fit | None = None
    for name, ms in ours.items():
        if use_tp:
            sel = [m for m in ms if m["cat"] in TELEPORT_CATS]
        else:
            sel = [m for m in ms if m["cat"] in FIT_KINDS_B]
        if len(sel) < 2:
            continue
        b = np.array([[m["x"], m["y"]] for m in sel], float)
        if use_tp:
            ii, jj = np.meshgrid(np.arange(len(b)), np.arange(len(b)))
            pairs = np.c_[ii.ravel(), jj.ravel()]
            pairs = pairs[pairs[:, 0] != pairs[:, 1]]
        else:
            pairs = knn_pairs(b, 12)
        scorer = Scorer(rows, ms)
        f = search(p, b, pairs, scorer, name)
        if f is None or f.inliers < 3:
            continue
        f = scorer.refine(f)
        if best is None or f.inliers > best.inliers:
            best = f
    if best is None or best.inliers < max(3, MIN_FIT_RATE * best.total):
        print(f"  mid {mid} ({MID_KEYS.get(mid, '?')}): sem ajuste confiável"
              + (f" (melhor {best.map}: {best.inliers}/{best.total})" if best else ""))
        return None
    print(f"  mid {mid} ({MID_KEYS.get(mid, '?')}) → {best.map}: {best.inliers}/{best.total} "
          f"teleportes e baús, s={best.s:.6g}")
    return best


def type_categories(placed: list[tuple[dict[str, Any], str, np.ndarray]],
                    ours: dict[str, list[dict[str, Any]]]) -> dict[str, str]:
    """Tipo do appsample → nossa categoria, pela maioria dos vizinhos dentro do raio."""
    trees = {n: cKDTree(np.array([[m["x"], m["y"]] for m in ms], float)) for n, ms in ours.items() if ms}
    seen: dict[str, Counter[str]] = defaultdict(Counter)
    totals: Counter[str] = Counter()
    for row, name, xy in placed:
        totals[row["type"]] += 1
        d, j = trees[name].query(xy, distance_upper_bound=TYPE_TOL)
        if np.isfinite(d):
            seen[row["type"]][ours[name][int(j)]["cat"]] += 1
    out: dict[str, str] = dict(FIXED_TYPES)
    for t, total in totals.items():
        if t in out:
            continue
        c = seen.get(t)
        if not c:
            continue
        cat, n = c.most_common(1)[0]
        hit = sum(c.values())
        if hit / total >= MIN_TYPE_RATE and n / hit >= MIN_TYPE_SHARE:
            out[t] = cat
    return out


def match_all(placed: list[tuple[dict[str, Any], str, np.ndarray]], cats: dict[str, str],
              ours: dict[str, list[dict[str, Any]]]) -> dict[str, list[str | float]]:
    """Casamento um pra um, do par mais próximo pro mais distante, só na mesma categoria."""
    by_key: dict[tuple[str, str], tuple[cKDTree, list[dict[str, Any]]]] = {}
    for name, ms in ours.items():
        groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for m in ms:
            groups[m["cat"]].append(m)
        for cat, g in groups.items():
            by_key[(name, cat)] = (cKDTree(np.array([[m["x"], m["y"]] for m in g], float)), g)
    pairs: list[tuple[float, str, str, str]] = []
    for row, name, xy in placed:
        cat = cats.get(row["type"])
        entry = by_key.get((name, cat)) if cat else None
        if not entry:
            continue
        tree, g = entry
        ds, js = tree.query(xy, k=min(5, len(g)), distance_upper_bound=MATCH_TOL)
        for d, j in zip(np.atleast_1d(ds), np.atleast_1d(js)):
            if np.isfinite(d):
                pairs.append((float(d), row["id"], name, g[int(j)]["id"]))
    pairs.sort()
    used_a: set[str] = set()
    used_b: set[tuple[str, str]] = set()
    out: dict[str, list[str | float]] = {}
    for d, aid, name, bid in pairs:
        if aid in used_a or (name, bid) in used_b:
            continue
        used_a.add(aid)
        used_b.add((name, bid))
        out[aid] = [name, bid, round(d / 10_000, 1)]  # distância em metros
    return out


def download(dest: Path) -> None:
    import requests

    dest.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(SRC_URL, timeout=60)
    r.raise_for_status()
    dest.write_bytes(r.content)
    print(f"baixado {SRC_URL} → {dest.relative_to(ROOT)}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--src", type=Path, default=DEFAULT_SRC)
    ap.add_argument("--markers", type=Path, default=ROOT / "web" / "public" / "markers")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--download", action="store_true", help="baixa a base do appsample antes (rede)")
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

    if args.download:
        download(args.src)
    if not args.src.exists():
        print(f"falta {args.src}; rode com --download", file=sys.stderr)
        return 1
    rows = load_appsample(args.src)
    ours = load_ours(args.markers)
    if not ours:
        print("sem marcadores em web/public/markers; rode tools/extract_markers.py", file=sys.stderr)
        return 1

    by_mid: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_mid[int(r["mid"])].append(r)
    print(f"{len(rows)} marcadores do appsample em {len(by_mid)} mapas")

    fits: dict[int, Fit] = {}
    for mid in sorted(by_mid):
        f = fit_mid(mid, by_mid[mid], ours)
        if f:
            fits[mid] = f

    placed: list[tuple[dict[str, Any], str, np.ndarray]] = []
    for mid, f in fits.items():
        pts = f.apply(np.array([[r["lng"], r["lat"]] for r in by_mid[mid]], float))
        placed.extend((r, f.map, xy) for r, xy in zip(by_mid[mid], pts))
    cats = type_categories(placed, ours)
    ids = match_all(placed, cats, ours)

    collectable = sum(1 for r, _, _ in placed if r["type"] in cats)
    print(f"tipos casados: {dict(sorted(cats.items(), key=lambda kv: int(kv[0][1:])))}")
    print(f"casou {len(ids)} de {collectable} marcadores de tipos com correspondência")

    maps_out = {
        str(mid): {"key": MID_KEYS.get(mid, ""), "map": f.map, "s": f.s, "bx": f.bx, "by": f.by,
                   "inliers": f.inliers, "total": f.total,
                   "matched": sum(1 for r in by_mid[mid] if r["id"] in ids)}
        for mid, f in sorted(fits.items())
    }
    out = {"source": "appsample", "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "types": cats, "maps": maps_out, "ids": dict(sorted(ids.items(), key=lambda kv: int(kv[0])))}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"gravado {args.out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
