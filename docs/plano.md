# nectr — plano aprovado (estrutura, decisões e desvios)

O plano original está em [plano-original.md](plano-original.md). Onde os dois divergem, prevalece este.

> **Notas de implementação (Fase 0)**
> - O pacote de testes da Cloudflare chama-se agora `@cloudflare/vitest-plugin` e substitui o `@cloudflare/vitest-pool-workers`.
> - O Vitest está fixado na versão 4.1: com o Vitest 5, o plugin falha no Windows ("File path must be a file: URL").
> - O TypeScript está fixado na versão 6.x, porque o `svelte-check` ainda não suporta o TypeScript 7.
> - Caminhos do Access: `admin*` e `api/admin*` (ver [setup.md](setup.md)).

## Contexto

Aplicação web pessoal para partilhar músicas com clientes por link (sem conta), ouvir e comparar versões (A/B), recolher comentários com timestamp e gerir revisões. Tudo em Cloudflare (Workers + R2 + D1 + Access), dentro dos planos gratuitos. A UI segue o espírito do Samply (moderna, escura, com artwork em destaque) e a clareza do Filepass na checklist. O design, o nome e os assets são originais.

Estado atual: a pasta `C:\AI Projects\Nectr` está vazia e não é um repositório git. Ferramentas instaladas: Node 24.15, npm 11.12, git 2.54 e ffmpeg 8.1 (serve de referência para validar o loudness). O wrangler não está instalado globalmente; fica como devDependency.

Este documento responde ao §13 do plano: estrutura proposta, desvios técnicos com justificação e dúvidas em aberto. Depois de aprovado, copio-o para `docs/plano.md` e avanço com a Fase 0.

---

## 1. Desvios e correções ao plano (o plano pede que eu avise quando algo não bate certo)

| # | No plano | Problema | Proposta |
|---|---|---|---|
| D1 | WAV válido = `fmt ` com formato 1 (PCM) | Muitos DAWs gravam WAV 24 bit como **WAVE_FORMAT_EXTENSIBLE (0xFFFE)** com subformato PCM. A especificação da Microsoft até o exige para mais de 16 bit. Rejeitar esses ficheiros bloquearia exports reais. | Aceitar o formato 1 **e** 0xFFFE com GUID de subformato PCM. Rejeitar float (3, ou 0xFFFE com subformato float) com a mensagem "WAV 32 bit float não é suportado". |
| D2 | Ler "os primeiros bytes" na finalização | Os ficheiros BWF do Pro Tools ou do Reaper podem trazer chunks `bext`, `iXML` ou `JUNK` antes do `fmt `. No MP3, uma tag ID3 com capa pode ter vários MB. | O validador percorre os chunks RIFF com leituras Range ao R2: primeiro 64 KB, depois salta pelos tamanhos dos chunks, com um limite de leituras. No MP3, salta a tag ID3v2 pelo tamanho declarado e confirma um frame MPEG-1/2 Layer III válido **e** o sync do frame seguinte. Só a presença de "ID3" não chega. |
| D3 | LUFS com um port WASM de libebur128 | Pesquisei: `ebur128-wasm` não é publicado há cerca de 4 anos. Não existe nenhum port de libebur128 para npm que seja mantido. `@audio/loudness` é recente, de maturidade incerta e não aceita entrada em blocos. Compilar C ou Rust para WASM obrigaria a ter Emscripten ou Rust na build. | **Implementar o medidor em TypeScript** (sem dependências, ~300 linhas): K-weighting com coeficientes calculados para qualquer sample rate (como no libebur128), blocos de 400 ms e de 3 s com passo de 100 ms (como no filtro `ebur128` do ffmpeg, que é a referência), gating absoluto/relativo, LRA (P10–P95) e true peak com oversampling 4x polifásico. Corre num Web Worker e recebe blocos. Testes com sinais da EBU Tech 3341/3342 e comparação com o ffmpeg nos teus ficheiros. |
| D4 | Validar contra o ffmpeg com ±0,2 dB de true peak | O ffmpeg calcula o true peak reamostrando para 192 kHz (swresample), e não com 4x. A 44,1 kHz são 176,4 kHz contra 192 kHz, com filtros diferentes. A diferença costuma ficar abaixo de 0,1 dB, mas não é garantida. O resumo do `ebur128` também só mostra 1 casa decimal. | Comparar com `ebur128=peak=true`, como pedes, e também com `loudnorm=print_format=json`, que dá 2 casas decimais. Se o true peak sair da tolerância, aumentar o filtro ou o fator de oversampling **antes** de avançar, e aviso-te. |
| D5 | MP3: `music-metadata` para bitrate, duração e sample rate | É uma dependência pesada, com várias subdependências, para algo que se resolve com cerca de 80 linhas. O MP3 vai ser descodificado de qualquer forma para o LUFS. | Parser próprio: salta a ID3v2, lê o header do 1.º frame (sample rate, canais, bitrate CBR) e o header Xing/Info/VBRI (número de frames para VBR). Bitrate médio = bytes de áudio × 8 / duração. Se aparecer um ficheiro que o parser não leia, reconsidero. |
| D6 | MP3: descodificar com um `AudioContext` à sample rate do ficheiro | Funciona, mas um `AudioContext` mexe no dispositivo de áudio e na política de autoplay. | Usar `OfflineAudioContext(2, 1, sampleRate).decodeAudioData()`: a sample rate é a mesma do ficheiro, por isso não há reamostragem nem efeitos secundários. Nota: descodifica o ficheiro inteiro em memória (cerca de 100 MB em float para 5 min de estéreo). É aceitável no desktop. **Substituída em §18:** os browsers cortam o MP3 descodificado em 0 dBFS; o MP3 passou a ser descodificado pelo mpg123. |
| D7 | PBKDF2 com "iterações altas" | O plano gratuito dos Workers tem um limite de **10 ms de CPU por pedido**. Com 100k iterações, o PBKDF2 pode passar desse limite e o pedido falha com o erro 1102. | Medir num Worker já em produção e usar o valor mais alto que fique abaixo de ~5 ms de CPU (provavelmente entre 10k e 30k). Guardar `password_iterations` em cada link para poder subir mais tarde. O risco fica compensado pelo token de 128 bits, que é preciso ter na mesma, e pelo rate limiting. |
| D8 | Upload por URL pré-assinado | Em desenvolvimento local, o URL pré-assinado aponta para o R2 **real**, mas o Worker local lê o R2 **simulado**, e a finalização falharia. | `createUploadTarget()`: em produção devolve um URL pré-assinado (`aws4fetch`). Localmente devolve `PUT /api/admin/dev-upload/:key`, que grava no R2 local. São cerca de 20 linhas, só ativas com `ENVIRONMENT=development`. |
| D9 | Ficheiros órfãos | Se o PUT terminar mas a finalização nunca for chamada (separador fechado, por exemplo), o objeto fica no R2 a ocupar os 10 GB. | Criar a versão com `status='pending'` quando se pede o URL. A finalização passa-a a `ready`. Um Cron Trigger diário (gratuito) apaga as versões pendentes com mais de 24 h, no R2 e no D1. |
| D10 | Polling com `last_seen` | Para que o convidado veja as mudanças de estado e as remoções, o polling precisa de saber o que mudou. | Juntar `updated_at` e `deleted_at` (soft delete) a `comments`, com um índice em `(version_id, updated_at)`: cada poll só lê as linhas alteradas. O polling pára quando o separador está escondido. |
| D11 | `wrangler.toml` | A Cloudflare recomenda `wrangler.jsonc` para projetos novos, e algumas funcionalidades novas só existem no formato JSON. | Usar `wrangler.jsonc`. |
| D12 | `wrangler dev` + Vite em separado | São dois servidores e o HMR do front-end fica separado do Worker. | Usar o **`@cloudflare/vite-plugin`**: um único `vite dev` corre o Worker no workerd (o runtime real), com D1 e R2 locais e HMR do Svelte. O `wrangler` continua a tratar das migrations, dos secrets e do deploy. |
| D13 | Armazenamento | O R2 tem 10 GB grátis. Um WAV 24 bit/48 kHz de 5 min ocupa ~86 MB, por isso cabem **~115 versões no total**. É o limite mais apertado da app. | Mostrar o espaço ocupado no painel do dono (soma de `size_bytes`), com aviso a partir dos 80%. Apagar versões antigas tem de ser fácil. Fica documentado em `limites.md`. |

## 2. Escolhas de stack (uma linha de justificação por dependência)

**Runtime**
- `hono`: router leve e tipado para o Worker (já estava no plano).
- `aws4fetch`: assina URLs S3 para o R2 (já estava no plano; ~2 KB e sem dependências).
- `jose`: verificação de JWT/JWKS do Access, auditada e sem dependências. Evita implementar à mão código de criptografia sensível. (Alternativa a considerar: o novo `ctx.access` dos Workers, se se confirmar que é preenchido em apps de Access por caminho. Testo isso na Fase 0.)
- `svelte` (v5): compilado, runtime pequeno e reatividade simples para o estado do player. **Escolho Svelte em vez de Preact.** Sem SvelteKit: um SPA simples servido pelos Static Assets.

**Desenvolvimento**
- `vite`, `@sveltejs/vite-plugin-svelte`, `@cloudflare/vite-plugin`, `wrangler`, `typescript`, `vitest` e `@cloudflare/vitest-pool-workers` (testes de integração com D1 e R2 locais).

**Sem dependência, feito à mão**
- Router do SPA (History API, ~50 linhas), parser LRC, parsers de WAV e MP3, medidor de loudness, picos da waveform, tokens, PBKDF2 e cookie HMAC (Web Crypto).
- Ícones: um subconjunto da Lucide (licença ISC) copiado como SVG inline.
- Fonte: um único ficheiro woff2 variável alojado na própria app (OFL).

## 3. Estrutura do repositório proposta

