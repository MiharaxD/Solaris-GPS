# 08: API local de dados do mapa

**What to build:** O web lê e grava os dados versionados de cada mapa (calibração, teleportes manuais, escala) por uma API do próprio servidor local do Vite, sem processo separado. Substitui o antigo canal WebSocket com o tracker em Python (o tracker agora roda no navegador).

**Blocked by:** 06

**Status:** ready-for-agent

- [x] GET/PUT /api/map-data/<name> lendo/gravando data/maps/<name>.json
- [x] Só localhost: Host local (anti DNS rebinding), Origin do próprio servidor, header próprio obrigatório na escrita, CORS desligado
- [x] Nome validado contra o índice de mapas (sem path traversal); escrita atômica; limite de tamanho
- [x] Cliente no web com fallback de download do JSON
- [x] Testes automatizados (Vitest) cobrindo leitura/escrita, nomes maliciosos, origem e Host
