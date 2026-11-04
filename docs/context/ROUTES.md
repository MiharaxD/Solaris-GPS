# Rotas por tipo de tarefa

Hoje existem a spec, as ferramentas de tiles, o mapa web, a API local de dados e os tickets. As pastas marcadas
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
- **Build de tiles:** `tools/build_tiles.py` (`inventory`, `manifest`, `pyramid`, `build` e
  `slice`). O `build` grava `web/public/tiles/` e `web/public/maps.json` (ignorados pelo git).
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
  `web/src/main.ts` (bootstrap, troca de mapa, HUD), `web/src/mapPicker.ts` (dropdown),
  `web/src/storage.ts` (prefs no localStorage) e `web/src/style.css` (tokens em `:root`).
- **Rodar e validar:** `npm --prefix web run dev` (http://127.0.0.1:5173, ou `preview_start
  web` pelo `.claude/launch.json`), `npm --prefix web run typecheck` (tsconfig.json pro
  browser e tsconfig.node.json pro vite.config e `web/server/`) e `npm --prefix web test`.
- **Cuidados:** o template de tile é `/tiles/<name>/{z}/{y}_{x}.webp` (y = linha). Os
  `bounds` do tile layer evitam 404 fora da grade. Leaflet 1.9 e TypeScript 7 em strict.
- **Não precisa ler:** `web/public/tiles/`, `web/public/maps.json` (gerados) e `web/dist/`.
- **Calibração (ticket 09):** `web/src/calibration.ts` (painel, pontos arrastáveis, vetor de
  erro, previsão das outras referências, escolha da transformação em `transform()`),
  `web/src/autoCalib.ts` (máscara de terra + busca das 8 orientações), `web/src/affine.ts`
  (afim/similaridade normalizadas, inversa, `anchorAt`; testes em `affine.test.ts`) e
  `web/src/refs.ts` (lê `/refs/<name>.json`).
- **Marcadores (ticket 11):** `web/src/markers.ts` (categorias, cores, filtro, busca;
  testes em `markers.test.ts`), `web/src/markerLayer.ts` (canvas único num pane próprio, hit
  test) e `web/src/markerPanel.ts` (painel, popup; recebe a calibração via
  `CalibrationPanel.onData`). Zoom do Leaflet fica no canto inferior direito.
- **Progresso (ticket 12):** `web/src/progress.ts` (`ProgressStore` no IndexedDB, backup
  `parseBackup`/`makeBackup`, `tallyMarkers`; testes em `progress.test.ts`). O painel de
  marcadores mostra e alterna. Cuidado: os ids dos marcadores são a chave do progresso.
- **Marcadores manuais (ticket 13):** formulário e modos de clique em `markerPanel.ts`
  (`openForm`, `saveManual`, `setMode`); `manualMarkersOf`/`patchMapData` em `mapData.ts`;
  pessoais em `ProgressStore` (`putPersonal`/`deletePersonal`). `MAP_FILE_CATS` (markers.ts)
  decide o que vai pro arquivo do mapa.
- **Importador do th.gl (ticket 14):** `web/src/thglImport.ts` (parser e casamento; testes em
  `thglImport.test.ts`) e `web/src/importDialog.ts` (diálogo de prévia).
- Ticket 15 segue daqui. No console do web, `window.solaris` expõe `view`,
  `calibration`, `markers`, `progress` e `mapData` pra depuração.

## Dados do mapa (`data/maps/<name>.json`) e API local
- **Ir direto para:** `web/server/mapData.ts` (validação de nome contra o `maps.json` e
  escrita atômica), `web/server/mapDataPlugin.ts` (GET/PUT `/api/map-data/<name>`, checando
  Host, Origin e o header `X-Solaris-Client`) e `web/src/mapData.ts` (cliente e fallback de
  download).
- **Testar:** `npm --prefix web test` (`web/server/mapDataPlugin.test.ts`).
- **Cuidados:** a API só existe no `vite dev`. O CORS fica desligado no `vite.config.ts`. A
  pasta vem de `mapDataDir` no `config.json`.

## Tracker no navegador *(planejado, Fases 2–3: tickets 17–28)*
- Código em `web/src/tracker/` *(planejado)*: Worker de captura e processamento, com o mesmo
  pipeline usado pelo runner de fixtures em Node/Vitest.
- Sprites em `tracker/icons/` e prints em `tracker/fixtures/` e `tracker/samples/` são do
  usuário (ignorados pelo git). Escala no minimapa a 1440p: Nexus ~34 px, teleporte ~14×34 px.
- `config.json`: só os padrões (cache, `data/maps`, tela 2560×1440, minimapa). Os ajustes
  do usuário ficam no navegador.

## Dados de entidades (WutheringData)
- **Ir direto para:** `vendor/WutheringData/ConfigDB/`. Clone parcial: pra incluir um
  arquivo, use `git sparse-checkout add <path>`. Nunca rode `git ls-tree -l` nesse clone,
  porque ele baixa o repositório inteiro (~1 GB).
- Teleportes: `Teleporter.json` (Type 2 = Beacon, 1 = Nexus, 3 = entrada) →
  `TeleportEntityConfigId` → `LevelEntityConfig_0.json`/`_1.json` por (MapId, EntityId) →
  `Transform[0]`.
- Mapa: `AkiMapSource.json` (`MapPath` termina no prefixo do `map_id` das tiles, ex.
  `.../AkiWorld_WP`), `AkiMap.json`, `MultiMap.json` (andares).
- Textos: `TextMap/en|pt/MultiText.json` (o pt só tem parte das chaves). Nome de área:
  `Area.json` (`Title`, `Father`).
- **Gerar referências:** `.venv/Scripts/python tools/extract_refs.py` grava
  `web/public/refs/<name>.json` (teleportes e Nexus com coordenadas e área; ignorado pelo git).
- **Não precisa ler:** `LevelEntityConfig.json` sem sufixo (dump antigo).
- **Arquivo grande:** os `LevelEntityConfig_*` têm 70–85 MB. Carregue via script e nunca
  leia direto.
- **Gerar marcadores:** `.venv/Scripts/python tools/extract_markers.py` grava
  `web/public/markers/<name>.json` (ignorado pelo git). Categoria = `BlueprintConfig.json`
  (`BlueprintType` → `EntityType`) + nome chinês da entidade; espécie traduzida por
  `TextMap/zh-Hans/MultiText.json`/`ItemInfo.json` (mesmas chaves do en/pt).

## Pop-out *(planejado, Fase 4)*
- Ticket 30: Document Picture-in-Picture (Chrome/Edge). Sem Tauri e sem Rust.

## Mini-mapa de arquivos
| Arquivo | Papel |
|---|---|
| `PROMPT_wuwa_tracker.md` | Spec original: regras, fatos do minimapa, fases |
| `.scratch/wuwa-tracker/issues/NN-*.md` | Tickets com bloqueadores e critérios |
| `tools/wuwa_maps.py` | Downloader e costurador do CDN do th.gl (não mexer) |
| `tools/build_tiles.py` | Inventário, manifest, pirâmide, build do web e slice |
| `web/src/mapView.ts` | Leaflet e conversão pixel↔latlng |
| `web/server/mapDataPlugin.ts` | API local `/api/map-data` |
| `config.json` | Padrões: caminhos, tela, minimapa |
| `tools/extract_refs.py` | Teleportes/Nexus do WutheringData → `web/public/refs/` |
| `tools/extract_markers.py` | Marcadores por categoria → `web/public/markers/` |
| `web/src/markerPanel.ts` | Painel de marcadores (filtro, busca, popup) |
| `web/src/calibration.ts` | Painel de calibração jogo→pixel |
| `assets/tiles_cache/*/manifest.json` | Metadados de cada mapa (zooms, limites) |
| `.gitignore` | Garante que assets e dados de terceiros fiquem fora |
