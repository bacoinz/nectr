# Testes manuais

Os testes automáticos (`npm test`) cobrem os parsers de áudio, a API, os links e as regras de acesso. Esta lista cobre o que só se vê num browser e num telemóvel a sério.

Browsers: **Firefox no Android** (o telemóvel do dono), **Chrome** e **Firefox** no computador. Não há iPhone para testar: o Safari do iOS fica por confirmar com o primeiro cliente que o use (ver o fim desta lista).

## Fase 1

### Upload (computador)

- [ ] Largar um WAV 24 bit (exportado de um DAW, com chunks `bext`/`iXML`): progresso, depois sample rate, bit depth e duração certos.
- [ ] Largar um WAV 16 bit e um MP3 (CBR e VBR): duração certa; no MP3 a forma de onda aparece depois de descodificado.
- [ ] Largar um WAV 32 bit float, um AIFF e um FLAC: recusados logo, com mensagem clara.
- [ ] Largar uma pasta do computador na página do artista: cria um projeto com as músicas lá dentro. Dentro de um projeto: cria uma pasta.
- [ ] Largar um ficheiro em cima de uma faixa: cria uma versão nova; nas versões aparece o nome do ficheiro e depois "v2".
- [ ] Fechar o separador a meio de um upload: a faixa não aparece; o ficheiro sai do R2 no dia seguinte.

### Organizar (computador)

- [ ] Arrastar uma faixa para o meio de outra: passa a ser a versão seguinte dela; "Anular" desfaz. Perto da borda de cima ou de baixo: muda a ordem.
- [ ] Arrastar uma versão (com a lista de versões aberta) para fora da faixa: passa a ser uma faixa à parte, logo a seguir; "Anular" desfaz.
- [ ] Arrastar faixas para cima de uma pasta: movem-se para lá.
- [ ] Selecionar arrastando a partir de qualquer espaço vazio, até ao fundo da janela.
- [ ] Botão direito numa faixa, numa pasta, numa versão e num espaço vazio: aparece o menu certo, sem ficar cortado pela tabela.
- [ ] Três pontinhos numa pasta → Apagar: apaga a pasta e tudo o que tem; "Anular" repõe.
- [ ] "Guardar" e "Feito" fecham sempre a janela em que estão.

### Player

- [ ] Clicar numa faixa só a abre; o botão ▶ da faixa (no número, ao passar o rato no computador; o círculo à esquerda no telemóvel) abre-a já a tocar.
- [ ] Play, pausa, voltar ao início, ±5 s e repetir (loop).
- [ ] Clicar e arrastar na forma de onda faz seek; com zoom (até 16×), arrastar desloca a forma de onda e, a tocar, a cabeça de leitura fica a meio.
- [ ] Mudar de versão a tocar mantém o segundo em que estava.
- [ ] Atalhos no computador: espaço, setas, Home, 1–9 (versões), + e −.
- [ ] Controlos no ecrã bloqueado do telemóvel (Media Session).
- [ ] Tocar uma faixa e voltar à lista, aos links ou ao perfil: no computador aparece a barra de baixo (controlos do leitor e linha para saltar); no telemóvel, o mini-leitor por cima do menu, com pausa. Tocar no título volta à faixa.
- [ ] Telemóvel: deslizar o mini-leitor para a esquerda passa à faixa seguinte da pasta; para a direita, à anterior.

### Links

- [ ] Link com password numa janela privada: pede a password; uma errada é recusada; a certa entra e continua válida ao recarregar (12 h).
- [ ] 5 passwords erradas: bloqueia 1 minuto com contagem decrescente. Fechar a janela privada e abrir outra (na mesma rede): continua bloqueado. Novos bloqueios duram 5, 15 e 60 minutos.
- [ ] Download desligado: não há botão. Ligado: o ficheiro descarrega com o nome "Artista - Título (v3 — nome).wav".
- [ ] Revogar, deixar expirar e apagar a faixa: o link mostra sempre a mesma página neutra.
- [ ] "Só a mais recente": uma versão nova substitui a anterior no link, sem criar outro.

### Firefox no Android

- [ ] O áudio começa ao tocar numa faixa, sem ter de carregar no play.
- [ ] Seek para o fim de uma faixa longa responde depressa (pedidos Range 206).
- [ ] WAV 24 bit e MP3 tocam.
- [ ] A lista de faixas e o player deslizam um sobre o outro; o botão "voltar" do Android regressa à lista.
- [ ] A barra de baixo (menu e controlos) não deixa espaço vazio por baixo, com a barra do Firefox em cima e em baixo.

