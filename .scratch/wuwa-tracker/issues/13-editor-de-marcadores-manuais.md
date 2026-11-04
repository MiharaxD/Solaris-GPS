# 13: Editor de marcadores manuais

**What to build:** Clico no mapa para criar marcador manual. Teleportes e Nexus (referências do tracker) vão para o arquivo de dados do mapa; marcadores pessoais vão para o IndexedDB.

**Blocked by:** 09 (Calibração afim por mapa)

**Status:** feito

- [x] Criar, editar, mover e apagar marcador manual
- [x] Escolha de categoria; teleporte/nexus salvos em pixel do zoom máximo no arquivo do mapa
- [x] Marcadores pessoais entram no progresso e no backup

**Como ficou:** "+ Novo marcador" no painel → clique no mapa → formulário (categoria, nome,
nota). Teleporte/Nexus vão pra `manualMarkers` em `data/maps/<name>.json` (px do zoom máximo,
via `patchMapData`, que relê o disco e não leva pontos de calibração não salvos); o resto vai
pro IndexedDB (store `personal`, DB v2) e entra no backup (`personal`). Popup do manual:
editar, mover (próximo clique) e apagar. Ids `m-…` (arquivo) e `p-…` (pessoal).
