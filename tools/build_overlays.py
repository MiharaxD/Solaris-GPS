#!/usr/bin/env python3
"""
Leva os overlays subterrâneos baixados por `tools/wuwa_overlays.py` pro mapa web.

Lê `assets/overlays/overlays.json` + `assets/overlays/cache/*.webp`, casa cada mapa do th.gl
com o nosso pelo `map_id` (web/public/maps.json) e grava, por mapa:

    web/public/overlays/<name>/<id>.webp
    web/public/overlays/<name>.json   {"overlays": [{id, label, file, rect, center}]}

`rect` = [x0, y0, x1, y1] em pixel do zoom máximo do nosso mapa (o mesmo espaço do
`MapView.toLatLng`). `center` = centroide dos pixels visíveis (alpha > 0), pro rótulo.

Uso (da raiz): .venv/Scripts/python tools/build_overlays.py
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image


def visible_center(img_path: Path, rect: list[float]) -> list[float]:
    """Centroide dos pixels com alpha > 0, convertido pro espaço de `rect`."""
    with Image.open(img_path) as im:
        w, h = im.size
        alpha = np.asarray(im.convert("RGBA").getchannel("A"))
    ys, xs = np.nonzero(alpha)
    x0, y0, x1, y1 = rect
    if len(xs) == 0:
        return [round((x0 + x1) / 2, 1), round((y0 + y1) / 2, 1)]
    cx = x0 + (float(xs.mean()) + 0.5) / w * (x1 - x0)
    cy = y0 + (float(ys.mean()) + 0.5) / h * (y1 - y0)
    return [round(cx, 1), round(cy, 1)]


def main() -> int:
    ap = argparse.ArgumentParser(description="Copia os overlays subterrâneos pro web/public/overlays/")
    ap.add_argument("--src", type=Path, default=Path("assets/overlays"))
    ap.add_argument("--maps", type=Path, default=Path("web/public/maps.json"))
    ap.add_argument("--out", type=Path, default=Path("web/public/overlays"))
    args = ap.parse_args()

    index_path: Path = args.src / "overlays.json"
    if not index_path.exists():
        print(f"Não achei {index_path}. Rode antes tools/wuwa_overlays.py.", file=sys.stderr)
        return 1
    if not args.maps.exists():
        print(f"Não achei {args.maps}. Rode antes tools/build_tiles.py build.", file=sys.stderr)
        return 1

    data: dict[str, Any] = json.loads(index_path.read_text(encoding="utf-8"))
    ours: list[dict[str, Any]] = json.loads(args.maps.read_text(encoding="utf-8"))["maps"]
    name_by_id = {m["map_id"]: m["name"] for m in ours}
    zoom_by_id = {m["map_id"]: m["maxZoom"] for m in ours}

    missing = 0
    for m in data["maps"]:
        map_id = m.get("parent_map_id")
        name = name_by_id.get(map_id)
        if not name:
            print(f"{m['name']}: mapa pai {map_id} não está no maps.json, pulei")
            continue
        if m["zoom"] != zoom_by_id[map_id]:
            print(f"{m['name']}: zoom {m['zoom']} ≠ maxZoom {zoom_by_id[map_id]} do {name}, pulei")
            continue
        dest = args.out / name
        if dest.exists():
            shutil.rmtree(dest)
        dest.mkdir(parents=True)
        entries: list[dict[str, Any]] = []
        for o in m["overlays"]:
            src = args.src / "cache" / o["file"]
            if not src.exists() or src.stat().st_size == 0:
                missing += 1
                continue
            file = f"{o['id']}.webp"
            shutil.copyfile(src, dest / file)
            entries.append({
                "id": o["id"],
                "label": o.get("label") or o["id"],
                "file": file,
                "rect": o["rect_px"],
                "center": visible_center(src, o["rect_px"]),
            })
        out_json = args.out / f"{name}.json"
        out_json.write_text(json.dumps({"overlays": entries}, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{name}: {len(entries)} overlays -> {out_json}")

    if missing:
        print(f"{missing} imagens faltando no cache (rode o wuwa_overlays.py de novo).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
