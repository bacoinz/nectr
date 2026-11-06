# Plataforma de partilha e revisão de áudio (Cloudflare)

Plano original do dono. Os desvios aprovados e as decisões tomadas estão em [plano.md](plano.md), que prevalece onde os dois divergem.

**Nome:** nectr

## 1. Objetivo

Construir uma aplicação web pessoal para partilhar músicas com clientes e colaboradores, ouvir e comparar versões e recolher feedback com timestamp. Junta a interface e a experiência de ouvir do Samply (https://samply.app/) com a gestão de revisões do Filepass (https://app.filepass.com/). Este projeto não é um clone: o design, o nome e os assets são originais e não se copiam logótipos, ícones ou textos de nenhum dos dois serviços.

Quem usa: eu (dono, único utilizador com conta) e os meus clientes/colaboradores, que entram por link, sem conta.

## 2. Restrições e preferências (importante)

- Tudo gratuito. Ficar dentro dos planos gratuitos da Cloudflare (Workers, R2, D1, Access). Sem serviços pagos de terceiros. Se algo exigir um serviço pago, para e pergunta-me primeiro, mas sempre a tender para serviços gratuitos.
- Simplicidade acima de tudo. Poucas dependências, sem frameworks pesados, sem serviços de terceiros sem necessidade clara. Antes de adicionar uma dependência, justifica-a numa linha.
- Formatos suportados: apenas WAV PCM (16 ou 24 bit) e MP3. Sem stems, sem AIFF, sem WAV 32 bit float, sem FLAC/AAC nesta versão. Ficheiros de música completa, tipicamente 5 a 150 MB.
- Línguas: interface em português europeu. Código, nomes de variáveis e commits em inglês.
- Sem paywall. Sou eu que decido, por link, se o download é permitido.
- A/B sem loudness match. Só quero saltar entre versões durante a reprodução.

## 3. Stack

- Linguagem: TypeScript em tudo.
- Backend: um Worker Cloudflare com `Hono` (router leve), que também serve o front-end estático (Workers Static Assets). Um único deploy.
- Front-end: Vite + Svelte (ou Preact, se te parecer mais simples). Sem UI kits pesados; CSS próprio com variáveis (tema escuro por defeito, claro opcional).
- Ficheiros: R2 (bucket privado).
- Base de dados: D1 (SQLite), com migrations em ficheiros `.sql` versionados.
- Autenticação do dono: Cloudflare Access (gratuito até 50 utilizadores) a proteger `/admin/*` e `/api/admin/*`. O Worker valida o header `Cf-Access-Jwt-Assertion` contra as chaves públicas do Access. Isola isto atrás de uma função (`getOwner(request)`) para ser fácil trocar mais tarde por contas próprias.
- Dev local: `wrangler dev` com R2 e D1 locais. Testes com `vitest` (e `@cloudflare/vitest-pool-workers` se funcionar sem atritos).

Estrutura sugerida: `/src/worker` (API), `/src/web` (front-end), `/migrations`, `/docs`, `wrangler.toml`.

## 4. Modelo de dados (D1)

- `projects` — id, name, artist, color (hex), artwork_key (R2, opcional), created_at
- `tracks` — id, project_id, title, position, lyrics_lrc (texto LRC, opcional), created_at
- `versions` — id, track_id, label (ex.: "v3 — vocals up"), notes, r2_key, original_filename, format (`wav` | `mp3`), size_bytes, duration_s, sample_rate, bit_depth (null no MP3), channels, bitrate_kbps, lufs_integrated, lufs_range, true_peak_dbtp, peaks_json (≈1500 pontos), lyrics_lrc_override (opcional), created_at
- `share_links` — id, token, project_id, track_id (nulo = projeto inteiro), label, password_hash, password_salt, allow_download, show_lyrics, allow_comments, expires_at, revoked_at, created_at, last_viewed_at
- `share_link_versions` — link_id, version_id (que versões o link expõe)
- `comments` — id, version_id, parent_id (respostas), link_id (nulo se for do dono), author_name, author_kind (`owner` | `guest`), time_s, time_end_s (opcional), body, status (`open` | `done` | `wontfix`), resolved_in_version_id (opcional), created_at, resolved_at

Índices em `comments(version_id, time_s)`, `share_links(token)`, `versions(track_id)`.

## 5. Funcionalidades (resumo)

1. Biblioteca (dono): projetos com cor, artista e artwork; faixas dentro de cada projeto; várias versões por faixa.
2. Metadados por versão: duração, sample rate, bit depth, bitrate, canais, formato, data de upload, LUFS integrado, LRA, true peak. Mostrados junto ao player.
3. Player: waveform com seek, tempo atual/total, comentários marcados na waveform, atalhos de teclado (espaço, setas, tecla para A/B).
4. A/B entre versões: botão/tecla que troca de versão e continua na mesma posição.
5. Links de partilha: token aleatório, password opcional, validade opcional, escolha de versões visíveis, e três interruptores: download, letra, comentários.
6. Feedback colaborativo: comentários com timestamp, respostas em fio, nome do convidado guardado no browser.
7. Checklist de revisões (dono): os comentários dos clientes viram tarefas por faixa, com estado e ligação à versão onde foram resolvidos.
8. Letra sincronizada (LRC): linha ativa em destaque com scroll automático; opção de esconder (por link e pelo ouvinte); editor "tap-to-sync" para o dono.

## 6. Decisões técnicas

### 6.1 Upload

- O browser pede ao Worker um URL pré-assinado de PUT para o R2 (usar `aws4fetch` com credenciais S3 do R2 guardadas como secrets) e envia o ficheiro direto, com barra de progresso (`XMLHttpRequest` para ter `upload.onprogress`). Não passar o ficheiro pelo Worker (limite de 100 MB no plano gratuito).
- Configurar CORS no bucket só para o domínio da app.
- Limite: 200 MB por ficheiro (validado no cliente e na finalização).
- Finalização: depois do PUT, o cliente chama `POST /api/admin/versions/finalize`. O Worker lê os primeiros bytes do objeto no R2 e valida: WAV = `RIFF....WAVE` com `fmt ` em PCM (formato 1) e 16 ou 24 bit; MP3 = cabeçalho `ID3` ou frame sync válido. Se falhar, apaga o objeto e devolve um erro claro em português (incluindo "WAV 32 bit float não é suportado").

### 6.2 Metadados e análise (no browser, durante o upload)

- WAV: ler o cabeçalho diretamente (sample rate, bit depth, canais, duração; bitrate = sample rate × bit depth × canais).
- MP3: `music-metadata` (versão para browser) para bitrate, duração e sample rate.
- LUFS integrado, LRA e true peak (4x oversampling): usar um port WASM de `libebur128`. Pesquisa primeiro se existe um pacote npm fiável e mantido. Se não existir, avalia compilar `libebur128` para WASM (é pequeno) ou implementar K-weighting + gating em TypeScript. Atenção: para WAV, ler o PCM direto do ficheiro e passá-lo em blocos ao medidor (não usar `decodeAudioData`, que reamostra e falseia as medições). Para MP3, decodificar com um `AudioContext` criado à sample rate do ficheiro.
- Validação obrigatória: comparar os valores com `ffmpeg -i x.wav -af ebur128=peak=true -f null -` em pelo menos 3-4 ficheiros reais meus. Tolerância: ±0,1 LU no integrado, ±0,2 dB no true peak. Se não bater, não avançar; avisar-me.
- Waveform: calcular ≈1500 picos (min/max por bloco) e guardar em `peaks_json`.
- Processar em blocos para não carregar o ficheiro inteiro em memória (um WAV 24 bit de 5 min dá ~115 MB em float).

### 6.3 Streaming e downloads

- Todo o áudio passa por `GET /s/:token/audio/:versionId` (convidados) ou `/api/admin/audio/:versionId` (dono). O Worker valida o token (e o cookie de password, se existir), lê do R2 com suporte a Range requests (`bucket.get(key, { range })`) e responde `206`/`Accept-Ranges: bytes`. O seek tem de funcionar no Safari/iOS (que exige Range correto).
- Download desligado: `Content-Disposition: inline`, sem botão na UI, sem expor o `r2_key`. Download ligado: endpoint separado com `Content-Disposition: attachment` e nome de ficheiro limpo.
- Aviso honesto a incluir na UI do dono, junto ao interruptor: "Desativar downloads esconde o botão e impede o descarregamento direto, mas quem consegue ouvir consegue sempre gravar o áudio."
- Cache: `Cache-Control: private`. Nada de cache pública.

### 6.4 A/B

- Um `<audio>` por versão da faixa, todos com `preload="auto"` (pré-carregar só as versões da faixa aberta). Ao trocar: ler `currentTime` e o estado de reprodução do atual, pausar, aplicar ao novo (esperar `canplay` / `seeked`), continuar a tocar. Um pequeno corte na troca é aceitável.
- A waveform, as métricas e os comentários mudam para a versão ativa.
- Testar no Safari iOS: desbloqueio de áudio por gesto do utilizador e limites de memória.

### 6.5 Links de partilha e segurança

- Token: 128 bits aleatórios (`crypto.getRandomValues`), base64url.
- Password: PBKDF2-SHA256 com salt (Web Crypto), iterações altas. Ao validar, emitir um cookie `HttpOnly; Secure; SameSite=Lax` assinado com HMAC (secret do Worker), restrito ao link e com validade curta (ex.: 12 h).
- Limitar tentativas de password por IP+link (binding de Rate Limiting da Cloudflare ou contador em D1).
- Links expirados ou revogados devolvem uma página neutra, sem revelar se o link existiu.
- Comentários de convidados: sanitizar o texto (renderizar como texto, nunca como HTML), limitar tamanho e frequência.
- Cabeçalhos: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, CSP restritiva.

### 6.6 Comentários e checklist

- Comentário = tempo (e intervalo opcional) + texto + autor. Aparece na waveform como marcador e numa lista ordenada por tempo.
- Estados: `open`, `done`, `wontfix`. Ao criar uma versão nova, os comentários abertos das versões anteriores continuam na checklist da faixa, com a etiqueta da versão de origem. Ao marcar como feito, o dono pode indicar em que versão foi resolvido (`resolved_in_version_id`).
- Vista "Revisões" (dono): checklist por faixa, filtros (abertos/feitos), clicar num item salta para esse ponto no player.
- O convidado vê o estado dos seus próprios pedidos (aberto/feito).
- Atualização em quase tempo real: polling a cada 10-15 s com o `last_seen`. Sem Durable Objects nesta versão.
- Notificações por email: fora do âmbito nesta versão (vejo na app).

### 6.7 Letra sincronizada

- Formato LRC (`[mm:ss.xx] linha`). Parser próprio e pequeno, tolerante a erros.
- Uma letra por faixa, com override opcional por versão.
- Linha ativa em destaque (via `timeupdate` ou `requestAnimationFrame`), scroll suave, clicar numa linha faz seek.
- Interruptor de esconder: no link (`show_lyrics`) e no player do ouvinte (preferência guardada em `localStorage`).
- Editor tap-to-sync (dono): colar a letra, carregar numa tecla a cada linha enquanto a faixa toca, ajustar timestamps à mão, guardar como LRC. Importar/exportar `.lrc`.
- Alinhamento automático (Whisper, `stable-ts`, etc.) fica fora da app: se eu quiser, gero o `.lrc` localmente e importo.

## 7. Fases e critérios de aceitação

- **Fase 0 — Setup** (confirmar comigo os passos manuais). Repositório, `wrangler.toml`, bucket R2, base de dados D1, secrets, app do Cloudflare Access. Deploy de um "hello world" protegido em `/admin`. ✔ `/admin` pede login via Access; `/` e `/s/*` são públicos.
- **Fase 1 — Núcleo**. Projetos, faixas, upload com validação, metadados, waveform, player com seek, versões, links com password e interruptores (download, letra, comentários), streaming com Range. ✔ Faço upload de um WAV 24 bit e de um MP3, vejo os metadados corretos, partilho por link com password, o seek funciona no Safari iOS, e com downloads desligados não há botão nem `attachment`.
- **Fase 2 — Feedback e revisões**. Comentários com timestamp, respostas, marcadores na waveform, checklist de revisões, estados, transição entre versões. ✔ Um convidado comenta sem conta; vejo o comentário na checklist, marco como feito na v2; o convidado vê o estado atualizado.
- **Fase 3 — A/B e métricas de loudness**. Troca A/B mantendo a posição; LUFS, LRA e true peak medidos e validados contra o ffmpeg. ✔ Alterno entre v1 e v2 a tocar sem perder a posição; os valores de loudness batem com o ffmpeg nos ficheiros de teste.
- **Fase 4 — Letras**. Parser LRC, vista sincronizada, interruptores, editor tap-to-sync, import/export. ✔ A letra segue a faixa, posso esconder no link e no player, e consigo criar um `.lrc` do zero na app.
- **Fase 5 — Acabamento**. Cor por projeto e artwork refinados, PWA (instalável no telemóvel), estados vazios e de erro, responsivo, acessibilidade básica (teclado, contraste), página de ajuda curta para o dono.

## 8. Testes

- Unitários: parser de cabeçalho WAV, parser LRC, cálculo de picos, validação de formatos, lógica de tokens/password.
- Integração: endpoints com D1/R2 locais (upload → finalize → streaming com Range → comentários → links).
- Manual (checklist na pasta `/docs`): Safari iOS, Chrome desktop e Firefox para o player, o A/B e o seek.

## 9. Monitorização de limites gratuitos

Documentar em `/docs/limites.md` os limites relevantes (R2 10 GB e operações mensais, Workers 100k pedidos/dia, D1 leituras/escritas diárias) e os pontos onde a app os consome (seek = vários Range requests). Se algum desenho aumentar muito o consumo, avisa-me.

## 10. Passos manuais meus (pede-me quando chegares aí)

- Conta Cloudflare, ativar R2 (pede cartão, sem custos dentro dos limites gratuitos), criar bucket.
- Gerar credenciais S3 do R2 e guardá-las como secrets do Worker.
- Criar a app do Cloudflare Access e definir o meu email como único utilizador permitido.
- Domínio ou subdomínio a usar.

## 11. Fora do âmbito (por agora)

Stems e sessões, AIFF, WAV 32 float, FLAC/AAC, paywall e pagamentos, loudness match no A/B, preview lossy para links sem download, contas para colaboradores, notificações por email, tempo real com Durable Objects, apps nativas.

## 12. Decisão em aberto

Contas com login para colaboradores recorrentes (ver todos os projetos partilhados com eles num só sítio): por agora não. Só o dono tem conta (via Access) e os restantes entram por link. Mantém a autenticação do dono isolada em `getOwner()` para facilitar uma futura mudança.

## 13. Como trabalhar

- Começa por ler este plano, propor a estrutura do repositório e listar dúvidas. Não avances para código antes de eu confirmar.
- Uma fase de cada vez, com commits pequenos e mensagens claras.
- No fim de cada fase: resumo curto do que foi feito, o que foi testado e o que ficou pendente.
- Se uma decisão técnica deste plano se revelar má, diz-me porquê e propõe uma alternativa em vez de seguir às cegas.

Em termos de UI: algo semelhante ao Samply, mais user friendly, bonito, simples, moderno. O Filepass tem uma UI muito clara e austera.
