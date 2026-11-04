# Estado atual

**Fase:** antes da Fase 0. Plano fechado e quebrado em 30 tickets. Ainda não há código do app.

## Pronto
- Assets organizados em `assets/tiles_cache/` (10 mapas) e `assets/mapas/` (PNGs de
  referência).
- `tools/wuwa_maps.py` versionado, sem alterações.
- Repositório na branch `main`, remote `origin` = github.com/MiharaxD/Solaris-GPS (PÚBLICO). `.gitignore` cobre assets, tiles
  geradas, `maps.json` e `vendor/`.

## Próximo (a frente)
1. Ticket 01: inventário e manifest do Overworld a partir do disco.
2. Ticket 03: investigação do WutheringData (pode rodar em paralelo com o 01).
3. Ticket 02: teste da pirâmide z5↔z6 (depende do 01).
4. Ticket 04 🛑: relatório da Fase 0 e aprovação.

## Fatos levantados
- O Overworld não tem manifest. O z5 é 32×32 (1024 tiles, todas preenchidas). O z6 tem
  3968 tiles, linhas 0–63 e colunas 1–62. Os limites batem com uma pirâmide padrão, mas
  ainda não foi verificado pixel a pixel.
- Os outros 9 mapas têm manifest. Honami, Avinoleum, Tethys e Vault têm uma pasta de zoom
  acima do máximo só com 49 arquivos de 0 bytes, que é sondagem do downloader.
- Python registrado no `py`: 3.11, 3.14 e 3.15. Node 24. Sem Rust e sem uv no PATH.

## Depende do usuário
- Sprites dos ícones (teleporte, Nexus, seta do jogador) e prints dos fixtures (Fase 2).
- Escala de UI em que joga (resolução já informada: 2560x1440).
- Pontos de calibração clicados no jogo (Fase 1).
- Instalar o Rust antes da Fase 4.

## Limitações conhecidas
- O WutheringData ainda não foi verificado: não se sabe se tem teleportes e Nexus com
  coordenadas (não verificado).
