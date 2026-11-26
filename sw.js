// Fa funzionare il sito anche senza rete (dai clienti il segnale spesso manca): i file del sito si tengono in memoria.
// Le chiamate a GitHub e alle mappe non passano di qui: vanno sempre direttamente in rete.
// Quando si pubblica una versione nuova basta cambiare VERSIONE: l'app la scarica da sola e si ricarica.
const VERSIONE = "rilievi-v10";
const FILE = ["./", "index.html", "app.js", "stile.css", "manifest.webmanifest", "icone/icona-180.png", "icone/icona-192.png", "icone/icona-512.png"];

self.addEventListener("install", e => {
  // cache: "reload" salta la memoria del browser (GitHub Pages tiene i file in cache per 10 minuti): si scaricano sempre quelli nuovi
  e.waitUntil(caches.open(VERSIONE).then(cache => Promise.all(FILE.map(async f => {
    const r = await fetch(new Request(f, { cache: "reload" }));
    if (!r.ok) throw new Error("File non scaricabile: " + f);
    await cache.put(f, r);
  }))).then(() => self.skipWaiting()));
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
