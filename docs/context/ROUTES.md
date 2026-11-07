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
- **Rombo Jinzhou–Mengzhou:** `tools/fill_overworld_gap.py --write` transforma os cortes retos
  dos blocos de dados do Overworld (z6 linhas 22–39, colunas 16–29, e as z5 correspondentes) em
  costa irregular: as duas regiões viram ilhas com mar no meio. Os cortes ficam em constantes
  `CUT_*` conferidas no disco. Guarda os originais em `assets/tiles_cache_backup/overworld_gap/`
  e é idempotente. Depois rode `build_tiles.py build`. Se o cache for rebaixado do CDN, rode de
  novo (apague o backup antes).

## Subterrâneo (overlays do th.gl)
- **Ir direto para:** `tools/wuwa_overlays.py` (lê o `tilesConfig` do HTML salvo do th.gl em
  `assets/overlays/mundo_aberto.html`, baixa as imagens pra `assets/overlays/cache/` e grava
  `assets/overlays/overlays.json` com o retângulo em pixel do zoom máximo; só rodar com pedido),
  `tools/build_overlays.py` (copia pra `web/public/overlays/<name>/` + `<name>.json` com `rect` e
  `center`) e `web/src/underground.ts` (`UndergroundLayer`: botão "Subterrâneo", escurece as
  tiles e desenha as imagens num pane entre tiles e marcadores; rótulos a partir de maxZoom−2).
- **Cuidados:** hoje só o Overworld tem overlays (30). As imagens são RGBA esparsas e várias se
  sobrepõem (andares). `footprints` do `overlays.json` ainda não são usados. O tracker ignora o
  subterrâneo.

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
- **Visual:** `web/src/style.css` segue o dossiê visual do usuário (claude.ai/artifact/6txRqHdy2ApX8DE28xPzip):
  tokens no `:root`, superfície comum (painel translúcido, linha fina, canto cortado) num seletor
  só no topo, rótulos em Chakra Petch e UI em Inter (`@fontsource`, importadas no `main.ts`).
  Ícones em `web/src/icons.ts`: `markerSvg` (selo escuro + anel na cor + glifo claro; teleporte e
  Nexus copiam a silhueta do minimapa), `markerSprite` (bitmap 64 px pro canvas) e `uiIcon`
  (glifos de traço da barra e dos cabeçalhos). Categoria → ícone e cor em `markers.ts`.
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
- **Marcadores (ticket 11):** `web/src/markers.ts` (categorias, ícones, cores, filtro, busca;
  testes em `markers.test.ts`), `web/src/markerLayer.ts` (canvas único num pane próprio, hit
  test) e `web/src/markerPanel.ts` (painel, popup; recebe a calibração via
  `CalibrationPanel.onData`). Zoom do Leaflet fica no canto inferior direito.
- **Progresso (ticket 12):** `web/src/progress.ts` (`ProgressStore` no IndexedDB, backup
  `parseBackup`/`makeBackup`, `tallyMarkers`; testes em `progress.test.ts`). O painel de
  marcadores mostra e alterna. Cuidado: os ids dos marcadores são a chave do progresso.
- **Configurações, atalhos e "mais próximo":** `web/src/settingsDialog.ts` (abas Geral e
  Atalhos; o slider de tamanho chama `setMarkerScale` do `markerPanel.ts` → `setScale` do
  `markerLayer.ts`; o painel de marcadores recolhe pelo `setCollapsed`), `web/src/hotkeys.ts` (combinação por `code`, prefs, conflitos; testes em
  `hotkeys.test.ts`), `web/src/toast.ts`. No `markerPanel.ts`: `setPlayer`/`updateNearest`
  (linha `.nearest-link`, só entre os itens desenhados e não encontrados), `collectNearest`,
  `undoLast` (histórico da sessão) e `setHideFound` por grupo. A ligação fica no `main.ts`.
- **Região do tracker:** `web/src/regions.ts` (retângulo por área de topo dos marcadores,
  nação inteira; testes em `regions.test.ts`), `web/src/regionPicker.ts` (seletor na barra,
  salvo por mapa) → `TrackerPanel.setSearchArea` → mensagem `area` → `TrackSession.setArea`
  → `GlobalLocator.locate(..., area)` (só a busca no mapa inteiro; a guiada por ícones não).
- **Marcadores manuais (ticket 13):** formulário e modos de clique em `markerPanel.ts`
  (`openForm`, `saveManual`, `setMode`); `manualMarkersOf`/`patchMapData` em `mapData.ts`;
  pessoais em `ProgressStore` (`putPersonal`/`deletePersonal`). `MAP_FILE_CATS` (markers.ts)
  decide o que vai pro arquivo do mapa.