```
nectr/
├─ wrangler.jsonc              # bindings: ASSETS, DB (D1), BUCKET (R2), RATE_LIMITER, cron diário
├─ vite.config.ts              # svelte + cloudflare plugin
├─ vitest.config.ts            # 2 projetos: "unit" (node) e "worker" (pool-workers)
├─ tsconfig.json               # + tsconfig.worker.json / tsconfig.web.json
├─ index.html                  # entrada do SPA
├─ .dev.vars.example           # secrets locais (o .dev.vars fica no .gitignore)
├─ migrations/
│  └─ 0001_init.sql
├─ public/                     # _headers (CSP/nosniff para assets), manifest, ícones, fonte
├─ scripts/
│  ├─ compare-loudness.ts      # corre o ffmpeg e o nosso medidor sobre fixtures/real/* e mostra a tabela de diferenças
│  └─ r2-cors.json             # política CORS do bucket (PUT só a partir da origem da app)
├─ fixtures/                   # ficheiros pequenos gerados (WAV 16/24, extensible, float, MP3 CBR/VBR)
│  └─ real/                    # os teus ficheiros reais (no .gitignore)
├─ src/
│  ├─ shared/                  # TS puro, usado pelo Worker e pelo browser
│  │  ├─ audio/wav-header.ts   # RIFF walker, fmt PCM/EXTENSIBLE, data chunk
│  │  ├─ audio/mp3-header.ts   # ID3v2 skip, frame header, Xing/Info/VBRI
│  │  ├─ audio/validate.ts     # regras de formato e mensagens de erro em PT
│  │  ├─ lrc.ts                # parse/serialize LRC tolerante
│  │  ├─ api-types.ts          # DTOs partilhados
│  │  └─ limits.ts             # MAX_UPLOAD_BYTES=200MB, tamanhos de comentários, etc.
│  ├─ worker/
│  │  ├─ index.ts              # app Hono + scheduled() (limpeza de pendentes)
│  │  ├─ env.ts
│  │  ├─ auth/owner.ts         # getOwner(request, env), isolado
│  │  ├─ auth/share.ts         # token, PBKDF2, cookie HMAC, rate limit
│  │  ├─ routes/admin/         # projects, tracks, versions (upload/finalize), links, comments, lyrics, audio
│  │  ├─ routes/share.ts       # /s/:token/* (página, API do convidado, áudio, download, artwork)
│  │  └─ lib/                  # r2-range.ts, upload-target.ts, ids.ts, headers.ts, db.ts
│  └─ web/
│     ├─ main.ts, App.svelte, router.ts
│     ├─ styles/               # tokens.css (tema escuro/claro), base.css
│     ├─ lib/                  # api.ts, format.ts (números/datas pt-PT), prefs.ts (localStorage)
│     ├─ audio/                # loudness.ts, peaks.ts (puros, testados em Node), analysis.worker.ts,
│     │                        # mp3-decode.ts, upload.ts (XHR com progresso)
│     ├─ player/               # Player, Waveform (canvas), Transport, ABSwitch, Metrics, Lyrics
│     ├─ comments/             # Thread, Composer, Markers
│     ├─ admin/                # Library, Project, Track, Revisions, LinkEditor, LyricsEditor, Help
│     └─ share/                # SharePage, PasswordGate, NeutralPage
├─ test/integration/           # upload → finalize → range → comments → links
└─ docs/
   ├─ plano.md                 # este plano + o original
   ├─ setup.md                 # passos manuais na Cloudflare
   ├─ limites.md
   └─ testes-manuais.md        # checklist Safari iOS / Chrome / Firefox
```

Os testes unitários ficam ao lado do código que testam (`*.test.ts`).

## 4. Rotas e fronteiras de segurança

- `/` é público: uma página simples ("nectr"), sem listar nada.
- `/admin/*` (SPA) e `/api/admin/*` são protegidos pelo Access na edge. O Worker valida o JWT em `getOwner()` mesmo assim (defesa em profundidade) e confirma que o `email` é igual a `OWNER_EMAIL`. Localmente, a validação só é contornada se `ENVIRONMENT=development` **e** o host for `localhost`. Se a sessão do Access expirar a meio de um pedido, a UI mostra "Sessão expirada — recarregar".
- Tudo o que é do convidado fica sob **`/s/:token/*`** (página, `api/…`, `audio/:versionId`, `download/:versionId`, `artwork`). O Worker corre primeiro para `/s/*` (`run_worker_first`). Assim, o cookie da password pode ter `Path=/s/<token>`, e um link inválido, expirado ou revogado recebe do servidor sempre a mesma página neutra, com 404.
- Os assets estáticos são servidos sem passar pelo Worker (não contam para o limite de pedidos). Os cabeçalhos de segurança vão no `public/_headers`. As respostas do Worker recebem os mesmos cabeçalhos por middleware.
- O streaming lê do R2 com `range` e responde `206`, com `Content-Range`, `Accept-Ranges: bytes`, `Content-Type` correto, `Cache-Control: private` e `Content-Disposition: inline`. O download é um endpoint separado (`attachment`, com nome limpo "Artista - Título (v3 — vocals up).wav"). O `r2_key` nunca é exposto.

## 5. Ajustes ao modelo de dados (sobre o §4 do plano)

- `versions`: + `status` (`pending`|`ready`, ver D9). Os picos ficam em `peaks_json` como inteiros quantizados entre -127 e 127 (≈1500 pares min/max, ~15 KB).
- `comments`: + `updated_at`, `deleted_at` (D10) e + `guest_id`, um id aleatório guardado no browser do convidado para identificar os comentários dele (editar e apagar os próprios, ver o estado dos próprios pedidos).
- `share_links`: + `password_iterations` (D7), + `version_mode` (`all`|`latest`|`selected`, ver §10.3).
- Índices extra: `comments(version_id, updated_at)`, `comments(link_id)`, `share_link_versions(version_id)`.
- IDs: base64url aleatório com 12 caracteres (`crypto.getRandomValues`). Tokens de link com 128 bits.

## 6. Decisões assumidas (diz-me se alguma não te serve)

1. Só ficheiros **mono ou estéreo**. Os multicanal são rejeitados com uma mensagem clara (o LUFS em surround precisa de pesos por canal).
2. **A/B com mais de 2 versões**: escolhes A e B; a tecla `B` alterna entre as duas; as teclas `1` a `9` saltam diretamente para a versão n.
3. O convidado tem de indicar o nome antes do 1.º comentário (fica guardado no `localStorage`). Pode editar ou apagar os próprios comentários. **Só o dono muda estados** (open/done/wontfix).
4. Artwork: redimensionado no browser antes do upload (canvas → JPEG/WebP com 1200 px). Não se usa o Cloudflare Images, que é pago.
5. O link de projeto inteiro mostra a tracklist (vista de álbum), com reprodução seguida das faixas. O A/B funciona dentro da mesma faixa.
6. Formatação pt-PT (`−14,2 LUFS`, datas `13/10/2026`). As mensagens de erro da API vêm já em português.
7. Rate limiting com o binding da Cloudflare: password 5 tentativas/60 s por IP+link, comentários 10/60 s. É aproximado (sincroniza com alguns segundos de atraso), mas chega para travar força bruta.
8. **Mockup antes da UI**: no início da Fase 1, faço um mockup estático (biblioteca, player com waveform e comentários, página do convidado) para aprovares a direção visual antes de construir os componentes.

## 7. Direção visual (resumo)

- Tema escuro por defeito. A cor do projeto funciona como acento: um gradiente subtil a partir do artwork ou da cor, e na waveform tocada.
- Cartões arredondados, muito espaço e tipografia grande nos títulos.
- Waveform grande, com os marcadores de comentário como pontos com as iniciais do autor, e uma barra de reprodução fixa em baixo.
- Revisões ao estilo Filepass: lista limpa, filtros claros e estado bem visível.
- Tema claro opcional por variáveis CSS (`[data-theme=light]`).
- Contraste AA, foco visível, navegação completa por teclado.

## 7b. UI no telemóvel (prioridade: comentar em timestamps com facilidade)

Os clientes vão ouvir sobretudo no telemóvel. Por isso, a página do convidado e o player são desenhados **mobile-first desde a Fase 1**, e não adaptados só no fim. Em desktop, o mesmo layout ganha um painel lateral.

**Layout (largura < 768 px)**
- No topo: artwork e títulos compactos.
- No meio: a waveform larga, com altura suficiente para o toque.
- Por baixo: separadores **Comentários · Letra · Info**.
- Em baixo: uma barra fixa com play/pause, o tempo, o A/B e o botão de comentar. Respeita `env(safe-area-inset-bottom)`.

**Gestos na waveform**
- Tocar faz seek.
- Arrastar faz scrub, com uma bolha a mostrar o tempo por cima do dedo.
- **Pressão longa abre um comentário nesse ponto.**
- Os marcadores têm uma área de toque de 44 px. Tocar num marcador abre esse comentário.

**Comentar em 1 toque**
- O botão grande "Comentar" na barra **captura o tempo atual no instante do toque**.
- Abre-se uma bottom sheet com:
  - o timestamp num chip editável: botões −1 s / +1 s, ou arrastar a waveform;
  - a opção "marcar fim" para comentar um intervalo;
  - o campo de texto e "Enviar".
- O nome é pedido na própria sheet, só no 1.º comentário.

**Teclado e reprodução**
- A sheet acompanha o teclado virtual (`visualViewport`), para o campo nunca ficar tapado.
- Por defeito, a reprodução **pausa enquanto escreves e retoma ao enviar**. Pode ser desligado nas preferências.

**Outros pormenores**
- Media Session API (API do browser, sem dependência): controlos no ecrã bloqueado com título, artista e artwork.
- Alvos de toque com ≥ 44 px, sem depender de hover e sem atalhos que só funcionem com teclado.
- Os atalhos de teclado continuam disponíveis em desktop.

