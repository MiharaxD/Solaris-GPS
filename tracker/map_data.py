"""Mapas conhecidos (pelos manifests) e arquivos versionados data/maps/<name>.json.

Esses arquivos guardam "o que se sabe do mapa": calibração, teleportes/nexus manuais, escala do
minimapa. Quem grava é o tracker, a pedido do web (mensagem save_map_data).
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
MAX_BYTES = 2_000_000


class MapDataError(ValueError):
    pass


def known_maps(tiles_cache: Path) -> list[str]:
    names: list[str] = []
    if not tiles_cache.is_dir():
        return names
    for d in sorted(tiles_cache.iterdir()):
        mf = d / "manifest.json"
        if mf.is_file():
            try:
                name = json.loads(mf.read_text(encoding="utf-8")).get("name")
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(name, str) and NAME_RE.match(name):
                names.append(name)
    return names


class MapDataStore:
    def __init__(self, directory: Path, allowed: list[str]) -> None:
        self.directory = directory
        self.allowed = set(allowed)

    def _path(self, name: str) -> Path:
        # Nome validado contra regex E contra a lista de mapas reais: impede path traversal.
        if not NAME_RE.match(name) or name not in self.allowed:
            raise MapDataError(f"mapa desconhecido: {name!r}")
        return self.directory / f"{name}.json"

    def load(self, name: str) -> dict[str, Any] | None:
        p = self._path(name)
        if not p.exists():
            return None
        data = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise MapDataError(f"{p.name} não contém um objeto JSON")
        return data

    def save(self, name: str, data: object) -> Path:
        p = self._path(name)
        if not isinstance(data, dict):
            raise MapDataError("data precisa ser um objeto JSON")
        text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
        if len(text.encode("utf-8")) > MAX_BYTES:
            raise MapDataError(f"dados acima de {MAX_BYTES} bytes")
        self.directory.mkdir(parents=True, exist_ok=True)
        # Escrita atômica: nunca deixa um JSON pela metade se algo falhar.
        fd, tmp = tempfile.mkstemp(dir=self.directory, prefix=f".{name}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            os.replace(tmp, p)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return p
