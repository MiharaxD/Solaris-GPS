# 07: Modo cortar imagem grande em tiles

**What to build:** Consigo incluir um mapa que só tenho como imagem única: a ferramenta de build corta a imagem em tiles 512 na mesma convenção e o mapa aparece no seletor.

**Blocked by:** 05 (Primeiro mapa no ar)

**Status:** ready-for-agent

- [ ] Corte em streaming/por blocos, sem carregar imagens gigantes inteiras em RAM quando evitável
- [ ] Gera manifest equivalente e entra no índice de mapas
- [ ] Tiles totalmente transparentes não são gravadas
