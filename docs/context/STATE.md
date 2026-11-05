# Estado atual

**Fase:** Fase 3 em andamento. Fases 0 e 1 aprovadas (ticket 10 adiado). Tickets 17–20 e 23 feitos; 21 e 22 em parte. Fase 2 aprovada (🛑 24); Fase 3 em andamento.

## Pronto
- `tools/build_tiles.py`: `inventory [--alpha]`, `manifest`, `pyramid` e `build` (gera
  `web/public/tiles` z1..zmax e `maps.json` pros 10 mapas; incremental) e `slice` (imagem única →
  tiles + manifest; preserva alpha).
- Calibração por mapa (ticket 09): o botão "Calibrar" estima sozinho (Overworld: 208/208
  referências em terra, orientação direta X→x, Y→y, ~0,5 s), e o usuário corrige 2–3 bolinhas
  comparando com o mapa do jogo. Calibrados pelo usuário (`data/maps/`): overworld (9 pontos,
  RMS 3,5 px, cobrindo Huanglong e Rinascita), lahai-roi (2,1), avinoleum (2,4), tethys-deep
  (1,4), vault-underground (0,5) e fabricatorium (6 pontos, 4,4).
  honami-city, dimmr-plains, simulacrum-nexus-mengzhou e chronorift-metropolis (1 Nexus) não
  têm referências suficientes. Não precisam de calibração pro tracker (que trabalha em pixel);
  ela só faria falta pra importar coordenadas de jogo.
- `tools/extract_refs.py` → `web/public/refs/` (7 mapas; os outros 3 não têm dados).
- Marcadores (ticket 11): `tools/extract_markers.py` → `web/public/markers/`. Overworld: 175
  teleportes, 33 Nexus, 2380 baús, 238 caskets, 10205 plantas, 2593 minérios e 2751 outros
  coletáveis. Painel "Marcadores" com filtro por categoria/subcategoria (salvo no
  localStorage), busca sem acento e popup. Plantas, minérios e coletáveis começam desligados.
  A contagem de baús inclui os que só aparecem após puzzle/desafio ("玩法刷新", "程序封锁").
- Progresso (ticket 12): encontrados no IndexedDB do navegador (popup ou botão direito),
  contagem x/y por categoria, por mapa e de todos os mapas, "Esconder encontrados" e
  Backup/Restaurar em JSON. Os ids (`e<EntityId>`, `tp-<Id>`) precisam ficar estáveis entre
  regenerações dos marcadores, senão o progresso se perde.
- Marcadores manuais (ticket 13): teleporte/Nexus em `data/maps` (`manualMarkers`, px), os
  outros no IndexedDB e no backup. Nos 3 mapas sem dados (honami, dimmr, mengzhou), os
  teleportes do tracker vão ter de ser cadastrados assim.
- Importador do th.gl (ticket 14): testado só com dados sintéticos. A escala real do backup
  do th.gl ainda não foi vista (o importador detecta cm/m e eixos trocados).
- Modo anotar fixture (ticket 15): botão "Fixture" grava print + anotação em
  `tracker/fixtures/` pela API local `/api/fixtures`. A captura da tela compartilhada fica
  pro ticket 17.
- Tracker (ticket 17): botão "Tracker" compartilha a tela (só vídeo), acha o minimapa sozinho
  (Hough no canto superior esquerdo) e mostra a prévia; ajuste manual salvo por resolução. Nos 9
  prints reais de tela cheia a detecção dá 97–100% (centro ~172,163, raio 123–126 a 1440p).
  Ainda não testado no jogo ao vivo.
- Escala (ticket 18): "Medir escala" no painel Fixture varre raios com NCC mascarada (cinza, furo
  na seta) num Worker (~2,4 s) e salva a mediana. Overworld: raio 104,3 px do z6 (8 medições,
  101–105; 0,83 px do z6 por px do minimapa a 1440p). O chute da spec (~1 tile, raio 256) estava
  2,5× maior. Com o raio do minimapa estável, os 8 bons dão 104,4–104,8. O 204708 não mede
  (a varredura não mascara o cone).
