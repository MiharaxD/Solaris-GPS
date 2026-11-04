# 11: Marcadores do WutheringData

**What to build:** Vejo no mapa os marcadores vindos do WutheringData, convertidos de coordenada de jogo para pixel pela calibração, com ícone por categoria, filtros e busca.

**Blocked by:** 03 (Investigação do WutheringData), 09 (Calibração afim por mapa)

**Status:** ready-for-agent

- [ ] Script gera os marcadores localmente a partir do clone (saída fora do git)
- [ ] Marcadores atribuídos ao mapa certo (AkiMapSource.MapPath → map_id das tiles)
- [ ] Teleporter.Type 2 = Beacon (teleporte), Type 1 = Nexus, Type 3 = entrada de instância; posição = LevelEntityConfig_0+_1 por (MapId, EntityId), Transform[0]
- [ ] Ícones por categoria, filtro por categoria e busca por nome
- [ ] Performance ok com milhares de marcadores (clustering ou canvas se precisar)
