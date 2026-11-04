"""Servidor WebSocket do tracker (só localhost, origem checada)."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from websockets.asyncio.server import Server, ServerConnection, serve
from websockets.exceptions import ConnectionClosed

from . import PROTOCOL_VERSION
from .config import Config
from .map_data import MapDataError, MapDataStore, known_maps
from .protocol import ProtocolError, encode, parse_client_message

log = logging.getLogger("tracker.server")


class TrackerServer:
    def __init__(self, config: Config) -> None:
        self.config = config
        self.maps = known_maps(config.tiles_cache)
        self.store = MapDataStore(config.map_data_dir, self.maps)
        self.active_map: str | None = None
        self.clients: set[ServerConnection] = set()

    def _rel(self, p: Path) -> str:
        try:
            return p.resolve().relative_to(self.config.root.resolve()).as_posix()
        except ValueError:
            return p.as_posix()

    async def broadcast(self, msg: dict[str, object]) -> None:
        text = encode(msg)
        for ws in list(self.clients):
            try:
                await ws.send(text)
            except ConnectionClosed:
                self.clients.discard(ws)

    async def handler(self, ws: ServerConnection) -> None:
        self.clients.add(ws)
        log.info("cliente conectado (%d)", len(self.clients))
        try:
            await ws.send(encode({
                "type": "welcome", "server": "solaris-tracker", "version": PROTOCOL_VERSION,
                "activeMap": self.active_map, "maps": self.maps,
            }))
            async for raw in ws:
                await self._handle(ws, raw)
        except ConnectionClosed:
            pass
        finally:
            self.clients.discard(ws)
            log.info("cliente desconectado (%d)", len(self.clients))

    async def _handle(self, ws: ServerConnection, raw: str | bytes) -> None:
        rid: str | None = None
        try:
            msg = parse_client_message(raw)
            rid = msg.get("requestId")  # type: ignore[assignment]
            if msg["type"] == "hello":
                return
            if msg["type"] == "set_active_map":
                name = msg["map"]
                if name not in self.maps:
                    raise ProtocolError(f"mapa desconhecido: {name!r}")
                if name != self.active_map:
                    self.active_map = name
                    log.info("mapa ativo: %s", name)
                await self.broadcast({"type": "active_map", "map": self.active_map})
            elif msg["type"] == "save_map_data":
                path = await asyncio.to_thread(self.store.save, msg["map"], msg["data"])
                log.info("salvo %s", path)
                await ws.send(encode({"type": "saved", "requestId": msg["requestId"], "map": msg["map"],
                                      "path": self._rel(path)}))
            elif msg["type"] == "get_map_data":
                data = await asyncio.to_thread(self.store.load, msg["map"])
                await ws.send(encode({"type": "map_data", "requestId": msg["requestId"], "map": msg["map"],
                                      "data": data}))
        except ProtocolError as e:
            await ws.send(encode({"type": "error", "requestId": e.request_id, "message": str(e)}))
        except MapDataError as e:
            await ws.send(encode({"type": "error", "requestId": rid, "message": str(e)}))

    async def start(self) -> Server:
        wsc = self.config.websocket
        return await serve(
            self.handler, wsc.host, wsc.port,
            origins=list(wsc.allowed_origins),  # bloqueia sites aleatórios abertos no navegador
            max_size=3_000_000,
        )
