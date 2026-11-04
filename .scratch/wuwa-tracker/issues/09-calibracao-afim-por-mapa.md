# 09: Calibração afim por mapa

**What to build:** Numa tela de calibração eu clico no mapa, digito a coordenada de jogo daquele ponto e, com 3+ pontos, vejo a afim jogo→pixel e o erro residual de cada ponto. Salvo no arquivo de dados do mapa pela API local (ou baixo o JSON se ela não estiver disponível).

**Blocked by:** 08 (API local de dados do mapa)

**Status:** ready-for-agent

- [x] Afim por mínimos quadrados com 3+ pontos, resíduo por ponto em pixels
- [x] Adicionar/remover/editar pontos
- [x] Salvar pela API local (/api/map-data); fallback de download do JSON
- [x] Dados de calibração carregados do arquivo ao abrir o mapa
