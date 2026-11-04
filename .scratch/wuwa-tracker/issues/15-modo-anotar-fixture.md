# 15: Modo anotar fixture

**What to build:** Para criar fixtures da Fase 2: abro um print de tela cheia (ou, depois do ticket 17, capturo o frame atual da tela compartilhada), escolho o mapa, clico no mapa web onde eu estava e o app grava a anotação (mapa, x, y em pixel do zoom máximo) junto da imagem.

**Blocked by:** 06

**Status:** feito

- [x] Carregar print do disco; botão de capturar frame da tela compartilhada quando houver (botão pronto; o ticket 17 liga com `FixturePanel.setFrameSource`)
- [x] Clique no mapa grava a posição real em pixel do zoom máximo
- [x] Campos: nº de ícones visíveis (0, 1, 2+), direção (opcional), observações
- [x] Fixture salvo na pasta local de fixtures (ignorada pelo git) via API local

**Como ficou:** botão "Fixture" na barra (exclusivo com "Calibrar"). `web/src/fixturePanel.ts`
grava `tracker/fixtures/<mapa>-<data-hora>.<png|jpg|webp>` + `.json` (`FixtureAnnotation`: map,
px no zoom máximo, icons 0/1/2, direction opcional, notes, width/height, source) via
`web/server/fixturesPlugin.ts` (GET lista, PUT imagem/anotação; mesmas proteções da API de
mapa, agora em `web/server/guards.ts`).