**Dono no telemóvel**
- A biblioteca, a checklist de revisões (marcar como feito) e as respostas a comentários também funcionam no telemóvel.
- O upload a partir do telemóvel é possível, mas o caso principal é o desktop. A análise de MP3 descodifica o ficheiro inteiro em memória e pode ser pesada num telemóvel.

**Mockup**: o mockup do início da Fase 1 inclui as vistas de telemóvel: player do convidado, sheet de comentário aberta e lista de comentários.

## 8. Fases (resumo de execução; detalho cada uma quando lá chegar)

- **Fase 0, Setup**
  - Fica pronto: `git init`, package.json, configurações, o Worker Hono com `/api/health` e `/api/admin/me` (`getOwner` + `jose`), um SPA mínimo (`/`, `/admin` mostra "Olá, <email>", `/s/:token` mostra a página neutra), `docs/setup.md`, vitest com 1 teste unitário e 1 de integração (`getOwner` rejeita JWT ausente ou inválido).
  - **Passos manuais teus**, que peço na altura: conta Cloudflare, R2 ativo, bucket `nectr-audio`, token S3 do R2 restrito ao bucket, base de dados D1 `nectr`, organização Zero Trust e app Access (para os caminhos `/admin*` e `/api/admin*` no hostname workers.dev, só o teu email), subdomínio workers.dev da conta.
  - Secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `COOKIE_SECRET`. Vars: `ACCOUNT_ID`, `R2_BUCKET`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `OWNER_EMAIL`, `APP_ORIGIN`.
  - O hostname é `*.workers.dev` com os preview URLs desligados. O critério de aceitação inclui confirmar que `/admin` e `/api/admin/me` pedem login e que `/` e `/s/x` são públicos. Se o Access por caminho não funcionar em workers.dev, passo ao plano B (§10.1) e aviso-te antes.
- **Fase 1, Núcleo**: migration 0001, CRUD de projetos/faixas/versões, upload (URL pré-assinado + XHR + Web Worker de análise com metadados e picos), finalize com validação, player com waveform e seek, streaming com Range, links (password, validade, versões, 3 interruptores), aviso honesto sobre downloads e medidor de espaço ocupado.
- **Fase 2, Feedback**: comentários e respostas, marcadores, polling, checklist de revisões, estados e `resolved_in_version_id`, estado visível para o convidado. Inclui o fluxo mobile do §7b: botão "Comentar" com o tempo capturado, pressão longa na waveform, bottom sheet e pausa ao escrever. **Critério extra:** um convidado num iPhone comenta num timestamp com 1 toque + texto + enviar, sem o teclado tapar o campo.
- **Fase 3, A/B e loudness**: elementos `<audio>` por versão e troca com posição mantida; o medidor TS ligado à UI; `scripts/compare-loudness.ts` corrido sobre 3-4 ficheiros teus. **Se a tolerância falhar, paro e aviso-te.** (O medidor pode ser escrito e testado mais cedo, na Fase 1, porque o upload já calcula a análise. Os valores só aparecem na UI depois de validados.)
- **Fase 4, Letras**: parser LRC, vista sincronizada, interruptores, editor tap-to-sync, import/export.
- **Fase 5, Acabamento**: PWA (o service worker nunca guarda áudio em cache), estados vazios e de erro, revisão final do responsivo (que já é construído mobile-first desde a Fase 1), acessibilidade, ajuda.

Cada fase é feita com commits pequenos (em inglês) e termina com um resumo do que foi feito, testado e deixado pendente.

## 9. Verificação

- **Unitários** (vitest/node): parser WAV (16/24, extensible, float rejeitado, chunks antes do `fmt `), parser MP3 (CBR, VBR Xing, ID3 grande), validação, LRC, picos, medidor de loudness (seno de 1 kHz a -23 dBFS dá -23,0 LUFS; sinais das Tech 3341/3342), tokens, PBKDF2 e cookie HMAC.
- **Integração** (pool-workers, D1 e R2 locais): presign/dev-upload → finalize (aceita e rejeita) → GET com `Range: bytes=0-1` e intervalos a meio (206 com cabeçalhos corretos) → links (password, cookie, expirado/revogado dão 404 neutro, download desligado não tem endpoint nem `attachment`) → comentários e polling.
- **Loudness**: `npx tsx scripts/compare-loudness.ts fixtures/real` mostra uma tabela "nosso vs ffmpeg" com o delta; todos têm de ficar em ±0,1 LU (I) e ±0,2 dB (TP).
- **Manual**: `docs/testes-manuais.md`, com seek e A/B no Safari iOS, Chrome e Firefox, incluindo WAV 24 bit extensible no Firefox. Inclui também o fluxo de comentário no telemóvel (iPhone Safari e Android Chrome): botão "Comentar", pressão longa, sheet com o teclado aberto, pausa e retoma, controlos no ecrã bloqueado.
- **Layouts**: verifico cada ecrã no browser integrado com emulação de telemóvel (375×812) e de desktop, e ainda nos temas claro e escuro.
- **Limites**: `docs/limites.md`, com o consumo estimado por funcionalidade (um seek são vários pedidos Range; o polling pára com o separador escondido; o R2 fica cheio com ~115 WAV).

## 10. Dúvidas respondidas

1. **Domínio: `*.workers.dev`** (ex.: `nectr.<conta>.workers.dev`). Origem do CORS: `https://nectr.<conta>.workers.dev`. Desligo os preview URLs (`preview_urls: false`).
   - **Risco a validar na Fase 0:** confirmar que uma app de Access self-hosted protege **só os caminhos** `/admin*` e `/api/admin*` num hostname workers.dev.
   - **Plano B**, se não proteger: dois Workers no mesmo repo (`nectr`, público, e `nectr-admin`, protegido por inteiro pelo Access), a partilhar os mesmos D1 e R2. O `getOwner()` não muda.
2. **Comentários: todos os da versão.** Quem tem acesso a uma versão vê os comentários de todos os links e os do dono, com o nome do autor. O `link_id` só fica visível para o dono (para saber de que link veio cada comentário). Se um link tiver `allow_comments` desligado, não mostra nem aceita comentários: é um link "só para ouvir".
3. **Links: modo por link.** `share_links.version_mode` = `all` | `latest` | `selected`.
   - `all`: todas as versões `ready` (de todas as faixas, num link de projeto).
   - `latest`: a versão mais recente de cada faixa.
   - `selected`: usa `share_link_versions`.
   - As versões novas aparecem automaticamente nos dois primeiros modos.
4. **GitHub privado + deploy manual** (`npm run deploy`). Na Fase 0 verifico se o `gh` está instalado e autenticado. Peço confirmação antes de criar o repositório remoto e antes do primeiro push.

## 11. Decisões de UI (mockup v2, 13/10/2026)

Referência visual: [docs/mockup/nectr-mockup.html](mockup/nectr-mockup.html). A biblioteca foi aprovada tal como está.

### Página do projeto (dono)

- Abre numa **lista detalhada das faixas**, com as colunas: nº, nome, duração, formato, sample rate, LUFS-I, true peak, data de atualização, versão, pedidos abertos e menu. Os valores são os da versão mais recente.
- A célula da versão (por exemplo `v3 / 3`) abre um **painel lateral à direita** com o histórico de versões. Cada versão mostra:
  - os metadados condensados e as notas;
  - os comentários;
  - as ações Ouvir e Descarregar original.

  No fim do painel há uma zona para carregar uma nova versão.
- Clicar numa faixa troca a lista pelo **player**:
  - a lista de faixas fica à esquerda;
  - a waveform não tem caixas de métricas: os metadados do ficheiro e o loudness aparecem **numa linha compacta** por cima das versões;
  - os **comentários ficam por baixo da waveform**.
- **Não há botão A/B.** Mudar de versão durante a reprodução mantém a posição. As teclas 1–9 escolhem a versão.

### Partilha

- A validade é "Sem validade" por defeito.

### Notas de voz nos comentários (Fase 2)

- O convidado e o dono podem comentar por escrito **ou com uma nota de voz até 1 minuto**, presa ao mesmo timestamp (ou intervalo).
- **Gravação no browser** com `MediaRecorder`, sem dependências:
  - Formato preferido: `audio/mp4` (AAC), suportado pelo Safari e pelo Chrome 126+.
  - Alternativa: `audio/webm;codecs=opus` (Firefox).
  - É obrigatório testar a reprodução cruzada no `testes-manuais.md`: uma nota gravada no Firefox, ouvida no Safari iOS.
- **Limites**: 60 s, cortados no cliente e validados no Worker pelo tamanho; máximo de 1,5 MB por nota.
  - Upload pelo Worker (é pequeno, não precisa de URL pré-assinado), para `voice/<commentId>.<ext>` no R2.
  - Streaming pela mesma rota com Range, com as mesmas regras de token/password.
- **Modelo de dados**: `comments` passa a ter `voice_key`, `voice_mime` e `voice_duration_s`. O `body` pode ficar vazio se houver nota de voz.
- **Custo**: 1 min ocupa ~0,5 MB. É desprezável para os 10 GB do R2, mas entra na conta do medidor de espaço.
- **Rate limit**: igual ao dos comentários.
- **Ideia para depois (fora do âmbito)**: transcrição automática com Whisper no Workers AI, que tem uma quota diária gratuita.

### Cliente (convidado)

- Um link de projeto abre na **lista de faixas** (vista de álbum) com:
  - a versão mais recente de cada faixa, a duração e o número de comentários;
  - o botão "Ouvir tudo";
  - um mini-player em baixo.

  Tocar numa faixa abre o player.
- Um link de faixa abre diretamente no player.

### Ajustes do mockup v3

- **Waveform detalhada**:
  - É desenhada coluna a coluna com picos min/max, em vez de barras.
  - Botões **−/+ de zoom** (1×, 2×, 4×, 8×, 16×). Com zoom, a waveform faz scroll horizontal, segue a cabeça de leitura durante a reprodução e dá para a arrastar.
  - Só a parte visível é desenhada no canvas, para não criar canvases gigantes.
  - **Desvio ao plano original**: o zoom precisa de mais resolução do que ≈1500 pontos. Proposta:
    - **~16 000 pares min/max por versão**, em int8 e codificados em base64 (~44 KB por versão);
    - guardados numa coluna `peaks` no D1 (o limite por linha é 2 MB);
    - uma leitura continua a contar como uma única linha.
