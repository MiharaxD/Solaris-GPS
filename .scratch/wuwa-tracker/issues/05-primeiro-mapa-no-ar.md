# 05: Primeiro mapa no ar

**What to build:** Abro o web e vejo o Overworld navegável com as tiles locais. A ferramenta de build copia só as tiles não vazias para o web, gera os zooms menores por redução (se a pirâmide foi confirmada) até o mapa caber numa tela, e escreve o índice de mapas (name, map_id, tileSize, minZoom, maxZoom, bounds).

**Blocked by:** 04 (🛑 Relatório da Fase 0 e estrutura/dependências)

**Status:** ready-for-agent

- [x] Leaflet com CRS.Simple, tileSize 512, maxNativeZoom = zoom máximo (zoom acima com upscale)
- [x] Template de tile {z}/{y}_{x}.webp mantendo a numeração do th.gl
- [x] maxBounds pelos limites do manifest; fundo azul-escuro fora dos bounds (as tiles são RGB, já com o fundo azul pintado)
- [x] Conversão pixel↔latlng via project/unproject no zoom máximo (px = x*512+u, py = y*512+v)
- [x] Tiles e índice de mapas gerados ficam fora do git
- [x] README com setup e créditos (Kuro Games, th.gl como fonte das tiles locais, Dimbreath/WutheringData)
- [x] TypeScript strict
