# 08: Canal web↔tracker

**What to build:** Com o tracker rodando, o web conecta por WebSocket em localhost, envia o mapa ativo e consegue pedir para salvar dados de mapa em arquivo. Base para calibração (Fase 1) e posição ao vivo (Fase 3).

**Blocked by:** 06 (Seletor com todos os mapas)

**Status:** ready-for-agent

- [x] Tracker Python 3.11 (venv) sobe servidor WebSocket só em localhost, porta do config.json
- [x] config.json criado com porta, caminho do cache de tiles e campos reservados (resolução, minimapa, hotkeys, escala por mapa)
- [x] Mensagem de mapa ativo enviada ao conectar e ao trocar de mapa
- [x] Mensagem save_map_data grava o arquivo de dados do mapa (versionado) e responde ok/erro
- [x] Web mostra estado da conexão e reconecta sozinho
- [x] Mensagens tipadas dos dois lados; nada sai do PC
