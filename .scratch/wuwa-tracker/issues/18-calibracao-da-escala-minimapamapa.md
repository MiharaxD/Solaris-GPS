# 18: Calibração da escala minimapa→mapa

**What to build:** Dado um print com posição conhecida, a ferramenta testa várias escalas em volta do chute inicial (1 tile 512 px do z6 do Overworld ≈ área do minimapa) e mostra o score de cada uma; a melhor vai para o config por mapa.

**Blocked by:** 17 (Harness de fixtures e recorte do minimapa)

**Status:** ready-for-agent

- [ ] Varredura de escalas com score por escala
- [ ] Chute inicial usado só como centro da busca
- [ ] Escala salva por mapa no config
