"""Mensagens JSON entre web e tracker (espelhadas em web/src/protocol.ts).

web → tracker
    {"type": "hello", "client": "web", "version": 1}
    {"type": "set_active_map", "map": "<name>"}
    {"type": "save_map_data", "requestId": "...", "map": "<name>", "data": {...}}
    {"type": "get_map_data", "requestId": "...", "map": "<name>"}

tracker → web
    {"type": "welcome", "server": "solaris-tracker", "version": 1, "activeMap": "<name>"|null, "maps": [...]}
    {"type": "active_map", "map": "<name>"|null}              (broadcast a todos)
    {"type": "saved", "requestId": "...", "map": "<name>", "path": "data/maps/<name>.json"}
    {"type": "map_data", "requestId": "...", "map": "<name>", "data": {...}|null}
    {"type": "error", "requestId": "..."|null, "message": "..."}
"""
from __future__ import annotations

import json
from typing import Any, Literal, TypedDict

from . import PROTOCOL_VERSION

MAX_MESSAGE_BYTES = 2_500_000


class ProtocolError(ValueError):
    def __init__(self, message: str, request_id: str | None = None) -> None:
        super().__init__(message)
        self.request_id = request_id


class Hello(TypedDict):
    type: Literal["hello"]
    client: str
    version: int


class SetActiveMap(TypedDict):
    type: Literal["set_active_map"]
    map: str


class SaveMapData(TypedDict):
    type: Literal["save_map_data"]
    requestId: str
    map: str
    data: dict[str, Any]


class GetMapData(TypedDict):
    type: Literal["get_map_data"]
    requestId: str
    map: str


ClientMessage = Hello | SetActiveMap | SaveMapData | GetMapData


def _str(msg: dict[str, Any], key: str, rid: str | None) -> str:
    v = msg.get(key)
    if not isinstance(v, str) or not v:
        raise ProtocolError(f"campo {key!r} ausente ou inválido", rid)
    return v


def parse_client_message(raw: str | bytes) -> ClientMessage:
    if isinstance(raw, bytes):
        raise ProtocolError("só mensagens de texto")
    if len(raw) > MAX_MESSAGE_BYTES:
        raise ProtocolError("mensagem grande demais")
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ProtocolError(f"JSON inválido: {e.msg}") from None
    if not isinstance(msg, dict):
        raise ProtocolError("mensagem precisa ser um objeto")
    rid = msg.get("requestId") if isinstance(msg.get("requestId"), str) else None
    kind = msg.get("type")
    if kind == "hello":
        version = msg.get("version")
        if version != PROTOCOL_VERSION:
            raise ProtocolError(f"versão de protocolo {version!r} != {PROTOCOL_VERSION}")
        return Hello(type="hello", client=_str(msg, "client", rid), version=PROTOCOL_VERSION)
    if kind == "set_active_map":
        return SetActiveMap(type="set_active_map", map=_str(msg, "map", rid))
    if kind == "save_map_data":
        data = msg.get("data")
        if not isinstance(data, dict):
            raise ProtocolError("campo 'data' precisa ser um objeto", rid)
        return SaveMapData(type="save_map_data", requestId=_str(msg, "requestId", rid),
                           map=_str(msg, "map", rid), data=data)
    if kind == "get_map_data":
        return GetMapData(type="get_map_data", requestId=_str(msg, "requestId", rid), map=_str(msg, "map", rid))
    raise ProtocolError(f"tipo desconhecido: {kind!r}", rid)


def encode(msg: dict[str, Any]) -> str:
    return json.dumps(msg, ensure_ascii=False)
