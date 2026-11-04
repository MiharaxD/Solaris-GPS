#!/usr/bin/env python3
"""Extrai teleportes (Resonance Beacon) e Nexus do WutheringData para cada mapa de tiles.

Saída (gitignored, derivada de dados © Kuro Games): web/public/refs/<name>.json
    {"map": "<name>", "source": "WutheringData", "refs": [
        {"id": "tp-300011", "kind": "beacon"|"nexus", "entityId": 113003404,
         "x": ..., "y": ..., "z": ..., "area": ["Jinzhou", "Central Plains"], "label": "..."}]}

Coordenadas = Transform[0] da entidade (unidade do jogo, sem conversão). Só lê o disco.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

KINDS = {2: "beacon", 1: "nexus"}  # Teleporter.Type; 3 = entrada de instância (fora por ora)
KIND_LABEL = {"beacon": "Teleporte", "nexus": "Nexus"}


def load(root: Path, rel: str) -> Any:
    return json.loads((root / rel).read_text(encoding="utf-8"))


def tile_maps(cache: Path) -> dict[str, str]:
    """prefixo do map_id (antes do '-') → name do manifest."""
    out: dict[str, str] = {}
    for d in cache.iterdir():
        mf = d / "manifest.json"
        if mf.is_file():
            out[d.name.split("-")[0]] = json.loads(mf.read_text(encoding="utf-8"))["name"]
    return out


def area_chain(area_id: int, areas: dict[int, dict[str, Any]], text: dict[str, str]) -> list[str]:
    chain: list[str] = []
    cur = areas.get(area_id)
    while cur is not None and len(chain) < 6:
        title = text.get(cur.get("Title", ""))
        if title and title != "Overworld" and (not chain or chain[-1] != title):
            chain.append(title)
        cur = areas.get(cur.get("Father", 0))
    return list(reversed(chain))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vendor", type=Path, default=Path("vendor/WutheringData"))
    ap.add_argument("--cache", type=Path, default=Path("assets/tiles_cache"))
    ap.add_argument("--out", type=Path, default=Path("web/public/refs"))
    ap.add_argument("--lang", default="pt", help="idioma dos nomes (cai para en se faltar)")
    args = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

    v = args.vendor
    en: dict[str, str] = load(v, "TextMap/en/MultiText.json")
    text = dict(en)
    local = v / f"TextMap/{args.lang}/MultiText.json"
    if args.lang != "en" and local.exists():
        text.update({k: s for k, s in json.loads(local.read_text(encoding="utf-8")).items() if s})
    areas = {a["AreaId"]: a for a in load(v, "ConfigDB/Area.json")}
    sources = {s["MapId"]: s["MapPath"].rsplit("/", 1)[-1] for s in load(v, "ConfigDB/AkiMapSource.json")}
    ents: dict[tuple[int, int], dict[str, Any]] = {}
    for part in ("ConfigDB/LevelEntityConfig_0.json", "ConfigDB/LevelEntityConfig_1.json"):
        for e in load(v, part):
            ents[(e["MapId"], e["EntityId"])] = e
    by_prefix = tile_maps(args.cache)

    per_map: dict[str, list[dict[str, Any]]] = {}
    missing = Counter[str]()
    for t in load(v, "ConfigDB/Teleporter.json"):
        kind = KINDS.get(t["Type"])
        if kind is None:
            continue
        name = by_prefix.get(sources.get(t["MapId"], ""))
        if name is None:
            missing[f"MapId {t['MapId']} sem tiles"] += 1
            continue
        e = ents.get((t["MapId"], t["TeleportEntityConfigId"]))
        if e is None:
            missing["entidade não encontrada"] += 1
            continue
        pos = e["Transform"][0]
        area = area_chain(e.get("AreaId", 0), areas, text)
        per_map.setdefault(name, []).append({
            "id": f"tp-{t['Id']}", "kind": kind, "entityId": e["EntityId"],
            "x": pos["X"], "y": pos["Y"], "z": pos["Z"], "area": area,
        })

    args.out.mkdir(parents=True, exist_ok=True)
    for name, refs in sorted(per_map.items()):
        # rótulo legível e único: "Teleporte · Jinzhou › Central Plains #2"
        refs.sort(key=lambda r: (r["kind"], r["area"], r["x"], r["y"]))
        # "#n" só quando a área tem mais de um do mesmo tipo: rótulo sem número = inequívoco.
        total = Counter((r["kind"], tuple(r["area"])) for r in refs)
        seen = Counter[tuple[str, tuple[str, ...]]]()
        for r in refs:
            key = (r["kind"], tuple(r["area"]))
            seen[key] += 1
            where = " › ".join(r["area"][-2:]) or "?"
            suffix = f" #{seen[key]}" if total[key] > 1 else ""
            r["label"] = f"{KIND_LABEL[r['kind']]} · {where}{suffix}"
            r["unique"] = total[key] == 1
        out = {"map": name, "source": "WutheringData", "refs": refs}
        (args.out / f"{name}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        kinds = Counter(r["kind"] for r in refs)
        print(f"{name:<26} {kinds['beacon']:>4} teleportes {kinds['nexus']:>3} nexus")
    for why, n in missing.items():
        print(f"  ignorados: {n} ({why})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
