<script lang="ts">
  import Dialog from "../components/Dialog.svelte";

  // "Ajuda" for the owner (rail, phone profile, or the ? key): shortcuts and how things work.
  let { onclose }: { onclose: () => void } = $props();
  const keys: [string, string][] = [
    ["Espaço", "Tocar / pausa"],
    ["← →", "Recuar / avançar 5 s"],
    ["Home", "Voltar ao início"],
    ["1 – 9", "Escolher a versão"],
    ["B", "Voltar à versão anterior (A/B)"],
    ["+ −", "Zoom na forma de onda"],
    ["M", "Sem som / com som"],
    ["Ctrl K  ou  /", "Procurar"],
    ["?", "Esta ajuda"],
    ["Delete", "Apagar o que está selecionado"],
    ["Ctrl A", "Selecionar tudo na lista"],
  ];
</script>

<Dialog title="Ajuda" subtitle="O essencial da nectr, em pouco espaço." {onclose} wide>
  <div class="help-grid">
    <section>
      <h3>Atalhos de teclado</h3>
      <dl class="keys">
        {#each keys as [k, what] (k)}<dt><kbd>{k}</kbd></dt><dd>{what}</dd>{/each}
      </dl>
    </section>
    <section>
      <h3>Organizar</h3>
      <ul>
        <li>Biblioteca → artista → projeto → pastas → faixas. Um projeto é um álbum/EP (com capa) ou uma pasta de trabalho (WIP, projeto live, outra), que aparece com ícone e em separado.</li>
        <li>Na Biblioteca, arrasta os artistas para mudar a ordem (no telemóvel: o botão Ordenar).</li>
        <li>Cada faixa pode ter capa própria (3 pontos → Capa da faixa). Ao escolher uma imagem, enquadras antes de guardar.</li>
        <li>Larga ficheiros em qualquer lado da página; em cima de uma faixa criam uma versão nova. Uma pasta inteira vira um projeto.</li>
        <li>Arrastar uma faixa para cima de outra junta-a como versão; arrastar uma versão para fora separa-a.</li>
        <li>Botão direito em faixas, pastas e espaço vazio abre os menus.</li>
      </ul>
    </section>
    <section>
      <h3>Partilhar</h3>
      <ul>
        <li>Um link pode ser de um artista, projeto, pasta ou faixa, com password e validade opcionais.</li>
        <li>"Só a mais recente" troca sozinha quando carregas uma versão nova.</li>
        <li>Sem download, ninguém descarrega o ficheiro, mas quem ouve pode sempre gravar o som.</li>
        <li>O olho, no fundo da página, mostra o que um convidado vê.</li>
      </ul>
    </section>
    <section>
      <h3>Comentários e revisões</h3>
      <ul>
        <li>As tuas notas são privadas (🔒) ou públicas (👁); as privadas nunca saem para os links.</li>
        <li>Os pedidos dos clientes ficam em Revisões até os marcares como feitos; um pedido aberto passa para as versões seguintes.</li>
        <li>Toca no tempo do campo para fixar o início; outra vez, o fim (intervalo).</li>
      </ul>
    </section>
    <section>
      <h3>Letra</h3>
      <ul>
        <li>Cola a letra (ou importa um .lrc), toca a música e carrega em Marcar no início de cada linha.</li>
        <li>Os tempos podem ser só de uma versão, quando a introdução muda.</li>
      </ul>
    </section>
    <section>
      <h3>Limites e telemóvel</h3>
      <ul>
        <li>O plano gratuito do R2 guarda 10 GB (cerca de 115 WAV de 5 min); o medidor está na barra lateral e no Perfil.</li>
        <li>No Android, o menu do browser tem "Instalar app" (ou "Adicionar ao ecrã principal"): a nectr abre como uma app.</li>
        <li>Perfil → Avisos: um aviso no telemóvel quando um convidado comenta. Os convidados ligam os deles no sino do link (respostas tuas e músicas novas).</li>
      </ul>
    </section>
  </div>
  {#snippet footer()}
    <button class="btn btn-primary" type="button" onclick={onclose}>Fechar</button>
  {/snippet}
</Dialog>
