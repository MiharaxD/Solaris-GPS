# 18: Calibração da escala minimapa→mapa

**What to build:** Dado um frame com posição conhecida, testo várias escalas em volta do chute inicial (1 tile 512 px do z6 do Overworld ≈ área do minimapa) e vejo o score de cada uma; a melhor fica salva nos dados do mapa.

**Blocked by:** 17

**Status:** ready-for-agent

- [ ] Varredura de escalas com score por escala; chute inicial só como centro da busca
- [ ] Escala salva por mapa em data/maps/<name>.json
- [ ] Verificar se o WuWa muda o zoom do minimapa em cidades/interiores (o Genshin muda); se mudar, a escala passa a ser estimada por frame dentro de uma faixa
