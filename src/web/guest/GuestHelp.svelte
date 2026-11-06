<script lang="ts">
  import Dialog from "../components/Dialog.svelte";

  // "Como funciona" for whoever opens a link (the ? at the top).
  let { onclose, comments, phone }: { onclose: () => void; comments: boolean; phone: boolean } = $props();
</script>

<Dialog title="Como funciona" subtitle="Ouvir, comparar versões e deixar notas no ponto certo da música." {onclose}>
  <ul class="help-list">
    <li><b>Ouvir:</b> {phone ? "toca no ▶ ao lado de uma faixa para a ouvir logo, ou abre-a para ver tudo." : "clica numa faixa para a abrir; ▶ no número abre já a tocar."} Na forma de onda, {phone ? "toca" : "clica"} para saltar.</li>
    {#if !phone}<li><b>Volume:</b> no controlo ao lado do zoom; a tecla M tira e repõe o som.</li>{/if}
    <li><b>Pastas:</b> {phone ? "toca" : "clica"} numa pasta para a abrir; a seta no topo volta atrás. No fim de uma música passa à seguinte da mesma pasta (a não ser que tenhas o repetir ligado).</li>
    <li><b>Versões:</b> mudar de versão continua no mesmo segundo, para comparares{phone ? "" : " (a tecla B volta à anterior)"}.</li>
    {#if comments}
      <li><b>Comentar:</b> o tempo no campo segue a música até começares a escrever. Toca nele para fixar o início e outra vez para marcar o fim de um intervalo.</li>
      {#if phone}<li><b>Num ponto exato:</b> mantém o dedo na forma de onda.</li>{/if}
      <li><b>Nota de voz:</b> {phone ? "mantém premido o microfone e larga para enviar; arrasta para a esquerda para continuar sem segurar." : "clica no microfone; volta a clicar em enviar quando acabares."} Até 1 minuto.</li>
      <li><b>Responder e editar:</b> podes responder a qualquer mensagem e editar as tuas no dia em que as escreveste.</li>
      <li><b>Pedidos:</b> quando quem te enviou o link resolve um pedido, aparece "Feito" e a versão.</li>
    {/if}
    <li><b>Avisos:</b> o sino no topo avisa-te {comments ? "quando te responderem ou houver músicas novas" : "quando houver músicas novas"} neste link, sem teres de o abrir.</li>
    {#if phone}<li><b>Como uma app:</b> no menu do browser, "Adicionar ao ecrã principal" guarda este link no telemóvel.</li>{/if}
  </ul>
  {#snippet footer()}
    <button class="btn btn-primary" type="button" onclick={onclose}>Percebi</button>
  {/snippet}
</Dialog>
