# Decisões ativas

- **Assets ficam em `assets/` e scripts de ferramenta em `tools/`.**
  Por quê: a raiz fica livre pra `web/`, `tracker/` e `overlay/`, e o `.gitignore` da spec
  vale como está.
  Exige: todo código lê o caminho do cache pelo `config.json`. O downloader precisa de
  `--cache`/`--out` explícitos.

- **O manifest que faltar é gerado a partir do disco pelo `build_tiles`, nunca rodando o
  downloader.**
  Por quê: regra de não rodar o `wuwa_maps.py` sem pedido, e o resultado é o mesmo.
  Exige: o mesmo formato do `write_manifest` do downloader, com `first_number_is_row: true`.

- **Os dados ficam divididos por tipo.** O que se sabe do mapa (pontos de calibração e afins
  por área, teleportes e Nexus cadastrados, escala minimapa→mapa) fica em
  `data/maps/<name>.json`, versionado. O progresso do usuário (encontrados, marcadores
  pessoais, filtros) fica no IndexedDB, com Backup/Restore.
  Por quê: o tracker precisa desses dados sem o web aberto (testes da Fase 2), e o git
  protege a calibração.
  Exige: o web grava esses arquivos pela mensagem `save_map_data` no WebSocket (o tracker
  escreve o arquivo), com download do JSON como alternativa se o tracker estiver offline. O
  web não tem backend próprio.

- **O tracker publica `x, y` em pixel do zoom máximo do mapa ativo.**
  Por quê: é o espaço onde ele faz o matching.
  Exige: a conversão pra coordenada de jogo acontece no web. O tracker não aplica afim em
  runtime: as referências dele (teleportes e Nexus) chegam já em pixel (ver a próxima
  decisão).

- **As referências do tracker são os teleportes e Nexus do WutheringData** (Teleporter Type
  2 = Beacon e Type 1 = Nexus, com a posição de `LevelEntityConfig_0/_1`), convertidos pra
  pixel pela calibração do mapa num arquivo gerado localmente e ignorado pelo git. Nos mapas
  sem dados (honami-city, dimmr-plains, simulacrum-nexus-mengzhou), elas vêm do cadastro
  manual em `data/maps/`.
  Por quê: os dados cobrem 7 dos 10 mapas, e os dados do vendor não podem ser commitados.
  Exige: regerar esse arquivo sempre que a calibração do mapa mudar.

- **A máscara do matching por imagem usa a cor de fundo, não alpha.** As tiles são RGB, com
  o fundo azul pintado (~RGB(4,36,52) e variações por mapa) e padding preto puro. Tile
  "lisa" (desvio padrão < 2, cor do fundo) = vazio: são 81% do Overworld, e há buracos
  assim até no meio da terra (ex.: z6 linha 28, colunas 20–21), um defeito dos dados do
  th.gl.
  Por quê: confirmado na Fase 0. O prompt supunha que as tiles tinham alpha.
  Exige: o matching ignora regiões com a cor de fundo. O build copia as tiles lisas mesmo
  assim (são baratas e evitam 404 no Leaflet).

- **No build do web, o zoom nativo é preferido ao gerado** (ex.: z5 do Overworld), e as
  posições sem filha são preenchidas com preto, igual ao padding nativo. O zoom mínimo é o
  primeiro em que a grade cabe em 2×2 tiles.

- **O venv do tracker usa Python 3.11 (`py -3.11`).**
  Por quê: o 3.15 é novo demais pras versões compiladas do OpenCV e do mss, e o 3.12 do uv
  não está registrado no `py`.

- **O WutheringData é clonado em `vendor/` (ignorado pelo git), e os marcadores derivados
  dele são gerados localmente e nunca commitados.**
  Por quê: os dados são © Kuro Games. Só o crédito vai no README.
  Exige: o que o usuário cadastra à mão em `data/maps/` vai pro repositório; o que é gerado
  a partir do vendor, não.

- **Fixtures são anotados clicando no mapa web** (ticket 15), gravando o mapa e `x, y` em
  pixel.
  Por quê: o WuWa não mostra coordenada na tela.

- **O mapa ativo é escolhido à mão no web** (com hotkey opcional). Detecção automática de
  mapa fica fora até o usuário pedir.
