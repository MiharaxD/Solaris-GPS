# 21: Camada de referências

**What to build:** Detecto ícones de teleporte e Nexus no minimapa, identifico qual é cada um pela constelação comparada às posições conhecidas do mapa (com 1 ícone, desambiguo pela última posição) e calculo a posição do jogador pelo deslocamento ícone→centro com a escala calibrada.

**Blocked by:** 11, 13, 18

**Status:** em andamento (falta validar 0 e 2+ ícones com prints reais)

- [x] Template matching com sprites recortados DO MINIMAPA (escala real em 1440p: Nexus ~34 px, teleporte ~14x34 px). Feito por cor e forma (os sprites de tracker/icons não estão na escala do minimapa): anel do Nexus por Hough (raio medido: 21,5 px a 1440p) e pilha do teleporte (~14×36) pelo azul que sobra.
- [ ] Casamento de constelação com 2+ ícones; desambiguação por última posição com 1. Implementado e testado com dados sintéticos; falta print real com 2+ ícones e com 1 ícone longe do centro.
- [x] Caso especial: ícone de teleporte/Nexus parcialmente coberto pela seta NO CENTRO do minimapa (logo após dar TP) = jogador exatamente naquela referência; template tolera a oclusão. 17 de 18 nos fixtures, a 1–9 px da camada imagem.
- [x] Posições de referência: WutheringData convertido pela calibração + manuais de data/maps
- [ ] Linha da camada na tabela, com casos 0/1/2+ ícones separados. A tabela existe; só há casos com 1 ícone.
