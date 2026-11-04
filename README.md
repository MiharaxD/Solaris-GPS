# Solaris GPS

Mapa interativo com marcadores e progresso para **Wuthering Waves**, com um tracker que
mostra sua posição em tempo real lendo o **minimapa** a partir da tela compartilhada no
navegador. É um projeto pessoal e não comercial, feito pra Windows 10/11 com Chrome ou Edge.

> **Segurança da conta.** O tracker só *vê a janela que você compartilhar* pelo navegador,
> como uma chamada de vídeo. Ele nunca lê nem escreve na memória do jogo, não injeta nada,
> não hooka APIs e não envia teclado nem mouse pro jogo. Nada sai do seu PC: não tem
> telemetria nem servidor externo, e o app não baixa nada em runtime.

## Estado

Em desenvolvimento. Hoje o mapa web mostra os 10 mapas a partir das tiles locais, com
calibração e marcadores (teleportes, baús, coletáveis) filtráveis e com busca. O tracker
(compartilhar tela) e o progresso ainda estão por vir (veja `docs/context/STATE.md`).

## Requisitos

- Windows 10/11 com Chrome ou Edge
- Node.js 20 ou mais novo
- Python 3.11 (`py -3.11`), só pras ferramentas de tiles e dados
- As tiles dos mapas em `assets/tiles_cache/` (não vêm com o repositório, veja abaixo)

## Setup

```bash
py -3.11 -m venv .venv
.venv/Scripts/python -m pip install -r tools/requirements.txt
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

### Marcadores (opcional)

Os marcadores vêm do [WutheringData](https://github.com/Dimbreath/WutheringData), clonado
por você em `vendor/WutheringData`. Eles são gerados localmente e nunca vão pro repositório:

```bash
.venv/Scripts/python tools/extract_refs.py
```

```bash
.venv/Scripts/python tools/extract_markers.py
```

O primeiro gera as referências da calibração (`web/public/refs/`) e o segundo, os marcadores
(`web/public/markers/`). Um mapa só mostra marcadores depois de calibrado (3+ pontos).

## Rodar o mapa web

```bash
npm --prefix web run dev
```

Abra http://127.0.0.1:5173. O servidor só escuta em localhost.

Testes do web:

```bash
npm --prefix web test
```

### Tracker

O botão **Tracker** compartilha a janela do jogo (o navegador pergunta qual) e recorta o
minimapa; a prévia fica no canto inferior esquerdo. Pra testar o pipeline nos seus prints
(anotados pelo botão **Fixture**, em `tracker/fixtures/`, fora do git):

```bash
npm --prefix web run fixtures
```

A página http://127.0.0.1:5173/lab.html mostra a detecção passo a passo.

## Configuração

`config.json` (na raiz) guarda os padrões: o caminho do cache de tiles, a pasta
`data/maps`, a resolução da tela e a posição e o formato do minimapa. Os ajustes que você fizer
no app (recorte do minimapa, preferências) ficam salvos no navegador. Os dados de cada mapa
(calibração, escala minimapa→mapa, teleportes cadastrados) ficam em `data/maps/<mapa>.json`,
gravados pelo próprio servidor local do Vite.

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