### Firefox no computador

- [ ] WAV 24 bit EXTENSIBLE toca e faz seek.

### Safari no iPhone (quando houver um cliente com iPhone)

- [ ] O áudio começa ao primeiro toque.
- [ ] Seek e WAV 24 bit funcionam (o Safari aceita WAV PCM).

## Fase 2 — comentários

### Convidado

- [ ] Ao abrir um link com comentários pela primeira vez, o nome é obrigatório (não há como fechar o cartão). Nomes como "asd", "aaaa", "teste", com números ou links são recusados com uma mensagem.
- [ ] O tempo no campo segue a música até começares a escrever; tocar fixa o início, outro toque marca o fim (intervalo), outro volta ao tempo atual.
- [ ] O intervalo escolhido aparece pintado na forma de onda enquanto se escreve, e continua marcado depois de enviado (na cor de quem comentou).
- [ ] Enviar um comentário fecha o teclado no telemóvel; aparece na lista e como ponto na forma de onda.
- [ ] Telemóvel: manter premido na forma de onda abre um comentário nesse ponto, com o teclado aberto e o campo visível.
- [ ] Nota de voz no telemóvel: manter premido o microfone grava, largar envia; arrastar para a esquerda bloqueia (aparecem apagar e enviar). Gravar pausa a música.
- [ ] Nota de voz no computador: um clique começa a gravar (bloqueado); 1 minuto no máximo.
- [ ] Enquanto se grava, a forma de onda do microfone ocupa a largura toda do campo e mexe com a voz.
- [ ] Uma nota gravada no Firefox (Android) toca no Chrome do computador e vice-versa.
- [ ] "Responder" em qualquer mensagem de outra pessoa; a resposta entra na mesma conversa. Nas tuas, só na última que escreveste nessa conversa ("A acrescentar à tua mensagem").
- [ ] "Editar" nas tuas mensagens escritas no próprio dia (aparece "editado"); no dia seguinte já não dá. As notas de voz não se editam.
- [ ] Mudar o nome (tocar no nome sublinhado) muda-o nos comentários que já fizeste.
- [ ] Um link "só para ouvir" (comentários desligados) não mostra campo nem comentários.

### Dono

- [ ] Nota privada (🔒) não aparece a nenhum convidado; pública (👁) aparece com o teu nome do perfil.
- [ ] Editar as tuas mensagens em qualquer altura.
- [ ] Os comentários dos clientes aparecem com "via <nome do link>"; "✓ Feito" marca-os feitos na versão mais recente e o convidado vê "Feito em v3".
- [ ] Um pedido aberto numa versão antiga aparece nas novas com "de v2", até ser feito.
- [ ] Revisões: filtros Abertos/Resolvidos/Todos, o círculo marca e desmarca (com Anular), "Resolvido em" muda a versão; o tempo abre a faixa nesse ponto.
- [ ] Revisões: as respostas aparecem por baixo de cada pedido e "Responder" escreve (ou grava) uma resposta ali mesmo. No telemóvel o texto ocupa a largura toda.
- [ ] O contador das Revisões (barra lateral e separadores do telemóvel) e a coluna "Pedidos" acompanham.
- [ ] Biblioteca: "Atividade recente" mostra os últimos comentários dos clientes.
- [ ] Com duas janelas (dono e convidado), um comentário novo aparece na outra em menos de 15 s.

## Fase 3 — A/B e loudness

- [ ] Carregar um WAV e um MP3: a linha de métricas da faixa mostra LUFS, LRA e TP (TP acima de −1 dBTP a laranja); a tabela mostra LUFS-I e True peak.
- [ ] Uma versão carregada antes da Fase 3 é medida sozinha ao abrir a faixa no computador ("A medir o loudness desta versão… x%"); depois os valores ficam guardados.
- [ ] `npm run loudness` com 3–4 ficheiros teus em `fixtures/real/`: todos dentro de ±0,1 LU (integrado) e ±0,2 dB (true peak) do ffmpeg.
- [ ] Computador: com uma faixa de várias versões a tocar, mudar de versão (clique, teclas 1–9 ou B) é imediato, sem silêncio, e continua no mesmo segundo. B volta à versão anterior.
- [ ] Telemóvel: mudar de versão continua no mesmo segundo (pode haver um instante de carregamento: no telemóvel as outras versões não são pré-carregadas, para poupar dados).

