# 25: Loop ao vivo a 10 Hz no mapa web

**What to build:** Com o jogo aberto, o tracker captura o minimapa a ~10 Hz (só captura de tela, mss) e publica {map, x, y, heading, confidence, layer}; o web segue o jogador com seta de direção, indicador de confiança e camada em uso.

**Blocked by:** 24 (🛑 Checkpoint da Fase 2)

**Status:** ready-for-agent

- [ ] Loop ~10 Hz com uso de CPU medido e reportado
- [ ] Referências sempre que possível; fallback em janela local; busca global ao perder rastreio
- [ ] Web: seguir jogador (toggle), seta, confiança, camada
- [ ] Nenhuma interação com o processo do jogo