- **Importador do th.gl (ticket 14):** `web/src/thglImport.ts` (parser e casamento; testes em
  `thglImport.test.ts`) e `web/src/importDialog.ts` (diálogo de prévia).
- **Importador do appsample:** `tools/build_appsample.py` (base em
  `assets/appsample/markers_all.v3.json`, `--download` baixa; grava `web/public/appsample.json`,
  ignorado pelo git; ~1 min), `web/src/appsampleImport.ts` (script do console, parser,
  `resolveIds`; testes em `appsampleImport.test.ts`) e `web/src/appsampleDialog.ts` (prévia por
  mapa, aplica em todos). Botão nas Configurações; `openAppsampleImport` no `markerPanel.ts`.
  Cuidado: os nomes dos tipos (`z1`...) e a chave da cifra vêm do bundle do site deles.
- **Fixtures (ticket 15):** `web/src/fixturePanel.ts` (UI e formato `FixtureAnnotation`) e
  `web/server/fixturesPlugin.ts` (`/api/fixtures`, grava em `fixturesDir` do `config.json`,
  padrão `tracker/fixtures/`; testes em `fixturesPlugin.test.ts`).
- No console do web, `window.solaris` expõe `view`,
  `calibration`, `markers`, `progress` e `mapData` pra depuração.

## Dados do mapa (`data/maps/<name>.json`) e API local
- **Ir direto para:** `web/server/mapData.ts` (validação de nome contra o `maps.json` e
  escrita atômica), `web/server/mapDataPlugin.ts` (GET/PUT `/api/map-data/<name>`),
  `web/server/guards.ts` (Host, Origin e o header `X-Solaris-Client`, comuns às APIs locais) e
  `web/src/mapData.ts` (cliente, `patchMapData` e fallback de download).
- **Testar:** `npm --prefix web test` (`web/server/mapDataPlugin.test.ts`).
- **Cuidados:** a API só existe no `vite dev`. O CORS fica desligado no `vite.config.ts`. A
  pasta vem de `mapDataDir` no `config.json`.

## Tracker no navegador (Fases 2–3: tickets 17–28)
- **Ir direto para:** `web/src/tracker/pipeline.ts` (`processFrame`, o mesmo no Worker e no
  runner), `minimap.ts` (detecção e recorte), `image.ts` (RGBA/cinza, resize, embed),
  `session.ts` (`TrackSession`: estado do rastreio por frame; testes em `session.test.ts`),
  `worker.ts` (lê o MediaStreamTrackProcessor, frame mais recente, Hz e ocupação) +
  `protocol.ts`, `web/src/trackerPanel.ts` (captura, configuração, comandos, HUD) e
  `web/src/trackerView.ts` (seta no mapa, cor por confiança, Seguir). Padrões de tela/minimapa do `config.json` chegam via `define`
  (`web/src/config.ts`).
- **Escala (ticket 18):** `web/src/tracker/match.ts` (NCC mascarada, `resizeGray` por área),
  `scale.ts` (`sweepScale`: passada grossa e fina), `tiles.ts` (`grayWindow` das tiles do zoom
  máximo; leitor do navegador e, no runner, `sharp`) e `scaleWorker.ts`. UI na seção "Escala do
  minimapa" do `fixturePanel.ts`; grava `minimapScale` (`mapData.ts`).
- **Camada imagem (ticket 19):** `web/src/tracker/locate.ts` (`detectCone`, `minimapPlanes`,
  `locateByImage`: grossa 4× + fina + subpixel), `imageLocator.ts` (janela 3×3 tiles com LRU,
  usada no Worker e no runner) e `planesWindow`/`lruTileReader` em `tiles.ts`. O Worker roda a
  camada quando o frame traz `locate` com `prev` (`protocol.ts`).
- **Busca global e Find me (ticket 20):** `web/src/tracker/globalSearch.ts` (`GlobalLocator`:
  visão geral no zoom em que o minimapa tem ~12 px, só onde há terra; meio 4× maior; fim com o
  `ImageLocator`; `confident` por margem e NCC). Roda no Worker quando `locate` vem sem `prev`.
  UI na seção "Posição" do `trackerPanel.ts` (Achar no mapa, Find me, marcador `.trk-pos`).
  As tiles de qualquer zoom vêm do `TileReader(z, linha, coluna)` em `tiles.ts`.