- **Controlos do player**, centrados:
  - voltar ao início, recuar, play/pausa, avançar;
  - zoom −/+ à direita.

  Os atalhos de teclado continuam a funcionar, mas não aparecem na interface.
- **Comentários** numa só coluna, por baixo da waveform.
- **Campo de comentário sempre visível** (dono e convidado), ao estilo WhatsApp:
  - **Tempo no próprio campo**: segue a música até se começar a escrever. Um toque fixa o início, um segundo marca o fim (intervalo) e um terceiro volta ao tempo atual.
  - **Microfone quando o campo está vazio, enviar quando há texto**:
    - no telemóvel, manter premido para gravar e largar para enviar; arrastar para a esquerda bloqueia a gravação, e aparecem os botões apagar e enviar;
    - no desktop, um clique começa a gravar já em modo bloqueado.
  - **Reprodução**: escrever não pausa a música; gravar uma nota de voz pausa.
  - **Nome do convidado**: pedido na primeira vez que envia e guardado no `localStorage`.
- **Teclado no telemóvel**:
  - A barra de controlos sobe acima do teclado: meta viewport `interactive-widget=resizes-content` (Android) e `visualViewport` (iOS).
  - Os botões de controlo fazem `preventDefault()` no `mousedown`/`pointerdown`, para não tirarem o foco ao campo nem fecharem o teclado.

### Ajustes do mockup v4

- **Pastas dentro dos projetos**, para álbuns, versões ao vivo, demos ou singles:
  - Cada pasta tem nome, **ícone** (um conjunto próprio de 12) e **cor** (8 opções).
  - Uma pasta pode ter subpastas.
  - Na página do projeto, as pastas aparecem como cartões por cima da tabela, com navegação por "migalhas". O convidado vê-as como secções na lista de faixas.
  - Um link de partilha pode ser de **uma faixa, uma pasta ou o projeto inteiro**.
  - Modelo de dados:
    - nova tabela `folders` (id, project_id, parent_id, name, icon, color, position, created_at);
    - `tracks.folder_id` (nulo = raiz do projeto);
    - `share_links.folder_id`.
- **Colunas da lista detalhada**:
  - Reordenáveis (arrastar o título) e redimensionáveis (arrastar a margem), com o botão "Repor colunas".
  - A preferência fica guardada no `localStorage` do dono, por dispositivo.
  - No produto, o reordenar usa pointer events, para funcionar também em ecrãs táteis.
- **Identidade do convidado, por dispositivo**:
  - O nome é pedido **ao entrar no link pela primeira vez** e nunca mais, porque fica guardado no dispositivo. Dá para mudar mais tarde ("A comentar como … · Mudar").
  - Modelo de dados: nova tabela `guests`, com id, link_id, name, secret_hash, created_at e last_seen_at.
  - O browser guarda o id e um segredo aleatório (128 bits). O segredo só permite editar e apagar os comentários feitos nesse dispositivo.
  - `comments.guest_id` substitui o `author_name` solto. Assim, uma mudança de nome atualiza todos os comentários desse dispositivo.
- **Convidado no computador**, em três colunas que se reorganizam em ecrãs mais estreitos:
  - à esquerda, o artwork e a lista de faixas agrupada por pastas;
  - ao centro, o player, o campo de comentário e os comentários;
  - à direita, a letra sincronizada e "Sobre esta versão" (as notas do dono).
  - Não há controlos de dono e as notas privadas do dono não aparecem.
- **Notas de voz**: a bolha ocupa só a largura do conteúdo. O play passa a pausa enquanto toca.
- **Enviar fecha o teclado** no telemóvel (o campo perde o foco).
- **Zoom**: durante a reprodução, a cabeça de leitura anda até ao meio da vista, a partir daí é a waveform que faz scroll e, no fim, a cabeça segue até à borda direita, sem saltos. Se o utilizador fizer scroll à mão, o seguimento pausa 2,5 s.

### Ajustes do mockup v5

- **Upload**:
  - **Arrastar ficheiros ou pastas para a janela.** Aparece um aviso a dizer onde vão ficar: no projeto, na pasta aberta, numa pasta da lista ou, se largados em cima de uma faixa, como **versão nova dessa faixa**. No ecrã do player, largar cria uma versão nova da faixa aberta.
  - O botão **"+"** abre um menu: "Upload de música" (vários ficheiros), "Upload de pasta" (todas as músicas de uma pasta do computador, incluindo subpastas, que viram uma pasta no projeto) e "Nova pasta".
  - A validação lê o cabeçalho logo no browser e rejeita com uma mensagem clara: WAV float ou de 8/32 bit, multicanal, ficheiro corrompido ou maior do que 200 MB. Os ficheiros que não são WAV/MP3 são ignorados, com aviso.
  - Uploads em paralelo, cada um com barra de progresso e o estado "A analisar".
- **Seleção múltipla**:
  - arrastar um retângulo, como no Windows;
  - Ctrl/⌘+clique para juntar à seleção, Shift+clique para um intervalo, Ctrl+A para tudo;
  - um clique simples continua a abrir a faixa.

  Aparece uma barra com "Mover para…" e "Apagar".
- **Apagar**:
  - Com Delete (ou Backspace), um pedido de confirmação diz o que é apagado com as pastas, e depois um aviso com **Anular**.
  - No produto, o apagamento é *soft delete*: as faixas e as pastas ficam marcadas como apagadas e um Cron Trigger diário apaga de vez os objetos do R2 passados 7 dias.
  - Os links para coisas apagadas deixam de funcionar e de aparecer.
- **Pastas numa lista própria** por cima das faixas (nome com ícone e cor, número de faixas, duração total, data de atualização), só quando existem.
- **Tabela**: as colunas ajustam-se ao conteúdo e o nome ocupa o resto. Dá para reordenar arrastando o título; não dá para redimensionar. Saíram "Repor colunas" e "Ouvir tudo".
- **Waveform** sem scrollbar visível; anda-se arrastando.
- **Barra lateral**: "Biblioteca" é uma árvore colapsável de projetos e pastas (com subpastas).
- **Página "Links"**, separada da janela de partilha:
  - todos os links, com os filtros Ativos, Expirados e Revogados;
  - interruptores por link (download, letra, comentários);
  - validade: prolongar 7 ou 30 dias, sem validade ou escolher uma data; um link expirado reativa-se pelo mesmo controlo;
  - copiar, revogar com Anular, e reativar.
  - A janela "Partilhar" serve só para criar links e mostra apenas um resumo, com a ligação "Gerir links".
- **Convidado**:
  - O nome aparece só como "Marta" sublinhado, na linha do número de faixas; tocar nele permite mudá-lo.
  - Mudar o nome atualiza também os comentários e as respostas já feitos nesse dispositivo (`guests.name`, com os comentários a referenciar `guest_id`).
  - Na lista de faixas, o balão de comentários aparece sempre, mesmo com zero, para indicar que dá para entrar e comentar.

### Ajustes do mockup v6

- **Cabeçalho do projeto**:
  - **lápis** no canto superior direito, que abre "Editar projeto": capa (JPG/PNG/WebP, reduzida para 1200 px no browser), nome, artista, ano, editora, descrição (aparece nos links) e cor do projeto (dá o tom ao cabeçalho, à waveform e à página do convidado);
  - o botão **"+"** tem o estilo dos restantes botões;
  - **"Ver como convidado"** passa a um botão redondo com um olho, fixo no canto inferior direito, com tooltip.
- **Faixas e pastas**:
  - **Arrastar uma linha muda a ordem** dentro da sua lista. A ordem fica guardada (`tracks.position` / `folders.position`).
  - Largar uma faixa (ou as faixas selecionadas) **numa pasta da lista ou da barra lateral move-a** para lá; largar no nome do projeto devolve-a à raiz. As pastas também se movem para dentro de outras pastas pela barra lateral. Há sempre um aviso com Anular.
  - O **retângulo de seleção só começa fora das linhas** (margens ou espaço por baixo da tabela).
  - Saiu a frase de ajuda por cima da tabela.
- **Barra lateral**: os projetos aparecem só com o nome, sem capa.
- **Links**: colunas de largura fixa (Link, Permissões, Validade, Ações), com cabeçalho, para tudo ficar alinhado. As ações ficam "Copiar", "Editar" e "Revogar".
- **Convidado no computador**: o nome volta à barra de topo ("A comentar como Marta", com o nome sublinhado para mudar). No telemóvel fica como estava.
- **Nota técnica**: na app real, os elementos fixos (o olho e a barra de seleção) usam `position: fixed` ou `sticky` sem nenhum antepassado com `overflow: hidden`, que é o que estraga o `sticky`.

### Ajustes do mockup v7

- **Cores**:
  - 12 cores por projeto, por ordem de matiz (vermelho, coral, laranja, âmbar, lima, verde, verde-água, ciano, azul, índigo, violeta, rosa). As pastas usam as mesmas 12 e ainda um cinzento neutro.
  - Dentro de um projeto, e nas páginas do convidado, os botões e os destaques (play, enviar, interruptores, seleção, etiquetas) usam a **cor do projeto**. O texto por cima fica escuro ou branco, conforme o que contrasta mais (luminância WCAG).
  - Fora dos projetos (barra lateral, biblioteca, revisões, links), o destaque continua a ser o amarelo do tema.
  - Implementação: um token `--accent`, que dentro de `.proj-scope` passa a valer `--proj-main`.
