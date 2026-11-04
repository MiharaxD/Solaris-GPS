#!/usr/bin/env python3
"""
Baixa as tiles de um mapa do THGL (cdn.th.gl) e costura tudo numa imagem só.

Uso básico (Overworld, zoom máximo descoberto automaticamente):
    python wuwa_maps.py

Outro mapa (pegue o ID na URL de uma tile dele pelo DevTools):
    python wuwa_maps.py --map NOME_DO_MAPA-abc123 --seed-zoom 5 --seed-x 14 --seed-y 13

Zoom específico (recomendado se o máximo ficar gigante):
    python wuwa_maps.py --zoom 5

Requisitos:  pip install requests pillow
"""
import argparse
import io
import json
import sys
import time
from collections import deque
from datetime import date
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from PIL import Image

DEFAULT_BASE = "https://cdn.th.gl/wuthering-waves/map-tiles"
DEFAULT_MAP = "AkiWorld_WP-e2f88b110e3b3c0bd074b0b86c81e40a"

Image.MAX_IMAGE_PIXELS = None  # a gente mesmo checa o tamanho antes de montar


class TileClient:
    def __init__(self, base, map_id, cache_dir, workers):
        self.base = base.rstrip("/")
        self.map_id = map_id
        self.cache = Path(cache_dir)
        self.workers = workers
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "wuwa-map-stitcher/1.0 (uso pessoal)"
        self.forbidden = 0

    def url(self, z, x, y):
        return f"{self.base}/{self.map_id}/{z}/{x}/{y}.webp?v=1"

    def path(self, z, x, y):
        return self.cache / self.map_id / str(z) / f"{x}_{y}.webp"

    def get(self, z, x, y):
        """Retorna os bytes da tile, ou None se ela não existe."""
        p = self.path(z, x, y)
        if p.exists():
            return p.read_bytes() or None  # arquivo vazio = "não existe" (cache negativo)
        for attempt in range(3):
            try:
                r = self.session.get(self.url(z, x, y), timeout=20)
            except requests.RequestException:
                time.sleep(1 + attempt)
                continue
            if r.status_code == 200:
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(r.content)
                return r.content
            if r.status_code in (403, 404, 410):
                if r.status_code == 403:
                    self.forbidden += 1
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b"")
                return None
            time.sleep(1 + attempt)
        return None


def find_seed(client, z, seed_zoom, sx, sy, radius=3):
    """Procura uma tile existente perto da posição equivalente da seed no zoom z."""
    scale = 2 ** (z - seed_zoom) if z >= seed_zoom else 1 / 2 ** (seed_zoom - z)
    cx, cy = int(sx * scale), int(sy * scale)
    window = sorted(
        ((cx + dx, cy + dy) for dx in range(-radius, radius + 1) for dy in range(-radius, radius + 1)),
        key=lambda p: abs(p[0] - cx) + abs(p[1] - cy),
    )
    for x, y in window:
        if x >= 0 and y >= 0 and client.get(z, x, y):
            return x, y
    return None


def discover_tiles(client, z, seed, max_tiles):
    """Flood fill (8 vizinhos) a partir da seed para descobrir todas as tiles existentes."""
    found, seen = {}, {seed}
    queue = deque([seed])
    while queue:
        batch = [queue.popleft() for _ in range(min(len(queue), client.workers * 4))]
        with ThreadPoolExecutor(client.workers) as ex:
            results = list(ex.map(lambda p: (p, client.get(z, *p)), batch))
        for (x, y), data in results:
            if not data:
                continue
            found[(x, y)] = True
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    n = (x + dx, y + dy)
                    if n not in seen and n[0] >= 0 and n[1] >= 0:
                        seen.add(n)
                        queue.append(n)
        if len(found) > max_tiles:
            sys.exit(f"Mais de {max_tiles} tiles no zoom {z}. Use um --zoom menor.")
        print(f"\r  zoom {z}: {len(found)} tiles encontradas, {len(queue)} na fila ", end="", flush=True)
    print()
    return sorted(found)


def max_zoom(client, args):
    z, last = args.seed_zoom, None
    while z <= args.zoom_limit:
        seed = find_seed(client, z, args.seed_zoom, args.seed_x, args.seed_y)
        if not seed:
            break
        last = z
        z += 1
    return last


