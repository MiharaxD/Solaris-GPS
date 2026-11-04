# 17: Compartilhar tela, recorte do minimapa e harness de fixtures

**What to build:** Clico em "Compartilhar tela", escolho a janela do jogo (ou a tela inteira, se jogo em tela cheia sem bordas) e o app acha o minimapa sozinho, mostrando uma prévia do recorte num canto, com ajuste manual. O mesmo pipeline roda num runner automatizado sobre todos os fixtures e imprime a tabela de acurácia/tempo por camada.

**Blocked by:** 16

**Status:** ready-for-agent

- [ ] getDisplayMedia; processamento num Web Worker; nada sai do PC
- [ ] Detecção automática do círculo do minimapa + ajuste manual (posição, raio, formato circular/quadrado com máscara); salvo por resolução, padrão vindo do config.json
- [ ] Prévia do recorte sempre visível enquanto compartilha
- [ ] Runner automatizado (Node/Vitest) usando o MESMO código do Worker sobre os fixtures; tabela erro (px) e ms/frame por camada
- [ ] Página de laboratório para depurar recorte e máscaras visualmente
- [ ] Testado em 1440p (resolução do usuário) e 1080p