- **"Ver como convidado"**: o olho fica no fundo da página, à direita, sem se sobrepor ao conteúdo.
- **Versões**: clicar na versão de uma faixa abre as versões **por baixo da faixa**, com as mesmas colunas, a mais recente primeiro (etiqueta "Atual") e uma linha "Adicionar versão" no topo. Clicar numa versão abre o player nessa versão. Largar um ficheiro numa destas linhas cria uma versão nova. O painel lateral de versões desapareceu.
- **Partilhar** depende do sítio de onde se clica:
  - na página de uma faixa: partilha a faixa, com a opção de partilhar a pasta onde ela está;
  - dentro de uma pasta: partilha a pasta inteira;
  - na raiz do projeto: partilha o projeto inteiro.

  Só uma faixa permite escolher versões uma a uma. Fechar a janela volta ao ecrã de onde se veio.

### Ajustes do mockup v8

- **Perfil do dono**: o bloco do dono na barra lateral abre uma janela com:
  - **Perfil**: foto (reduzida no browser), nome (o que os clientes veem nas tuas respostas, em vez de "Produtor") e o email de acesso, só de leitura (vem do Cloudflare Access).
  - **Resumo**: projetos, faixas, versões e notas de voz; espaço no R2 por tipo (áudio, notas de voz, capas) e espaço livre.
  - **Por fazer**: pedidos abertos por projeto, links que expiram nos próximos 7 dias e links ativos.
  - **Uso do plano gratuito**: pedidos ao Worker, leituras e escritas no D1, leituras no R2. Na app real, estes números vêm da API de análise GraphQL da Cloudflare, com um token só de leitura e gratuito (mais um secret). É opcional.
  - Modelo de dados: tabela `owner_profile` (uma linha: nome, photo_key).
- **Movimento**:
  - as páginas entram com fade e um pequeno deslize (0,34 s);
  - as janelas aparecem com fade e um ligeiro *pop*;
  - o menu "+", a barra de seleção e os avisos animam ao aparecer;
  - as versões deslizam ao abrir;
  - mudar de pasta anima a lista.
  - Tudo em CSS (keyframes e transições), sem bibliotecas, e respeita `prefers-reduced-motion`.
- **Telemóvel**:
  - A lista de faixas e o player **deslizam um sobre o outro** (estilo iOS): o player entra pela direita e a lista recua.
  - O **logótipo e o nome da app** aparecem no topo das páginas da password e da lista de faixas, mas não no player.
  - Saiu o "Ouvir tudo".
- **Convidado no computador**:
  - Em janelas mais estreitas, o player **fica ao lado da lista de faixas** e encolhe com a janela; só em ecrãs de telemóvel passa a uma coluna.
  - A letra fica numa **barra lateral**: em janelas largas está aberta e pode esconder-se com o botão "Letra"; em janelas estreitas abre por cima, como uma gaveta.

### Ajustes do mockup v9

- **Telemóvel, lista de faixas**: o logótipo e o nome ficam centrados dentro do cabeçalho do álbum, como na página da password, sem barra própria por cima.
- **Convidado no computador, painel lateral** ("Sobre esta versão" e "Letra"):
  - Aberto: tem um botão **›** para o recolher.
  - Recolhido: fica uma **barra estreita** (48 px) à direita, com **‹** e o texto vertical "Sobre esta versão · Letra"; clicar em qualquer ponto da barra volta a abri-lo.
  - Em janelas estreitas (≤ 1200 px), o painel **recolhe sozinho** para essa barra, em vez de ficar por cima do player. Cruzar esse limite devolve-o ao modo automático (`matchMedia`). Mesmo estreito, dá para o abrir à mão; nesse caso fica ao lado e o player encolhe.
  - Saiu o botão "Letra" do título do player.

### Ajustes do mockup v10

- **Waveform**: redesenha-se sempre que a sua própria caixa muda de largura (`ResizeObserver` em cada waveform). Assim acompanha o painel lateral a abrir ou a recolher, sem precisar de zoom.
- **Telemóvel, lista de faixas**: mais margem no topo, como na página da password.
- **Dono no telemóvel** (a mesma app, adaptada):
  - Uma **barra de separadores em baixo**: Biblioteca (com a árvore projeto → pasta → faixa), Revisões (com o contador de abertos), Links e Perfil (a tua foto). Substitui a barra lateral.
  - **Biblioteca**: projetos em grelha de 2 colunas, espaço no R2 e atividade recente.
  - **Projeto**: capa, nome e lápis; "Partilhar", "+" e "ver como convidado"; pastas e faixas em lista, com a versão, a duração e o LUFS.
  - **Faixa**: ecrã inteiro sem a barra de separadores, com as métricas condensadas, as versões, a waveform, o campo de comentário e os comentários com "Marcar como feito"; os controlos ficam em baixo.
  - **Revisões**: pedidos abertos por faixa, e um toque no círculo marca como feito.
  - **Navegação**: as páginas deslizam (biblioteca → projeto → faixa); mudar de separador não desliza.
  - No projeto e na faixa, os destaques usam a cor do projeto; o resto usa o amarelo do tema.
- **Movimento**: a primeira apresentação da página é estática e só a navegação posterior anima. Assim, a página nunca aparece a meio de uma animação (miniaturas, aparelhos lentos).

### Ajustes do mockup v11

- **Voltar atrás no telemóvel**:
  - **No mockup**: o "‹ Biblioteca" estava dentro do conteúdo e desaparecia ao fazer scroll. Passou a uma **barra de topo fixa** (no dono e no convidado) e há também um gesto de arrastar a partir da borda esquerda.
  - **Na app real**: cada página tem o seu URL (History API), por isso o **gesto ou botão de voltar do próprio telemóvel** funciona (incluindo o deslize do iOS), além da barra de topo.
- **Dono no telemóvel**:
  - Sai o espaço no R2 da Biblioteca (já está no Perfil).
  - No fundo do Perfil aparecem o logótipo e o nome da app.
  - Sai o botão "ver como convidado".
- **Responder a comentários**:
  - Cada comentário tem **"Responder"** (dono e convidado), e no dono também "Marcar como feito".
  - Ao responder, o **tempo no campo passa a ser o do comentário** (ou o intervalo) e aparece uma faixa "A responder a Marta aos 0:18", com × para cancelar.
  - O comportamento é igual no computador.
- **Telemóvel, zoom**: os botões −/+ passam para a **linha das versões**, alinhados à direita. Se houver muitas versões, a linha faz **scroll horizontal com o dedo** e nunca passa por cima dos botões.
- **Repetir**: um botão de **loop** à direita dos controlos (telemóvel e computador). Ligado, a faixa recomeça do início quando chega ao fim.

### Ajustes do mockup v12

- **"✓ Feito"** substitui "Marcar como feito" nos botões dos comentários (computador e telemóvel). Num pedido já feito, o botão continua a dizer "Reabrir".
- **Separadores no dono (telemóvel)**:
  - **Erro no mockup**: depois de visitar um separador, já não se conseguia voltar ao anterior.
  - **Causa**: a animação de entrada mantinha o último estado (`animation-fill-mode: both`). Isso deixava a página visitada por cima das outras.
  - **Correção**: a animação deixou de reter o estado final, e mudar de separador limpa a animação anterior.
  - **Regra para a app real**: as animações de entrada nunca guardam o estado final em páginas que podem ficar escondidas. A visibilidade é sempre decidida pela classe ou pelo estado da página.

### Ajustes do mockup v13

- **Dono no telemóvel, Faixa**: a página ganha os separadores **Comentários · Letra · Info**, como no convidado.
  - As métricas (formato, LUFS, LRA, TP) saem do topo e vão para "Info", junto com a versão, a data e as notas. "Editar notas" também fica aí.
  - "Letra" mostra a letra sincronizada, com um botão "Editar" (o editor é da Fase 4).
  - Os separadores ficam presos logo abaixo da barra de voltar quando se faz scroll.
- **Computador, Faixa**: ao abrir uma faixa, a **barra lateral recolhe-se**. Fica só o logótipo, uma seta "›" para a abrir e os ícones de Biblioteca, Revisões (com o contador) e Links, sem os nomes, com tooltip ao passar o rato. O avatar do perfil continua em baixo.
  - Aberta na página da faixa, a barra mostra "‹" para voltar a recolher.
  - Mudar de faixa mantém a escolha. Voltar à faixa vindo de outro ecrã recolhe-a outra vez.
- **Computador, Faixa**: o painel lateral **"Sobre esta versão · Letra"** do convidado também aparece aqui.
  - Recolhe-se num trilho estreito com o texto na vertical, e recolhe-se sozinho em janelas estreitas.
  - O dono tem ainda "Editar notas", "Editar" (letra) e "Adicionar letra" quando a faixa ainda não tem letra.

### Ajustes do mockup v14

- **Janela do dono (computador)**: a barra lateral tem sempre a altura da janela, com o perfil fixo em baixo. Só o conteúdo à direita faz scroll.
  - Na app real, a barra fica com `height: 100dvh` e posição fixa, e só a área principal tem scroll.
  - As janelas de diálogo (partilhar, pastas, perfil) passam a cobrir apenas a área visível.
- **Letra no telemóvel** (convidado e dono): deixa de ocupar o ecrã todo.
  - Aparece dentro do separador, como os comentários e a info. O topo, a waveform e o campo de comentário continuam visíveis.
  - A linha atual acompanha a música dentro de uma caixa própria, sem fazer scroll à página.
- **Notas do dono, privadas ou públicas**: no campo de comentário do dono há um botão "Privada" / "Pública" (no telemóvel só o ícone 🔒/👁). O texto do campo diz o que vai acontecer.
  - **Privada**: só o dono vê.
  - **Pública**: os convidados com acesso à versão também veem, com o nome do dono.
  - Uma nota nova usa a última escolha. Uma resposta a um comentário começa como pública, mas pode passar a privada.
  - Nas listas do dono, cada nota mostra "nota privada" ou "pública".
