# 14: Importador do backup do th.gl

**What to build:** Colo/abro um array JSON de "id@x:y" (coordenadas de jogo), o app converte e casa por proximidade com meus marcadores, mostra quantos casaram e quantos não, e eu reviso antes de aplicar.

**Blocked by:** 12 (Encontrado, progresso e backup)

**Status:** feito

- [x] Parser robusto do formato id@x:y
- [x] Casamento por proximidade com raio configurável, após conversão pela calibração
- [x] Prévia com casados/não casados e possibilidade de desmarcar itens
- [x] Aplicar marca encontrados; nada é aplicado sem confirmação
- [x] Dados do th.gl nunca vão para o repositório

**Como ficou:** `web/src/thglImport.ts` (`parseThgl`, `matchEntries` com grade espacial e
casamento um-pra-um) e `web/src/importDialog.ts` (botão "Importar th.gl…" no painel). O
casamento é feito em coordenada de JOGO contra os marcadores do WutheringData do mapa ativo
(raio em metros, padrão 3), sem passar pela calibração. Testa escalas (cm, m, dm) e troca de
eixos e fica com a que mais casa, porque o formato exato do th.gl não foi confirmado.
Nada do arquivo é guardado; só os nossos ids viram encontrados.
