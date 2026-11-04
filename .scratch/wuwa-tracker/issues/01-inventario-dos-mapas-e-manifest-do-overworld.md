# 01: Inventário dos mapas e manifest do Overworld

**What to build:** Rodo uma ferramenta de build que lê todos os manifests do cache de tiles e me mostra, por mapa: zoom máximo, nº de tiles, tamanho da grade, tamanho da tile e quantas posições da grade estão vazias. Avisa mapa sem manifest e, para o Overworld (que não tem), gera o manifest no mesmo formato do downloader, lendo SÓ o disco (sem rede, sem rodar o downloader).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Tabela-resumo dos 10 mapas impressa no terminal
- [x] Pastas de zoom acima do máximo que só têm arquivos de 0 bytes (sondagem do downloader) são ignoradas
- [x] Arquivos de 0 bytes nunca são abertos como imagem
- [x] Manifest do Overworld gerado com z5 e z6, first_number_is_row=true, tile_size lido de uma tile real
- [x] Nenhum acesso à rede
