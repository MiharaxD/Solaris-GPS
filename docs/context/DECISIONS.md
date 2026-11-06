# Decisões ativas

- **O tracker roda dentro do site** (decisão do usuário, no modelo do Teyvat GPS). Ele
  captura a janela do jogo (ou a tela inteira, em tela cheia sem bordas) com
  `getDisplayMedia` e processa num Web Worker. Não existe processo Python em runtime.
  Por quê: um app só, sem terminal, e o navegador só enxerga a janela escolhida.
  Exige: os algoritmos são escritos em TypeScript. O mesmo código roda no Worker e no runner
  de fixtures (Node/Vitest). Libs pesadas (ex.: OpenCV.js/WASM) só se os números
  justificarem, sempre empacotadas localmente e carregadas sob demanda ao compartilhar a
  tela. A frequência real é medida, não prometida (o plano antigo era 10 Hz nativo).
  Hotkeys globais só por extensão opcional do Chrome. O overlay vira pop-out por Document
  Picture-in-Picture (sempre no topo, mas não transparente nem click-through).

- **Assets ficam em `assets/` e scripts de ferramenta em `tools/`.** O caminho do cache e o
  de `data/maps` vêm do `config.json`. O downloader precisa de `--cache`/`--out` explícitos.

- **O manifest que faltar é gerado a partir do disco pelo `build_tiles`, nunca rodando o
  downloader.** Mesmo formato do `write_manifest`, com `first_number_is_row: true`.

- **Os dados ficam divididos por tipo.** O que se sabe do mapa (pontos de calibração e afins
  por área, teleportes e Nexus cadastrados à mão, escala minimapa→mapa) fica em
  `data/maps/<name>.json`, versionado. O progresso do usuário (encontrados, marcadores
  pessoais, filtros) e as preferências de captura ficam no navegador (IndexedDB/
  localStorage), com Backup/Restore.
  Por quê: o runner de fixtures precisa desses dados fora do navegador, e o git protege a
  calibração.
  Exige: o web grava pela API do servidor do Vite (`/api/map-data/<name>`, só em
  localhost), com download do JSON como alternativa.

- **O tracker trabalha em pixel do zoom máximo do mapa ativo.** A conversão pra coordenada
  de jogo usa a calibração afim. As referências (teleportes e Nexus) são convertidas pra
  pixel uma vez, ao carregar o mapa.

- **As referências do tracker são os teleportes e Nexus do WutheringData** (Teleporter Type
  2 = Beacon e Type 1 = Nexus, com a posição de `LevelEntityConfig_0/_1`), gerados
  localmente num arquivo ignorado pelo git, mais os cadastros manuais de `data/maps/` nos
  mapas sem dados (honami-city, dimmr-plains, simulacrum-nexus-mengzhou).
  Por quê: os dados cobrem 7 dos 10 mapas, e os dados do vendor não podem ser commitados.

- **No matching por imagem, a máscara fica só no minimapa** (furo da seta, cone de visão e
  ícones claros); o mapa entra inteiro, em tons de cinza. Nos 9 fixtures, mascarar a cor de
  fundo do mapa (~RGB(4,36,52)) fez errar um caso, porque o mar do minimapa também é escuro e
  casa com ele, e mascarar só o padding preto não mudou nada (+20 ms). Cor RGB também não
  ganhou nada e custa 3×. As opções continuam no código (`planesWindow`, `MinimapMaskOptions`).
  Tiles "lisas" (desvio < 2, cor do fundo) são o vazio do th.gl (81% do Overworld), com
  buracos até no meio da terra (ex.: z6 linha 28, colunas 20–21). O build copia essas tiles
  mesmo assim (são baratas e evitam 404 no Leaflet).
  Exige: reavaliar a máscara do fundo se aparecer fixture em cima desses buracos.

- **No build do web, o zoom nativo é preferido ao gerado** (ex.: z5 do Overworld), e as
  posições sem filha são preenchidas com preto (ou transparente, se a origem for RGBA). O
  zoom mínimo é o primeiro em que a grade cabe em 2×2 tiles.

- **Python 3.11 em `.venv` só pras ferramentas** (`tools/requirements.txt`). O 3.15 é novo
  demais pras libs, e o 3.12 do uv não está registrado no `py`.

- **O WutheringData é clonado em `vendor/` (ignorado pelo git), e o que for derivado dele
  nunca é commitado.** Só o crédito vai no README. O que o usuário cadastra à mão em
  `data/maps/` vai pro repositório.

