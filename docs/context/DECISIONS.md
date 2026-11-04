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
  Exige: a conversão pra coordenada de jogo acontece só no web, e o tracker não depende da
  calibração afim.

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
