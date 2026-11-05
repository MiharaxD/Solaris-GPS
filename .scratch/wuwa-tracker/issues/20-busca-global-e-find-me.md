# 20: Busca global e "Find me"

**What to build:** Sem posição anterior, encontro a posição primeiro num zoom reduzido da pirâmide e refino no zoom máximo. Botão "Find me": clico onde estou de verdade e o rastreio recomeça com busca local naquele ponto.

**Blocked by:** 19

**Status:** done

- [x] Busca coarse-to-fine com tempo e acurácia medidos nos fixtures
- [x] Find me: clique no mapa → busca local em volta do clique → volta a seguir
- [x] Funciona em mapas que só têm o zoom máximo baixado (usando zooms gerados). A visão geral do Overworld já é o z2 gerado; teste sintético com pirâmide gerada.
