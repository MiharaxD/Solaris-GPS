Quero construir um app no estilo "Teyvat GPS", só que para Wuthering Waves: um mapa
interativo com marcadores e progresso, mais um tracker que mostra minha posição em tempo
real lendo o MINIMAPA da tela. Uso pessoal, Windows 10/11. Sou dev web, então pode usar
termos técnicos.

## Regras inegociáveis (segurança da conta)
- NUNCA ler ou escrever memória do processo do jogo, injetar DLL, hookar API ou interagir
  com o cliente de qualquer forma.
- NUNCA enviar inputs (teclado/mouse) pro jogo. Nada de automação.
- O tracker só pode CAPTURAR A TELA (igual um software de gravação) e processar a imagem
  localmente. Nada sai do meu PC: sem telemetria, sem servidor externo.
- O app também não BAIXA nada em runtime: tiles e dados são lidos só do disco. As tiles
  já foram baixadas antes por uma ferramenta separada (tools/wuwa_maps.py). Não rode essa
  ferramenta sem eu pedir.
- Se alguma ideia sua exigir quebrar essas regras, me avisa e propõe alternativa.

## Fatos sobre o minimapa do WuWa
- O minimapa é FIXO: norte sempre pra cima, ele não rotaciona.
- Só a seta do jogador gira, como uma bússola. A direção vem dela.
- Não implemente tratamento de rotação do mapa.
- Observação minha, NÃO medida: a área do mundo que o minimapa mostra é parecida com a
  área de 1 tile (512 px) do zoom 6 do Overworld. Use isso só como chute inicial da
  calibração de escala. O valor real tem que ser medido.
- A escala minimapa → pixel do mapa depende da resolução, da escala de UI e do mapa
  (cada mapa pode ter densidade de pixel diferente). Calibre por mapa.

## Mapas já baixados (assets prontos)
Já tenho as tiles de 10 mapas, baixadas do CDN do th.gl com o script tools/wuwa_maps.py.
Fica tudo em assets/ (gitignored):

- assets/tiles_cache/<map_id>/<z>/<y>_<x>.webp: as tiles originais.
  - ATENÇÃO À ORDEM: no nome do arquivo (e na URL original do th.gl,
    `<map_id>/<z>/<y>/<x>.webp`), o PRIMEIRO número é a LINHA (y) e o SEGUNDO é a COLUNA
    (x). Eu montei os mapas com os eixos trocados uma vez e saiu tudo embaralhado, então
    confira isso.
  - Arquivo de 0 bytes = tile que não existe (cache negativo do script). Nunca tente
    abrir como imagem.
  - Tiles de 512x512 px (confirmado no Overworld; os outros estão no manifest).
  - As tiles têm transparência (alpha): mar e áreas vazias são transparentes. O th.gl
    pinta um fundo azul-escuro por trás. Algumas áreas do Overworld são cobertas por arte
    de nuvem (ex.: região das montanhas no céu), que não vai bater com o minimapa.
- assets/tiles_cache/<map_id>/manifest.json: FONTE DE VERDADE de cada mapa. Campos:
  `name`, `map_id`, `tile_size` [w, h], `first_number_is_row` (true),
  `tile_path_template`, `empty_file_means_no_tile`, `max_zoom` e `zooms` (por zoom:
  `tile_count`, `first_min/max` = linhas, `second_min/max` = colunas).
- assets/mapas/<prefixo>_z<zoom>_swap.png: os mapas inteiros costurados, SÓ para
  referência visual. Nunca carregue esses PNGs no app nem no tracker (o Overworld no
  zoom 6 daria 32768x31744 px, mais de 1 GB de RAM).

Na maioria dos mapas só tenho o zoom máximo. No Overworld tenho o zoom 5 e o 6.

| name (manifest)           | map_id                                              | zoom máx |
|---------------------------|-----------------------------------------------------|----------|
| overworld                 | AkiWorld_WP-e2f88b110e3b3c0bd074b0b86c81e40a        | 6        |
| lahai-roi                 | WP_Xueyuan-ddcb99d4191b54dca07461460f729054         | 5        |
| fabricatorium             | WP_HDSYC-2d87525bba6bb223afbc88988166aacb           | 5        |
| simulacrum-nexus-mengzhou | WP_3_7_WXSG-8792f85b032fd25db0d8d91545864b4a        | 5        |
| tethys-deep               | WP_HHA_Underground-17030f1461f12d89becc388f4f2c2e28 | 4        |
| avinoleum                 | WP_DianDaoTa2-f0bd3bd416ef313e80562c54a368b58f      | 4        |
| dimmr-plains              | WP_3_3_RLG-17ed048a53e1f8f4a0d192a64999dfeb         | 4        |
| vault-underground         | WP_JK_Underground-72bbb75d75b88fe41b0eec3061b81eca  | 3        |
| honami-city               | WP_2_8_Suibo-fbb47390920aa7a3d2f99b64c0c01c8c       | 3        |
| chronorift-metropolis     | WP_2_8_Cafe-7873fc419904c6c5190ab45bb2ce5256        | 2        |

