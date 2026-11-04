# 25: Rastreio ao vivo no navegador

**What to build:** Com a tela compartilhada, o Worker processa os frames continuamente e o mapa segue o jogador com seta de direção, indicador de confiança e camada em uso.

**Blocked by:** 24

**Status:** ready-for-agent

- [ ] Frames via MediaStreamTrackProcessor (ou requestVideoFrameCallback) no Worker; frequência medida e reportada (alvo: o máximo estável com CPU baixa)
- [ ] Uso de CPU medido e reportado
- [ ] Comportamento com aba em segundo plano medido; mitigação documentada (Worker, pop-out)
- [ ] Referências sempre que possível; fallback em janela local; busca global ao perder o rastreio
- [ ] Web: seguir jogador (toggle), seta, confiança, camada