- Camada imagem (ticket 19): no Worker, com posição anterior, acha o minimapa por NCC em cinza
  numa janela 3×3 de tiles (busca ±160 px). Nos 9 prints, a 1440p e 1080p, partindo de 4
  posições anteriores até 100 px fora, acerta todos e sempre no mesmo ponto. ~25 ms por frame
  no navegador e ~40 ms quando troca a janela. NCC 0,35–0,96 (o 204708 é o pior).
- Busca global e Find me (ticket 20): no painel Tracker, "Achar no mapa" procura no mapa
  inteiro (Overworld: visão geral em z2, ~200–350 ms, +~100 ms pra montar a visão geral na 1ª
  vez) e "Find me" usa o clique como posição anterior. Achada a posição, cada frame segue com a
  camada imagem e um marcador no mapa. Nos fixtures, a global acerta 16 de 18; os 2 erros (o
  204708, nas duas resoluções) saem "incerto" (margem ≤ 0,04 contra ≥ 0,11 nos acertos), e
  aí a UI mostra o palpite e pede o Find me. Testado no navegador com um canvas simulando a
  tela compartilhada; ainda não com o jogo ao vivo.
- Referências (ticket 21, em parte): detecta Nexus (anel, tolera a seta por cima) e teleporte
  pela cor e forma, e calcula a posição pela referência (WutheringData + manuais). Nos 9
  prints (todos logo após o TP, ícone sob a seta) acha o ícone do tipo certo em 17 de 18 (falha
  no 204400 a 1080p, ícone quase todo coberto); posição a 1–9 px da camada imagem (17 px no
  204400 a 1440p). ~8 ms/frame. Com 1 ícone precisa da posição anterior; a constelação (2+)
  só foi testada com dados sintéticos. O painel só exibe o resultado; a fusão é o ticket 23.
- Heading (ticket 22, em parte): direção pela simetria da seta, 1–9 ms. Sem direção anotada
  nos prints; parado o cone aponta pra frente, e seta e cone ficam a ≤ 9,5° onde o cone foi bem
  detectado. O painel mostra a direção na linha de tempos da prévia.
- Fusão (ticket 23): o painel segue a posição fundida (camada, confiança e o que foi
  descartado aparecem no status). Nos fixtures: seguindo, imagem e ícones concordam em 17 de 18
  (no outro só há imagem); sem posição anterior, a busca guiada resolve os 18, inclusive o
  204708 em que a global errava (~200–420 ms).
- Os prints foram anotados em cima de teleportes/Nexus. Em 204534, 204619 e 204748 a anotação
  ficou 15–34 px fora do teleporte, e o casamento aponta pro teleporte: o erro "contra a
  anotação" do runner inclui esse ruído.
- API local `/api/map-data/<name>` no servidor do Vite (grava/lê `data/maps/`), com 10 testes
  Vitest. O tracker vai rodar no navegador (decisão do usuário); o servidor Python foi removido.
- `web/`: Vite + TS + Leaflet com seletor dos 10 mapas (escolha salva no localStorage), HUD de pixel
  sob o cursor. README com setup e créditos.
- Manifest do Overworld gerado a partir do disco (`overworld`, z5 e z6).
- Repositório na branch `main`, remote `origin` = github.com/MiharaxD/Solaris-GPS (**público**).
- `.venv` com Python 3.11 e `tools/requirements.txt` (Pillow, numpy), só pras ferramentas.
- WutheringData em `vendor/WutheringData` (clone parcial com sparse checkout, só os
  arquivos usados).

## Fatos confirmados na Fase 0
- 10 mapas, tiles 512×512. Todas as grades estão completas dentro dos limites (0 posições
  vazias). Os arquivos de 0 bytes ficam só na borda testada pelo downloader.
- **As tiles são RGB, sem canal alpha.** O fundo azul-escuro (~RGB(4,36,52); o
  `tethys-deep` usa ~(16,40,56)) vem pintado na tile, e há padding preto puro em algumas
  bordas (ex.: coluna 0 do Overworld z5). Tiles inteiras "lisas" da cor de fundo são o vazio
  do th.gl (81% do Overworld), incluindo buracos no meio da terra (z6 linha 28, colunas 20–21).