Se a tabela e o manifest discordarem, vale o manifest. O Overworld contém VÁRIAS regiões
do jogo (Huanglong, Rinascita etc.) num único conjunto de tiles. Por isso, no app,
"mapa" = um map_id, e não uma região do jogo.

## Arquitetura
1. tracker/ (Python 3.11+): captura a região do minimapa (mss), calcula a posição com
   OpenCV e publica {map, x, y, heading, confidence, layer} via WebSocket em localhost.
   `map` é o `name` do manifest. O WebSocket é bidirecional: o web avisa o tracker de
   qual mapa está ativo.
2. web/ (Vite + TypeScript + Leaflet com CRS.Simple): mapa com tiles, marcadores,
   filtros, progresso e a posição do jogador ao vivo. Deve rodar numa segunda tela.
3. overlay/ (só na última fase): janela transparente, sempre no topo e click-through
   (Tauri de preferência) mostrando um minimapa.
4. tools/: wuwa_maps.py (já existe, não mexa sem eu pedir) e os scripts de build de
   tiles que você vai criar.

## Fases (PARE no fim de cada uma, me mostre o resultado e espere meu ok)

### Fase 0: Investigação e plano
- Ler todos os manifest.json em assets/tiles_cache/ e me mostrar um resumo: mapa, zoom
  máximo, nº de tiles, tamanho da grade, tamanho da tile e quantas posições da grade
  estão vazias. Avisar se algum mapa estiver sem manifest.
- No Overworld (que tem z5 e z6), verificar se o zoom 5 se alinha com o 6 como uma
  pirâmide padrão (tile (y, x) no z5 = tiles (2y..2y+1, 2x..2x+1) no z6, reduzidas).
  Isso decide se posso gerar os zooms menores dos outros mapas por redução.
- Clone https://github.com/Dimbreath/WutheringData e investigue se existem dados de
  entidades com coordenadas de mundo. Antes, confirme que o repositório existe e está
  acessível; se não estiver, me avise. PRIORIDADE MÁXIMA: posições de todos os teleportes
  e Nexus Ressoantes, porque são a base do tracker. Depois: baús, mutterflies, tidal
  heritage, etc. Me diga o que tem, em quais arquivos e em que formato. Não assuma: abra
  os arquivos. Veja também se os dados indicam em qual mapa (map_id ou nome de nível,
  tipo "AkiWorld", "WP_HHA_Underground") cada entidade está.
- Se os teleportes e nexus não estiverem nos dados, me avise. Vou cadastrá-los na mão
  na tela de calibração da Fase 1.
- Proponha a estrutura de pastas e as dependências. Me pergunte o que faltar.

### Fase 1: Mapa web
- NÃO recorte os PNGs gigantes. Use as tiles de assets/tiles_cache/. Crie
  tools/build_tiles que:
  - lê cada manifest;
  - copia só as tiles NÃO vazias para web/public/tiles/<name>/<z>/<y>_<x>.webp
    (gitignored);
  - gera os zooms menores por redução 2x2 → 1, até um zoom mínimo em que o mapa inteiro
    caiba numa tela (só se a Fase 0 confirmou a pirâmide padrão);
  - escreve web/public/maps.json com name, map_id, tileSize, minZoom, maxZoom e bounds
    de cada mapa.
  Mantenha um modo opcional que corta uma imagem grande em tiles, para mapas que eu só
  conseguir como imagem única.
- Leaflet: `tileSize` 512, `maxNativeZoom` = zoom máximo do mapa (permitindo zoom acima
  com upscale), `maxBounds` pelos limites do manifest e fundo do container azul-escuro
  (por causa das áreas transparentes). Template de tile: `{z}/{y}_{x}.webp`. Mantenha a
  numeração de tiles do th.gl, sem renumerar. Pixel no zoom máximo:
  px = x * 512 + u, py = y * 512 + v. Converta pixel ↔ latlng com
  `map.unproject([px, py], maxZoom)` e `map.project(latlng, maxZoom)`.
- Seletor de mapa (dropdown) com os mapas do maps.json. A escolha fica salva e é enviada
  ao tracker.
- Cada MAPA (map_id) tem seu PRÓPRIO sistema de coordenadas. Implemente conversão
  coordenada de jogo → pixel do mapa POR MAPA, com transformação afim calibrada por 3 ou
  mais pontos conhecidos. Faça uma tela de calibração onde eu clico no mapa e informo a
  coordenada. Mostre o erro residual de cada ponto. Como o Overworld junta várias regiões
  do jogo, se uma afim só não fechar bem no mapa todo (resíduo alto numa região), suporte
  calibrações separadas por área dentro do mesmo mapa.
- Marcadores por categoria com ícones, filtros, busca e "marcar como encontrado".
  Progresso por categoria e por mapa.
- Editor de marcadores: clique no mapa para criar marcador manual (para o que faltar nos
  dados, incluindo teleportes e nexus se necessário).
