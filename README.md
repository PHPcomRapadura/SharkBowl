# Shark Bowl

Aplicação mobile-first para encontros presenciais da comunidade PHP. Todas as pessoas entram com GitHub, enviam perguntas e participam de uma fila de falas sincronizada em tempo real.

O PocketBase reúne banco SQLite, autenticação, API e Realtime na própria VPS. A interface React fala diretamente com ele; as regras de sala continuam no backend, em rotas privadas do PocketBase.

## Requisitos

- Docker Compose v2
- Node.js 20+ e npm 10+ para desenvolver o frontend
- Um domínio HTTPS apontado para o proxy já existente
- Uma OAuth App do GitHub

## Rodar localmente

```bash
cp .env.example .env
docker compose up --build -d
npm install
npm run dev
```

Abra [http://localhost:5173](http://localhost:5173). O Vite usa o PocketBase em `http://127.0.0.1:8090` definido no `.env`.

O GitHub só aceita um callback por OAuth App. Para desenvolvimento, use uma OAuth App separada ou altere temporariamente o callback para `http://127.0.0.1:8090/api/oauth2-redirect`.

## Configurar GitHub e PocketBase

1. Suba o container e crie o primeiro superusuário:

   ```bash
   docker compose exec -it pocketbase /pb/pocketbase superuser create admin@exemplo.com 'uma-senha-forte'
   ```

2. Abra `https://seu-dominio/_/` pelo proxy existente e entre no painel.
3. Em **Collections > users > Options > OAuth2**, configure e habilite somente **GitHub** com Client ID e Client Secret.
4. Na OAuth App do GitHub, configure:

   - Homepage URL: `https://seu-dominio`
   - Authorization callback URL: `https://seu-dominio/api/oauth2-redirect`

Não coloque o Client Secret do GitHub no repositório, no frontend ou no `.env` da aplicação. Ele fica apenas nas configurações persistentes do PocketBase.

## Implantar na VPS

O Compose publica o serviço apenas em `127.0.0.1:8090`; conecte o proxy já existente a essa porta e faça o proxy de HTTP, WebSocket/SSE e `/_/` para o mesmo domínio da aplicação.

```bash
docker compose up --build -d
docker compose ps
```

Na produção, não defina `VITE_POCKETBASE_URL`: frontend, API e Realtime usam a mesma origem pública. Se o build for feito fora do domínio final, defina `VITE_PUBLIC_APP_URL=https://seu-dominio` antes de construir para que o QR Code use a URL correta.

Restrinja o painel `/_/` no proxy, use senha forte para superusuários e configure a lista de IPs permitidos no PocketBase quando possível. O healthcheck consulta `/api/health` dentro do container.

O volume `pocketbase_data` contém usuários, salas e configurações OAuth. Faça backup externo e testado desse volume antes de atualizar a imagem. Fixamos PocketBase em `0.40.4`; revise as notas da versão e teste uma cópia do volume antes de atualizar.

## Regras de acesso

- GitHub é obrigatório para participar, criar salas e entrar na fila.
- Qualquer pessoa autenticada pode criar uma sala e se torna seu dono.
- O dono pode promover participantes que já entraram na sala a facilitadores e revogar esse acesso.
- Somente dono e facilitadores podem abrir perguntas, controlar a fila e definir o tempo.
- Apenas o dono pode reiniciar uma sessão; a sala e seus facilitadores permanecem.
- Perguntas anônimas nunca retornam a identidade do autor para o navegador.
- As coleções de perguntas, fila e membros não aceitam escrita direta pelo cliente. As ações passam por rotas transacionais no PocketBase.

## Rotas da interface

- `/`: lobby e criação de salas.
- `/s/:slug`: tela de participante.
- `/s/:slug/facilitador`: painel de controle, disponível apenas a quem tem permissão.

O QR Code leva sempre à tela de participante e não concede acesso de facilitador.

## Validação

```bash
npm run build
docker compose config
```

As migrações em `pb_migrations/` são executadas automaticamente na primeira inicialização de um volume novo. O JSON histórico em `data/rooms.json` não é lido pela nova versão; ele continua preservado localmente como backup.
