# Solaris GPS: mapa interativo e tracker do Wuthering Waves

Mapa web com marcadores e progresso (estilo "Teyvat GPS") e um tracker que lê o MINIMAPA
da tela pra mostrar a posição ao vivo. Uso pessoal, Windows 10/11.
Spec completa e fases: `PROMPT_wuwa_tracker.md`. Plano em tickets: `.scratch/wuwa-tracker/issues/`.

Stack planejada: tracker em Python 3.11 (venv, mss, OpenCV, WebSocket); web em Vite +
TypeScript strict + Leaflet (CRS.Simple); overlay em Tauri (só na Fase 4, precisa de Rust,
que ainda não está instalado). Node 24 instalado.
Python: use `py -3.11`. O padrão da máquina é o 3.15, novo demais pras libs. `py -3.12`
não funciona: o 3.12 que existe foi instalado pelo uv e não está registrado no `py`.

## Comandos
Ainda não há código de app. Os comandos de instalar, rodar e testar entram aqui quando os
tickets 05, 08 e 17 existirem.

**Só com pedido explícito do usuário:**
- `python tools/wuwa_maps.py --cache assets/tiles_cache --out assets/mapas ...` baixa do CDN
  do th.gl. Rode da raiz e sempre passe `--cache`/`--out`: os padrões do script apontam pra
  pastas antigas e criariam um cache vazio novo.

## Invariantes (inegociáveis)
- O tracker só CAPTURA A TELA. Nunca ler/escrever memória do jogo, injetar DLL, hookar API,
  enviar input de teclado/mouse ou automatizar nada. Hotkeys só ESCUTAM o teclado.
- Nada sai do PC: sem telemetria, sem servidor externo. O WebSocket só escuta em localhost.
- Em runtime, nada é baixado: tiles e dados vêm só do disco.
- Não editar nem rodar `tools/wuwa_maps.py` sem pedido.
- Nomes das tiles: `<z>/<y>_<x>.webp`, PRIMEIRO número = LINHA. Arquivo de 0 bytes = tile que
  não existe; nunca abrir como imagem.
- Nunca carregar os PNGs costurados de `assets/mapas/` no app nem no tracker (só servem de
  referência visual).
- Nunca commitar dados de terceiros: `assets/`, tiles geradas, `maps.json`, `vendor/`, dados
  do th.gl/appsample e marcadores gerados a partir do WutheringData.
- O minimapa não rotaciona (norte fixo). Não implementar tratamento de rotação do mapa.
- PARAR no fim de cada fase (tickets 🛑) e esperar o ok do usuário.

## Estilo
- Conversa, comentários, commits e UI em português. Identificadores em inglês.
- TypeScript strict; type hints em todo o Python.
- Commits pequenos, um por funcionalidade (`feat:`, `fix:`, `chore:`). Nunca push sem pedido.

## Protocolo de consulta (antes de qualquer tarefa)
1. Leia `docs/context/ROUTES.md` e vá direto aos caminhos do tipo de tarefa.
2. Leia `docs/context/STATE.md` e `docs/context/DECISIONS.md` só se a tarefa depender de
   estado, prioridades ou escolhas de produto.
3. Explore além disso só se a rota não cobrir o caso. Em arquivo grande, use busca e leia
   trechos.

## Protocolo de manutenção (ao terminar trabalho relevante, sem precisar pedir)
- Atualize só os documentos afetados, antes de declarar a tarefa concluída.
- Substitua em vez de acrescentar: remova o que ficou obsoleto, as pendências concluídas e as
  redundâncias.
- Se descobriu um caminho novo ou uma rota errada, corrija o `ROUTES.md`.
- Nunca registre diário, log de sessão, raciocínio, SHAs, resultados de teste datados ou
  tamanhos de build.
- Respeite os limites de tamanho; quando chegar perto, compacte.
- Instruções novas do usuário prevalecem; atualize os documentos quando elas mudarem uma
  regra.
