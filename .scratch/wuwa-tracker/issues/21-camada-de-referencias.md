# 21: Camada de referências

**What to build:** Detecto ícones de teleporte e Nexus no minimapa, identifico qual é cada um pela constelação comparada às posições conhecidas do mapa (com 1 ícone, desambiguo pela última posição) e calculo a posição do jogador pelo deslocamento ícone→centro com a escala calibrada.

**Blocked by:** 11 (Marcadores do WutheringData), 13 (Editor de marcadores manuais), 18 (Calibração da escala minimapa→mapa)

**Status:** ready-for-agent

- [ ] Template matching com sprites recortados DO MINIMAPA (na escala do minimapa em 1440p), não do mapa grande
- [ ] Casamento de constelação com 2+ ícones; desambiguação por última posição com 1
- [ ] Caso especial: ícone de teleporte/Nexus parcialmente coberto pela seta NO CENTRO do minimapa (acontece logo após dar TP) = jogador exatamente naquela referência; template deve tolerar a oclusão pela seta
- [ ] Posições de referência lidas do arquivo de dados do mapa
- [ ] Linha da camada na tabela, com casos 0/1/2+ ícones separados