- **Calibração sem precisar identificar nomes.** O WuWa não mostra coordenada e os nomes das
  referências são genéricos ("Teleporte · Jinzhou #3"). Por isso o painel primeiro **estima
  sozinho**: testa as 8 orientações de eixo e a escala/deslocamento que põem mais referências
  em terra (máscara = pixel que não é fundo nem preto). O usuário corrige comparando com o
  mapa do jogo: clica na bolinha e depois no lugar certo. Com 1 ponto, a estimativa só se
  desloca; com 2, vira similaridade (espelhamento herdado da estimativa); com 3 ou mais, afim
  por mínimos quadrados.
  Em `data/maps` (repositório público) vão só `refId`, `game` e `px`. O rótulo vem das
  referências locais e nunca é salvo. A afim e o RMS são gravados junto, derivados dos
  pontos. A estimativa não é salva.
  Referências que não existem no jogo (ex.: os 2 teleportes do Energy Hub no Fabricatorium,
  em outra altura/andar) vão pra `ignoredRefs` em `data/maps`. Elas ficam fora da estimativa
  e da calibração, e o tracker e os marcadores precisam respeitar essa lista.

- **A escala minimapa→mapa é guardada como raio do minimapa em px do zoom máximo**
  (`minimapScale.radiusPx` em `data/maps`, mediana das medições salvas). Por frame, px do mapa
  por px do minimapa = `radiusPx / r` (r = raio na tela).
  Por quê: a área do mundo que o minimapa mostra não depende da resolução nem da escala de UI.
  Exige: um raio estável na tela. A detecção oscila 123–126 px a 1440p (até 3% de escala), então
  o rastreio deve usar a região ajustada/salva, não redetectar a cada frame.
  A região é fixa: a detecção só roda sem região salva pra resolução ou pelo botão. Anel fraco
  só pausa (ticket 27); procurar de novo sozinho achava falsos anéis com o mapa aberto e salvava.

- **Algoritmos do tracker (Fase 2, escolhidos pelos 9 fixtures; tabelas no runner):** posição
  pela camada imagem (NCC em cinza, cone mascarado, ~25 ms/frame), conferida pelos ícones
  (referências) quando houver; concordando a ≤ 20 px vale a imagem, que é mais precisa (1–9
  px de diferença entre as duas). Sem posição anterior: com ícone no centro (logo após o TP), a
  busca guiada pelos teleportes do tipo (18 de 18); sem ícone, a busca global (16 de 18, os 2
  erros saem "incerto" e pedem Find me). A direção vem só da seta (o cone é da câmera).
  Exige: revalidar a fusão com prints de 0 e 2+ ícones (a constelação só tem teste sintético).

- **Suavização por Kalman, não média exponencial** (ticket 26): a média fica sempre alguns
  frames atrás do jogador andando; o Kalman de velocidade constante não atrasa, aceita
  intervalos irregulares (frames pulados, aba em segundo plano) e pesa cada medida pela
  confiança. Só a posição exibida é suavizada. Saltos grandes só passam com teleporte
  confirmado pelo ícone, Find me ou busca global repetida no mesmo lugar.

- **Fixtures são anotados clicando no mapa web** (ticket 15), a partir de um print ou do
  frame atual da tela compartilhada. Por quê: o WuWa não mostra coordenada na tela.

- **O importador do th.gl casa em coordenada de jogo**, não em pixel: compara direto com o
  `Transform` dos marcadores do WutheringData, então o erro da calibração não entra. Ele
  importa pro mapa ativo (o arquivo não diz o mapa) e descobre sozinho a escala (cm/m) e a
  ordem dos eixos pelo maior número de casamentos.

- **O mapa ativo é escolhido à mão no web.** Detecção automática de mapa fica fora até o
  usuário pedir. A recuperação manual é o "Find me": clicar onde está pra recomeçar o
  rastreio.

- **Não copiar código nem dados de outros sites de mapa** (Teyvat GPS, th.gl, appsample).
  Pode-se usar a descrição pública de como eles funcionam como referência de produto.

- **Visual no código do dossiê do WuWa, com assets próprios**: neutros escuros e frios; cor
  saturada só com significado (raridade dos baús em cinza→verde→azul→roxo→ouro, famílias de
  atributo nas outras categorias, estado do tracker); ouro só pra valor (progresso, premium);
  foco e seleção em branco. Nenhum asset do jogo: os ícones são SVG desenhados aqui, e
  teleporte/Nexus só imitam a silhueta do minimapa.

- **Região escolhida limita só a busca no mapa inteiro.** O retângulo vem dos próprios
  marcadores (área de topo do WutheringData, quantis 0,5–99,5% + 600 px). A busca guiada por
  ícones (logo após teleporte) e o rastreio local não olham a região, pra um TP pra outra
  região ainda funcionar. Errar a região faz o tracker não achar: o usuário troca no seletor.
- **"Coletar o mais próximo" só vê o que está desenhado**: respeita categoria, tipo e
  "esconder coletados", e pula os já encontrados. Os atalhos são da página (não globais).