- **Modelo de dados**: `comments.is_private INTEGER NOT NULL DEFAULT 0`, válido para comentários e respostas.
  - Só o dono pode pôr 1. Os comentários dos convidados são sempre 0.
  - A API do convidado filtra `is_private = 0` na própria query SQL. Uma nota privada nunca sai do Worker para um link de partilha, nem nos polls.

### Ajustes do mockup v15

- **Responder a respostas**: cada mensagem de uma conversa tem "Responder", e não apenas o comentário de cima. Assim, o convidado pode responder ao que o dono disse e o dono pode responder de volta.
  - A resposta entra na **mesma conversa**, que tem só um nível e fica por ordem cronológica. A faixa no campo indica a quem se responde ("A responder a Produtor aos 0:18").
  - Nas tuas próprias mensagens não aparece "Responder".
  - Na app real, uma resposta a uma resposta grava o `parent_id` do comentário de topo. Não há árvores profundas.

## 12. Fase 1 — implementação (15/10/2026)

O que ficou feito, o que mudou em relação ao plano e o que fica para as fases seguintes.

### Feito

- **Modelo de dados** (`migrations/0001_init.sql`): perfil do dono, projetos, pastas, faixas, versões (`pending`/`ready`, picos), links e versões por link. Apagar é sempre *soft delete*. As tabelas dos comentários e dos convidados entram com a Fase 2 (`0002`).
- **Validação de áudio partilhada** (`src/shared/audio`): o mesmo código corre no browser (antes do upload) e no Worker (na finalização, a ler o cabeçalho do R2).
- **API do dono**: projetos, pastas, faixas e versões; capa e foto; apagar com anular; mover; reordenar; upload pré-assinado e finalização; streaming com Range; download com nome limpo; limpeza diária (cron).
- **Links e convidado**: password PBKDF2 com cookie HMAC por link, limite de tentativas, modo de versões, validade, revogar, interruptores, página neutra para tudo o que não é válido.
- **Interface do dono**: biblioteca, projeto (tabela, pastas, versões por baixo da faixa, seleção, arrastar, menu +, largar ficheiros em qualquer lado), faixa (forma de onda com zoom, transporte, versões), partilha, links, perfil. Layout próprio no telemóvel.
- **Convidado**: password, lista de faixas e player, no computador e no telemóvel.
- **"Ver como convidado"**: as páginas do convidado alimentadas pela API do dono (`/admin/projetos/:id/convidado`), sem criar um link.

### Decisões tomadas durante a implementação

- **Fontes**: Bricolage Grotesque, Figtree e JetBrains Mono passam a vir da própria app (`@fontsource-variable`, OFL). O CSP não deixa carregar o Google Fonts.
- **Upload de pasta**: cria uma pasta no projeto com todas as músicas lá dentro, incluindo as das subpastas (como no mockup).
- **Capa gerada**: quando não há imagem, o padrão vem do nome do projeto (igual para o dono e para o convidado).
- **PBKDF2**: 15 000 iterações, guardadas em cada link (D7). A medir em produção.

### Fica para as fases seguintes (de propósito)

- **Fase 2**: comentários, notas de voz, nome do convidado, revisões (a página "Revisões" e o contador entram aí), coluna "Pedidos", painel de atividade da biblioteca.
- **Fase 3**: LUFS, LRA e true peak (as colunas mostram "—" até lá); A/B com um `<audio>` por versão pré-carregado (hoje há um só elemento, que já mantém a posição ao mudar de versão).
- **Fase 4**: letra (o painel "Sobre esta versão" já tem o lugar), editor tap-to-sync.
- **Fase 5**: procurar, PWA, ajuda.

## 13. A biblioteca organiza-se por artista (15/10/2026)

Correção do dono depois da Fase 1: o nível de cima da biblioteca são os **artistas**, e os **projetos** (álbuns, EPs, singles) são as pastas de primeiro nível dentro de cada artista.

- **Biblioteca** → **artista** (foto, cor, descrição) → **projeto** (capa, ano, editora, descrição, cor) → **pastas** (nome, ícone e cor, como antes) → **faixas**. Também pode haver faixas soltas diretamente no artista.
- A linha por baixo de "Biblioteca" mostra "N artistas · N projetos · N faixas · N versões".
- **Upload de pasta**: na página do artista, uma pasta do computador cria um projeto; dentro de um projeto, cria uma pasta.
- **Mover**: uma pasta levada para a raiz do artista passa a ser um projeto.
- **Links**: podem ser de um artista inteiro, de um projeto, de uma pasta ou de uma faixa. A página do convidado mostra no topo o projeto (capa, nome, artista e ano), ou o artista quando o link é do artista inteiro ou de uma faixa solta. Num link de artista, cada projeto aparece como uma secção com a sua capa.
- **Ver como convidado** funciona para o artista e para cada projeto ou pasta.
- **Modelo de dados** (`migrations/0002_artists.sql`): `projects` passa a `artists` (sem as colunas `artist`, `year` e `label`; `artwork_key` passa a `photo_key`); `folders` ganha `artwork_key`, `year`, `label` e `description`, usados quando `parent_id IS NULL`; `project_id` passa a `artist_id` em pastas, faixas e links. Os dados de teste antigos ficam com o nome do artista que tinham.
- Rotas da app: `/admin/artistas/:id`, `/admin/artistas/:id/pastas/:folderId` (projeto ou pasta), `/admin/artistas/:id/faixas/:trackId`.

## 14. Fase 2 — comentários (15/10/2026)

### Feito

- **Modelo de dados** (`migrations/0004_comments.sql`): `guests` (um dispositivo num link: nome e o hash de um segredo guardado no browser) e `comments` (conversas de um nível, notas privadas do dono, pedidos abertos/feitos com a versão que os resolveu, notas de voz no R2 em `voice/<id>`).
- **API do dono**: comentários por faixa (com perguntas por novidades), comentar por escrito ou por voz, responder, marcar feito/reabrir (e escolher a versão), apagar, ouvir notas de voz, lista das Revisões.
- **API do convidado**: nome, comentários públicos da faixa, comentar, responder, apagar os próprios, notas de voz. Só dentro do que o link partilha, com limite de 10 por minuto. Com os comentários desligados, o link fica só para ouvir.
- **Interface**: campo de comentário com o tempo que segue a música, intervalo, microfone (manter premido no telemóvel, um clique no computador), privada/pública no dono, faixa "A responder a…"; lista de conversas com "Responder", "✓ Feito"/"Reabrir" e "Apagar"; pontos na forma de onda; pressão longa no telemóvel; página e separador "Revisões" com contador; coluna "Pedidos"; contagem de comentários na lista do convidado; "Atividade recente" na biblioteca; espaço das notas de voz no Perfil.
- **Nome do convidado**: pedido ao entrar num link com comentários, com "Agora não, só quero ouvir"; nesse caso volta a ser pedido antes do primeiro comentário.

### Decisões tomadas durante a implementação

- **Estados**: só "Aberto" e "Feito" (o "Fica assim" do plano inicial não entrou; dá para apagar ou responder).
- **Editar um comentário**: não há; apaga-se e escreve-se outra vez (menos interface, o mesmo resultado).
- **Pedidos que passam de versão**: um pedido aberto numa versão aparece nas seguintes com a etiqueta "de v2", até ser feito. As notas do dono ficam na versão onde foram escritas.
- **Pressão longa** fixa o tempo do comentário nesse ponto e abre o teclado, sem mudar a posição da música.
- **Atualização**: cada página de faixa pergunta por novidades a cada 15 s, só com o separador visível (ver `limites.md`).
- **Notas de voz**: AAC em MP4 quando o browser grava assim, Opus em WebM/Ogg no Firefox. O Worker confirma o formato pelos primeiros bytes. O `Permissions-Policy` passou a permitir o microfone na própria app.
- **Apagar** um comentário apaga também as respostas (soft delete; o cron limpa ao fim de 7 dias, com as notas de voz).

### Fica para depois

- Teste cruzado de notas de voz Firefox ↔ Safari (quando houver um iPhone).
- Transcrição das notas de voz (Workers AI) continua fora do âmbito.

### Ajustes do dono à Fase 2

- **Nome obrigatório** num link com comentários: o cartão não fecha sem nome. Um filtro (o mesmo no browser e no Worker, `src/shared/guest-name.ts`) recusa nomes como "asd", "aaaa", "teste", com números, símbolos ou links.
- **Intervalos na forma de onda**: o intervalo escolhido aparece pintado enquanto se escreve, e os comentários com intervalo ficam marcados (na cor do autor; o selecionado fica mais forte).
- **Editar**: o dono edita as suas mensagens escritas quando quiser; um convidado só no dia em que as escreveu (dia de Portugal). Aparece "editado". As notas de voz não se editam. (`migrations/0005_comment_edits.sql`: `edited_at`.)
- **Responder a si próprio**: nas próprias mensagens, só na última de cada conversa ("A acrescentar à tua mensagem").
- **Revisões**: mostram as respostas de cada pedido e deixam responder ali mesmo (texto ou voz, privada ou pública).
- **Notas de voz mais leves**: mono, Opus a 24 kbps (~180 KB por minuto) onde o browser grava Opus; AAC a 32 kbps no Safari antigo. Antes eram ~480 KB por minuto. A forma de onda da gravação mostra o nível do microfone e ocupa o campo todo.
- **Play**: abrir uma faixa já não a põe a tocar; só o botão ▶ da lista (no número, no computador; o círculo à esquerda, no telemóvel) e "Ouvir" nos menus. Se já estiver a tocar, a música continua na faixa nova.

## 15. Fase 3 — A/B e loudness (15/10/2026)

### Feito

