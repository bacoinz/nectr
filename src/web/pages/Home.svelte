<main class="home">
  <div class="brand">
    <img src="/favicon.svg" alt="" width="56" height="56" />
    <h1>nectr</h1>
  </div>
  <p>Partilha e revisão de música.</p>
</main>

<style>
  .home {
    min-height: 100dvh;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: var(--space-3);
    padding: var(--space-6);
    text-align: center;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  h1 {
    margin: 0;
    font-size: 2.5rem;
    letter-spacing: -0.03em;
  }
  p {
    margin: 0;
    color: var(--fg-muted);
  }
</style>
