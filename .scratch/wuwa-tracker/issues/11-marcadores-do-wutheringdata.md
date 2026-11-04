# 11: Marcadores do WutheringData

**What to build:** Vejo no mapa os marcadores vindos do WutheringData, convertidos de coordenada de jogo para pixel pela calibração, com ícone por categoria, filtros e busca.

**Blocked by:** 03 (Investigação do WutheringData), 09 (Calibração afim por mapa)

**Status:** feito

- [x] Script gera os marcadores localmente a partir do clone (saída fora do git)
- [x] Marcadores atribuídos ao mapa certo (AkiMapSource.MapPath → map_id das tiles)
- [x] Teleporter.Type 2 = Beacon (teleporte), Type 1 = Nexus, Type 3 = entrada de instância; posição = LevelEntityConfig_0+_1 por (MapId, EntityId), Transform[0]
- [x] Ícones por categoria, filtro por categoria e busca por nome
- [x] Performance ok com milhares de marcadores (clustering ou canvas se precisar)

**Como ficou:** `tools/extract_markers.py` → `web/public/markers/<name>.json` (coordenadas de
jogo; o web converte com a afim dos pontos de `data/maps`). Categorias: teleporte, Nexus, baú
(básico/padrão/avançado/premium/ilusório, pelo nome chinês do blueprint), Sonance Casket
(`HookSoundBox`/`HookPullSoundBox`), planta, minério e outros coletáveis (espécie traduzida
via TextMap zh-Hans → idioma). Entradas de instância (Type 3) ficaram de fora (sem nome
legível). Canvas único (`web/src/markerLayer.ts`), ~18 mil pontos no Overworld.