- **Medidor** (`src/shared/loudness.ts`, sem dependências): K-weighting para qualquer sample rate (como o libebur128), blocos de 400 ms e de 3 s a cada 100 ms, gating absoluto e relativo, LRA (P10–P95, como o libebur128) e true peak com sobreamostragem 4× (2× acima de 48 kHz) por um interpolador polifásico (sinc com janela de Kaiser, 24 taps por fase), nunca abaixo do pico de amostra.
- **Testes** com os sinais das EBU Tech 3341 (integrado, gating, outras sample rates, mono) e 3342 (LRA), e true peak entre amostras.
- **Comparação com o ffmpeg** (`npm run loudness`, `scripts/compare-loudness.test.ts`): sobre ficheiros teus em `fixtures/real/` ou, sem eles, um conjunto gerado pelo ffmpeg. Em 7 ficheiros gerados (ruído rosa 48 kHz/24 bit, dinâmica 44,1 kHz/16 bit, varrimento 96 kHz, picos entre amostras, ruído com clipping, MP3 192 kbps, tom mono): integrado e true peak a ≤0,04 do `ebur128` (que mostra uma casa decimal).
- **Upload**: a análise no Web Worker passa a fazer a forma de onda e o loudness na mesma passagem (WAV lido aos bocados, MP3 descodificado e enviado ao Worker). A finalização guarda LUFS-I, LRA e TP.
- **Versões antigas**: ao abrir a faixa no computador, a versão sem loudness é descarregada, medida no browser e guardada (`PUT /api/admin/versions/:id/loudness`).
- **A/B**: no computador, até 3 outras versões da faixa ficam carregadas ao lado e seguem a cabeça de leitura; mudar de versão troca de elemento `<audio>` sem esperar e mantém o segundo. A tecla **B** volta à versão anterior.

### Decisões tomadas durante a implementação

- **Referência**: o `ebur128` do ffmpeg (mede a 48 kHz). O `loudnorm` mede depois de reamostrar para 192 kHz e, em material com muito conteúdo no topo do espectro (ruído, clipping), lê até ~0,1 LU abaixo do `ebur128` e do nosso; fica na tabela, mas não é o critério.
- **Comparação corrida pelo vitest** (um projeto "loudness" à parte), em vez de `tsx`: não é preciso nenhuma dependência nova.
- **Sem pré-carregamento no telemóvel**, para não gastar os dados de quem ouve.

### Fica para depois

- Correr `npm run loudness` sobre 3–4 ficheiros teus (pôr em `fixtures/real/`).

## 16. Fase 4 — letras (15/10/2026)

### Feito

- **LRC** (`src/shared/lrc.ts`): leitura tolerante (vários tempos por linha, [m:ss], [mm:ss:xx], [offset], etiquetas ignoradas) e escrita em [mm:ss.xx]; linhas sem tempo ficam como texto simples.
- **Dados**: a letra da faixa em `tracks.lyrics_lrc` e, quando os tempos de uma versão são diferentes, `versions.lyrics_lrc_override` (as duas colunas já existiam desde a 0001; não houve migration).
- **API**: dono lê e grava a letra da faixa ou de uma versão; o convidado lê a da versão que ouve, só se o link mostrar letras.
- **Vista sincronizada**: a linha atual acende e fica à vista dentro da sua caixa; clicar numa linha salta para lá; uma letra sem tempos aparece como texto. Computador: painel "Sobre esta versão · Letra" (dono e convidado). Telemóvel: separador "Letra".
- **Editor** (dono): texto (colar, importar .lrc, descarregar .lrc) e tempos por toques ("Marcar"/Enter, com 0,15 s de compensação da reação), −/+ 0,1 s por linha, desfazer, recomeçar, linhas fora de ordem a vermelho; guarda para todas as versões ou só para a versão aberta.

### Decisões tomadas durante a implementação

- O editor mantém os tempos das linhas que não mudaram quando se corrige o texto.
- No convidado, o separador "Letra" do telemóvel só aparece quando a faixa tem letra.

## 17. Fase 5 — acabamento (15/10/2026)

### Feito

- **Instalar como app (PWA)**: `manifest.webmanifest` e ícones (192, 512, maskable, apple-touch). O dono instala a nectr inteira (abre em `/admin`); num link, o manifest passa a ser o do próprio link (`/s/<token>/manifest.webmanifest`, trocado no HTML pelo Worker), por isso o convidado instala só aquele link, com o nome do projeto.
- **Service worker** (`public/sw.js`): guarda só os ficheiros da app (`/assets/*` com hash, ícones), no máximo os 80 mais recentes. Nunca áudio, notas de voz, respostas da API ou páginas. Sem rede, uma página abre com "Sem ligação" e "Tentar outra vez".
- **Procurar** (Ctrl/⌘+K ou `/`, e o botão na barra lateral e na Biblioteca do telemóvel): artistas, projetos, pastas e faixas pelo nome, sem ligar a acentos nem maiúsculas; todas as palavras têm de bater (no nome ou no artista/projeto); ↑/↓ e Enter. Um pedido (`GET /api/admin/search-index`) traz só nomes e ids, guardado 1 minuto.
- **Ajuda**: "Ajuda" na barra lateral, no Perfil do telemóvel e na tecla `?` (atalhos, organizar, partilhar, comentários, letra, limites). O convidado tem o "?" no topo, com o que pode fazer naquele link.
- **Tema claro** (Perfil → Aspeto: escuro, claro ou automático), só nas páginas do dono; os links continuam escuros.
- **Erros e sem ligação**: um erro inesperado mostra "Algo correu mal" com "Tentar outra vez" e "Recarregar", em vez de uma página em branco; sem rede, os pedidos dizem "Sem ligação à internet" e aparece uma nota no topo, que desaparece quando a ligação volta.
- **Acessibilidade**: Tab fica dentro dos diálogos; a pesquisa é uma combobox com a opção ativa anunciada; botões só com ícone têm nome.

### Decisões tomadas durante a implementação

- O service worker só se regista no build de produção (no `npm run dev` não interfere).
- A pesquisa filtra no browser: para uma biblioteca pessoal, uma lista de nomes é pequena e evita um índice no D1.
- O painel "uso do plano gratuito" (pedidos e CPU do dia) não foi feito: precisa de um token da API da Cloudflare só para isso. O medidor de espaço do R2 continua na barra lateral e no Perfil.

## 18. Correção do true peak dos MP3 (15/10/2026)

O dono comparou 6 MP3 com o Samply: LUFS iguais, mas o true peak de 3 deles mais baixo na nectr (um master do dono: +0,2 contra +0,8 dBTP).

- **Causa**: o browser (`decodeAudioData`, e também o `AudioDecoder` do WebCodecs) corta o MP3 descodificado em ±1,0. Masters altos têm amostras acima de 0 dBFS depois da descodificação (esse master chega a +0,75 dBFS), e o true peak medido sobre o áudio cortado fica baixo. Os WAV não eram afetados.
- **Correção**: o MP3 é descodificado no Web Worker da análise pelo mpg123 em WebAssembly (`mpg123-decoder`, ~80 KB, carregado só durante a análise), 1 MB de cada vez, sem guardar o áudio inteiro em memória. A política de segurança passou a permitir WebAssembly (`'wasm-unsafe-eval'`).
- **Resultado**: um master do dono −9,26 LUFS e +0,75 dBTP; ffmpeg `ebur128` −9,3 e +0,7; Samply +0,8. `npm run loudness` passou a descodificar os MP3 também com o mpg123, como a app.
- **MP3 já carregados**: a migration 0006 apaga o loudness dos MP3, que volta a ser medido quando cada faixa é aberta no computador.
- **Durações** arredondadas ao segundo (3:03,6 → 3:04), como nos outros players; o tempo a tocar continua a contar os segundos inteiros.

## 19. Avisos (notificações push) (15/10/2026)

Pedido do dono depois da Fase 5: avisos no telemóvel quando há comentários novos, e também para os convidados.

### Feito

- **Quem recebe o quê**:
  - o dono, quando um convidado comenta, envia uma nota de voz ou responde (título: faixa e versão; texto: "Marta · Editora: …"; abre a faixa nessa conversa);
  - o convidado, quando o dono responde numa conversa onde ele escreveu (as notas privadas nunca avisam);
  - o convidado, quando há música nova que o link dele mostra: faixa nova ou versão nova (num link "versões escolhidas", uma versão nova não entra e não avisa). Uploads em lote juntam-se num só aviso ("3 novidades: …") e cada aviso substitui o anterior desse link.
- **Ativar**: dono em Perfil → Avisos (com "Enviar um teste"); convidado no sino ao lado do "?" do link (também em links só de ouvir, para as músicas novas). Depois da primeira mensagem, o convidado vê uma vez "Queres saber quando te responderem? Avisar-me".
- **Web Push sem bibliotecas** (`src/worker/lib/push.ts`): encriptação aes128gcm (RFC 8291, testada com o exemplo do RFC byte a byte) e assinatura VAPID (RFC 8292) com Web Crypto. A chave privada é o secret `VAPID_JWK` (`scripts/push-key.mjs`); a pública está em `GET /api/push/key`.
- **Dados**: migration 0007, tabela `push_subscriptions` (um dispositivo por audiência: `owner` ou o id do link; `guest_id` quando o dispositivo tem nome no link).
- **Segurança**: o Worker só envia para os serviços de push dos browsers (Google, Mozilla, Microsoft, Apple), nunca para um endereço qualquer vindo do browser. Dispositivos que o serviço de push dá como desaparecidos (404/410) são apagados; o cron apaga os de links revogados, expirados ou apagados.
- **Service worker**: mostra o aviso (ícone, ícone pequeno monocromático `badge-96.png`) e, ao tocar, leva uma janela aberta da mesma parte da app para lá, ou abre uma nova.

### Decisões tomadas durante a implementação

- No máximo 25 envios por acontecimento e 20 dispositivos por audiência: chega para uso pessoal e fica dentro dos subrequests e do CPU do plano gratuito.
- Um convidado a responder a outro convidado não avisa ninguém além do dono (fica simples; os convidados de um link podem nem se conhecer).
- No iPhone os avisos só funcionam com o link no ecrã principal (iOS 16.4+); o diálogo explica isso.

## 20. Espaço, apagar e volume (15/10/2026)

