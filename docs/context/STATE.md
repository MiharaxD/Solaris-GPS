# Estado atual

**Fase:** Fase 2 em andamento. Fases 0 e 1 aprovadas (ticket 10 adiado). Ticket 17 feito.

## Pronto
- `tools/build_tiles.py`: `inventory [--alpha]`, `manifest`, `pyramid` e `build` (gera
  `web/public/tiles` z1..zmax e `maps.json` pros 10 mapas; incremental) e `slice` (imagem única →
  tiles + manifest; preserva alpha).
- Calibração por mapa (ticket 09): o botão "Calibrar" estima sozinho (Overworld: 208/208
  referências em terra, orientação direta X→x, Y→y, ~0,5 s), e o usuário corrige 2–3 bolinhas
  comparando com o mapa do jogo. Calibrados pelo usuário (`data/maps/`): overworld (9 pontos,
  RMS 3,5 px, cobrindo Huanglong e Rinascita), lahai-roi (2,1), avinoleum (2,4), tethys-deep
  (1,4), vault-underground (0,5) e fabricatorium (6 pontos, 4,4).
  honami-city, dimmr-plains, simulacrum-nexus-mengzhou e chronorift-metropolis (1 Nexus) não
  têm referências suficientes. Não precisam de calibração pro tracker (que trabalha em pixel);
  ela só faria falta pra importar coordenadas de jogo.
- `tools/extract_refs.py` → `web/public/refs/` (7 mapas; os outros 3 não têm dados).
- Marcadores (ticket 11): `tools/extract_markers.py` → `web/public/markers/`. Overworld: 175
  teleportes, 33 Nexus, 2380 baús, 238 caskets, 10205 plantas, 2593 minérios e 2751 outros
  coletáveis. Painel "Marcadores" com filtro por categoria/subcategoria (salvo no
  localStorage), busca sem acento e popup. Plantas, minérios e coletáveis começam desligados.
  A contagem de baús inclui os que só aparecem após puzzle/desafio ("玩法刷新", "程序封锁").
- Progresso (ticket 12): encontrados no IndexedDB do navegador (popup ou botão direito),
  contagem x/y por categoria, por mapa e de todos os mapas, "Esconder encontrados" e
  Backup/Restaurar em JSON. Os ids (`e<EntityId>`, `tp-<Id>`) precisam ficar estáveis entre
  regenerações dos marcadores, senão o progresso se perde.
- Marcadores manuais (ticket 13): teleporte/Nexus em `data/maps` (`manualMarkers`, px), os
  outros no IndexedDB e no backup. Nos 3 mapas sem dados (honami, dimmr, mengzhou), os
  teleportes do tracker vão ter de ser cadastrados assim.
- Importador do th.gl (ticket 14): testado só com dados sintéticos. A escala real do backup
  do th.gl ainda não foi vista (o importador detecta cm/m e eixos trocados).
- Modo anotar fixture (ticket 15): botão "Fixture" grava print + anotação em
  `tracker/fixtures/` pela API local `/api/fixtures`. A captura da tela compartilhada fica
  pro ticket 17.
- Tracker (ticket 17): botão "Tracker" compartilha a tela (só vídeo), acha o minimapa sozinho
  (Hough no canto superior esquerdo) e mostra a prévia; ajuste manual salvo por resolução. Nas
  amostras reais a detecção dá 99–100% em 1440p e 1080p. Ainda não testado num print real de
  tela cheia nem no jogo ao vivo.
- API local `/api/map-data/<name>` no servidor do Vite (grava/lê `data/maps/`), com 10 testes
  Vitest. O tracker vai rodar no navegador (decisão do usuário); o servidor Python foi removido.
- `web/`: Vite + TS + Leaflet com seletor dos 10 mapas (escolha salva no localStorage), HUD de pixel
  sob o cursor. README com setup e créditos.
- Manifest do Overworld gerado a partir do disco (`overworld`, z5 e z6).
- Repositório na branch `main`, remote `origin` = github.com/MiharaxD/Solaris-GPS (**público**).
- `.venv` com Python 3.11 e `tools/requirements.txt` (Pillow, numpy), só pras ferramentas.
- WutheringData em `vendor/WutheringData` (clone parcial com sparse checkout, só os
  arquivos usados).

