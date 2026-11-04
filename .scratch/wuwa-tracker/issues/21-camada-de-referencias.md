# 21: Camada de referências

**What to build:** Detecto ícones de teleporte e Nexus no minimapa, identifico qual é cada um pela constelação comparada às posições conhecidas do mapa (com 1 ícone, desambiguo pela última posição) e calculo a posição do jogador pelo deslocamento ícone→centro com a escala calibrada.

**Blocked by:** 11, 13, 18

**Status:** ready-for-agent

- [ ] Template matching com sprites recortados DO MINIMAPA (escala real em 1440p: Nexus ~34 px, teleporte ~14x34 px)
- [ ] Casamento de constelação com 2+ ícones; desambiguação por última posição com 1
- [ ] Caso especial: ícone de teleporte/Nexus parcialmente coberto pela seta NO CENTRO do minimapa (logo após dar TP) = jogador exatamente naquela referência; template tolera a oclusão
- [ ] Posições de referência: WutheringData convertido pela calibração + manuais de data/maps
- [ ] Linha da camada na tabela, com casos 0/1/2+ ícones separados
