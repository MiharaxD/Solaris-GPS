# 19: Fallback por imagem com janela local

**What to build:** Com posição anterior conhecida, localizo o recorte do minimapa no mapa ativo por template matching (só translação, escala calibrada) numa janela montada das tiles, dentro do Worker.

**Blocked by:** 18

**Status:** done

- [x] Janela (ex.: 3x3 tiles) montada das tiles em tons de cinza, com cache LRU; nunca os PNGs costurados
- [x] Máscara pela cor de fundo do mapa (tiles RGB sem alpha; tiles lisas = vazio) e padding preto; centro (seta), cone de visão e ícones mascarados. No minimapa: seta, cone e ícones claros. No mapa, a máscara do fundo piorou (o mar também casa) e a do preto não mudou nada: ficam como opção, desligadas.
- [x] Implementação escolhida pelos números (OpenCV.js empacotado localmente vs. correlação própria em WASM/WebGL/WebGPU). NCC própria em TS puro, grossa (4×) + fina: ~25 ms/frame no navegador; OpenCV.js/WASM não se justifica.
- [x] Linha da camada na tabela de acurácia/tempo
