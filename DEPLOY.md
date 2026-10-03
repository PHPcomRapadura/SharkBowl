# Deploy com GitHub Actions

O workflow compila o frontend com as dependências do lockfile e envia um snapshot
para o remote Tevun. O servidor usa `alpine:3.21` com o binário oficial PocketBase 0.40.4,
executa as migrations e espera o container ficar saudável. A pipeline verifica
a revisão recebida, a imagem do container e os endpoints HTTP e HTTPS.

O projeto Compose continua sendo `sharkbowl`, com o volume
`sharkbowl_pocketbase_data`. O `.env` do servidor e a configuração OAuth no banco
permanecem no servidor. Nenhuma credencial OAuth é enviada ao GitHub.

Configure o environment `production`, as variables `DEPLOY_REMOTE` (URL SSH)
e `DEPLOY_KNOWN_HOSTS` (entrada SSH confiável) e o secret
`DEPLOY_SERVER_PRIVATE_KEY` (chave de deploy autorizada no servidor).

Push em `main` publica automaticamente. Pull requests executam apenas o build.
Após merge, também é possível executar manualmente o workflow.
O force push é usado somente no repositório de snapshots Tevun.
