// nectr service worker: makes the app installable and quick to open.
// It keeps only the app's own static files (the hashed /assets/*, icons).
// Never audio, voice notes, API answers or pages: those always come from the
// network, so nothing private or stale sits on the device.
const CACHE = "nectr-static-v1";

const OFFLINE = `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>nectr</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111014;color:#f1eef6;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}p{color:#a6a1b3}button{margin-top:12px;padding:10px 18px;border-radius:999px;border:0;background:#f4b740;color:#1d1404;font-weight:700}</style></head>
<body><div><h1>Sem ligação</h1><p>A nectr precisa de internet para abrir esta página.</p><button onclick="location.reload()">Tentar outra vez</button></div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Hashed build files and icons never change under the same name: cache first.
  if (url.pathname.startsWith("/assets/") || /^\/(icon-[\w-]+\.png|badge-96\.png|apple-touch-icon\.png|favicon\.svg)$/.test(url.pathname)) {
    e.respondWith(
      caches.open(CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          // Old builds' files would pile up after each deploy: keep the newest ones only.
          await c.put(req, res.clone());
          const keys = await c.keys();
          for (const k of keys.slice(0, Math.max(0, keys.length - 80))) await c.delete(k);
        }
        return res;
      }),
    );
    return;
  }
  // Pages: always the network; a friendly page when there is none.
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).catch(() => new Response(OFFLINE, { headers: { "Content-Type": "text/html; charset=utf-8" } })));
  }
});

// Notifications (Web Push): the Worker sends { title, body, tag, url }.
// Same tag = the earlier notification is replaced, quietly.
self.addEventListener("push", (e) => {
  let m = {};
  try {
    m = e.data ? e.data.json() : {};
  } catch {
    m = { body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(m.title || "nectr", {
      body: m.body || "",
      tag: m.tag || undefined,
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      lang: "pt-PT",
      data: { url: m.url || "/" },
    }),
  );
});

// A tap opens the place it is about: an open window of the same part of the
// app (the owner's pages, or that link) moves there; otherwise a new one.
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin);
  const part = (p) => (p.startsWith("/admin") ? "/admin" : p.split("/").slice(0, 3).join("/"));
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (list) => {
      const same = list.find((c) => part(new URL(c.url).pathname) === part(url.pathname));
      if (same) {
        await same.focus();
        same.postMessage({ type: "open", url: url.pathname + url.search });
        return;
      }
      await self.clients.openWindow(url.href);
    }),
  );
});
