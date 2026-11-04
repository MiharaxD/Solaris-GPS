# Solaris GPS

Mapa interativo com marcadores e progresso para **Wuthering Waves**, com um tracker que
mostra sua posição em tempo real lendo o **minimapa** da tela. É um projeto pessoal e não
comercial, feito pra Windows 10/11.

> **Segurança da conta.** O tracker só *captura a tela*, como um software de gravação.
> Ele nunca lê nem escreve na memória do jogo, não injeta nada, não hooka APIs e não envia
> teclado nem mouse pro jogo. Nada sai do seu PC: não tem telemetria nem servidor externo,
> e o app não baixa nada em runtime.

## Estado

Em desenvolvimento. Hoje o mapa web mostra os mapas a partir das tiles locais. O tracker,
os marcadores e o progresso ainda estão por vir (veja `docs/context/STATE.md`).

## Requisitos

- Windows 10/11
- Python 3.11 (`py -3.11`)
- Node.js 20 ou mais novo
- As tiles dos mapas em `assets/tiles_cache/` (não vêm com o repositório, veja abaixo)

## Setup

```bash
py -3.11 -m venv .venv
.venv/Scripts/python -m pip install pillow numpy
npm --prefix web install
```

### Tiles

As tiles ficam em `assets/tiles_cache/<map_id>/<z>/<linha>_<coluna>.webp`, com um
`manifest.json` por mapa. Elas são baixadas uma única vez, à parte, com `tools/wuwa_maps.py`
(rode da raiz e passe `--cache assets/tiles_cache --out assets/mapas`).

Depois, gere as tiles do web (copia as tiles, cria os zooms menores e escreve
`web/public/maps.json`):

```bash
.venv/Scripts/python tools/build_tiles.py build
```

Outros comandos úteis:

```bash
.venv/Scripts/python tools/build_tiles.py inventory
```

```bash
.venv/Scripts/python tools/build_tiles.py manifest <map_id> --name <nome>
```

```bash
.venv/Scripts/python tools/build_tiles.py pyramid <map_id> --lo 5
```

## Rodar o mapa web

```bash
npm --prefix web run dev
```

Abra http://127.0.0.1:5173. O servidor só escuta em localhost.

## Rodar o tracker

```bash
.venv/Scripts/python -m pip install -r tracker/requirements.txt
```

```bash
.venv/Scripts/python -m tracker
```

Ele sobe um WebSocket em `ws://127.0.0.1:8765` e só aceita conexões do mapa web (as origens
ficam em `config.json`). Por enquanto, ele recebe o mapa ativo e grava os dados de calibração
em `data/maps/`. A captura do minimapa vem nas próximas fases. O mapa web funciona com o
tracker desligado.

Testes:

```bash
.venv/Scripts/python -m pytest
```

## Configuração

`config.json` (na raiz): caminho do cache de tiles, pasta `data/maps`, porta e origens do
WebSocket, resolução da tela, posição e formato do minimapa, hotkeys e escala
minimapa→mapa calibrada por mapa.

## Créditos e direitos

- **Wuthering Waves**: arte, assets e dados © Kuro Games. Este projeto não é afiliado nem
  endossado pela Kuro Games.
- **Tiles dos mapas** (uso local): baixadas do CDN do
  [th.gl (The Hidden Gaming Lair)](https://www.th.gl/), que processou as tiles. Elas
  **não** estão no repositório.
- **Dados do jogo**: [Dimbreath/WutheringData](https://github.com/Dimbreath/WutheringData),
  usado localmente (posição de teleportes, Nexus e outras entidades). Os dados derivados
  dele também não estão no repositório.

Tiles, dados de jogo e dados de outros sites de mapa nunca são commitados (veja o
`.gitignore`).
