// Fa funzionare il sito anche senza rete (dai clienti il segnale spesso manca): i file del sito si tengono in memoria.
// Le chiamate a GitHub e alle mappe non passano di qui: vanno sempre direttamente in rete.
const VERSIONE = "rilievi-v1";
const FILE = ["./", "index.html", "app.js", "stile.css", "manifest.webmanifest", "icone/icona-180.png", "icone/icona-192.png", "icone/icona-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(nomi => Promise.all(nomi.filter(n => n !== VERSIONE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // prima la versione in memoria (subito, anche offline), intanto si aggiorna per la prossima volta
  e.respondWith(caches.open(VERSIONE).then(async cache => {
    const salvata = await cache.match(e.request, { ignoreSearch: true });
    const dallaRete = fetch(e.request).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => null);
    if (salvata) { e.waitUntil(dallaRete); return salvata; }
    return (await dallaRete) || (e.request.mode === "navigate" ? cache.match("index.html") : Response.error());
  }));
});