## Fase 4 — letras

- [ ] Faixa (dono) → Adicionar letra: colar o texto, "Acertar tempos", tocar ▶ e carregar em Marcar (ou Enter) no início de cada linha; −/+ acerta 0,1 s; Desfazer volta atrás; Guardar.
- [ ] Colar uma letra com tempos ([00:12.50]…) ou importar um .lrc: os tempos ficam. Descarregar .lrc devolve o ficheiro.
- [ ] A linha cantada acende e fica à vista dentro da caixa da letra, sem a página saltar; clicar numa linha salta para ela; depois de fazer scroll à mão, espera 3 s antes de voltar a seguir.
- [ ] Numa faixa com várias versões: "Só a v2" guarda tempos só para essa versão; as outras continuam com os da faixa.
- [ ] Letra sem tempos aparece como texto simples.
- [ ] Convidado: a letra aparece no painel lateral (computador) e no separador "Letra" (telemóvel); com "Mostrar letra" desligado no link, não aparece.

## Fase 5 — acabamento

- [ ] Android (Firefox): abrir `/admin`, menu ⋮ → "Instalar" (ou "Adicionar ao ecrã principal"). O ícone da nectr aparece no ecrã principal e abre sem barra do browser.
- [ ] Android: abrir um link `/s/…` e instalar: o atalho tem o nome do projeto e abre nesse link.
- [ ] Modo de avião com a app aberta: aparece "Sem ligação à internet" no topo; o que já estava a tocar continua. Recarregar sem rede mostra a página "Sem ligação" com "Tentar outra vez".
- [ ] Ctrl+K (ou `/`) em qualquer página do dono: escrever parte de um nome (com ou sem acentos) mostra artistas, projetos, pastas e faixas; ↑/↓ e Enter abrem. No telemóvel, a lupa na Biblioteca.
- [ ] `?` abre a ajuda (ou "Ajuda" na barra lateral / Perfil no telemóvel); no link, o "?" no topo.
- [ ] Perfil → Aspeto → Claro: as páginas do dono ficam claras e a escolha fica guardada; os links continuam escuros.
- [ ] Com um diálogo aberto, Tab e Shift+Tab só andam dentro dele; Esc fecha.

## True peak dos MP3 (§18 do plano)

- [ ] Abrir no computador cada faixa MP3 já carregada: aparece "A medir o loudness desta versão…" e depois os valores. O true peak deve ficar a ±0,2 dB do Samply (um master do dono ≈ +0,7/+0,8 dBTP).
- [ ] Carregar um MP3 novo: os valores aparecem logo, sem esperar.

## Avisos (§19 do plano)

- [ ] `node scripts/push-key.mjs` corrido uma vez; Perfil → Avisos mostra "Ativar neste dispositivo".
- [ ] Android (Firefox): ativar no Perfil, aceitar o pedido do browser, "Enviar um teste": o aviso chega. Fechar o Firefox e pedir a alguém (ou a ti numa janela privada) que comente num link: o aviso chega com o browser fechado; tocar abre a faixa nessa conversa.
- [ ] Computador: o mesmo com o browser aberto noutra página.
- [ ] Convidado: no link, sino → "Ligar avisos". Responder-lhe (resposta pública) faz chegar o aviso; uma nota privada não.
- [ ] Carregar uma versão nova de uma faixa do link: o convidado recebe "Nova versão de …"; uma faixa nova: "Faixa nova: …"; várias de seguida: "N novidades: …" num só aviso.
- [ ] Revogar o link: deixam de chegar avisos desse link.
- [ ] Desligar no sino (convidado) ou "Desativar neste dispositivo" (dono): deixam de chegar.

## Espaço, apagar e volume (§20 do plano)

- [ ] Depois de apagar faixas, a barra lateral mostra só as versões que restam e "… apagados saem até d/m"; o Perfil mostra "Apagados" à parte na barra do espaço.
- [ ] Faixa com várias versões → 3 pontos → "Manter apenas a última versão" → confirmar: fica só a mais recente; "Anular" no aviso repõe as outras.
- [ ] Computador: o slider de volume ao lado do zoom (faixa do dono e do convidado) e no leitor do fundo; M tira e repõe o som; o nível mantém-se depois de recarregar.
- [ ] Telemóvel: não aparece slider de volume.

## Nome do projeto no Ableton (§21 do plano)