- **Espaço que não batia certo**: o dono apagou faixas (28 versões, 450 MB) e a barra lateral continuava a dizer "28 versões". O que se apaga fica 7 dias no R2 (para o "Anular") e o cron diário (03:17 UTC) remove-o depois, mas a contagem misturava tudo. Agora a biblioteca separa: versões e áudio da biblioteca, notas de voz, e "apagados" com a data em que saem ("450 MB apagados saem até 22/10"). O medidor conta tudo o que o R2 guarda de facto.
- **Apagar uma faixa apaga todas as versões dela**: as versões passam a ser marcadas no mesmo lote que a faixa (o "Anular" repõe-nas). Antes ficavam por marcar, mas já eram removidas pelo cron com a faixa.
- **Verificado com um teste**: faixa com duas versões e notas de voz (de um convidado e do dono) → apagar → 8 dias depois, o áudio das duas versões e as duas notas de voz já não estão no R2 e as linhas saíram do D1. Os testes que já existiam cobrem pastas, projetos com capa, uploads abandonados (24 h) e comentários de voz apagados.
- **"Manter apenas a última versão"** nos 3 pontos de uma faixa com várias versões: pede confirmação ("A v1 de “Maré alta” é apagada, com os comentários e as notas de voz que tiverem…") e pode ser anulado logo a seguir.
- **Volume** no computador (páginas do dono e do convidado, e no leitor no fundo da biblioteca): altifalante para tirar/repor o som (tecla M) e um slider. O nível fica guardado no dispositivo e segue a curva do ouvido (o som é o quadrado da posição). Em ecrãs táteis não aparece: usam-se os botões do aparelho.

## 21. Nome do projeto no Ableton (15/10/2026)

- Em "Mudar o nome" de uma faixa há um segundo campo, **Nome do projeto no Ableton** (o Live Set costuma ter outro nome que a música). Só o dono o vê.
- Aparece logo a seguir ao nome da faixa, em itálico, mais pequeno e esbatido: nas listas da pasta/projeto (computador e telemóvel), na lista lateral da faixa e no título da página da faixa. A pesquisa (Ctrl+K) também encontra a faixa por esse nome.
- Coluna `tracks.session_name` (migration 0008). Nunca sai para um link: a página do convidado constrói as faixas só com id, pasta e título, e um teste confirma que a resposta do link não o contém.

## 22. Cada versão guarda o nome da faixa que era (15/10/2026)

- **O problema**: uma faixa renomeada, arrastada para cima de outra, passava a versão dessa outra e aparecia na lista de versões com o nome do ficheiro original; o nome dado no site perdia-se.
- **Agora**: ao juntar, cada versão que se move guarda o nome da faixa que era (`versions.name`, migration 0009). A faixa de destino mantém o título dela; a que foi largada fica como versão mais recente, isto é, a principal. Na lista de versões aparece esse nome (ou o nome do ficheiro, para as versões que nunca foram outra faixa), e em "Sobre esta versão" aparece "Era a faixa “…”".
- **Anular** devolve o nome à faixa e tira-o da versão; **tornar uma versão independente** cria a faixa com esse nome, em vez do nome do ficheiro.
- **Largar um ficheiro novo** numa faixa (renomeada ou não) nunca lhe muda o título; o ficheiro entra como versão mais recente e principal. Um teste confirma os três casos.
- Como o nome do ficheiro, este nome é só do dono: não sai para os links.

## 23. Menus das versões e barra lateral recolhível (16/10/2026)

- **Os 3 pontos das versões não abriam**: abriam, mas fora do ecrã. A animação de entrada das linhas das versões ficava aplicada no fim (`animation-fill-mode: both`) com um `transform`, e um elemento com `transform` passa a ser a moldura dos menus `position: fixed` lá dentro. As animações de entrada (linhas das versões, diálogos, barra de seleção) passaram a `backwards`: o aspeto é o mesmo e não deixam nada aplicado.
- **Barra lateral recolhível em todas as páginas do dono** (o botão de seta que já existia na página da faixa):
  - na página da faixa e com a janela estreita (até 1024 px), recolhe-se sozinha; o botão abre-a até se mudar de página ou a janela voltar a alargar;
  - no resto, fica como a deixaste, guardado no dispositivo.
- Os indicadores de largura da janela passaram a ser também revistos no evento `resize` (alguns browsers embutidos não emitem a mudança das media queries).

## 24. Organização: tipos de projeto, capas, ordem e pastas nos links (16/10/2026)

- **Leitor**: no fim de uma música passa à seguinte da mesma lista (a pasta, no dono e no convidado), a não ser com "repetir" ligado; a página da faixa acompanha. Botão **faixa seguinte** em todos os leitores, entre +5 s e repetir (desativado na última).
- **Tipos de projeto** (`folders.kind`, migration 0010): Álbum / EP (com capa, ano, editora), WIP, Projeto live, Outra pasta (com ícone, como as pastas). Na página do artista aparecem separados ("Álbuns e EPs" / "Outros projetos"); um projeto que deixa de ser álbum guarda a capa, mas deixa de a mostrar.
- **24 cores** (as 12 de antes e mais 12, mais escuras ou suaves).
- **Capa da faixa** (`tracks.artwork_key`): 3 pontos → Capa da faixa, ou a miniatura ao lado do título na página da faixa. Quem ouve vê-a na faixa, no leitor e no ecrã bloqueado; sem ela, aparece a do projeto. Sai do R2 com a faixa (cron) ou ao ser trocada/removida.
- **Recortar imagens** antes de guardar (capas de projeto e de faixa, foto do artista, foto de perfil): arrastar, zoom com slider, roda ou dois dedos; resultado quadrado em JPEG, sem nunca ampliar (até 1200 px; 512 px na foto de perfil, com pré-visualização redonda). Sem dependências.
- **Foto de perfil mal cortada**: o estilo do avatar repunha o tamanho e a posição do fundo; corrigido.
- **Ordem dos artistas** (`artists.position`): arrastar na Biblioteca; no telemóvel, "Ordenar" com setas. Artistas novos entram em último.
- **Pastas nos links**: o convidado vê as pastas fechadas e entra numa de cada vez (computador: a lista lateral; telemóvel: uma página por pasta, como na app do dono no telemóvel). Num link de artista, os álbuns/EPs primeiro e depois os outros projetos; as pastas de um projeto só aparecem dentro dele; pastas vazias não aparecem. Quando o topo do link tem só uma pasta e mais nada, abre logo nela. Endereços `/s/:token/f/:pasta`.

## 25. Tocar em segundo plano no telemóvel (16/10/2026)

- **Controlos do sistema** (Media Session): título, artista e capa (em vários tamanhos), tocar/pausa, ±10 s, a barra de posição, faixa anterior/seguinte (a lista onde a faixa está; "anterior" volta primeiro ao início) e o estado tocar/pausa sempre certo. É o que aparece na aba de notificações e no ecrã bloqueado, como nos outros leitores.
- Experimentado e retirado: pôr os elementos `<audio>` dentro da página e forçar o carregamento antecipado (`preload="auto"`). No Firefox para Android não evitou a paragem ao mudar de app e coincidiu com cortes no som.
- **Limite**: quem decide se continua a tocar com outra app à frente é o browser e o Android. No Firefox para Android, a notificação tem menos controlos (tocar/pausa) do que no Chrome. Se parar ao fim de algum tempo bloqueado, a causa costuma ser a poupança de bateria: Definições → Apps → Firefox → Bateria → Sem restrições.

## 26. Quem entrou nos links e nomes mais exigentes (16/10/2026)

- **Links**: cada link mostra quem deu o nome ("2 pessoas entraram: Marta, Rui"), com a data em que entrou, se voltou (a última visita, atualizada no máximo uma vez por hora; conta a partir de agora) e quantos comentários tem. Cada nome é um dispositivo. Links só para ouvir não pedem nome, por isso dizem isso em vez da lista.
- **Nomes de spam**: além das linhas do teclado inteiras, sem vogais e letras triplicadas, o nome é recusado com quatro teclas seguidas de uma linha do teclado em qualquer parte ("qwer", "lkjh"), só letras da linha do meio (6 ou mais), um bocado repetido ("asdasd", "jdjdjd", "hahaha"; "Lulu" e "Nini" passam), cinco consoantes seguidas, uma palavra comprida com uma só vogal ("jdksjdka") ou, com 4 letras ou mais, sem nenhuma vogal a sério (o "y" não conta: "yygnjy", o nome que tinha passado), e mais palavras de enchimento ("spam", "fulano", "blabla"…). É a mesma verificação no browser e no Worker.

## 27. Partilhas feitas pelos convidados (26/10/2026)

- **Onde**: só nos links com "Quem recebe pode partilhar" ligado (no diálogo de partilha e nos interruptores da página Links; desligado por defeito).
- **O convidado**: "Partilhar" na faixa aberta, ou "Partilhar esta pasta" numa pasta (no telemóvel, o ícone no topo). Dá o nome se ainda não deu, escreve opcionalmente para quem é, e recebe um link (copiado; no telemóvel, "Enviar" abre a partilha do sistema). Vê e revoga as suas partilhas nesse link.
- **A partilha** (`share_links.parent_link_id`, `created_by_guest_id`, migration 0011): sem download e sem password (mesmo que o link de origem os tenha), só a faixa ou pasta escolhida, e segue o link de origem em tudo o resto: versões, letra, comentários e validade. Revogado ou expirado o link de origem, a partilha deixa de funcionar. Uma partilha não pode ser partilhada outra vez. No máximo 20 partilhas ativas por link.
- **O dono**: na página Links, debaixo de cada link, "N partilhas feitas a partir deste link" com quem partilhou, o quê, quando, quem entrou e se já foi aberta; copiar, revogar, reativar. Os comentários vindos de uma partilha chegam com "via Partilha de Marta para Rui". Aviso no telemóvel quando alguém partilha.
- O cron apaga as partilhas cujo link de origem desapareceu.

