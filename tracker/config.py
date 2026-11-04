"""Leitura do config.json da raiz do projeto (caminhos relativos a ele)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = ROOT / "config.json"


@dataclass(frozen=True)
class WebSocketConfig:
    host: str = "127.0.0.1"
    port: int = 8765
    allowed_origins: tuple[str, ...] = ("http://127.0.0.1:5173", "http://localhost:5173")


@dataclass(frozen=True)
class Config:
    root: Path
    tiles_cache: Path
    map_data_dir: Path
    websocket: WebSocketConfig
    raw: dict[str, Any] = field(default_factory=dict)  # seções ainda não tipadas (minimapa, hotkeys...)


def load_config(path: Path = DEFAULT_CONFIG) -> Config:
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    base = path.resolve().parent
    ws = data.get("websocket", {})
    host = str(ws.get("host", "127.0.0.1"))
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"websocket.host={host!r}: o tracker só pode escutar em localhost")
    return Config(
        root=base,
        tiles_cache=base / data.get("tilesCache", "assets/tiles_cache"),
        map_data_dir=base / data.get("mapDataDir", "data/maps"),
        websocket=WebSocketConfig(
            host=host,
            port=int(ws.get("port", 8765)),
            allowed_origins=tuple(ws.get("allowedOrigins", WebSocketConfig.allowed_origins)),
        ),
        raw=data,
    )
