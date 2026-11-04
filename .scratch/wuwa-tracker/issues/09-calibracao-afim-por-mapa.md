# 09: Calibração afim por mapa

**What to build:** Numa tela de calibração eu clico no mapa, digito a coordenada de jogo daquele ponto e, com 3+ pontos, vejo a afim jogo→pixel e o erro residual de cada ponto. Salvo no arquivo de dados do mapa pelo tracker, ou baixo o JSON se o tracker estiver offline.

**Blocked by:** 08 (Canal web↔tracker)

**Status:** ready-for-agent

- [ ] Afim por mínimos quadrados com 3+ pontos, resíduo por ponto em pixels
- [ ] Adicionar/remover/editar pontos
- [ ] Salvar via save_map_data; fallback de download quando desconectado
- [ ] Dados de calibração carregados do arquivo ao abrir o mapa
