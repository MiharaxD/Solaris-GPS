#!/usr/bin/env python3
"""
Extrai a configuração dos mapas do HTML salvo do th.gl, baixa as imagens de
overlay do modo subterrâneo e gera um overlays.json com a posição de cada
overlay em PIXEL das suas tiles (no zoom máximo do mapa pai).

Uso (da raiz; só com pedido, porque baixa do CDN do th.gl):
    .venv/Scripts/python tools/wuwa_overlays.py --html assets/overlays/mundo_aberto.html

Saídas (em assets/overlays/, ignorado pelo git):
    tiles_config.json         config completa de todos os mapas (url, bounds, transformation...)
    cache/*.webp              as imagens dos overlays
    overlays.json             overlays + footprints com posição em mundo e em pixel

Depois: .venv/Scripts/python tools/build_overlays.py (copia pro web/public/overlays/).

Conversão mundo -> pixel (igual ao Leaflet do th.gl), com transformation [a, b, c, d]:
    x_px = 2^zoom * (a * lng + b)
    y_px = 2^zoom * (c * lat + d)
Bounds vêm como [[lat_min, lng_min], [lat_max, lng_max]]; lat -> eixo Y (linha), lng -> eixo X (coluna).

Requisitos:  pip install requests pillow
"""
import argparse
import io
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from PIL import Image

DEFAULT_BASE = "https://cdn.th.gl/wuthering-waves"


def extract_tiles_config(html_path):
    """Acha o payload do Next.js que contém "tilesConfig" e devolve o objeto já decodificado."""
    s = Path(html_path).read_text(encoding="utf-8", errors="replace")
    i = s.find("tilesConfig")
    if i < 0:
        sys.exit("Não achei 'tilesConfig' no HTML. Salvou a resposta do Network (aba Doc)?")
    marker = "self.__next_f.push([1,"
    start = s.rfind(marker, 0, i)
    if start < 0:
        sys.exit("Achei 'tilesConfig', mas não o payload do Next.js em volta dele.")
    payload, _ = json.JSONDecoder().raw_decode(s, start + len(marker))
    key = '"tilesConfig":'
    j = payload.index(key) + len(key)
    cfg, _ = json.JSONDecoder().raw_decode(payload, j)
    return cfg


def world_to_px(lat, lng, transformation, zoom):
    a, b, c, d = transformation
    k = 2 ** zoom
    return k * (a * lng + b), k * (c * lat + d)


def bounds_to_rect(bounds, transformation, zoom):
    (lat1, lng1), (lat2, lng2) = bounds
    x1, y1 = world_to_px(lat1, lng1, transformation, zoom)
    x2, y2 = world_to_px(lat2, lng2, transformation, zoom)
    return [round(min(x1, x2), 2), round(min(y1, y2), 2), round(max(x1, x2), 2), round(max(y1, y2), 2)]


def download(session, url, dest):
    if dest.exists() and dest.stat().st_size > 0:
        return dest.read_bytes()
    for attempt in range(3):
        try:
            r = session.get(url, timeout=30)
        except requests.RequestException:
            time.sleep(1 + attempt)
            continue
        if r.status_code == 200:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(r.content)
            return r.content
        if r.status_code in (403, 404, 410):
            print(f"  {r.status_code} em {url}")
            return None
        time.sleep(1 + attempt)
    return None


def main():
    ap = argparse.ArgumentParser(description="Baixa os overlays subterrâneos do th.gl e gera overlays.json")
    ap.add_argument("--html", required=True, help="HTML da página do mapa salvo pelo DevTools (aba Network > Doc)")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--cache", default="assets/overlays/cache")
    ap.add_argument("--out", default="assets/overlays/overlays.json")
    ap.add_argument("--tiles-config-out", default="assets/overlays/tiles_config.json")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    cfg = extract_tiles_config(args.html)
    Path(args.tiles_config_out).write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Config de {len(cfg)} mapas salva em {args.tiles_config_out}")

    session = requests.Session()
    session.headers["User-Agent"] = "wuwa-overlay-fetcher/1.0 (uso pessoal)"
    cache = Path(args.cache)
    result = {"maps": []}

    for name, m in cfg.items():
        overlays = m.get("overlays") or []
        if not overlays:
            continue
        parent_name = (m.get("layer") or {}).get("parent") or name
        parent = cfg.get(parent_name, m)
        tr = m.get("transformation") or parent["transformation"]
        zoom = (m.get("options") or parent.get("options") or {}).get("maxNativeZoom")
        tile_url = parent.get("url") or m.get("url") or ""
        parent_map_id = tile_url.split("/map-tiles/")[-1].split("/")[0] if "/map-tiles/" in tile_url else None
        print(f"\n{name} ({m.get('defaultTitle')}): {len(overlays)} overlays sobre {parent_name}, zoom {zoom}")

        def fetch(o):
            url = args.base.rstrip("/") + o["url"]
            fname = o["url"].rsplit("/", 1)[-1]
            data = download(session, url, cache / fname)
            return o, fname, data

        with ThreadPoolExecutor(args.workers) as ex:
            fetched = list(ex.map(fetch, overlays))

        entries = []
        for o, fname, data in fetched:
            rect = bounds_to_rect(o["bounds"], tr, zoom)
            size = list(Image.open(io.BytesIO(data)).size) if data else None
            entries.append({
                "id": fname.split(".")[0].replace("overlay_ug_", ""),
                "label": o.get("label"),
                "file": fname,
                "bounds_world": o["bounds"],
                "rect_px": rect,  # [x0, y0, x1, y1] no zoom `zoom` do mapa pai
                "image_size": size,
                "downloaded": data is not None,
            })
            status = f"{size[0]}x{size[1]}" if size else "FALHOU"
            print(f"  {entries[-1]['id']:>4}  {status:>11}  {o.get('label')}")

        result["maps"].append({
            "name": name,
            "title": m.get("defaultTitle"),
            "parent": parent_name,
            "parent_map_id": parent_map_id,
            "zoom": zoom,
            "tile_size": (parent.get("options") or {}).get("tileSize"),
            "transformation": tr,
            "overlays": entries,
            "footprints": [
                {"bounds_world": f, "rect_px": bounds_to_rect(f, tr, zoom)} for f in (m.get("footprints") or [])
            ],
        })

    Path(args.out).write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(len(mp["overlays"]) for mp in result["maps"])
    ok = sum(e["downloaded"] for mp in result["maps"] for e in mp["overlays"])
    print(f"\n{ok}/{total} overlays baixados. Posições salvas em {args.out}")
    if ok < total:
        print("Alguns falharam. Rode de novo (o que já baixou fica no cache).")


if __name__ == "__main__":
    main()