- **Referências (ticket 21):** `web/src/tracker/icons.ts` (`detectIcons`: cor dos ícones, anel
  do Nexus por Hough, pilha do teleporte) e `references.ts` (`refPoints`: WutheringData pela
  afim + manuais − `ignoredRefs`; `locateByRefs`: constelação ou anterior). O Worker roda quando
  `locate.refs` vem; o painel Tracker monta as refs em `setMap` e só exibe o resultado.
- **Fusão (ticket 23):** `web/src/tracker/fuse.ts` (`fuseLocal`, `fuseGlobal`,
  `guidedCandidates` e `iconAtCenter`; limiares em `DEFAULT_FUSE`). O Worker devolve `fused`, e o painel Tracker
  usa só ele pra posição (`showPosition`).
- **Suavização e saltos (ticket 26):** `web/src/tracker/motion.ts` (`MotionFilter`: Kalman
  por eixo; `JumpGate`: velocidade máxima e confirmação de salto; testes em `motion.test.ts`).
  A sessão guarda `pos` (medida aceita, usada na busca) e `display` (suavizada, vai no
  `track.pos`); salto descartado vem em `rejected`.
- **Pausa sem minimapa (ticket 27):** `web/src/tracker/presence.ts` (`minimapPresence`: anel da
  borda perto da região salva, via `ringNear` em `minimap.ts`; `PresenceGate`: histerese). A
  sessão (`checkPresence`) pausa, re-detecta o minimapa na tela a cada 1 s com o anel fraco e, ao
  voltar, desconta o tempo pausado dos relógios. Estado `pausado` + `pausedFor` no `track`.
- **Heading (ticket 22):** `web/src/tracker/heading.ts` (`arrowHeading`: eixo de simetria da
  silhueta da seta, ponta pelo lado mais longo). Roda no Worker em todo frame com recorte.
- **Câmera:** `cameraView` em `locate.ts` (meio do `detectCone`) → `camera` no resultado; o cone
  no mapa é o `setCamera` do `trackerView.ts` (estilo `.trk-cone`).
- **Testar:** `npm --prefix web test` (sintéticos em `minimap.test.ts`, `scale.test.ts` e
  `locate.test.ts`, `globalSearch.test.ts`, `references.test.ts`, `heading.test.ts`, `fuse.test.ts`, `motion.test.ts`, `presence.test.ts` e `session.test.ts`, com as imagens de
  `synthetic.ts`) e
  `npm --prefix web run fixtures` (runner sobre `tracker/fixtures/` e `tracker/samples/`;
  config em `web/vitest.fixtures.config.ts`; `SOLARIS_DUMP=<pasta>` grava os recortes; mede a
  escala de cada print anotado e imprime a mediana; a tabela PRESENÇA simula telas sem minimapa; uma tabela por camada, todas com uma região
  do minimapa por resolução, como o ajuste salvo).
  Depuração visual: http://127.0.0.1:5173/lab.html.
- **Cuidados:** o Vite não serve `tracker/` (fs restrito): no laboratório, abra o arquivo pelo
  seletor. Prints e sprites nunca vão pro `web/public`. O runner lê as tiles de
  `web/public/tiles/` (precisa do `build_tiles.py build`).
- Sprites em `tracker/icons/` e prints em `tracker/fixtures/` e `tracker/samples/` são do
  usuário (ignorados pelo git). Os sprites não estão na escala do minimapa; medido nos prints a
  1440p: anel do Nexus com ~43 px de diâmetro, pilha do teleporte ~14×36 px.
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
| `tools/build_overlays.py` | Overlays subterrâneos → `web/public/overlays/` |
| `web/src/mapView.ts` | Leaflet e conversão pixel↔latlng |
| `web/server/mapDataPlugin.ts` | API local `/api/map-data` |
| `config.json` | Padrões: caminhos, tela, minimapa |
| `tools/extract_refs.py` | Teleportes/Nexus do WutheringData → `web/public/refs/` |
| `tools/extract_markers.py` | Marcadores por categoria → `web/public/markers/` |
| `tools/build_appsample.py` | Tabela appsample → nossos ids → `web/public/appsample.json` |
| `web/src/markerPanel.ts` | Painel de marcadores (filtro, busca, popup) |
| `web/src/calibration.ts` | Painel de calibração jogo→pixel |
| `assets/tiles_cache/*/manifest.json` | Metadados de cada mapa (zooms, limites) |
| `.gitignore` | Garante que assets e dados de terceiros fiquem fora |