- Progresso salvo em IndexedDB, com Backup/Restore em JSON.
- Importador: aceitar um array JSON de strings no formato "id@x:y" (backup do th.gl, em
  coordenadas de jogo) e casar por proximidade com meus marcadores depois da conversão.
  Mostrar quantos casaram e quantos não, e deixar eu revisar antes de aplicar.

### Fase 2: Prova de conceito do tracker (imagem parada)
O mapa ativo vem do seletor manual. Não tente adivinhar o mapa.

Pipeline em duas camadas:
1. Referências (prioridade): detectar ícones de teleporte e de Nexus Ressoante no
   minimapa (template matching com os sprites dos ícones, que vou colocar em
   tracker/icons/). Ícones são iguais entre si, então identificar QUAL é cada um
   comparando a constelação (posições relativas de 2+ ícones) com as posições conhecidas
   no mundo. Com 1 ícone só, desambiguar pela última posição conhecida. Calcular a
   posição do jogador pelo deslocamento ícone → centro do minimapa, usando a escala
   minimapa→mapa calibrada uma vez por mapa.
2. Fallback por imagem: se não houver ícone confiável, localizar o recorte do minimapa
   no mapa ativo (só translação, escala fixa calibrada). Mascarar o centro (seta) e
   ícones sobrepostos.
   - A referência vem das TILES, nunca dos PNGs costurados. Monte em memória só a janela
     de busca (ex.: 3x3 tiles em volta da última posição), em tons de cinza, com cache
     LRU de tiles.
   - Use o alpha da tile como máscara: área transparente não conta no matching.
   - Busca global (sem posição anterior): coarse-to-fine, primeiro num zoom reduzido da
     pirâmide e depois refinando no zoom máximo.
   - Ferramenta de calibração da escala minimapa→mapa: dado um print com posição
     conhecida, testar várias escalas e mostrar o score de cada uma. O chute inicial
     está em "Fatos sobre o minimapa".
- Recorte do minimapa configurável: posição, tamanho e formato (circular ou quadrado,
  com máscara).
- Quando as duas camadas estiverem disponíveis, usar uma pra validar a outra e
  descartar resultado incoerente.
- Direção (heading): detectar a rotação da seta do jogador no centro do minimapa
  (comparar com o sprite da seta em ângulos de 0 a 359).
- Eu coloco prints em tracker/fixtures/ (tela cheia + posição real anotada + qual mapa),
  incluindo casos com 0, 1 e 2+ ícones visíveis. Me mostre uma tabela de acurácia (erro
  em pixels) e tempo por frame para cada camada separada e para as duas combinadas.
  Escolha os algoritmos com base nos números, não no chute.
- Script de teste automatizado que roda todos os fixtures.

### Fase 3: Tracker ao vivo
- Loop de captura a ~10 Hz com uso de CPU baixo. Me mostre a medição.
- Usar a camada de referências sempre que possível. No fallback por imagem, buscar numa
  janela em volta da última posição e fazer busca global quando perder o rastreio.
- Mapa ativo: escolhido MANUALMENTE no web e enviado ao tracker pelo WebSocket, com
  hotkey global opcional pra trocar. Não implemente detecção automática de mapa agora;
  isso fica como melhoria futura, se eu pedir.
- Suavização (filtro de Kalman ou média exponencial) e descarte de saltos impossíveis.
  Exceção: teleporte é um salto legítimo, então aceitar salto grande se a camada de
  referências confirmar a nova posição.
- Detectar quando o minimapa não está visível (menu, mapa aberto, cutscene) e pausar.
- No web: seguir jogador, seta de direção, indicador de confiança e qual camada
  está sendo usada.
- Hotkey global (só ouvindo o teclado, sem enviar nada pro jogo) para "marcar o
  marcador mais próximo como encontrado", com filtro de categorias que essa hotkey
  pode marcar.

### Fase 4: Overlay
- Minimapa transparente no topo, click-through, com hotkeys para mostrar/ocultar,
  travar/destravar e zoom. Requer o jogo em janela sem bordas. Me avise das limitações.

## Qualidade
- Código tipado (TypeScript strict, type hints em Python), README com setup e um
  config.json para resolução, posição do minimapa, hotkeys, porta do WebSocket, caminho
  de assets/tiles_cache e escala minimapa→mapa calibrada por mapa.
- Suportar resoluções diferentes (1080p e 1440p, pelo menos) e escala de UI.
- Commits pequenos por funcionalidade.

## Dados e direitos
- Assets e dados são © Kuro Games. Uso pessoal e não comercial. Credite o Dimbreath/
  WutheringData no README.
- As tiles foram baixadas do CDN do th.gl (The Hidden Gaming Lair): arte © Kuro Games,
  tiles processadas pelo th.gl. Credite no README como fonte das tiles de uso local.
- Não incluir no projeto dados de outros sites de mapa (ex.: appsample, th.gl). Posso
  usar localmente pra testar, mas nunca vão pro repositório. No .gitignore, no mínimo:
  assets/tiles_cache/, assets/mapas/, web/public/tiles/ e web/public/maps.json.

Comece pela Fase 0.
