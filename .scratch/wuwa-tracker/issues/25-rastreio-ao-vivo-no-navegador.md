# 25: Rastreio ao vivo no navegador

**What to build:** Com a tela compartilhada, o Worker processa os frames continuamente e o mapa segue o jogador com seta de direção, indicador de confiança e camada em uso.

**Blocked by:** 24

**Status:** done (CPU do processo e aba em segundo plano com o jogo real: medir na demo do 🛑 29)

- [x] Frames via MediaStreamTrackProcessor (ou requestVideoFrameCallback) no Worker; frequência medida e reportada (alvo: o máximo estável com CPU baixa). 10 Hz estáveis (escolha de 5–30 Hz no painel; Hz no HUD da prévia).
- [x] Uso de CPU medido e reportado: ocupação do Worker no HUD, ~25–35% de um núcleo a 10 Hz com o rastreio firme. CPU do processo: Gerenciador de tarefas do Chrome na demo.
- [x] Comportamento com aba em segundo plano medido; mitigação documentada (Worker, pop-out). Com a página em segundo plano o Worker manteve 9,7 Hz (fonte simulada); sem MediaStreamTrackProcessor, o modo compatível pausa. O painel mostra a taxa medida ao voltar pra aba.
- [x] Referências sempre que possível; fallback em janela local; busca global ao perder o rastreio (perdido após 1,5 s; global a cada 2 s)
- [x] Web: seguir jogador (toggle), seta, confiança, camada
