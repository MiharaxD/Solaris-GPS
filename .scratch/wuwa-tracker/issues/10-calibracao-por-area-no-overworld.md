# 10: Calibração por área no Overworld

**What to build:** Se uma afim só não fecha no Overworld inteiro, defino áreas (ex.: por região) com calibrações separadas; a conversão usa a afim da área que contém o ponto.

**Blocked by:** 09 (Calibração afim por mapa)

**Status:** ready-for-agent

- [ ] Criar/editar áreas (polígono ou retângulo) dentro de um mapa
- [ ] Cada área tem seus pontos e resíduos
- [ ] Conversão escolhe a área certa; fora de qualquer área usa a afim global
- [ ] Persistido no arquivo de dados do mapa
