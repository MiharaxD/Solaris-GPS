# 17: Compartilhar tela, recorte do minimapa e harness de fixtures

**What to build:** Clico em "Compartilhar tela", escolho a janela do jogo (ou a tela inteira, se jogo em tela cheia sem bordas) e o app acha o minimapa sozinho, mostrando uma prévia do recorte num canto, com ajuste manual. O mesmo pipeline roda num runner automatizado sobre todos os fixtures e imprime a tabela de acurácia/tempo por camada.

**Blocked by:** 16

**Status:** feito (falta validar em print real de tela cheia)

- [x] getDisplayMedia; processamento num Web Worker; nada sai do PC
- [x] Detecção automática do círculo do minimapa + ajuste manual (posição, raio, formato circular/quadrado com máscara); salvo por resolução, padrão vindo do config.json
- [x] Prévia do recorte sempre visível enquanto compartilha
- [x] Runner automatizado (Node/Vitest) usando o MESMO código do Worker sobre os fixtures; tabela erro (px) e ms/frame por camada
- [x] Página de laboratório para depurar recorte e máscaras visualmente
- [ ] Testado em 1440p (resolução do usuário) e 1080p (feito com frames sintéticos e com os recortes de `tracker/samples/` colados num frame; falta print real de tela cheia)

**Como ficou:** `web/src/tracker/` (`image.ts`, `minimap.ts` com Hough de círculos no canto
superior esquerdo + refinamento por score de anel, `pipeline.ts` compartilhado, `worker.ts`,
`protocol.ts`). UI em `web/src/trackerPanel.ts` (botão "Tracker"): `getDisplayMedia` só vídeo,
4 frames/s pro Worker, prévia fixa no canto inferior esquerdo, ajuste manual salvo por
resolução (`solaris.minimap.<w>x<h>`; padrão do `config.json` se preenchido). Laboratório em
`/lab.html`. Runner: `npm --prefix web run fixtures` (pngjs; `SOLARIS_DUMP=<pasta>` grava os
recortes). Amostras reais: confiança 99–100%, ~80 ms pra detectar a 1440p (só no início),
recorte ~1–15 ms.