## Fatos confirmados na Fase 0
- 10 mapas, tiles 512×512. Todas as grades estão completas dentro dos limites (0 posições
  vazias). Os arquivos de 0 bytes ficam só na borda testada pelo downloader.
- **As tiles são RGB, sem canal alpha.** O fundo azul-escuro (~RGB(4,36,52); o
  `tethys-deep` usa ~(16,40,56)) vem pintado na tile, e há padding preto puro em algumas
  bordas (ex.: coluna 0 do Overworld z5). Tiles inteiras "lisas" da cor de fundo são o vazio
  do th.gl (81% do Overworld), incluindo buracos no meio da terra (z6 linha 28, colunas 20–21).
- **A pirâmide é padrão:** z5 (r,c) = z6 (2r..2r+1, 2c..2c+1) reduzido, com erro RGB médio
  de 0,21/255 no deslocamento (0,0) contra 2,7–7 nos deslocamentos vizinhos. Dá pra gerar
  zooms menores por redução.
- **O WutheringData tem os teleportes com posição.** `Teleporter.json` (Type 2 = Beacon,
  Type 1 = Nexus, Type 3 = entrada de instância) → `TeleportEntityConfigId` → entidade em
  `LevelEntityConfig_0/_1.json` por (MapId, EntityId) → `Transform[0]` {X, Y, Z}. Os 733
  resolvem.
- **Cobertura:** Overworld (175 beacons e 33 Nexus), Lahai-Roi (28 e 9), Tethys (9 e 0),
  Avinoleum (8 e 1), Fabricatorium (7 e 0), Vault (5 e 0), Chronorift (0 e 1). **Sem
  dados:** honami-city, dimmr-plains e simulacrum-nexus-mengzhou. Os dois últimos são
  mapas mais novos que o dump (último commit: março de 2026).
- O `MarkVector` do `MapMark.json` vem zerado (só os rótulos de área têm posição).
  Posição sempre vem da entidade.
- O `LevelEntityConfig.json` sem sufixo é um dump antigo (setembro de 2025). Usar o `_0` +
  `_1`.

## Próximo (a frente)
- **Parado no ticket 18** (escala minimapa→mapa), esperando os prints do usuário. Os tickets
  18–23 dependem de fixtures reais pra escolher os algoritmos pelos números. O ticket 10 (afim por área) fica
  adiado: uma afim só fechou o Overworld com RMS de 3,5 px. Reavaliar se a ilha cinza grande
  à oeste, sem teleportes nos dados, destoar. Tickets 08, 15 e 17–30 foram
  reescritos pro tracker no navegador (pop-out em vez de Tauri, auto-collect, Find me).

## Depende do usuário
- **Bloqueante:** 8–10 prints de tela cheia (2560×1440) anotados pelo botão "Fixture" em
  `tracker/fixtures/`, com casos de 0, 1 e 2+ ícones, campo aberto, cidade e direções variadas.
  Pedido ao usuário em 2026-11-04; a pasta ainda está vazia.
- Os sprites do minimapa (teleporte, Nexus e seta) serão recortados desses prints, não pedidos
  à parte. Escala observada a 1440p: Nexus ~34 px, teleporte ~14×34 px.
- Teleportes à mão nos 3 mapas sem dados (pelo "+ Novo marcador").

## Limitações conhecidas
- O minimapa tem um cone de visão claro que gira com a câmera. Ele precisa de máscara ou
  tratamento no matching (não verificado o quanto atrapalha).
- No navegador, a frequência do rastreio e o comportamento com a aba em segundo plano ainda
  não foram medidos. O Genshin muda o zoom do minimapa em cidades; não verificado no WuWa.
- Os dados de entidades podem não bater com a versão atual do jogo (dump de março de 2026).
- Categoria "Sonance Casket" inferida pelos blueprints `HookSoundBox`/`HookPullSoundBox`; não
  conferida no jogo. Nomes de espécie saem em inglês (o TextMap pt não tem essas chaves).
