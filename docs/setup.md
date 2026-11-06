# Setup na Cloudflare (passos manuais)

Tudo aqui cabe nos planos gratuitos. Os passos marcados com **[Fase 1]** só são precisos quando chegarmos ao upload.

## Requisitos locais

- Node 22+ e npm.
- `npm install` na raiz do projeto.
- `cp .dev.vars.example .dev.vars` para desenvolvimento local. Em `localhost`, o `OWNER_EMAIL` do `.dev.vars` é aceite sem Access.

## 1. Conta e login

1. Cria uma conta gratuita em <https://dash.cloudflare.com> (ou usa a que já tens).
2. Em **Workers & Pages**, escolhe o subdomínio `workers.dev` da conta, se ainda não tiveres um. A app fica em `https://nectr.<subdominio>.workers.dev`.
3. No terminal, na pasta do projeto, autoriza o wrangler (abre o browser):
   ```bash
   npx wrangler login
   ```
4. Confirma com `npx wrangler whoami`.

## 2. Primeiro deploy

```bash
npm run deploy
```

Nesta altura a app já é pública em `/` e `/s/*`. O `/admin` abre, mas a API do dono responde sempre 401, porque o Access ainda não está configurado (as variáveis `ACCESS_*` estão vazias).

## 3. Cloudflare Access (protege só `/admin*` e `/api/admin*`)

1. No dashboard, abre **Zero Trust**. Na primeira vez, escolhe o nome da equipa (fica `<equipa>.cloudflareaccess.com`) e o plano **Free**.
2. Vai a **Access → Applications → Add an application → Self-hosted**.
   - Nome: `nectr admin`.
   - Session duration: `24 hours` (ou o que preferires).
   - **Destinations** (duas entradas, ambas com o hostname `nectr.<subdominio>.workers.dev`):
     - path `admin*`
     - path `api/admin*`
   - Identity provider: **One-time PIN** (código por email; vem incluído).
3. Cria uma policy:
   - Action **Allow**.
   - Include → **Emails** → o teu email (só esse).
4. Guarda a aplicação. Se não encontrares o **AUD tag** e o **team domain** no dashboard, abre `/admin` numa janela privada (ou faz `curl -sI https://nectr.<sub>.workers.dev/admin`). O endereço de login para onde o Access redireciona tem a forma `https://<equipa>.cloudflareaccess.com/...?kid=<AUD>`, com os dois valores.

Nota: em "Authentication", basta deixar "Accept all available identity providers" ligado. O One-time PIN vem incluído.

## 4. Variáveis da app

Em `wrangler.jsonc`, preenche:

```jsonc
"vars": {
  "ENVIRONMENT": "production",
  "OWNER_EMAIL": "o-teu-email@exemplo.com",
  "ACCESS_TEAM_DOMAIN": "https://<equipa>.cloudflareaccess.com",
  "ACCESS_AUD": "<AUD tag>"
}
```

Estas variáveis não são secretas. A verificação do JWT usa as chaves públicas do Access.

Depois, faz um novo deploy:

```bash
npm run deploy
```

## 5. Verificação da Fase 0

| URL | Esperado |
|---|---|
| `https://nectr.<sub>.workers.dev/` | Página "nectr", sem login |
| `…/s/qualquer-coisa` | "Este link não está disponível", sem login |
| `…/admin` | Pede login do Access; depois mostra "Olá, <email>" |
| `…/admin/projetos` | Pede login do Access |
| `…/api/admin/me` (janela privada) | Redireciona para o login do Access |

## 6. [Fase 1] R2, D1 e secrets

Só os passos 1 e 3 precisam de ti no dashboard. Os outros correm no terminal.

1. **Ativar o R2**: no dashboard, abre **R2 Object Storage** e ativa o serviço. Pede um cartão, mas não há custos dentro dos 10 GB gratuitos (e das operações mensais grátis).
2. **Criar o bucket e a base de dados** (uma vez):
   ```bash
   npx wrangler r2 bucket create nectr-audio
   npx wrangler d1 create nectr
   ```
   O segundo comando mostra um `database_id`. Junta-o à entrada `d1_databases` do `wrangler.jsonc` (`"database_id": "…"`).
3. **Credenciais S3 do R2** (para os URLs de upload pré-assinados):
   - Vai a **R2 → Manage API tokens → Create API token**.
   - Permissão **Object Read & Write**, só para o bucket `nectr-audio`.
   - Guarda o **Access Key ID** e o **Secret Access Key** como secrets do Worker. O wrangler pede cada valor de forma interativa; não os escrevas na linha de comandos:
     ```bash
     npx wrangler secret put R2_ACCESS_KEY_ID
     npx wrangler secret put R2_SECRET_ACCESS_KEY
     ```
4. **Secret do cookie das passwords** (gerado e enviado sem aparecer no ecrã):
   ```bash
   node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put COOKIE_SECRET
   ```
5. **CORS do bucket**: só a origem da app pode fazer PUT (o browser envia o ficheiro direto para o R2):
   ```bash
   npx wrangler r2 bucket cors set nectr-audio --file scripts/r2-cors.json
   ```
   Se a app mudar de endereço (domínio próprio), atualiza a origem em `scripts/r2-cors.json` e repete.
6. **Migrations e deploy**:
   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```

### Verificação da Fase 1

| Passo | Esperado |
|---|---|
| Criar um projeto e largar um WAV 24 bit e um MP3 | Barra de progresso, depois a faixa aparece com formato, sample rate e duração certos |
| Largar um WAV 32 bit float | Recusado logo no browser, com a mensagem "WAV 32 bit float não é suportado" |
| Abrir a faixa | Waveform, play, seek ao clicar e ao arrastar, zoom até 16× |
| Partilhar com password e abrir o link numa janela privada | Pede a password; depois mostra as faixas e toca |
| Seek no Safari do iPhone | Salta para o ponto tocado (pedidos Range com resposta 206) |
| Link com download desligado | Não há botão; `/s/<token>/download/<id>` responde com a página neutra |
| Revogar o link | A página passa a "Este link não está disponível" |

## Desenvolvimento local da Fase 1

```bash
npm run db:migrate:local   # uma vez, e sempre que houver uma migration nova
npm run dev
```

Localmente, os uploads vão para o R2 simulado através de `/api/admin/dev-upload/…` (o URL pré-assinado apontaria para o bucket real). Não são precisas credenciais do R2.

## 7. Avisos no telemóvel (notificações)

Os avisos usam Web Push, gratuito (o serviço de push do Firefox ou do Chrome entrega-os). Precisam de uma chave própria, criada uma vez:

```bash
node scripts/push-key.mjs
```

O script cria a chave e guarda-a como secret `VAPID_JWK` na Cloudflare, sem a mostrar. Correr outra vez pede `--force`, porque uma chave nova desliga os avisos em todos os dispositivos até serem ligados de novo. Para desenvolvimento local: `node scripts/push-key.mjs --dev` (escreve no `.dev.vars`).

Depois: Perfil → Avisos → **Ativar neste dispositivo**, e **Enviar um teste**.
