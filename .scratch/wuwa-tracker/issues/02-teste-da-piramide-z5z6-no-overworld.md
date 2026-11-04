# 02: Teste da pirâmide z5↔z6 no Overworld

**What to build:** Verifico com números se a tile (y, x) do z5 é igual às 4 tiles (2y..2y+1, 2x..2x+1) do z6 reduzidas. O veredito decide se os zooms menores dos outros mapas podem ser gerados por redução 2x2→1.

**Blocked by:** 01 (Inventário dos mapas e manifest do Overworld)

**Status:** ready-for-agent

- [x] Amostra representativa de tiles comparada (incluindo bordas e áreas com alpha)
- [x] Métrica de erro (ex.: PSNR/diferença média por canal, alpha incluído) reportada
- [x] Veredito claro: pirâmide padrão sim/não, com offset de linha/coluna se houver
