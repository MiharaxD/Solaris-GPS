# Rotas por tipo de tarefa

Hoje existem a spec, as ferramentas de tiles, os assets e os tickets. As pastas marcadas
*(planejado)* ainda não existem: crie no lugar indicado e tire a marca quando passarem a
existir. Python: sempre `.venv/Scripts/python` (3.11).

## Próximo trabalho / o que fazer agora
- **Ir direto para:** `.scratch/wuwa-tracker/issues/`. Pegue o menor número cujos
  bloqueadores estejam todos feitos (a "frente").
- **Cuidados:** tickets 🛑 (04, 16, 24, 29) são paradas pra aprovação do usuário. Ao
  terminar um ticket, marque os checkboxes e atualize o `STATE.md`.
- **Spec de referência:** `PROMPT_wuwa_tracker.md`. A seção da fase correspondente basta;
  não precisa ler o arquivo todo.

## Tiles, manifests e mapas
- **Ir direto para:** `assets/tiles_cache/<map_id>/manifest.json` (fonte de verdade de cada
  mapa) e `assets/tiles_cache/<map_id>/<z>/<y>_<x>.webp`.
- **Build de tiles:** `tools/build_tiles.py`, com os subcomandos `inventory`, `manifest` e
  `pyramid`. O comando de build pro web (ticket 05) entra nele, com saída em
  `web/public/tiles/` e `web/public/maps.json` (ignorados pelo git).
- **Testar:** `.venv/Scripts/python tools/build_tiles.py inventory` (sai com 1 se algum
  manifest divergir do disco).
- **Cuidados:** as tiles são RGB, sem alpha. O fundo azul vem pintado e há padding preto
  puro. Pastas de zoom acima do `max_zoom` que só têm arquivos de 0 bytes são sondagem do
  downloader: ignore. No Overworld, z6 tem linhas 0–63 e colunas 1–62.
- **Não precisa ler:** `assets/mapas/*.png` (gigantes, só referência visual).

## Download de tiles (só com pedido)
- **Ir direto para:** `tools/wuwa_maps.py` (~240 linhas). `write_manifest` define o formato do
  manifest; `TileClient.path` define o nome dos arquivos.
- **Cuidados:** não editar nem rodar sem pedido. Os padrões `--cache tiles_cache` e
  `--out mapas` estão desatualizados (agora ficam em `assets/`).

## Mapa web (Vite + TS + Leaflet)
- **Ir direto para:** `web/src/mapView.ts` (Leaflet CRS.Simple, troca de mapa e conversão
  pixel↔latlng no `maxZoom`), `web/src/maps.ts` (tipos e leitura do `maps.json`),
  `web/src/main.ts` (bootstrap e HUD) e `web/src/style.css` (tokens de cor em `:root`).
- **Rodar e validar:** `npm --prefix web run dev` (http://127.0.0.1:5173, ou `preview_start
  web` pelo `.claude/launch.json`) e `npm --prefix web run typecheck`.
- **Cuidados:** o template de tile é `/tiles/<name>/{z}/{y}_{x}.webp` (y = linha). Os
  `bounds` do tile layer evitam 404 fora da grade. Leaflet 1.9 e TypeScript 7 em strict.
- **Não precisa ler:** `web/public/tiles/`, `web/public/maps.json` (gerados) e `web/dist/`.
- Tickets 06–15 seguem daqui.
- Dados do mapa (calibração, teleportes, Nexus, escala) vêm de `data/maps/<name>.json`
  *(planejado)*. Progresso do usuário fica no IndexedDB.

## Tracker (Python 3.11) *(planejado, `tracker/`)*
- Tickets 08 (WebSocket e config), 17–23 (PoC com fixtures), 25–28 (ao vivo).
- Sprites em `tracker/icons/` e prints em `tracker/fixtures/` são fornecidos pelo usuário.
- `config.json` *(planejado)*: resolução, minimapa, hotkeys, porta, caminho do cache, escala
  por mapa.

## Dados de entidades (WutheringData)
- **Ir direto para:** `vendor/WutheringData/ConfigDB/`. Clone parcial: pra incluir um
  arquivo, use `git sparse-checkout add <path>`. Nunca rode `git ls-tree -l` nesse clone,
  porque ele baixa o repositório inteiro (~1 GB).
- Teleportes: `Teleporter.json` (Type 2 = Beacon, 1 = Nexus, 3 = entrada) →
  `TeleportEntityConfigId` → `LevelEntityConfig_0.json`/`_1.json` por (MapId, EntityId) →
  `Transform[0]`.
- Mapa: `AkiMapSource.json` (`MapPath` termina no prefixo do `map_id` das tiles, ex.
  `.../AkiWorld_WP`), `AkiMap.json`, `MultiMap.json` (andares).
- Textos: `TextMap/<lang>/MultiText.json` (24 MB em `en`, ainda não baixado).
- **Não precisa ler:** `LevelEntityConfig.json` sem sufixo (dump antigo).
- **Arquivo grande:** os `LevelEntityConfig_*` têm 70–85 MB. Carregue via script e nunca
  leia direto.
- A saída gerada no ticket 11 não é commitada (adicionar a pasta ao `.gitignore`).

## Overlay *(planejado, `overlay/`, Fase 4)*
- Ticket 30. Precisa de Rust/Tauri.

## Mini-mapa de arquivos
| Arquivo | Papel |
|---|---|
| `PROMPT_wuwa_tracker.md` | Spec original: regras, fatos do minimapa, fases |
| `.scratch/wuwa-tracker/issues/NN-*.md` | Tickets com bloqueadores e critérios |
| `tools/wuwa_maps.py` | Downloader e costurador do CDN do th.gl (não mexer) |
| `tools/build_tiles.py` | Inventário, geração de manifest e teste da pirâmide |
| `assets/tiles_cache/*/manifest.json` | Metadados de cada mapa (zooms, limites) |
| `.gitignore` | Garante que assets e dados de terceiros fiquem fora |