def write_manifest(client, z, tiles, args):
    """Grava/atualiza <cache>/<mapa>/manifest.json com tudo que o tracker precisa saber."""
    firsts = [t[0] for t in tiles]
    seconds = [t[1] for t in tiles]
    tw, th = Image.open(io.BytesIO(client.get(z, *tiles[0]))).size
    path = client.cache / client.map_id / "manifest.json"
    manifest = json.loads(path.read_text()) if path.exists() else {}
    manifest.update(
        name=args.name or client.map_id.split("-")[0],
        map_id=client.map_id,
        tile_size=[tw, th],
        first_number_is_row=bool(args.swap_xy),
        tile_path_template="{z}/{first}_{second}.webp",
        empty_file_means_no_tile=True,
        generated=date.today().isoformat(),
    )
    manifest.setdefault("zooms", {})[str(z)] = {
        "tile_count": len(tiles),
        "first_min": min(firsts), "first_max": max(firsts),
        "second_min": min(seconds), "second_max": max(seconds),
    }
    manifest["max_zoom"] = max(int(k) for k in manifest["zooms"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(f"Manifest salvo em {path}")


def stitch(client, z, tiles, out_path, flip_y, swap_xy, max_pixels):
    # (col, row) de cada tile na imagem final. Com swap_xy, o 1o número da URL vira a LINHA.
    pos = {t: ((t[1], t[0]) if swap_xy else (t[0], t[1])) for t in tiles}
    cs = [p[0] for p in pos.values()]
    rs = [p[1] for p in pos.values()]
    c0, r0 = min(cs), min(rs)
    cols, rows = max(cs) - c0 + 1, max(rs) - r0 + 1

    first = Image.open(io.BytesIO(client.get(z, *tiles[0])))
    tw, th = first.size
    width, height = cols * tw, rows * th
    print(f"  grade {cols}x{rows} tiles de {tw}x{th}px -> imagem final {width}x{height}px")
    if width * height > max_pixels:
        sys.exit(
            f"Imagem de {width * height / 1e6:.0f} megapixels passa do limite "
            f"({max_pixels / 1e6:.0f} MP). Use --zoom menor ou aumente --max-pixels."
        )

    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for i, t in enumerate(tiles, 1):
        data = client.get(z, *t)
        if not data:
            continue
        tile = Image.open(io.BytesIO(data)).convert("RGBA")
        c, r = pos[t]
        row = (rows - 1 - (r - r0)) if flip_y else (r - r0)
        canvas.paste(tile, ((c - c0) * tw, row * th))
        if i % 200 == 0:
            print(f"\r  costurando {i}/{len(tiles)}", end="", flush=True)
    print()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_path)
    print(f"Salvo em {out_path}")


def main():
    ap = argparse.ArgumentParser(description="Baixa e costura tiles de mapa do THGL")
    ap.add_argument("--map", default=DEFAULT_MAP, help="ID do mapa (pasta na URL da tile)")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--seed-zoom", type=int, default=6, help="zoom de uma tile que você sabe que existe")
    ap.add_argument("--seed-x", type=int, default=27)
    ap.add_argument("--seed-y", type=int, default=27)
    ap.add_argument("--zoom", type=int, help="zoom desejado (padrão: o maior que existir)")
    ap.add_argument("--zoom-limit", type=int, default=10)
    ap.add_argument("--workers", type=int, default=6, help="downloads simultâneos (seja gentil com o CDN)")
    ap.add_argument("--max-tiles", type=int, default=20000)
    ap.add_argument("--max-pixels", type=int, default=400_000_000)
    ap.add_argument("--flip-y", action="store_true", help="use se a imagem sair de cabeça pra baixo")
    ap.add_argument("--swap-xy", action="store_true",
                    help="use se as emendas entre tiles não casarem (1o número da URL = linha)")
    ap.add_argument("--name", help="nome amigável do mapa no manifest (ex: overworld)")
    ap.add_argument("--no-stitch", action="store_true", help="só baixa as tiles e grava o manifest")
    ap.add_argument("--cache", default="tiles_cache")
    ap.add_argument("--out", default="mapas")
    args = ap.parse_args()

    client = TileClient(args.base, args.map, args.cache, args.workers)

    z = args.zoom
    if z is None:
        print("Descobrindo o zoom máximo...")
        z = max_zoom(client, args)
        if z is None:
            msg = "Não achei nenhuma tile. Confere o ID do mapa e a seed."
            if client.forbidden:
                msg += " O CDN respondeu 403: provavelmente ele bloqueia acesso fora do site. Respeita isso."
            sys.exit(msg)
        print(f"  zoom máximo: {z}")

    seed = find_seed(client, z, args.seed_zoom, args.seed_x, args.seed_y)
    if not seed:
        sys.exit(f"Sem tile perto da seed no zoom {z}.")

    print(f"Mapeando tiles do zoom {z}...")
    tiles = discover_tiles(client, z, seed, args.max_tiles)

    write_manifest(client, z, tiles, args)
    if args.no_stitch:
        return

    print("Costurando...")
    suffix = "_swap" if args.swap_xy else ""
    out_path = Path(args.out) / f"{args.map.split('-')[0]}_z{z}{suffix}.png"
    stitch(client, z, tiles, out_path, args.flip_y, args.swap_xy, args.max_pixels)


if __name__ == "__main__":
    main()