- [ ] 3 pontos de uma faixa → Mudar o nome → preencher "Nome do projeto no Ableton" → Guardar: aparece em itálico à frente do nome na lista e na página da faixa.
- [ ] Ctrl+K com parte desse nome encontra a faixa.
- [ ] No link do cliente (e em "Ver como convidado") esse nome não aparece.

## Nomes das versões (§22 do plano)

- [ ] Mudar o nome de uma faixa e arrastá-la para cima de outra: a outra mantém o título; na lista de versões, a nova versão (a principal) aparece com o nome que lhe deste.
- [ ] "Anular" no aviso: a faixa volta com o nome que tinha.
- [ ] Arrastar essa versão para fora: a faixa nova fica com esse nome.
- [ ] Largar um ficheiro novo em cima de uma faixa renomeada: o título não muda e o ficheiro passa a ser a versão principal.

## Menus das versões e barra lateral (§23 do plano)

- [ ] Abrir as versões de uma faixa (o v2/2 na lista) e carregar nos 3 pontos de uma versão: o menu abre junto ao botão; "Nome e notas", "Tornar faixa independente" e "Apagar versão" funcionam.
- [ ] Biblioteca: a seta no topo da barra lateral recolhe-a; recarregar mantém-na recolhida; outra vez, abre.
- [ ] Estreitar a janela (abaixo de ~1024 px): a barra recolhe-se sozinha; voltar a alargar: volta como estava.
- [ ] Página da faixa: recolhida ao entrar; a seta abre-a.

## Organização (§24 do plano)

- [ ] Deixar tocar uma faixa até ao fim: passa à seguinte da mesma pasta e a página muda para ela; com "repetir" ligado, repete. O botão ⏭ (depois do +5 s) faz o mesmo e fica apagado na última faixa.
- [ ] Novo projeto → Tipo "WIP" (ou Projeto live / Outra pasta): escolhe um ícone; na página do artista aparece em "Outros projetos", com o ícone; "Álbum / EP" fica em "Álbuns e EPs", com capa.
- [ ] As 24 cores aparecem em duas filas nos editores.
- [ ] 3 pontos de uma faixa → Capa da faixa → escolher uma imagem retangular: abre o recorte (arrastar, zoom), "Usar imagem" guarda; a capa aparece na página da faixa, no leitor e no link do cliente.
- [ ] Foto de perfil e foto do artista: o recorte abre (redondo no perfil) e a foto aparece bem enquadrada na barra lateral.
- [ ] Biblioteca: arrastar um artista para antes/depois de outro muda a ordem e mantém-se ao recarregar; no telemóvel, Ordenar → setas.
- [ ] Link de um projeto com subpastas: as pastas aparecem fechadas; clicar abre a pasta, a seta volta atrás (computador e telemóvel). Link de um artista: álbuns/EPs primeiro, depois os outros projetos. Um link cujo topo é uma só pasta abre logo nela.

## Segundo plano no telemóvel (§25 do plano)

- [ ] Android: tocar uma faixa e mudar para outra app: continua a tocar e aparece o leitor na aba de notificações (com capa, no Chrome também anterior/seguinte e a barra).
- [ ] Bloquear o telemóvel 10 minutos com música a tocar (várias faixas da mesma pasta): continua e passa à seguinte. Se parar, pôr a bateria do browser em "Sem restrições" e repetir.
- [ ] Os botões da notificação (tocar/pausa, seguinte) mexem no leitor da app, e a app mostra a faixa certa ao voltar.

## Quem entrou nos links (§26 do plano)

- [ ] Links: um link com comentários mostra "N pessoas entraram" e, ao abrir, os nomes, a data e os comentários de cada um.
- [ ] Num link, tentar entrar com "asdasd", "qweqwe" ou "jdksjdka": é recusado; "Marta" ou "Rui Costa" entram.

## Partilhas dos convidados (§27 do plano)

- [ ] Links: ligar "Partilhar" num link. No link (outro browser ou janela privada): abrir uma faixa → Partilhar → "Para quem?" → Criar link. O link novo abre só essa faixa, sem botão de descarregar e sem pedir password.
- [ ] Numa pasta: "Partilhar esta pasta" funciona igual.
- [ ] Na tua página Links aparece "1 partilha feita a partir deste link" com o nome de quem partilhou; e chega um aviso no telemóvel.
- [ ] Revogar o link de origem: a partilha deixa de abrir. Reativar: volta.
- [ ] Num link sem "Partilhar" ligado, o botão não aparece.

