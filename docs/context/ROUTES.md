# Rotas por tipo de tarefa

Hoje o repositório tem só a spec, o downloader, os assets e os tickets. As pastas marcadas
*(planejado)* ainda não existem; crie no lugar indicado e mova a marca pra cá quando existirem.

## Próximo trabalho / o que fazer agora
- **Ir direto para:** `.scratch/wuwa-tracker/issues/`. Pegue o menor número cujos
  bloqueadores estejam todos feitos (a "frente").
- **Cuidados:** tickets 🛑 (04, 16, 24, 29) são paradas pra aprovação do usuário. Ao
  terminar um ticket, marque os checkboxes e atualize o `STATE.md`.
- **Spec de referência:** `PROMPT_wuwa_tracker.md`. A seção da fase correspondente basta;
  não precisa ler o arquivo todo.

## Tiles, manifests e mapas
- **Ir direto para:** `assets/tiles_cache/<map_id>/manifest.json` (fonte de verdade de cada
  mapa) e `assets/tiles_cache/<map_id>/<z>/<y>_<x>.webp`.
- **Build de tiles:** `tools/build_tiles` *(planejado, ticket 01/05)*. Saída em
  `web/public/tiles/` e `web/public/maps.json` (ignorados pelo git).
- **Cuidados:** o Overworld (`AkiWorld_WP-…`) não tem manifest; gerar só a partir do disco.
  Pastas de zoom acima do `max_zoom` que só têm arquivos de 0 bytes são sondagem do
  downloader: ignore. No Overworld, z6 tem linhas 0–63 e colunas 1–62.
- **Não precisa ler:** `assets/mapas/*.png` (gigantes, só referência visual).

## Download de tiles (só com pedido)
- **Ir direto para:** `tools/wuwa_maps.py` (~240 linhas). `write_manifest` define o formato do
  manifest; `TileClient.path` define o nome dos arquivos.
- **Cuidados:** não editar nem rodar sem pedido. Os padrões `--cache tiles_cache` e
  `--out mapas` estão desatualizados (agora ficam em `assets/`).

## Mapa web (Vite + TS + Leaflet) *(planejado, `web/`)*
- Tickets 05–15. Conversão pixel↔latlng: `unproject/project` no `maxZoom`.
- Dados do mapa (calibração, teleportes, Nexus, escala) vêm de `data/maps/<name>.json`
  *(planejado)*. Progresso do usuário fica no IndexedDB.

## Tracker (Python 3.11) *(planejado, `tracker/`)*
- Tickets 08 (WebSocket e config), 17–23 (PoC com fixtures), 25–28 (ao vivo).
- Sprites em `tracker/icons/` e prints em `tracker/fixtures/` são fornecidos pelo usuário.
- `config.json` *(planejado)*: resolução, minimapa, hotkeys, porta, caminho do cache, escala
  por mapa.

## Dados de entidades (WutheringData) *(planejado)*
- Clone em `vendor/` (ignorado pelo git). Ticket 03 investiga; ticket 11 gera os marcadores
  localmente, e o resultado não é commitado.

## Overlay *(planejado, `overlay/`, Fase 4)*
- Ticket 30. Precisa de Rust/Tauri.

## Mini-mapa de arquivos
| Arquivo | Papel |
|---|---|
| `PROMPT_wuwa_tracker.md` | Spec original: regras, fatos do minimapa, fases |
| `.scratch/wuwa-tracker/issues/NN-*.md` | Tickets com bloqueadores e critérios |
| `tools/wuwa_maps.py` | Downloader e costurador do CDN do th.gl (não mexer) |
| `assets/tiles_cache/*/manifest.json` | Metadados de cada mapa (zooms, limites) |
| `.gitignore` | Garante que assets e dados de terceiros fiquem fora |
