"""Testes do canal web↔tracker: protocolo, origem, gravação de data/maps e path traversal."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus

from tracker.config import Config, WebSocketConfig
from tracker.server import TrackerServer

ORIGIN = "http://127.0.0.1:5173"


@pytest.fixture
def cfg(tmp_path: Path) -> Config:
    cache = tmp_path / "tiles_cache"
    for name in ("overworld", "lahai-roi"):
        d = cache / f"{name}-id"
        d.mkdir(parents=True)
        (d / "manifest.json").write_text(json.dumps({"name": name}), encoding="utf-8")
    return Config(root=tmp_path, tiles_cache=cache, map_data_dir=tmp_path / "data" / "maps",
                  websocket=WebSocketConfig(host="127.0.0.1", port=0, allowed_origins=(ORIGIN,)))


@pytest.fixture
async def server(cfg: Config):
    srv = TrackerServer(cfg)
    ws_server = await srv.start()
    port = next(iter(ws_server.sockets)).getsockname()[1]
    yield srv, f"ws://127.0.0.1:{port}"
    ws_server.close()
    await ws_server.wait_closed()


async def recv(ws) -> dict:
    return json.loads(await ws.recv())


async def test_welcome_and_active_map_broadcast(server) -> None:
    srv, url = server
    async with connect(url, origin=ORIGIN) as a, connect(url, origin=ORIGIN) as b:
        wa, wb = await recv(a), await recv(b)
        assert wa["type"] == "welcome" and wa["maps"] == ["lahai-roi", "overworld"]
        assert wa["activeMap"] is None and wb["type"] == "welcome"
        await a.send(json.dumps({"type": "hello", "client": "web", "version": 1}))
        await a.send(json.dumps({"type": "set_active_map", "map": "overworld"}))
        assert await recv(a) == {"type": "active_map", "map": "overworld"}
        assert await recv(b) == {"type": "active_map", "map": "overworld"}
        assert srv.active_map == "overworld"


async def test_save_and_get_map_data(server, cfg: Config) -> None:
    _, url = server
    async with connect(url, origin=ORIGIN) as ws:
        await recv(ws)
        data = {"calibration": {"points": [{"px": [1, 2], "game": [3, 4]}]}}
        await ws.send(json.dumps({"type": "save_map_data", "requestId": "r1", "map": "overworld", "data": data}))
        saved = await recv(ws)
        assert saved == {"type": "saved", "requestId": "r1", "map": "overworld", "path": "data/maps/overworld.json"}
        assert json.loads((cfg.map_data_dir / "overworld.json").read_text(encoding="utf-8")) == data
        await ws.send(json.dumps({"type": "get_map_data", "requestId": "r2", "map": "overworld"}))
        got = await recv(ws)
        assert got["type"] == "map_data" and got["data"] == data
        await ws.send(json.dumps({"type": "get_map_data", "requestId": "r3", "map": "lahai-roi"}))
        assert (await recv(ws))["data"] is None


@pytest.mark.parametrize("bad", ["../config", "..\\x", "Overworld", "nao-existe", "a/b"])
async def test_rejects_unknown_or_traversal_names(server, cfg: Config, bad: str) -> None:
    _, url = server
    async with connect(url, origin=ORIGIN) as ws:
        await recv(ws)
        await ws.send(json.dumps({"type": "save_map_data", "requestId": "x", "map": bad, "data": {}}))
        err = await recv(ws)
        assert err["type"] == "error" and err["requestId"] == "x"
    assert not any(cfg.root.rglob("*.json.tmp"))
    assert not (cfg.root / "config.json").exists()


@pytest.mark.parametrize("payload", ['{"type":"save_map_data","requestId":"y","map":"overworld","data":[1]}',
                                     "não é json", '{"type":"nada"}', '{"type":"hello","client":"web","version":99}'])
async def test_invalid_messages_return_error(server, payload: str) -> None:
    _, url = server
    async with connect(url, origin=ORIGIN) as ws:
        await recv(ws)
        await ws.send(payload)
        assert (await recv(ws))["type"] == "error"


async def test_rejects_foreign_origin(server) -> None:
    _, url = server
    with pytest.raises(InvalidStatus):
        async with connect(url, origin="https://site-qualquer.example"):
            pass
