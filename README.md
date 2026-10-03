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
docker compose run --rm pocketbase migrate up --dir=/pb/pb_data --hooksDir=/pb/hooks --migrationsDir=/pb/migrations
docker compose up -d
npm install
npm run dev
```

Abra [http://localhost:5173](http://localhost:5173). O Vite usa o PocketBase em `http://127.0.0.1:8090` definido no `.env`.

O GitHub só aceita um callback por OAuth App. Para desenvolvimento, use uma OAuth App separada ou altere temporariamente o callback para `http://127.0.0.1:8090/api/oauth2-redirect`.

## Configurar GitHub e PocketBase

1. Suba o container e crie o primeiro superusuário:

   ```bash
   docker compose exec -it pocketbase /bin/sh /pb/bootstrap.sh superuser create admin@exemplo.com 'uma-senha-forte'
   ```

2. Abra `https://seu-dominio/_/` pelo proxy existente e entre no painel.
3. Em **Collections > users > Options > OAuth2**, configure e habilite somente **GitHub** com Client ID e Client Secret.
4. Na OAuth App do GitHub, configure:

   - Homepage URL: `https://seu-dominio`
   - Authorization callback URL: `https://seu-dominio/api/oauth2-redirect`

Não coloque o Client Secret do GitHub no repositório, no frontend ou no `.env` da aplicação. Ele fica apenas nas configurações persistentes do PocketBase.

## Implantar na VPS

Em produção, `.tevun/environment/bowl.devi.tools/docker-compose.override.yml` conecta o PocketBase à rede `reverse-proxy`, sem publicar portas no host. O Tevun serve a aplicação em `https://bowl.devi.tools` e mantém os dados no volume `sharkbowl_pocketbase_data`.

```bash
cp .tevun/environment/bowl.devi.tools/docker-compose.override.yml docker-compose.override.yml
COMPOSE_PROJECT_NAME=sharkbowl bash .tevun/hooks/install.sh "$PWD"
docker compose -p sharkbowl -f compose.yaml -f docker-compose.override.yml ps
```

Na produção, não defina `VITE_POCKETBASE_URL`: frontend, API e Realtime usam a mesma origem pública. Se o build for feito fora do domínio final, defina `VITE_PUBLIC_APP_URL=https://seu-dominio` antes de construir para que o QR Code use a URL correta.

Restrinja o painel `/_/` no proxy, use senha forte para superusuários e configure a lista de IPs permitidos no PocketBase quando possível. O healthcheck consulta `/api/health` dentro do container.

O volume `pocketbase_data` contém usuários, salas e configurações OAuth. Faça backup externo e testado desse volume antes de atualizar a imagem. Fixamos PocketBase em `0.40.4`; revise as notas da versão e teste uma cópia do volume antes de atualizar.

## Regras de acesso

- GitHub é obrigatório para participar, criar salas e entrar na fila.
- Qualquer pessoa autenticada pode criar uma sala e se torna seu dono.
- O dono e os facilitadores convidados podem abrir perguntas, controlar a fila e definir o tempo.
- Apenas o dono pode reiniciar uma sessão; a sala e seus participantes permanecem.
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

O hook de publicação executa as migrações pendentes em `pocketbase/migrations/` antes de iniciar o serviço; o comando do serviço desabilita a migração automática ao iniciar. O JSON histórico em `data/rooms.json` não é lido pela nova versão; ele continua preservado localmente como backup.

## Organização e runtime

`pocketbase/hooks` e `pocketbase/migrations` reúnem o backend. `pocketbase/bootstrap.sh` prepara o binário oficial PocketBase 0.40.4 no volume `pocketbase_binary`, valida seu SHA-256 e fornece os certificados para OAuth HTTPS. O serviço usa `alpine:3.21`, sem Dockerfile próprio. O volume `pocketbase_data` permanece separado e persistente.

Em desenvolvimento, execute `npm run dev` para o frontend conectado ao PocketBase em container. Na produção, a pipeline compila `dist/client` e copia o override de `.tevun/environment/bowl.devi.tools` para `docker-compose.override.yml` no snapshot. Frontend compilado, hooks e migrações são montados somente para leitura; não há build de imagem da aplicação.

Ao abrir uma pergunta, o dono escolhe 2, 3, 5 minutos ou um tempo personalizado por fala (1 segundo a 1440 minutos). A duração é aplicada na abertura da pergunta, sem alterar a fala em andamento. Participantes da sala podem votar nas perguntas pendentes e desfazer seus votos; cada pessoa tem um voto por pergunta, e somente contagem e seu próprio estado de voto são enviados ao navegador. As listas priorizam votos, com desempate por envio; a abertura permanece manual.

Somente o dono controla a sala. Ele pode transferi-la para outro participante autenticado que já entrou nela; o destinatário vira o único dono e o anterior perde imediatamente o controle. Perguntas, votos e fila são preservados. Papéis antigos não autorizam facilitação. Comandos de controle incluem uma versão do estado: comandos desatualizados são rejeitados e a tela recarrega a sala. Mudanças atualizam os clientes inscritos na mesma sala.
