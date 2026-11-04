# 14: Importador do backup do th.gl

**What to build:** Colo/abro um array JSON de "id@x:y" (coordenadas de jogo), o app converte e casa por proximidade com meus marcadores, mostra quantos casaram e quantos não, e eu reviso antes de aplicar.

**Blocked by:** 12 (Encontrado, progresso e backup)

**Status:** ready-for-agent

- [ ] Parser robusto do formato id@x:y
- [ ] Casamento por proximidade com raio configurável, após conversão pela calibração
- [ ] Prévia com casados/não casados e possibilidade de desmarcar itens
- [ ] Aplicar marca encontrados; nada é aplicado sem confirmação
- [ ] Dados do th.gl nunca vão para o repositório
