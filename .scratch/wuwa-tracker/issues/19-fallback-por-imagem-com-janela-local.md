# 19: Fallback por imagem com janela local

**What to build:** Com posição anterior conhecida, localizo o recorte do minimapa no mapa ativo por template matching (só translação, escala calibrada) numa janela montada das tiles, dentro do Worker.

**Blocked by:** 18

**Status:** ready-for-agent

- [ ] Janela (ex.: 3x3 tiles) montada das tiles em tons de cinza, com cache LRU; nunca os PNGs costurados
- [ ] Máscara pela cor de fundo do mapa (tiles RGB sem alpha; tiles lisas = vazio) e padding preto; centro (seta), cone de visão e ícones mascarados
- [ ] Implementação escolhida pelos números (OpenCV.js empacotado localmente vs. correlação própria em WASM/WebGL/WebGPU)
- [ ] Linha da camada na tabela de acurácia/tempo
