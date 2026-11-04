#!/usr/bin/env python3
"""Ferramentas de build das tiles locais (só lê o disco, nunca acessa a rede).

Subcomandos:
    inventory                      resumo de todos os mapas do cache
    manifest <map_id> --name NOME  gera manifest.json a partir do disco (se faltar)
    pyramid <map_id> --lo N        testa se zoom N == zoom N+1 reduzido
    build                          tiles + zooms menores + maps.json em web/public/

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


def _tile_rgba(map_dir: Path, z: int, r: int, c: int, size: tuple[int, int]) -> "np.ndarray":
    import numpy as np

    p = map_dir / str(z) / f"{r}_{c}.webp"
    if not p.exists() or p.stat().st_size == 0:
        return np.zeros((size[1], size[0], 4), np.float32)
    with Image.open(p) as im:
        return np.asarray(im.convert("RGBA"), np.float32)


def _compare(ref: "np.ndarray", test: "np.ndarray") -> tuple[float, float]:
    """(erro médio RGB onde ambos têm alpha>0, erro médio de alpha)."""
    import numpy as np

    both = (ref[..., 3] > 0) & (test[..., 3] > 0)
    rgb = float(np.abs(ref[..., :3] - test[..., :3])[both].mean()) if both.any() else float("nan")
    alpha = float(np.abs(ref[..., 3] - test[..., 3]).mean())
    return rgb, alpha


def cmd_pyramid(cache: Path, map_id: str, lo: int, samples: int) -> int:
    """Verifica se tile (r,c) no zoom lo == filhas (2r..2r+1, 2c..2c+1) do zoom lo+1 reduzidas.

    Também testa deslocamentos de ±1 tile (no zoom alto) pra detectar grades desalinhadas.
    """
    import random

    map_dir = cache / map_id
    scans = scan_map(map_dir)
    hi = lo + 1
    if lo not in scans or hi not in scans:
        raise SystemExit(f"Precisa dos zooms {lo} e {hi}; disponíveis: {sorted(scans)}")
    size = first_tile_size(map_dir, scans[lo])
    tiles = sorted(scans[lo].tiles)
    rng = random.Random(42)
    (r0, r1), (c0, c1) = scans[lo].row_range, scans[lo].col_range
    border = [t for t in tiles if t[0] in (r0, r1) or t[1] in (c0, c1)]
    pick = rng.sample(tiles, min(samples, len(tiles))) + rng.sample(border, min(8, len(border)))

    print(f"{map_id}: z{lo} vs z{hi} reduzido, {len(pick)} tiles amostradas (inclui bordas)")
    offsets = [(dr, dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1)]
    totals = {o: [0.0, 0.0, 0] for o in offsets}
    worst: list[tuple[float, tuple[int, int]]] = []
    for r, c in pick:
        ref = _tile_rgba(map_dir, lo, r, c, size)
        for dr, dc in offsets:
            test = _shifted_parent(map_dir, hi, r, c, dr, dc, size)
            rgb, al = _compare(ref, test)
            t = totals[(dr, dc)]
            if rgb == rgb:  # não-NaN
                t[0] += rgb
                t[2] += 1
            t[1] += al
            if (dr, dc) == (0, 0):
                worst.append((rgb if rgb == rgb else -1, (r, c)))
    print(f"{'offset (lin,col) z' + str(hi):>22} {'erro RGB médio':>15} {'erro alpha médio':>17}")
    for o in offsets:
        s_rgb, s_al, n = totals[o]
        print(f"{str(o):>22} {s_rgb / max(n, 1):>15.2f} {s_al / len(pick):>17.2f}")
    worst.sort(reverse=True)
    print("piores tiles no offset (0,0):", [(f"{e:.2f}", t) for e, t in worst[:5]])
    return 0


def _shifted_parent(map_dir: Path, hi: int, r: int, c: int, dr: int, dc: int,
                    size: tuple[int, int]) -> "np.ndarray":
    """Junta as 4 filhas (2r+dr.., 2c+dc..) do zoom hi e reduz 2x2→1 com alpha pré-multiplicado."""
    import numpy as np

    w, h = size
    big = np.zeros((2 * h, 2 * w, 4), np.float32)
    for i in (0, 1):
        for j in (0, 1):
            big[i * h:(i + 1) * h, j * w:(j + 1) * w] = _tile_rgba(
                map_dir, hi, 2 * r + i + dr, 2 * c + j + dc, size)
    a = big[..., 3:4] / 255.0
    pre = np.concatenate([big[..., :3] * a, a * 255.0], axis=2)
    small = pre.reshape(h, 2, w, 2, 4).mean(axis=(1, 3))
    alpha = small[..., 3:4] / 255.0
    rgb = np.where(alpha > 0, small[..., :3] / np.maximum(alpha, 1e-6), 0)
    return np.concatenate([rgb, small[..., 3:4]], axis=2)


MIN_GRID_TILES = 2  # zoom mínimo: o mapa inteiro cabe em ~2x2 tiles (1024 px)


def _reduce_children(children: dict[tuple[int, int], Image.Image], size: tuple[int, int]) -> Image.Image:
    """Monta 2x2 filhas (faltantes = preto, igual ao padding nativo) e reduz pra uma tile."""
    w, h = size
    big = Image.new("RGB", (2 * w, 2 * h), (0, 0, 0))
    for (i, j), im in children.items():
        big.paste(im, (j * w, i * h))
    return big.resize(size, Image.Resampling.BOX)


def build_map(map_dir: Path, out_root: Path, quality: int) -> dict:
    """Copia as tiles reais e gera os zooms menores por redução 2x2→1.

    Zoom nativo existente (ex.: z5 do Overworld) é preferido ao gerado. Retorna a entrada do maps.json.
    """
    import shutil

    manifest = load_manifest(map_dir)
    if manifest is None:
        raise SystemExit(f"{map_dir.name} sem manifest. Rode: build_tiles.py manifest {map_dir.name} --name NOME")
    if not manifest.get("first_number_is_row", False):
        raise SystemExit(f"{map_dir.name}: first_number_is_row=false não suportado")
    name: str = manifest["name"]
    scans = scan_map(map_dir)
    zmax = max(scans)
    size = first_tile_size(map_dir, scans[zmax])
    out = out_root / name

    copied = generated = skipped = 0
    current: set[tuple[int, int]] = set(scans[zmax].tiles)
    for r, c in current:
        src = map_dir / str(zmax) / f"{r}_{c}.webp"
        dst = out / str(zmax) / f"{r}_{c}.webp"
        if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1

    z = zmax
    while True:
        rows = max(r for r, _ in current) + 1
        cols = max(c for _, c in current) + 1
        if max(rows, cols) <= MIN_GRID_TILES or z == 0:
            break
        parent_z = z - 1
        parents = {(r // 2, c // 2) for r, c in current}
        native = scans.get(parent_z)
        for pr, pc in sorted(parents):
            dst = out / str(parent_z) / f"{pr}_{pc}.webp"
            dst.parent.mkdir(parents=True, exist_ok=True)
            if native and (pr, pc) in native.tiles:
                src = map_dir / str(parent_z) / f"{pr}_{pc}.webp"
                if not (dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime):
                    shutil.copy2(src, dst)
                    copied += 1
                continue
            kids = {
                (i, j): out / str(z) / f"{2 * pr + i}_{2 * pc + j}.webp"
                for i in (0, 1) for j in (0, 1)
            }
            kids = {k: p for k, p in kids.items() if p.exists()}
            if dst.exists() and all(dst.stat().st_mtime >= p.stat().st_mtime for p in kids.values()):
                skipped += 1
                continue
            children = {k: Image.open(p).convert("RGB") for k, p in kids.items()}
            _reduce_children(children, size).save(dst, "WEBP", quality=quality, method=6)
            generated += 1
        current = parents
        z = parent_z
    zmin = z

    top = scans[zmax]
    (r0, r1), (c0, c1) = top.row_range, top.col_range
    w, h = size
    print(f"{name:<26} z{zmin}–z{zmax}  copiadas={copied} geradas={generated} já atualizadas={skipped}")
    return {
        "name": name,
        "map_id": manifest["map_id"],
        "tileSize": w,
        "minZoom": zmin,
        "maxZoom": zmax,
        # limites em pixel do zoom máximo: x = coluna*tile, y = linha*tile
        "bounds": {"x0": c0 * w, "y0": r0 * h, "x1": (c1 + 1) * w, "y1": (r1 + 1) * h},
    }


def cmd_build(cache: Path, out_root: Path, index_path: Path, only: list[str], quality: int) -> int:
    entries = []
    for map_dir in sorted(p for p in cache.iterdir() if p.is_dir()):
        m = load_manifest(map_dir)
        if only and (m is None or m["name"] not in only):
            continue
        entries.append(build_map(map_dir, out_root, quality))
    entries.sort(key=lambda e: (e["name"] != "overworld", e["name"]))
    if not only:
        index_path.parent.mkdir(parents=True, exist_ok=True)
        index_path.write_text(json.dumps({"maps": entries}, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"Índice salvo em {index_path} ({len(entries)} mapas)")
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
    py = sub.add_parser("pyramid", help="testa se zoom lo == zoom lo+1 reduzido")
    py.add_argument("map_id")
    py.add_argument("--lo", type=int, required=True)
    py.add_argument("--samples", type=int, default=40)
    bd = sub.add_parser("build", help="copia tiles + gera zooms menores + maps.json para o web")
    bd.add_argument("--out", type=Path, default=Path("web/public/tiles"))
    bd.add_argument("--index", type=Path, default=Path("web/public/maps.json"))
    bd.add_argument("--only", nargs="*", default=[], help="nomes de mapas (não reescreve o índice)")
    bd.add_argument("--quality", type=int, default=90)
    args = ap.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if args.cmd == "inventory":
        return cmd_inventory(args.cache, args.alpha)
    if args.cmd == "build":
        return cmd_build(args.cache, args.out, args.index, args.only, args.quality)
    if args.cmd == "pyramid":
        return cmd_pyramid(args.cache, args.map_id, args.lo, args.samples)
    return cmd_manifest(args.cache, args.map_id, args.name, args.force)


if __name__ == "__main__":
    sys.exit(main())
