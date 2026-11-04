"""`python -m tracker`: sobe o servidor WebSocket local.

Nesta fase só existe o canal com o web (mapa ativo + gravação de data/maps). A captura do
minimapa entra nas Fases 2–3.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
from pathlib import Path

from .config import DEFAULT_CONFIG, load_config
from .server import TrackerServer


async def _run(config_path: Path) -> None:
    cfg = load_config(config_path)
    server = TrackerServer(cfg)
    ws = await server.start()
    logging.info("tracker em ws://%s:%d (%d mapas; origens %s)", cfg.websocket.host, cfg.websocket.port,
                 len(server.maps), ", ".join(cfg.websocket.allowed_origins))
    async with ws:
        await ws.serve_forever()


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m tracker")
    ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    try:
        asyncio.run(_run(args.config))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
