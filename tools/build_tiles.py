#!/usr/bin/env python3
"""Ferramentas de build das tiles locais (só lê o disco, nunca acessa a rede).

Subcomandos:
    inventory                      resumo de todos os mapas do cache
    manifest <map_id> --name NOME  gera manifest.json a partir do disco (se faltar)

Convenção do cache (mesma do tools/wuwa_maps.py com --swap-xy):
    <cache>/<map_id>/<z>/<linha>_<coluna>.webp   (arquivo de 0 bytes = tile inexistente)
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from PIL import Image

DEFAULT_CACHE = Path("assets/tiles_cache")


@dataclass(frozen=True)
class ZoomScan:
    zoom: int
    tiles: frozenset[tuple[int, int]]  # (linha, coluna) das tiles não vazias
    empty_files: int

    @property
    def row_range(self) -> tuple[int, int]:
        rows = [r for r, _ in self.tiles]
        return min(rows), max(rows)

    @property
    def col_range(self) -> tuple[int, int]:
        cols = [c for _, c in self.tiles]
        return min(cols), max(cols)

    @property
    def grid(self) -> tuple[int, int]:
        (r0, r1), (c0, c1) = self.row_range, self.col_range
        return r1 - r0 + 1, c1 - c0 + 1


def parse_tile_name(path: Path) -> tuple[int, int] | None:
    stem = path.stem
    first, sep, second = stem.partition("_")
    if not sep or not first.isdigit() or not second.isdigit():
        return None
    return int(first), int(second)


def scan_zoom(zoom_dir: Path) -> ZoomScan:
    tiles: set[tuple[int, int]] = set()
    empty = 0
    for f in zoom_dir.glob("*.webp"):
        pos = parse_tile_name(f)
        if pos is None:
            continue
        if f.stat().st_size == 0:
            empty += 1
        else:
            tiles.add(pos)
    return ZoomScan(int(zoom_dir.name), frozenset(tiles), empty)


def scan_map(map_dir: Path) -> dict[int, ZoomScan]:
    """Zooms com ao menos uma tile real. Pastas só com 0 bytes (sondagem) ficam de fora."""
    result: dict[int, ZoomScan] = {}
    for d in sorted(map_dir.iterdir()):
        if d.is_dir() and d.name.isdigit():
            scan = scan_zoom(d)
            if scan.tiles:
                result[scan.zoom] = scan
    return result


def probe_only_zooms(map_dir: Path) -> list[int]:
    return sorted(
        int(d.name) for d in map_dir.iterdir()
        if d.is_dir() and d.name.isdigit() and not scan_zoom(d).tiles
    )


def first_tile_size(map_dir: Path, scan: ZoomScan) -> tuple[int, int]:
    r, c = min(scan.tiles)
    with Image.open(map_dir / str(scan.zoom) / f"{r}_{c}.webp") as im:
        return im.size


def load_manifest(map_dir: Path) -> dict | None:
    p = map_dir / "manifest.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def count_transparent(map_dir: Path, scan: ZoomScan) -> int:
    """Tiles existentes mas 100% transparentes (alpha máximo = 0)."""
    n = 0
    for r, c in scan.tiles:
        with Image.open(map_dir / str(scan.zoom) / f"{r}_{c}.webp") as im:
            if im.mode in ("RGBA", "LA") and im.getchannel("A").getextrema()[1] == 0:
                n += 1
    return n


def cmd_inventory(cache: Path, alpha: bool) -> int:
    header = (f"{'name':<26} {'zmax':>4} {'tiles':>6} {'grade (lin x col)':>18} {'tile':>8} {'vazias':>7}"
              + (f" {'transp.':>7}" if alpha else "") + "  obs")
    print(header)
    print("-" * len(header))
    problems = 0
    for map_dir in sorted(p for p in cache.iterdir() if p.is_dir()):
        manifest = load_manifest(map_dir)
        scans = scan_map(map_dir)
        if not scans:
            print(f"{map_dir.name:<26} sem tiles")
            problems += 1
            continue
        zmax = max(scans)
        top = scans[zmax]
        rows, cols = top.grid
        cells = rows * cols
        size = first_tile_size(map_dir, top)
        notes: list[str] = []
        if manifest is None:
            notes.append("SEM MANIFEST")
            problems += 1
            name = map_dir.name.split("-")[0]
        else:
            name = manifest["name"]
            mz = manifest["zooms"].get(str(zmax))
            if manifest["max_zoom"] != zmax or mz is None:
                notes.append(f"manifest diz zmax={manifest['max_zoom']}")
                problems += 1
            elif (mz["tile_count"], mz["first_min"], mz["first_max"], mz["second_min"], mz["second_max"]) != (
                len(top.tiles), *top.row_range, *top.col_range
            ):
                notes.append("manifest diverge do disco")
                problems += 1
            if list(manifest["tile_size"]) != list(size):
                notes.append(f"tile_size manifest={manifest['tile_size']}")
                problems += 1
        others = [z for z in scans if z != zmax]
        if others:
            notes.append("também z" + ",".join(map(str, others)))
        probes = probe_only_zooms(map_dir)
        if probes:
            notes.append("sondagem ignorada z" + ",".join(map(str, probes)))
        print(
            f"{name:<26} {zmax:>4} {len(top.tiles):>6} {f'{rows} x {cols}':>18} "
            f"{f'{size[0]}x{size[1]}':>8} {cells - len(top.tiles):>7}"
            + (f" {count_transparent(map_dir, top):>7}" if alpha else "")
            + f"  {'; '.join(notes)}"
        )
    return 1 if problems else 0


def build_manifest(map_dir: Path, name: str) -> dict:
    scans = scan_map(map_dir)
    if not scans:
        raise SystemExit(f"Nenhuma tile em {map_dir}")
    zmax = max(scans)
    w, h = first_tile_size(map_dir, scans[zmax])
    zooms = {
        str(z): {
            "tile_count": len(s.tiles),
            "first_min": s.row_range[0], "first_max": s.row_range[1],
            "second_min": s.col_range[0], "second_max": s.col_range[1],
        }
        for z, s in sorted(scans.items())
    }
    return {
        "name": name,
        "map_id": map_dir.name,
        "tile_size": [w, h],
        "first_number_is_row": True,
        "tile_path_template": "{z}/{first}_{second}.webp",
        "empty_file_means_no_tile": True,
        "generated": date.today().isoformat(),
        "generated_by": "tools/build_tiles.py (a partir do disco)",
        "zooms": zooms,
        "max_zoom": zmax,
    }


def cmd_manifest(cache: Path, map_id: str, name: str, force: bool) -> int:
    map_dir = cache / map_id
    if not map_dir.is_dir():
        raise SystemExit(f"Mapa não encontrado: {map_dir}")
    out = map_dir / "manifest.json"
    if out.exists() and not force:
        raise SystemExit(f"{out} já existe (use --force para sobrescrever)")
    manifest = build_manifest(map_dir, name)
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Manifest salvo em {out}")
    print(json.dumps(manifest["zooms"], indent=2))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    sub = ap.add_subparsers(dest="cmd", required=True)
    inv = sub.add_parser("inventory", help="resumo dos mapas")
    inv.add_argument("--alpha", action="store_true", help="conta tiles 100%% transparentes (decodifica todas)")
    m = sub.add_parser("manifest", help="gera manifest.json a partir do disco")
    m.add_argument("map_id")
    m.add_argument("--name", required=True)
    m.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if args.cmd == "inventory":
        return cmd_inventory(args.cache, args.alpha)
    return cmd_manifest(args.cache, args.map_id, args.name, args.force)


if __name__ == "__main__":
    sys.exit(main())
