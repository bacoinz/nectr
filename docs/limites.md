# Limites dos planos gratuitos

A app foi pensada para caber nos planos gratuitos da Cloudflare. Este documento diz onde estão os limites e o que os gasta.

## Limites relevantes

| Serviço | Limite gratuito | Notas |
|---|---|---|
| Workers | 100 000 pedidos/dia, 10 ms de CPU por pedido | Os ficheiros estáticos (a app, as fontes) não contam |
| R2 | 10 GB guardados, 1 milhão de operações de escrita (classe A) e 10 milhões de leitura (classe B) por mês | Sem custos de saída de dados |
| D1 | 5 GB, 5 milhões de linhas lidas e 100 000 escritas por dia | |
| Access | 50 utilizadores | Só o dono usa |
| Rate limiting | Incluído | Usado para as tentativas de password e para os comentários (10 por minuto por ligação e link) |

## Onde a app gasta

### Espaço no R2 (o limite mais apertado)

- Um WAV 24 bit/48 kHz estéreo de 5 min ocupa ~86 MB, por isso cabem **~115 versões** destas. Um MP3 320 kbps de 5 min ocupa ~12 MB.
- O medidor na barra lateral e no Perfil mostra o espaço usado, e fica laranja a partir dos 80%.
- O que se apaga só sai do R2 **7 dias depois** (para poder ser reposto). Os uploads que nunca chegaram a ser finalizados saem ao fim de 24 h.
- Capas e fotos são reduzidas no browser (JPEG, 1200 px e 512 px), por isso ocupam poucas dezenas de KB.
- **Notas de voz**: até 1 minuto, mono, Opus a 24 kbps (~180 KB por minuto; AAC a 32 kbps no Safari antigo, ~240 KB). Mil notas de um minuto ocupam ~0,2 GB. Entram no medidor de espaço.

### Pedidos ao Worker

- **Ouvir**: o browser pede o áudio em partes (pedidos Range). Uma faixa ouvida do início ao fim costuma dar poucos pedidos; cada **seek** pode dar mais um ou dois.
- **Abrir uma página**: 1 a 3 pedidos (dados do projeto ou do link e a forma de onda).
- **Versões pré-carregadas (A/B)**: no computador, com uma faixa aberta, até 3 outras versões ficam a carregar ao lado da que toca, para a troca ser imediata. Isso multiplica os pedidos de áudio dessa faixa (pedidos Range a seguir à cabeça de leitura). No telemóvel não acontece.
- **Medir versões antigas**: uma versão carregada antes da Fase 3 é descarregada uma vez inteira para ser medida no browser (1 pedido e 1 leitura no R2).
- **Comentários**: a página da faixa (dono e convidado) pergunta por novidades a cada 15 s, só enquanto o separador está visível, e só lê o que mudou. Uma hora a ouvir com a página aberta são ~240 pedidos.
- **Procurar**: abrir a pesquisa faz 1 pedido (só nomes), no máximo um por minuto.
- **App instalada**: o service worker guarda os ficheiros da app no telemóvel ou computador, por isso abrir a app pede menos ficheiros (que de qualquer forma não contam). Nunca guarda áudio.
- **Avisos**: cada comentário de um convidado, resposta tua ou upload envia um pedido por dispositivo com os avisos ligados (no máximo 25), a partir do Worker, depois da resposta. Os serviços de push do Firefox e do Chrome não cobram. Os dispositivos ficam numa tabela pequena no D1.
- Mesmo com uso intenso (dezenas de clientes por dia), fica muito longe dos 100 000.

### CPU (10 ms por pedido)

- As passwords dos links usam PBKDF2 com **15 000 iterações** (D7 no plano), abaixo do limite. O número fica guardado em cada link e pode subir mais tarde, sem invalidar os links antigos.
- A análise do áudio (forma de onda e, na Fase 3, loudness) corre **no browser**, não no Worker.
- A validação do upload lê só o cabeçalho do ficheiro no R2 (algumas leituras de 64 KB, com limite).

### D1

- Cada página do dono lê os projetos, as pastas, as faixas e as versões (sem a forma de onda). A forma de onda (~44 KB por versão) só é lida quando a faixa abre, e depois fica em cache no browser.
- Quem abre um link atualiza a data de "último acesso", no máximo uma vez por hora.
- Cada comentário é uma linha (uma escrita). As perguntas por novidades leem só os comentários alterados da faixa aberta.

### R2 (operações)

- Upload: 1 escrita (PUT pré-assinado) e algumas leituras para validar.
- Ouvir: uma leitura por pedido Range.
- Fica muito longe dos limites mensais.

## Se algum limite apertar

- **Espaço**: apagar versões antigas (a lista de versões por faixa mostra o tamanho e a data). Um domínio próprio não muda nada aqui.
- **Pedidos**: o plano pago dos Workers custa 5 USD/mês. Antes de qualquer custo, a app avisa e pergunta.
