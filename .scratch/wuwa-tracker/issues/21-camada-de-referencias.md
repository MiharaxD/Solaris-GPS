# 21: Camada de referências

**What to build:** Detecto ícones de teleporte e Nexus no minimapa, identifico qual é cada um pela constelação comparada às posições conhecidas do mapa (com 1 ícone, desambiguo pela última posição) e calculo a posição do jogador pelo deslocamento ícone→centro com a escala calibrada.

**Blocked by:** 13 (Editor de marcadores manuais), 18 (Calibração da escala minimapa→mapa)

**Status:** ready-for-agent

- [ ] Template matching com os sprites fornecidos pelo usuário
- [ ] Casamento de constelação com 2+ ícones; desambiguação por última posição com 1
- [ ] Posições de referência lidas do arquivo de dados do mapa
- [ ] Linha da camada na tabela, com casos 0/1/2+ ícones separados
