# Estado atual

**Fase:** Fase 0 concluída (tickets 01–03). Ticket 04 🛑 esperando aprovação do usuário.

## Pronto
- `tools/build_tiles.py`: `inventory [--alpha]`, `manifest <map_id> --name`, `pyramid <map_id> --lo N`.
- Manifest do Overworld gerado a partir do disco (`overworld`, z5 e z6).
- Repositório na branch `main`, remote `origin` = github.com/MiharaxD/Solaris-GPS (**público**).
- `.venv` com Python 3.11, Pillow e numpy (`.venv/Scripts/python`).
- WutheringData em `vendor/WutheringData` (clone parcial com sparse checkout, só os
  arquivos usados).

## Fatos confirmados na Fase 0
- 10 mapas, tiles 512×512. Todas as grades estão completas dentro dos limites (0 posições
  vazias). Os arquivos de 0 bytes ficam só na borda testada pelo downloader.
- **As tiles são RGB, sem canal alpha.** O fundo azul-escuro (~RGB(4,36,52); o
  `tethys-deep` usa ~(16,40,56)) vem pintado na tile, e há padding preto puro em algumas
  bordas (ex.: coluna 0 do Overworld z5).
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
- Ticket 04 🛑: aprovação. Depois, ticket 05 (primeiro mapa no ar).

## Depende do usuário
- Sprites dos ícones **recortados do minimapa** (teleporte, Nexus e seta, na escala real em
  1440p). Os enviados (59×82 e 94×85) parecem vir do mapa grande.
- Prints de tela cheia pros fixtures (Fase 2) e a escala de UI. Resolução: 2560×1440.
- Pontos de calibração (Fase 1). Teleportes à mão só nos 3 mapas sem dados.
- Instalar o Rust antes da Fase 4.

## Limitações conhecidas
- O minimapa tem um cone de visão claro que gira com a câmera. Ele precisa de máscara ou
  tratamento no matching (não verificado o quanto atrapalha).
- Os dados de entidades podem não bater com a versão atual do jogo (dump de março de 2026).
