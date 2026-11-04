# 19: Fallback por imagem com janela local

**What to build:** Com posição anterior conhecida, localizo o recorte do minimapa no mapa ativo por template matching (só translação, escala calibrada) numa janela montada das tiles.

**Blocked by:** 18 (Calibração da escala minimapa→mapa)

**Status:** ready-for-agent

- [ ] Janela (ex.: 3x3 tiles) montada em memória, tons de cinza, cache LRU de tiles; nunca os PNGs costurados
- [ ] Alpha da tile usado como máscara; centro (seta) e ícones mascarados
- [ ] Linha da camada na tabela de acurácia/tempo
