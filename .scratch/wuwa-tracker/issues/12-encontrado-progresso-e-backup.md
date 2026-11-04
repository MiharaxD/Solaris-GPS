# 12: Encontrado, progresso e backup

**What to build:** Marco marcadores como encontrados, vejo progresso por categoria e por mapa, e faço Backup/Restore em JSON. Tudo persiste no IndexedDB.

**Blocked by:** 11 (Marcadores do WutheringData)

**Status:** feito

- [x] Marcar/desmarcar encontrado no popup do marcador
- [x] Progresso por categoria e por mapa (x/y e %)
- [x] Opção de esconder encontrados
- [x] Backup exporta JSON; Restore valida e importa
- [x] Persistência em IndexedDB

**Como ficou:** `web/src/progress.ts` (`ProgressStore`: IndexedDB `solaris`/`found`, chave
`<mapa>:<id>`, cópia em memória; backup `solaris-gps-backup` v1 = ids por mapa; Restore valida e
substitui). Popup tem "Marcar como encontrado"; botão direito no marcador alterna. Encontrados
ficam apagados ou escondidos ("Esconder encontrados"). Contagem x/y por categoria e
subcategoria, linha do mapa e "Progresso em todos os mapas".