- **A pirâmide é padrão:** z5 (r,c) = z6 (2r..2r+1, 2c..2c+1) reduzido, com erro RGB médio
  de 0,21/255 no deslocamento (0,0) contra 2,7–7 nos deslocamentos vizinhos. Dá pra gerar
  zooms menores por redução.
- **O WutheringData tem os teleportes com posição.** `Teleporter.json` (Type 2 = Beacon,
  Type 1 = Nexus, Type 3 = entrada de instância) → `TeleportEntityConfigId` → entidade em
  `LevelEntityConfig_0/_1.json` por (MapId, EntityId) → `Transform[0]` {X, Y, Z}. Os 733
  resolvem.
- **Cobertura:** Overworld (175 beacons e 33 Nexus), Lahai-Roi (28 e 9), Tethys (9 e 0),
  Avinoleum (8 e 1), Fabricatorium (7 e 0), Vault (5 e 0), Chronorift (0 e 1). **Sem
  dados:** honami-city, dimmr-plains e simulacrum-nexus-mengzhou. Os dois últimos são
  mapas mais novos que o dump (último commit: março de 2026).
- O `MarkVector` do `MapMark.json` vem zerado (só os rótulos de área têm posição).
  Posição sempre vem da entidade.
- O `LevelEntityConfig.json` sem sufixo é um dump antigo (setembro de 2025). Usar o `_0` +
  `_1`.

## Próximo (a frente)
- Ticket 25 (rastreio ao vivo). Os itens pendentes de 21 e 22 dependem dos prints abaixo. O ticket 10 (afim por área) fica
  adiado: uma afim só fechou o Overworld com RMS de 3,5 px. Reavaliar se a ilha cinza grande
  à oeste, sem teleportes nos dados, destoar. Tickets 08, 15 e 17–30 foram
  reescritos pro tracker no navegador (pop-out em vez de Tauri, auto-collect, Find me).

## Depende do usuário
- **Bloqueante pro ticket 21:** prints com ícones de teleporte/Nexus LONGE do centro (0, 1 e
  2+ ícones), andando um pouco depois do teleporte. Os 9 fixtures do Overworld foram tirados em
  cima do teleporte (ícone embaixo da seta): só cobrem o caso especial. Pedido em 2026-11-04.
  Também ajudam: interiores/cavernas (confirmar que a escala não muda) e outros mapas.
- Pro ticket 22: anotar a direção da seta (campo "Direção" do painel Fixture) em alguns prints.
- Os sprites do minimapa (teleporte, Nexus e seta) serão recortados desses prints, não pedidos
  à parte. Escala observada a 1440p: Nexus ~34 px, teleporte ~14×34 px.
- Teleportes à mão nos 3 mapas sem dados (pelo "+ Novo marcador").

## Limitações conhecidas
- O cone de visão (claro, ~60°, gira com a câmera) é detectado pelos degraus de brilho nas
  bordas mais o contraste do setor. Acerta 8 dos 9 prints; no 204214 (cone sutil sobre chão
  amarelo) pega os prédios brancos, e o casamento acerta mesmo assim. Sem a máscara, o 204708
  erra. O raio detectado oscila 123–126 px a 1440p; o rastreio precisa da região salva.
- No navegador, a frequência do rastreio e o comportamento com a aba em segundo plano ainda
  não foram medidos.
- Seguir a posição frame a frame ainda não barra saltos: ao trocar de lugar sem "Find me", a
  camada local pode "andar" pra um lugar parecido por perto (NCC ~0,6). Isso é o ticket 26.
- A região do minimapa salva no navegador pode estar desatualizada (no teste, cy 178 contra
  163 detectado); isso desloca a posição em ~12 px. "Detectar minimapa" no painel Tracker
  corrige.
- Os dados de entidades podem não bater com a versão atual do jogo (dump de março de 2026).
- Categoria "Sonance Casket" inferida pelos blueprints `HookSoundBox`/`HookPullSoundBox`; não
  conferida no jogo. Nomes de espécie saem em inglês (o TextMap pt não tem essas chaves).
