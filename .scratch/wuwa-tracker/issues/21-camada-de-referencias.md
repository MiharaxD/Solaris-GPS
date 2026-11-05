# 21: Camada de referências

**What to build:** Detecto ícones de teleporte e Nexus no minimapa, identifico qual é cada um pela constelação comparada às posições conhecidas do mapa (com 1 ícone, desambiguo pela última posição) e calculo a posição do jogador pelo deslocamento ícone→centro com a escala calibrada.

**Blocked by:** 11, 13, 18

**Status:** feito

- [x] Template matching com sprites recortados DO MINIMAPA (escala real em 1440p: Nexus ~34 px, teleporte ~14x34 px). Feito por cor e forma (os sprites de tracker/icons não estão na escala do minimapa): anel do Nexus por Hough (raio medido: 21,5 px a 1440p; longe da seta exige 70% do anel, senão o Hough acha anel encostado no teleporte) e pilha do teleporte (~17×43, até ~24×50 com o brilho de destaque) pelo azul que sobra.
- [x] Casamento de constelação com 2+ ícones; desambiguação por última posição com 1. Nos prints com ícone longe do centro: tipo certo em todos, posição a 2–10 px da anotação; o de 2 teleportes sai por constelação (3–6 px). Sem posição anterior, a busca guiada usa os ícones à vista (constelação = 1 candidata).
- [x] Caso especial: ícone de teleporte/Nexus parcialmente coberto pela seta NO CENTRO do minimapa (logo após dar TP) = jogador exatamente naquela referência; template tolera a oclusão. 17 de 18 nos fixtures, a 1–9 px da camada imagem.
- [x] Posições de referência: WutheringData convertido pela calibração + manuais de data/maps
- [x] Linha da camada na tabela, com casos 0/1/2+ ícones separados (resumo no fim da tabela REFERÊNCIAS do runner). Só 1 caso com 0 ícones (detecção falhou); prints sem ícone ficam pro usuário.
