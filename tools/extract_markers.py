#!/usr/bin/env python3
"""Gera os marcadores de cada mapa a partir do clone local do WutheringData.

Saída (gitignored, derivada de dados © Kuro Games): web/public/markers/<name>.json
    {"map": "<name>", "source": "WutheringData",
     "markers": [{"id": "e113003404", "cat": "chest", "sub": "advanced", "name": "...",
                  "x": ..., "y": ..., "z": ..., "area": ["Jinzhou", "Central Plains"]}]}

Coordenadas em unidade do jogo (Transform[0]); o web converte pra pixel com a calibração de
data/maps/<name>.json. Os teleportes usam o mesmo id das referências ("tp-<Id>"), pra que
`ignoredRefs` valha aqui também. Só lê o disco.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_refs import area_chain, load, tile_maps  # noqa: E402

TELEPORT_KINDS = {2: "beacon", 1: "nexus"}

# Baús: tier pelo nome chinês do blueprint (nomes oficiais em inglês entre parênteses).
CHEST_TYPES = {"TreasureBox", "HookTreasureBox", "VisionTreasureBox"}
CHEST_TIERS: list[tuple[str, str]] = [
    ("幻象宝箱", "illusive"),           # Illusive Chest (aparece após derrotar o grupo)
    ("豪华|涡纹", "premium"),           # Premium Supply Chest
    ("丰厚|精密", "advanced"),          # Advanced Supply Chest
    ("标准|基准", "standard"),          # Standard Supply Chest
    ("简易|朴素|散落", "basic"),        # Basic Supply Chest
]
CHEST_LABELS = {"illusive": "Baú ilusório", "premium": "Baú premium", "advanced": "Baú avançado",
                "standard": "Baú padrão", "basic": "Baú básico"}

CASKET_TYPES = {"HookSoundBox", "HookPullSoundBox"}

# Coletáveis: "<prefixo><número>_<espécie>" no nome da entidade.
COLLECT_TYPES = {"Collect", "CollectWithHook", "Destructible", "DestructibleWithHook", "Collect3"}
COLLECT_RE = re.compile(r"(植物|矿物|特殊|生态动物)\d*_([^_\d（(]+)")
COLLECT_CAT = {"植物": "plant", "矿物": "ore", "特殊": "collectible", "生态动物": "collectible"}

# Nunca entram: eventos temporários, missão, monstros disfarçados.
EXCLUDE_RE = re.compile(r"活动|任务|宝箱怪|底座|副本")


def item_names(v: Path, text: dict[str, str]) -> dict[str, str]:
    """nome chinês → nome traduzido. Os TextMaps usam as mesmas chaves em todos os idiomas;
    `text` já vem com o idioma pedido por cima do inglês."""
    out: dict[str, str] = {}
    sources = [("TextMap/zh-Hans/MultiText.json", text),
               ("TextMap/zh-Hans/ItemInfo.json", load(v, "TextMap/en/ItemInfo.json"))]
    for zh_file, target in sources:
        zh: dict[str, str] = load(v, zh_file)
        for k, name in zh.items():
            if name and len(name) <= 12 and name not in out and target.get(k):
                out[name] = target[k]
    return out


def classify(e: dict[str, Any], etype: str, items: dict[str, str], unknown: Counter[str]) -> tuple[str, str, str] | None:
    """(categoria, subcategoria, nome) ou None."""
    name: str = e["Name"]
    if EXCLUDE_RE.search(name):
        return None
    if etype in CHEST_TYPES:
        for pat, tier in CHEST_TIERS:
            if re.search(pat, name):
                return "chest", tier, CHEST_LABELS[tier]
        return None
    if etype in CASKET_TYPES or "绕声匣" in name:
        return "casket", "casket", "Sonance Casket"
    if etype in COLLECT_TYPES:
        m = COLLECT_RE.search(name)
        if not m:
            return None
        species = items.get(m.group(2))
        if species is None:
            unknown[m.group(2)] += 1
            return None
        return COLLECT_CAT[m.group(1)], species, species
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--vendor", type=Path, default=Path("vendor/WutheringData"))
    ap.add_argument("--cache", type=Path, default=Path("assets/tiles_cache"))
    ap.add_argument("--out", type=Path, default=Path("web/public/markers"))
    ap.add_argument("--lang", default="pt", help="idioma das áreas (cai para en se faltar)")
    args = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]

    v = args.vendor
    text: dict[str, str] = dict(load(v, "TextMap/en/MultiText.json"))
    local = v / f"TextMap/{args.lang}/MultiText.json"
    if args.lang != "en" and local.exists():
        text.update({k: s for k, s in json.loads(local.read_text(encoding="utf-8")).items() if s})
    areas = {a["AreaId"]: a for a in load(v, "ConfigDB/Area.json")}
    sources = {s["MapId"]: s["MapPath"].rsplit("/", 1)[-1] for s in load(v, "ConfigDB/AkiMapSource.json")}
    by_prefix = tile_maps(args.cache)
    map_name = {mid: by_prefix[p] for mid, p in sources.items() if p in by_prefix}
    etypes = {b["BlueprintType"]: b["EntityType"] for b in load(v, "ConfigDB/BlueprintConfig.json")}
    items = item_names(v, text)

    ents: dict[tuple[int, int], dict[str, Any]] = {}
    for part in ("ConfigDB/LevelEntityConfig_0.json", "ConfigDB/LevelEntityConfig_1.json"):
        for e in load(v, part):
            ents[(e["MapId"], e["EntityId"])] = e

    per_map: dict[str, list[dict[str, Any]]] = {}

    def add(e: dict[str, Any], mid: str, cat: str, sub: str, label: str) -> None:
        pos = e["Transform"][0]
        per_map.setdefault(map_name[e["MapId"]], []).append({
            "id": mid, "cat": cat, "sub": sub, "name": label,
            "x": pos["X"], "y": pos["Y"], "z": pos["Z"],
            "area": area_chain(e.get("AreaId", 0), areas, text),
        })

    for t in load(v, "ConfigDB/Teleporter.json"):
        kind = TELEPORT_KINDS.get(t["Type"])
        e = ents.get((t["MapId"], t["TeleportEntityConfigId"]))
        if kind and e and t["MapId"] in map_name:
            add(e, f"tp-{t['Id']}", kind, kind, "Teleporte" if kind == "beacon" else "Nexus")

    unknown = Counter[str]()
    for (map_id, _), e in ents.items():
        if map_id not in map_name:
            continue
        c = classify(e, etypes.get(e["BlueprintType"], ""), items, unknown)
        if c:
            add(e, f"e{e['EntityId']}", *c)

    args.out.mkdir(parents=True, exist_ok=True)
    for name, markers in sorted(per_map.items()):
        # O mesmo objeto aparece repetido entre versões do dump: um por posição (~1 m).
        seen: set[tuple[Any, ...]] = set()
        uniq: list[dict[str, Any]] = []
        for m in sorted(markers, key=lambda m: m["id"]):
            key = (m["cat"], m["sub"], round(m["x"] / 100), round(m["y"] / 100), round(m["z"] / 100))
            if key not in seen:
                seen.add(key)
                uniq.append(m)
        out = {"map": name, "source": "WutheringData", "markers": uniq}
        (args.out / f"{name}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")),
                                               encoding="utf-8")
        cats = Counter(m["cat"] for m in uniq)
        print(f"{name:<22} " + "  ".join(f"{k} {n}" for k, n in sorted(cats.items())))
    if unknown:
        top = ", ".join(f"{k}×{n}" for k, n in unknown.most_common(12))
        print(f"  sem nome de item ({sum(unknown.values())}): {top}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
