"use strict";
/* Rilievi Giodè — sito per iPhone/iPad: cliente, indirizzo (con mappe), stanze, misure delle aperture e foto.
   Tutto si salva sul telefono (IndexedDB, anche senza rete) e con «Invia» passa al repository privato su GitHub,
   da cui il programma sul PC lo scarica. Nessun altro server: i dati vanno solo dal telefono a GitHub. */

const TIPI_APERTURA = ["Finestra", "Portafinestra", "Porta", "Vetrata", "Nicchia", "Altro"];
const INSTALLAZIONI = ["A soffitto", "A parete", "Dentro il vano", "Fuori dal vano"];
const TENDE = ["Tenda a onda", "Tenda a pieghe", "Tenda a pannello", "Tenda a pacchetto", "Tenda a rullo", "Plissé", "Veneziana", "Tenda a vetro", "Doppia tenda (velo e tessuto)"];
const CATEGORIE = {
  "Zona giorno": ["Soggiorno", "Sala da pranzo", "Cucina", "Ingresso", "Corridoio"],
  "Zona notte": ["Camera da letto", "Cameretta", "Studio"],
  "Bagno": ["Bagno", "Bagno di servizio"],
  "Altri ambienti": ["Lavanderia", "Taverna", "Mansarda", "Terrazzo/Balcone", "Altro"],
};
const MISURE = [["larghezza", "Larghezza"], ["altezza_sx", "Altezza sinistra"], ["altezza_dx", "Altezza destra"],
                ["altezza_davanzale", "Altezza davanzale"], ["altezza_soffitto", "Altezza soffitto"]];
// nei rilievi fatti prima c'era una sola «Altezza»: se è compilata si continua a mostrarla
const misureDi = a => (a.altezza !== undefined && a.altezza !== "") ? [MISURE[0], ["altezza", "Altezza (vecchio rilievo)"], ...MISURE.slice(1)] : MISURE;
const CHIAVE_CONFIG = "giode_rilievi_cfg";
const API = "https://api.github.com";
const VERSIONE_APP = "15 (26/11/2026)";   // da cambiare insieme a VERSIONE in sw.js a ogni pubblicazione

const $app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const adesso = () => new Date().toISOString();
const oggi = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const nuovoId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, "") : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""));
const breve = () => Math.random().toString(36).slice(2, 8);
const inRete = () => navigator.onLine !== false;
const standalone = () => window.navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);

// ------------------------------------------------------------------------------------------------ messaggi
function avviso(testo, tipo, ms) {
  const box = document.getElementById("avvisi");
  const el = document.createElement("div");
  el.className = "avviso" + (tipo ? " avviso-" + tipo : "");
  el.textContent = testo;
  box.appendChild(el);
  setTimeout(() => el.remove(), ms || (tipo === "err" ? 7000 : 3000));
}

// ------------------------------------------------------------------------------------------------ archivio sul telefono
const db = (() => {
  let aperto;
  const apri = () => aperto || (aperto = new Promise((ok, ko) => {
    const r = indexedDB.open("giode-rilievi", 4);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains("preventivi")) d.createObjectStore("preventivi", { keyPath: "id" });   // preventivi in corso, dal PC
      if (!d.objectStoreNames.contains("clienti")) d.createObjectStore("clienti", { keyPath: "id" });   // elenco clienti del PC
      if (!d.objectStoreNames.contains("rilievi")) d.createObjectStore("rilievi", { keyPath: "id" });
      if (!d.objectStoreNames.contains("foto")) d.createObjectStore("foto");
      if (!d.objectStoreNames.contains("appuntamenti")) d.createObjectStore("appuntamenti", { keyPath: "id" });   // calendario
    };
    r.onblocked = () => avviso("Chiudi le altre schede o finestre dell'app per completare l'aggiornamento.", "err", 9000);
    r.onsuccess = () => {
      r.result.onversionchange = () => { r.result.close(); location.reload(); };   // un'altra versione dell'app apre l'archivio: ci si fa da parte
      ok(r.result);
    };
    r.onerror = () => ko(r.error);
  }));
  async function op(archivio, modo, fn) {
    const d = await apri();
    return new Promise((ok, ko) => {
      const t = d.transaction(archivio, modo);
      const richiesta = fn(t.objectStore(archivio));
      t.oncomplete = () => ok(richiesta ? richiesta.result : undefined);
      t.onerror = t.onabort = () => ko(t.error);
    });
  }
  const intervallo = id => IDBKeyRange.bound(id + "/", id + "/￿");
  return {
    tutti: () => op("rilievi", "readonly", s => s.getAll()),
    leggi: id => op("rilievi", "readonly", s => s.get(id)),
    salva: r => op("rilievi", "readwrite", s => s.put(r)),
    elimina: async id => { await op("rilievi", "readwrite", s => s.delete(id)); await op("foto", "readwrite", s => s.delete(intervallo(id))); },
    tuttiPreventivi: () => op("preventivi", "readonly", s => s.getAll()),
    sostituisciPreventivi: async lista => {
      const d = await apri();
      return new Promise((ok, ko) => {
        const t = d.transaction("preventivi", "readwrite"), s = t.objectStore("preventivi");
        s.clear(); lista.forEach(p => s.put(p));
        t.oncomplete = () => ok(); t.onerror = t.onabort = () => ko(t.error);
      });
    },
    tuttiClienti: () => op("clienti", "readonly", s => s.getAll()),
    sostituisciClienti: async lista => {
      const d = await apri();
      return new Promise((ok, ko) => {
        const t = d.transaction("clienti", "readwrite"), s = t.objectStore("clienti");
        s.clear(); lista.forEach(c => s.put(c));
        t.oncomplete = () => ok(); t.onerror = t.onabort = () => ko(t.error);
      });
    },
    tuttiApp: () => op("appuntamenti", "readonly", s => s.getAll()),
    leggiApp: id => op("appuntamenti", "readonly", s => s.get(id)),
    salvaApp: a => op("appuntamenti", "readwrite", s => s.put(a)),
    salvaFoto: (chiave, blob) => op("foto", "readwrite", s => s.put(blob, chiave)),
    leggiFoto: chiave => op("foto", "readonly", s => s.get(chiave)),
    chiaviFoto: id => op("foto", "readonly", s => s.getAllKeys(intervallo(id))),
    eliminaFoto: chiave => op("foto", "readwrite", s => s.delete(chiave)),
  };
})();

// ------------------------------------------------------------------------------------------------ collegamento a GitHub
function config() {
  try { const c = JSON.parse(localStorage.getItem(CHIAVE_CONFIG) || "null"); return c && c.r && c.t ? { r: c.r, t: c.t, b: c.b || "main" } : null; }
  catch (e) { return null; }
}
function salvaConfig(c) { try { localStorage.setItem(CHIAVE_CONFIG, JSON.stringify(c)); } catch (e) { avviso("Il telefono non permette di salvare le impostazioni (navigazione privata?).", "err"); } }

function decodificaLink(testo) {
  const m = String(testo || "").match(/#cfg=([A-Za-z0-9_\-]+)/) || String(testo || "").match(/^([A-Za-z0-9_\-]{20,})$/);
  if (!m) return null;
  try {
    let b = m[1].replace(/-/g, "+").replace(/_/g, "/");
    b += "=".repeat((4 - b.length % 4) % 4);
    const dati = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b), c => c.charCodeAt(0))));
    return typeof dati.r === "string" && typeof dati.t === "string" && /^[\w.\-]+\/[\w.\-]+$/.test(dati.r) ? { r: dati.r, t: dati.t, b: dati.b || "main" } : null;
  } catch (e) { return null; }
}

function importaDaIndirizzo() {
  if (!location.hash.startsWith("#cfg=")) return;
  const c = decodificaLink(location.hash);
  if (c) {
    salvaConfig(c);
    // Nella scheda di Safari l'indirizzo resta com'è: così «Aggiungi alla schermata Home» porta con sé il collegamento
    // (su iPhone l'app sulla Home ha un proprio spazio dati). Dentro l'app installata, invece, lo si toglie.
    if (standalone()) history.replaceState(null, "", location.pathname + location.search);
    setTimeout(() => avviso("Collegato a " + c.r + ".", "ok", 4500), 400);
  } else setTimeout(() => avviso("Il link di collegamento non è valido.", "err"), 400);
}

async function gh(metodo, percorso, corpo) {
  const c = config();
  if (!c) throw new Error("Il telefono non è ancora collegato a GitHub (Impostazioni).");
  const url = `${API}/repos/${c.r}/contents/${percorso.split("/").map(encodeURIComponent).join("/")}` + (metodo === "GET" ? `?ref=${encodeURIComponent(c.b)}` : "");
  const opz = { method: metodo, headers: { Authorization: "Bearer " + c.t, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" } };
  if (corpo) { opz.headers["Content-Type"] = "application/json"; opz.body = JSON.stringify({ ...corpo, branch: c.b }); }
  let r;
  try { r = await fetch(url, opz); } catch (e) { throw new Error("Nessuna connessione: riprova quando c'è rete."); }
  if (r.status === 404 && metodo === "GET") return null;
  if (r.ok) return r.json();
  const messaggi = { 401: "La chiave di accesso non è valida o è scaduta.", 403: "La chiave non ha il permesso di scrivere (serve «Contents: Read and write»).",
                     404: "Repository non trovato: controlla il nome e che la chiave sia per quel repository.", 409: "Conflitto su GitHub, riprova.", 422: "GitHub ha rifiutato il file." };
  const errore = new Error(messaggi[r.status] || `GitHub ha risposto con l'errore ${r.status}.`);
  errore.stato = r.status;
  throw errore;
}

const aBase64Testo = s => { const b = new TextEncoder().encode(s); let t = ""; for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(t); };
const blobABase64 = blob => new Promise((ok, ko) => { const f = new FileReader(); f.onload = () => ok(String(f.result).split(",")[1]); f.onerror = () => ko(f.error); f.readAsDataURL(blob); });

// ------------------------------------------------------------------------------------------------ dati del rilievo
function nomiFoto(r) {
  const nomi = [...(r.foto || [])];
  for (const s of r.stanze || []) { nomi.push(...(s.foto || [])); for (const a of s.aperture || []) nomi.push(...(a.foto || [])); }
  return nomi;
}
// una bozza (rilievo nuovo non ancora salvato con «Salva») non si manda al PC
const daInviare = r => !r.bozza && (!(r._sync && r._sync.inviato === r.modificato) || nomiFoto(r).some(n => !(r._sync.foto || {})[n]));
const contaAperture = r => (r.stanze || []).reduce((n, s) => n + (s.aperture || []).length, 0);
// rilievo senza niente dentro (nessun dato del cliente, indirizzo, note, stanze o foto): non vale la pena tenerlo
const rilievoVuoto = r => !r.eliminato && !(r.cliente && (r.cliente.nome || r.cliente.telefono || r.cliente.email)) && !(r.indirizzo && r.indirizzo.testo)
  && !String(r.note || "").trim() && !(r.stanze || []).length && !(r.foto || []).length;

function nuovoRilievo() {
  const t = adesso();
  return { id: nuovoId(), versione: 1, data: oggi(), creato: t, modificato: t, bozza: true, cliente: { nome: "", telefono: "", email: "" },
           indirizzo: { testo: "", lat: null, lon: null }, note: "", stanze: [], foto: [], _sync: { inviato: "", foto: {} } };
}
const nuovaApertura = () => ({ id: breve() + breve(), tipo: "Finestra", larghezza: "", altezza_sx: "", altezza_dx: "", altezza_davanzale: "", altezza_soffitto: "",
                               installazione: "", tenda_desiderata: "", note: "", foto: [] });

function nomeStanzaUnivoco(nome, esistenti) {
  nome = nome.trim().replace(/\s+/g, " ");
  const usati = new Set(esistenti.map(e => e.toLowerCase()));
  if (!usati.has(nome.toLowerCase())) return nome;
  const base = nome.replace(/\s+\d+$/, "") || nome;
  let n = 2;
  while (usati.has(`${base} ${n}`.toLowerCase())) n++;
  return `${base} ${n}`;
}

const percorsoDi = (obj, percorso) => percorso.reduce((o, k) => o[k], obj);
function impostaPercorso(obj, percorso, valore) { percorsoDi(obj, percorso.slice(0, -1))[percorso[percorso.length - 1]] = valore; }

// ------------------------------------------------------------------------------------------------ salvataggio automatico
let rilievo = null, timerSalva = null, apertiStanze = new Set();

async function salvaOra() {
  clearTimeout(timerSalva); timerSalva = null;
  if (!rilievo) return;
  const copia = JSON.parse(JSON.stringify(rilievo));
  const attuale = await db.leggi(copia.id);
  if (attuale && attuale._sync) copia._sync = attuale._sync;    // l'esito degli invii non si perde con le modifiche
  await db.salva(copia);
  const el = document.getElementById("stato-salvataggio");
  if (el) el.textContent = "Salvato ✓";
}
function cambiato() {
  rilievo.modificato = adesso();
  const el = document.getElementById("stato-salvataggio");
  if (el) el.textContent = "Salvo…";
  clearTimeout(timerSalva);
  timerSalva = setTimeout(() => salvaOra().catch(e => avviso("Non riesco a salvare sul telefono: " + e.message, "err")), 400);
}
addEventListener("pagehide", () => { if (timerSalva) salvaOra(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && timerSalva) salvaOra(); });

// ------------------------------------------------------------------------------------------------ foto
const urlFoto = [];
async function comprimi(file, massimo = 1600, qualita = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const f = Math.min(1, massimo / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * f)); c.height = Math.max(1, Math.round(img.naturalHeight * f));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok, ko) => c.toBlob(b => b ? ok(b) : ko(new Error("Foto non convertibile")), "image/jpeg", qualita));
  } finally { URL.revokeObjectURL(url); }
}

async function aggiungiFoto(files, percorso) {
  const destinazione = percorsoDi(rilievo, percorso);
  destinazione.foto = destinazione.foto || [];
  let fatte = 0;
  for (const file of files) {
    try {
      const blob = await comprimi(file);
      const nome = `${Date.now().toString(36)}${breve()}.jpg`;
      await db.salvaFoto(`${rilievo.id}/${nome}`, blob);
      destinazione.foto.push(nome);
      fatte++;
    } catch (e) { avviso("Una foto non si è potuta usare: " + (e.message || e), "err"); }
  }
  if (fatte) { cambiato(); await salvaOra(); disegnaEditor(); avviso(fatte === 1 ? "Foto aggiunta." : `${fatte} foto aggiunte.`, "ok"); }
}

// La foto di un rilievo fatto con un altro telefono non è qui: si scarica da GitHub (se non è stata tolta) e si tiene sul telefono.
async function fotoDaGithub(rilievoId, nome) {
  const c = config();
  if (!c || !inRete()) return null;
  try {
    const r = await fetch(`${API}/repos/${c.r}/contents/foto/${encodeURIComponent(rilievoId)}/${encodeURIComponent(nome)}?ref=${encodeURIComponent(c.b)}`,
      { headers: { Authorization: "Bearer " + c.t, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" } });
    if (!r.ok) return null;
    const blob = await r.blob();
    await db.salvaFoto(`${rilievoId}/${nome}`, blob);
    return blob;
  } catch (e) { return null; }
}
async function leggiFotoLocaleOGithub(rilievoId, nome) {
  return (await db.leggiFoto(`${rilievoId}/${nome}`)) || (await fotoDaGithub(rilievoId, nome));
}

async function caricaMiniature() {
  urlFoto.splice(0).forEach(u => URL.revokeObjectURL(u));
  const mio = rilievo && rilievo.id;
  for (const img of document.querySelectorAll("img[data-foto]")) {
    const blob = await leggiFotoLocaleOGithub(mio, img.dataset.foto);
    if (!rilievo || rilievo.id !== mio) return;     // nel frattempo si è cambiata schermata
    if (blob) { const u = URL.createObjectURL(blob); urlFoto.push(u); img.src = u; }
    else { img.alt = "Foto non disponibile"; img.parentElement.title = "Foto non disponibile: era di un altro telefono ed è già stata tolta da GitHub"; img.parentElement.style.opacity = ".4"; }
  }
}

async function apriVisore(nome, percorso) {
  const blob = await leggiFotoLocaleOGithub(rilievo.id, nome);
  if (!blob) { avviso("Questa foto non è più sul telefono né su GitHub.", "err"); return; }
  const url = URL.createObjectURL(blob);
  const v = document.createElement("div");
  v.className = "visore";
  v.innerHTML = `<img alt="Foto"><div class="azioni"><button class="btn btn-pericolo" data-az="elimina">Elimina foto</button><button class="btn" data-az="chiudi">Chiudi</button></div>`;
  v.querySelector("img").src = url;
  const chiudi = () => { URL.revokeObjectURL(url); v.remove(); };
  v.addEventListener("click", async e => {
    const az = e.target.dataset.az;
    if (az === "chiudi") chiudi();
    if (az === "elimina" && confirm("Eliminare questa foto?")) {
      const d = percorsoDi(rilievo, percorso);
      d.foto = d.foto.filter(n => n !== nome);      // il file si toglie dal telefono al salvataggio: così «Non salvare» può riportarla
      cambiato(); await salvaOra(); chiudi(); disegnaEditor();
    }
  });
  document.body.appendChild(v);
}

// ------------------------------------------------------------------------------------------------ indirizzo e mappe
// l'indirizzo così com'è scritto, su una riga: le mappe lo trovano meglio senza aggiunte
const unaRiga = s => String(s || "").split("\n").map(r => r.trim().replace(/,+$/, "")).filter(Boolean).join(", ");


// ---- punto esatto del cliente: preso sul posto con un telefono, o incollato nella sua scheda sul PC ----
// Con il punto, Mappe dell'iPhone e Google Maps ricevono le stesse coordinate e aprono lo stesso posto; senza, cercano
// l'indirizzo scritto (e possono non coincidere). Le regole sono le stesse del programma sul PC.
let rilieviConPunto = [];
const haPunto = r => !r.eliminato && !!(r.indirizzo && r.indirizzo.gps && r.indirizzo.lat != null && r.indirizzo.lon != null);
async function caricaPunti() { rilieviConPunto = (await db.tutti()).filter(haPunto); }
// il rilievo aperto cambia prima di essere salvato: si aggiorna subito il suo punto (preso o tolto)
const aggiornaPunto = r => { rilieviConPunto = rilieviConPunto.filter(x => x.id !== r.id).concat(haPunto(r) ? [r] : []); };
// stesso posto? uno dei due indirizzi può avere meno parole, ma il numero civico non deve cambiare; vuoto va con tutti
function stessoIndirizzo(a, b) {
  const parti = s => String(s || "").toLowerCase().match(/[a-zà-ù0-9]+/g) || [];
  const civici = t => t.filter(p => /^\d{1,4}$/.test(p)), parole = t => t.filter(p => !/^\d+$/.test(p));
  const x = parti(a), y = parti(b), cx = civici(x), cy = civici(y), px = parole(x), py = parole(y);
  if (cx.length && cy.length && !cx.some(n => cy.includes(n))) return false;
  return px.every(p => py.includes(p)) || py.every(p => px.includes(p));
}
// «lat,lon» del cliente per quell'indirizzo (vince il punto più recente), oppure ""
function puntoCliente(indirizzo, chi = {}) {
  const nome = normNome(chi.nome);
  const c = clientiPC.find(x => x.id === chi.id) || (nome ? clientiPC.find(x => normNome(x.nome) === nome) : undefined);
  const trovati = [];
  if (c && c.punto_il && stessoIndirizzo(indirizzo, indirizzoCliente(c))) trovati.push({ punto: c.punto || "", il: c.punto_il });   // vuoto = tolto sul PC
  for (const r of rilieviConPunto) {
    const suo = (chi.id && r.cliente_id === chi.id) || (c && r.cliente_id === c.id) || (nome && normNome(r.cliente && r.cliente.nome) === nome);
    if (suo && stessoIndirizzo(indirizzo, r.indirizzo.testo)) trovati.push({ punto: `${r.indirizzo.lat},${r.indirizzo.lon}`, il: r.indirizzo.gps_il || "" });
  }
  trovati.sort((a, b) => b.il.localeCompare(a.il));
  return trovati.length ? trovati[0].punto : "";
}
// i collegamenti alle due mappe: «dove» è il punto esatto («lat,lon») oppure l'indirizzo scritto
function urlMappe(dove, esatto) {
  const q = encodeURIComponent(dove);
  return {
    apple: esatto ? `https://maps.apple.com/?ll=${dove}&q=${q}` : `https://maps.apple.com/?q=${q}`,
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
    appleIndicazioni: `https://maps.apple.com/?daddr=${q}&dirflg=d`,
    indicazioni: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
  };
}
function pulsantiMappe(dove, esatto) {
  const u = urlMappe(dove, esatto);
  return `<a class="btn btn-piccolo" href="${esc(u.apple)}" target="_blank" rel="noopener">🗺 Mappe</a>
          <a class="btn btn-piccolo" href="${esc(u.google)}" target="_blank" rel="noopener">📍 Google Maps</a>`;
}

function linkMappe() {
  const i = rilievo.indirizzo, testo = unaRiga(i.testo);
  // prima la posizione presa qui, poi il punto del cliente, poi l'indirizzo scritto
  const qui = haPunto(rilievo) ? `${i.lat},${i.lon}` : "";
  const delCliente = qui ? "" : puntoCliente(testo, { id: rilievo.cliente_id, nome: rilievo.cliente.nome });
  const vecchie = !testo && i.lat != null && i.lon != null ? `${i.lat},${i.lon}` : "";
  const esatto = qui || delCliente || vecchie;
  if (!esatto && !testo) return `<span class="muted small">Scrivi l'indirizzo o usa la posizione per aprire le mappe.</span>`;
  return pulsantiMappe(esatto || testo, !!esatto) + `<span class="muted small" style="flex-basis:100%">${esatto
    ? `📍 Le mappe aprono il punto esatto${delCliente ? " salvato per questo cliente" : ""}.`
    : "Le mappe cercano l'indirizzo scritto. Sul posto usa «Usa la mia posizione»."}</span>`;
}
const aggiornaLinkMappe = () => { const el = document.getElementById("mappe"); if (el) el.innerHTML = linkMappe(); };

function indirizzoDa(risposta) {
  const a = risposta.address || {};
  const via = [a.road || a.pedestrian || a.footway || "", a.house_number || ""].filter(Boolean).join(" ");
  const citta = a.city || a.town || a.village || a.municipality || a.hamlet || "";
  const prov = a["ISO3166-2-lvl6"] ? a["ISO3166-2-lvl6"].split("-")[1] : "";
  const luogo = [a.postcode, citta].filter(Boolean).join(" ") + (prov ? ` (${prov})` : "");
  return [via, luogo.trim()].filter(Boolean).join(", ") || risposta.display_name || "";
}

async function usaPosizione() {
  if (!navigator.geolocation) { avviso("Il telefono non permette di leggere la posizione.", "err"); return; }
  avviso("Cerco la posizione…");
  let pos;
  try { pos = await new Promise((ok, ko) => navigator.geolocation.getCurrentPosition(ok, ko, { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 })); }
  catch (e) { avviso(e.code === 1 ? "Posizione negata: attivala in Impostazioni → Privacy → Localizzazione per Safari." : "Posizione non disponibile qui.", "err", 6000); return; }
  rilievo.indirizzo.lat = +pos.coords.latitude.toFixed(6);
  rilievo.indirizzo.lon = +pos.coords.longitude.toFixed(6);
  rilievo.indirizzo.gps = true;
  rilievo.indirizzo.gps_il = adesso();   // tra più punti dello stesso cliente vale il più recente
  if (String(rilievo.indirizzo.testo || "").trim()) avviso("Posizione salvata ✓ Mappe e Google Maps aprono questo punto. L'indirizzo scritto non è stato cambiato.", "ok", 5000);
  else {   // indirizzo ancora vuoto: si prova a compilarlo dalla posizione
    let testo = "";
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=it&lat=${rilievo.indirizzo.lat}&lon=${rilievo.indirizzo.lon}`);
      if (r.ok) testo = indirizzoDa(await r.json());
    } catch (e) { /* senza rete restano le coordinate */ }
    rilievo.indirizzo.testo = testo || `Posizione ${rilievo.indirizzo.lat}, ${rilievo.indirizzo.lon}`;
    avviso(testo ? "Indirizzo trovato: controllalo e correggi se serve." : "Posizione salvata (l'indirizzo non si è potuto cercare: scrivilo a mano).", testo ? "ok" : "", 5000);
  }
  aggiornaPunto(rilievo); cambiato(); disegnaEditor();
}

// ------------------------------------------------------------------------------------------------ viste
function barra(titolo, { indietro, impostazioni, stato } = {}) {
  return `<header class="barra">${indietro ? `<button data-az="indietro" aria-label="Indietro">‹</button>` : ""}<h1>${esc(titolo)}</h1>
    ${stato ? `<span class="stato" id="stato-salvataggio">${esc(stato)}</span>` : ""}
    ${impostazioni ? `<button data-az="impostazioni" aria-label="Impostazioni">⚙︎</button>` : ""}</header>`;
}

// elenco dei rilievi: per data (il più recente in cima), con la data in vista e la ricerca
let cercaRilievo = "", rilieviHome = [];
const dataDelRilievo = (iso, opzioni) => { const d = new Date(iso + "T12:00:00"); return isNaN(d) ? String(iso || "") : d.toLocaleDateString("it-IT", opzioni); };
const dataBreve = iso => dataDelRilievo(iso, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
// quello in cui si cerca: cliente, telefono, indirizzo, numero del preventivo e la data (26/11/2026 oppure «26 novembre»)
const testoRilievo = r => normNome([r.cliente.nome, r.cliente.telefono, r.cliente.email, r.indirizzo.testo, r.preventivo_numero,
  dataBreve(r.data), dataDelRilievo(r.data, { day: "numeric", month: "long", year: "numeric" })].join(" "));

function schedeRilievi() {
  const parole = normNome(cercaRilievo).split(" ").filter(Boolean);
  const trovati = rilieviHome.filter(r => { const testo = testoRilievo(r); return parole.every(p => testo.includes(p)); });
  return trovati.map(r => `<div class="card cliccabile" data-apri="${esc(r.id)}">
      <div class="riga"><span class="data-rilievo">📅 ${esc(dataBreve(r.data))}</span><span class="spazio"></span>
        ${r.bozza ? `<span class="badge badge-attesa">bozza: non salvato</span>` : daInviare(r) ? `<span class="badge badge-attesa">da inviare</span>` : `<span class="badge badge-ok">inviato</span>`}</div>
      <div class="rilievo-titolo">${esc(r.cliente.nome || "Cliente senza nome")}</div>
      ${r.indirizzo.testo ? `<div class="rilievo-riga">${esc(r.indirizzo.testo)}</div>` : ""}
      <div class="rilievo-riga">${(r.stanze || []).length} stanze · ${contaAperture(r)} aperture · ${nomiFoto(r).length} foto</div></div>`).join("")
    || `<div class="vuoto">${rilieviHome.length ? "Nessun rilievo trovato." : "Nessun rilievo.<br>Premi «Nuovo rilievo» per cominciare il primo sopralluogo."}</div>`;
}

async function vistaHome(conservaScroll) {
  const scrollPrima = window.scrollY;
  rilievo = null;
  rilieviHome = (await db.tutti()).filter(r => !r.eliminato).sort((a, b) => (b.data + b.modificato).localeCompare(a.data + a.modificato));
  const cfg = config();
  const attesa = rilieviHome.filter(daInviare).length;
  const testoInvia = `⟳ Invia al PC${attesa ? ` (${attesa})` : ""}`;
  const box = document.getElementById("elenco-rilievi");
  if (box && conservaScroll) {   // aggiornamento mentre si guarda l'elenco: la casella di ricerca (e la tastiera) restano
    box.innerHTML = schedeRilievi();
    const invia = $app.querySelector('[data-az="invia"]');
    if (invia) { invia.textContent = testoInvia; invia.disabled = !(cfg && attesa); }
    return;
  }
  const appenaCollegato = cfg && !standalone() && location.hash.startsWith("#cfg=");
  $app.innerHTML = barra("Rilievi Giodè", { impostazioni: true }) + `<main>${schede("rilievi")}
    ${appenaCollegato ? `<div class="banner"><strong>Collegato ✓</strong> Per avere l'app sulla schermata Home, <strong>adesso</strong> tocca Condividi <span aria-hidden="true">⬆︎</span> → «Aggiungi alla schermata Home» da questa pagina, poi aprila dall'icona.</div>` : ""}
    ${cfg ? "" :`<div class="banner"><strong>Manca il collegamento al computer.</strong> Puoi già fare i rilievi, ma per mandarli al PC serve il collegamento: apri <a href="#/impostazioni">Impostazioni</a>.</div>`}
    <input id="cerca-rilievo" type="search" placeholder="Cerca per cliente, indirizzo o data" value="${esc(cercaRilievo)}" autocomplete="off" style="margin-bottom:.8rem">
    <div id="elenco-rilievi">${schedeRilievi()}</div>
  </main>
  <div class="fondo"><div><button class="btn btn-primario" data-az="nuovo">+ Nuovo rilievo</button>
    <button class="btn" data-az="invia" ${cfg && attesa ? "" : "disabled"}>${testoInvia}</button></div></div>`;
  window.scrollTo(0, conservaScroll ? scrollPrima : 0);
}

// ------------------------------------------------------------------------------------------------ clienti del PC
// L'elenco dei clienti arriva dal computer (file clienti.json nell'archivio privato) e si sceglie da qui: così non si creano doppioni.
let clientiPC = [];
const normNome = s => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();

async function aggiornaClienti() {
  if (!config() || !inRete()) return false;
  try {
    const f = await gh("GET", "clienti.json");
    if (!f || !f.content) return false;
    const dati = JSON.parse(decodifica64(f.content));
    if (!Array.isArray(dati.clienti)) return false;
    await db.sostituisciClienti(dati.clienti.filter(c => c && c.id && c.nome));
    clientiPC = (await db.tuttiClienti()).sort((a, b) => a.nome.localeCompare(b.nome, "it"));
    return true;
  } catch (e) { return false; }   // senza rete o file non ancora pubblicato restano i clienti già scaricati
}
async function caricaClientiLocali() { clientiPC = (await db.tuttiClienti()).sort((a, b) => a.nome.localeCompare(b.nome, "it")); }

function indirizzoCliente(c) { return [c.indirizzo, c.citta].filter(Boolean).join(" "); }

// suggerimenti sotto il nome: se il cliente c'è già sul PC si propone di usarlo (invece di scriverne uno nuovo)
function suggerimentiCliente() {
  if (!rilievo) return "";
  if (rilievo.cliente_id && clientiPC.some(c => c.id === rilievo.cliente_id)) return `<span class="badge badge-ok">✓ Cliente del PC</span>`;
  const n = normNome(rilievo.cliente && rilievo.cliente.nome);
  if (n.length < 2) return "";
  const simili = clientiPC.filter(c => normNome(c.nome).includes(n)).slice(0, 3);
  return simili.map(c => `<button class="btn btn-piccolo" style="margin:0 .3rem .3rem 0" data-az="usa-cliente" data-id="${esc(c.id)}">Usa «${esc(c.nome)}» (già sul PC)</button>`).join("");
}

function applicaCliente(c) {
  if (!c || !rilievo) return;
  rilievo.cliente = { ...rilievo.cliente, nome: c.nome, telefono: c.telefono || rilievo.cliente.telefono || "", email: c.email || rilievo.cliente.email || "" };
  rilievo.cliente_id = c.id;
  if (!rilievo.indirizzo.testo && indirizzoCliente(c)) { rilievo.indirizzo = { testo: indirizzoCliente(c), lat: null, lon: null }; }
  cambiato(); disegnaEditor(); avviso("Cliente «" + c.nome + "» collegato al PC.", "ok");
}

function foglioClienti(onScegli) {
  const v = document.createElement("div");
  v.className = "velo";
  v.innerHTML = `<div class="foglio"><h2>Clienti del computer <button class="btn btn-piccolo" data-az="chiudi-foglio">Chiudi</button></h2>
    <input id="cerca-cliente" type="search" placeholder="Cerca per nome, telefono o indirizzo" autocomplete="off" style="margin-bottom:.6rem">
    <div id="elenco-clienti"></div><p class="muted small" id="nota-clienti"></p></div>`;
  const disegna = () => {
    const q = normNome(v.querySelector("#cerca-cliente").value);
    const lista = clientiPC.filter(c => !q || normNome([c.nome, c.telefono, c.indirizzo, c.citta].join(" ")).includes(q));
    v.querySelector("#elenco-clienti").innerHTML = lista.slice(0, 60).map(c => `<button class="cliente-voce" data-id="${esc(c.id)}"><strong>${esc(c.nome)}</strong>
      <span class="small muted">${esc([c.telefono, indirizzoCliente(c)].filter(Boolean).join(" · "))}</span></button>`).join("");
    v.querySelector("#nota-clienti").textContent = clientiPC.length
      ? (lista.length > 60 ? "Scrivi per restringere l'elenco." : lista.length ? "" : "Nessun cliente trovato: scrivi il nome a mano nel rilievo e verrà aggiunto sul PC.")
      : "L'elenco è vuoto. Sul computer premi «Sincronizza con il telefono» nel Calendario (o «Scarica nuovi rilievi»): poi qui compaiono i clienti.";
  };
  v.addEventListener("click", e => {
    if (e.target === v || e.target.dataset.az === "chiudi-foglio") { v.remove(); return; }
    const voce = e.target.closest(".cliente-voce");
    if (voce) { const c = clientiPC.find(x => x.id === voce.dataset.id); v.remove(); onScegli(c); }
  });
  v.addEventListener("input", disegna);
  document.body.appendChild(v);
  disegna();
  aggiornaClienti().then(ok => { if (ok && v.isConnected) disegna(); });   // se c'è rete, si aggiorna l'elenco
}

// ------------------------------------------------------------------------------------------------ preventivi in corso (dal PC)
// I preventivi «in corso» arrivano dal computer (preventivi.json, senza prezzi). Da qui si prendono le misure dei prodotti
// scelti (ognuno ha il suo riquadro): si crea un rilievo collegato al preventivo e, quando arriva sul PC, le misure
// finiscono nelle righe di quei prodotti.
let preventiviPC = [], cercaPreventivo = "";
const firmaPreventivi = l => JSON.stringify([...l].sort((a, b) => String(a.id).localeCompare(String(b.id))));
const dataOrdine = d => String(d || "").split("/").reverse().join("-");

async function ghTesto(percorso) {   // contenuto di un file dell'archivio, anche grande (null se non c'è)
  const c = config();
  const r = await fetch(`${API}/repos/${c.r}/contents/${percorso}?ref=${encodeURIComponent(c.b)}`,
    { headers: { Authorization: "Bearer " + c.t, Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ha risposto con l'errore ${r.status}.`);
  return r.text();
}

async function aggiornaPreventivi() {
  const testo = await ghTesto("preventivi.json");
  if (testo === null) return false;
  let dati;
  try { dati = JSON.parse(testo); } catch (e) { return false; }
  if (!Array.isArray(dati.preventivi) || firmaPreventivi(dati.preventivi) === firmaPreventivi(preventiviPC)) return false;
  await db.sostituisciPreventivi(dati.preventivi.filter(p => p && p.id));
  preventiviPC = await db.tuttiPreventivi();
  return true;
}
async function caricaPreventiviLocali() { preventiviPC = await db.tuttiPreventivi(); }

const titoloRiga = v => [v.tipo, v.nome].filter(Boolean).join(" · ") || "Prodotto";
const dettaglioRiga = v => [[v.produttore, v.codice_articolo].filter(Boolean).join(" "),
  v.quantita ? `${String(v.quantita).replace(".", ",")} ${v.unita || ""}`.trim() : ""].filter(Boolean).join(" — ");
const eTenda = tipo => /tend/i.test(tipo || "");
// i prodotti del preventivo per identificativo di riga, nell'ordine del preventivo
const righeDelPreventivo = p => new Map((p.stanze || []).flatMap(s => (s.voci || []).map(v => [v, s]))
  .map(([v, s], ordine) => [v.rid, { v, s, ordine }]));
const riquadroProdotto = v => ({ titolo: titoloRiga(v), finestra: v.sottocategoria || "", dettaglio: dettaglioRiga(v), voci_id: [v.rid] });
const compilata = a => ["larghezza", "altezza", "altezza_sx", "altezza_dx", "altezza_davanzale", "altezza_soffitto", "installazione", "note"]
  .some(k => String(a[k] ?? "").trim()) || !!(a.foto || []).length;

// prodotti che hanno già il loro riquadro (nei rilievi della versione precedente un riquadro valeva per tutta la finestra: contano le tende)
function prodottiMisurati(r, p) {
  const righe = righeDelPreventivo(p), scelti = new Set();
  for (const s of r.stanze || []) for (const a of s.aperture || []) {
    let ids = a.voci_id || [];
    if (ids.length > 1) { const tende = ids.filter(i => eTenda(righe.get(i)?.v.tipo)); ids = tende.length ? tende : ids.slice(0, 1); }
    ids.forEach(i => scelti.add(i));
  }
  return scelti;
}

// porta il rilievo ad avere un riquadro per ogni prodotto scelto (le aperture aggiunte a mano restano)
function allineaProdotti(r, p, scelti) {
  const righe = righeDelPreventivo(p), fatti = new Set(), svuotate = new Set();
  r.stanze = r.stanze || [];
  for (const st of r.stanze) {
    st.aperture = (st.aperture || []).filter(a => {
      if (!a.voci_id) return true;
      // prodotto non più nel preventivo: il riquadro compilato resta, così le misure non si perdono (si elimina a mano)
      if (!a.voci_id.some(i => righe.has(i))) return compilata(a);
      const liberi = a.voci_id.filter(i => scelti.has(i) && !fatti.has(i));
      const rid = liberi.find(i => eTenda(righe.get(i)?.v.tipo)) || liberi[0];
      if (!rid) { svuotate.add(st); return false; }
      fatti.add(rid);
      if (righe.has(rid)) { Object.assign(a, riquadroProdotto(righe.get(rid).v)); delete a.prodotti; }
      return true;
    });
  }
  for (const [rid, { v, s }] of righe) {
    if (!scelti.has(rid) || fatti.has(rid)) continue;
    let st = r.stanze.find(x => x.nome_preventivo === s.nome) || r.stanze.find(x => normNome(x.nome) === normNome(s.nome));
    if (!st) { st = { id: breve() + breve(), nome: s.nome, nome_preventivo: s.nome, categoria: s.categoria || "", note: "", foto: [], aperture: [] }; r.stanze.push(st); }
    st.aperture.push({ ...nuovaApertura(), ...riquadroProdotto(v) });
  }
  const posto = a => a.voci_id && righe.has(a.voci_id[0]) ? righe.get(a.voci_id[0]).ordine : 1e9;
  r.stanze.forEach(st => st.aperture.sort((x, y) => posto(x) - posto(y)));
  r.stanze = r.stanze.filter(st => !svuotate.has(st) || st.aperture.length || st.note || (st.foto || []).length);
}

async function rilievoDelPreventivo(id) { return (await db.tutti()).find(r => !r.eliminato && r.preventivo_id === id); }

async function prendiMisure(p, scelti) {
  let r = await rilievoDelPreventivo(p.id);
  const nuovo = !r;
  if (nuovo) {
    r = nuovoRilievo();
    r.preventivo_id = p.id; r.preventivo_numero = p.numero || "";
    r.cliente = { nome: p.cliente.nome || "", telefono: p.cliente.telefono || "", email: p.cliente.email || "" };
    if (p.cliente_id) r.cliente_id = p.cliente_id;
    r.indirizzo = { testo: p.cliente.indirizzo || "", lat: null, lon: null };
  }
  const prima = JSON.stringify(r.stanze);
  allineaProdotti(r, p, scelti);
  if (nuovo || JSON.stringify(r.stanze) !== prima) { if (!nuovo) r.modificato = adesso(); await db.salva(r); }
  r.stanze.forEach(s => apertiStanze.add(s.id));
  if (location.hash !== "#/r/" + r.id) location.hash = "#/r/" + r.id;
  else { rilievo = r; disegnaEditor(); }   // si era già dentro questo rilievo
}

async function disegnaPreventivi() {
  const fatti = new Map((await db.tutti()).filter(r => !r.eliminato && r.preventivo_id).map(r => [r.preventivo_id, r]));
  const q = normNome(cercaPreventivo);
  const lista = preventiviPC.filter(p => !q || normNome([p.numero, p.cliente.nome, p.cliente.indirizzo, p.cliente.telefono].join(" ")).includes(q))
    .sort((a, b) => dataOrdine(b.data).localeCompare(dataOrdine(a.data)) || String(b.numero).localeCompare(String(a.numero)));
  const elenco = lista.map(p => {
    const r = fatti.get(p.id), prodotti = (p.stanze || []).reduce((n, s) => n + (s.voci || []).length, 0);
    return `<div class="card cliccabile" data-az="apri-preventivo" data-id="${esc(p.id)}">
      <div class="riga"><span class="rilievo-titolo">${esc(p.cliente.nome || "Cliente senza nome")}</span><span class="spazio"></span>
        ${r ? (r.bozza ? `<span class="badge badge-attesa">misure in bozza</span>` : `<span class="badge badge-ok">misure prese ✓</span>`)
          : p.rilievo_preso ? `<span class="badge badge-ok">rilievo preso ✓</span>` : `<span class="badge">da misurare</span>`}</div>
      <div class="rilievo-riga">${p.numero ? "n. " + esc(p.numero) + " · " : ""}${esc(p.data)}${p.cliente.indirizzo ? " · " + esc(p.cliente.indirizzo) : ""}</div>
      <div class="rilievo-riga">${(p.stanze || []).length} stanze · ${prodotti} prodotti</div></div>`;
  }).join("") || `<div class="vuoto">${preventiviPC.length ? "Nessun preventivo trovato." : "Nessun preventivo in corso.<br>Sul computer i preventivi «In corso» arrivano qui da soli."}</div>`;
  const box = document.getElementById("elenco-preventivi");
  if (box) { box.innerHTML = elenco; return; }
  $app.innerHTML = barra("Rilievi Giodè", { impostazioni: true }) + `<main>${schede("preventivi")}
    ${config() ? "" : `<div class="banner">Per vedere i preventivi del computer serve il collegamento (<a href="#/impostazioni">Impostazioni</a>).</div>`}
    <input id="cerca-preventivo" type="search" placeholder="Cerca per cliente, numero o indirizzo" value="${esc(cercaPreventivo)}" autocomplete="off" style="margin-bottom:.8rem">
    <div id="elenco-preventivi">${elenco}</div></main>`;
}

async function vistaPreventivi() {
  rilievo = null;
  await caricaPreventiviLocali();
  $app.innerHTML = "";
  await disegnaPreventivi();
  window.scrollTo(0, 0);
  sincronizzaSubito();
}

async function foglioPreventivo(p) {
  if (!p) return;
  if (rilievo && timerSalva) await salvaOra();
  const esistente = await rilievoDelPreventivo(p.id);
  const gia = esistente ? prodottiMisurati(esistente, p) : null;
  const spuntato = v => gia ? gia.has(v.rid) : eTenda(v.tipo);   // la prima volta sono proposte le tende
  const v = document.createElement("div");
  v.className = "velo";
  v.innerHTML = `<div class="foglio"><h2><span>Preventivo ${esc(p.numero || "")}</span> <button class="btn btn-piccolo" data-az="chiudi-foglio">Chiudi</button></h2>
    <div class="card"><div style="font-size:1.15rem;font-weight:700">${esc(p.cliente.nome || "Cliente senza nome")}</div>
      <div class="muted small">del ${esc(p.data)}</div>
      ${p.cliente.indirizzo ? `<p style="margin:.4rem 0">${esc(p.cliente.indirizzo)}</p>` : ""}
      <div class="mappa-link">${p.cliente.telefono ? `<a class="btn btn-piccolo btn-primario" href="tel:${esc(p.cliente.telefono)}">📞 Chiama</a>` : ""}${mappeApp(p.cliente.indirizzo, { id: p.cliente_id, nome: p.cliente.nome })}</div></div>
    <p class="banner">Spunta i prodotti di cui prendere le misure: ognuno avrà il suo riquadro.</p>
    ${(p.stanze || []).map(s => `<div class="card"><h3>${esc(s.nome)}</h3>${(s.voci || []).map(x => `<label class="scelta-prodotto">
        <input type="checkbox" data-rid="${esc(x.rid)}" ${spuntato(x) ? "checked" : ""}>
        <span><strong>${esc(titoloRiga(x))}</strong>
          <span class="small muted">${esc([x.sottocategoria, dettaglioRiga(x)].filter(Boolean).join(" · "))}</span>
          ${x.misure ? `<span class="small muted misure-prese">${esc(x.misure)}</span>` : ""}</span></label>`).join("") || `<p class="muted">Nessun prodotto.</p>`}</div>`).join("")}
    <button class="btn btn-primario btn-largo" data-az="prendi-misure">📏 ${esistente ? "Continua le misure" : "Prendi le misure"}</button></div>`;
  v.addEventListener("click", async e => {
    const az = e.target.dataset.az;
    if (e.target === v || az === "chiudi-foglio") { v.remove(); return; }
    if (az !== "prendi-misure") return;
    const scelti = new Set([...v.querySelectorAll("input[data-rid]:checked")].map(i => i.dataset.rid));
    if (!scelti.size && !esistente) { avviso("Spunta almeno un prodotto da misurare.", "err"); return; }
    // riquadri già compilati che sparirebbero perché è stata tolta la spunta
    const righe = righeDelPreventivo(p);
    const perse = (esistente?.stanze || []).flatMap(s => s.aperture || [])
      .filter(a => a.voci_id && a.voci_id.some(i => righe.has(i)) && !a.voci_id.some(i => scelti.has(i)) && compilata(a));
    if (perse.length && !confirm(`Hai tolto la spunta a prodotti già misurati:\n${perse.map(a => "• " + (a.titolo || "Prodotto")).join("\n")}\n\nLe loro misure vengono cancellate. Continuare?`)) return;
    v.remove();
    try { await prendiMisure(p, scelti); } catch (err) { avviso(err.message || String(err), "err", 7000); }
  });
  document.body.appendChild(v);
}

// ------------------------------------------------------------------------------------------------ calendario
const TIPI_APP = { montaggio: "Montaggio", misure: "Misure", altro: "Altro" };
const NOMI_MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
let meseApp = (() => { const d = new Date(); d.setDate(1); return d; })();
let giornoApp = oggi();
let appuntamenti = [], sincronizzandoApp = false;

const schede = attiva => `<div class="schede"><a href="#" class="${attiva === "rilievi" ? "attiva" : ""}">Rilievi</a><a href="#/preventivi" class="${attiva === "preventivi" ? "attiva" : ""}">Preventivi</a><a href="#/calendario" class="${attiva === "calendario" ? "attiva" : ""}">Calendario</a></div>
  <div class="small muted" id="riga-sync" style="margin:-.4rem .2rem .7rem">${testoStatoSync()}</div>`;
const isoData = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dataLunga = iso => new Date(iso + "T12:00:00").toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
const decodifica64 = b => new TextDecoder().decode(Uint8Array.from(atob(String(b).replace(/\s/g, "")), c => c.charCodeAt(0)));
const appVisibili = () => appuntamenti.filter(a => !a.eliminato);
const promemoria = a => a.tipo === "altro" ? a.titolo || "" : "";   // il nome dato al promemoria («Altro»)

// pulsanti delle mappe per un cliente: il suo punto esatto se c'è, altrimenti l'indirizzo scritto
function mappeApp(indirizzo, chi) {
  const punto = puntoCliente(indirizzo, chi), dove = punto || unaRiga(indirizzo);
  return dove ? pulsantiMappe(dove, !!punto) : "";
}

async function sincronizzaAppuntamenti() {
  const lista = (await gh("GET", "appuntamenti")) || [];
  const remoti = new Map((Array.isArray(lista) ? lista : []).filter(v => v.name.endsWith(".json")).map(v => [v.name.slice(0, -5), v]));
  let scaricati = 0, inviati = 0;
  for (const [id, voce] of remoti) {                                  // 1) dal PC al telefono
    const loc = await db.leggiApp(id);
    if (loc && loc._sha === voce.sha) continue;
    const file = await gh("GET", `appuntamenti/${id}.json`);
    if (!file || !file.content) continue;
    let r;
    try { r = JSON.parse(decodifica64(file.content)); } catch (e) { continue; }
    if (!r || r.id !== id) continue;
    if (!loc || String(r.modificato) > String(loc.modificato)) { await db.salvaApp({ ...r, _sha: file.sha, _inviato: r.modificato }); scaricati++; }
    else { loc._sha = file.sha; await db.salvaApp(loc); }             // quello del telefono è più recente: parte sotto
  }
  for (const loc of await db.tuttiApp()) {                            // 2) dal telefono al PC
    if (loc._inviato === loc.modificato) continue;
    const { _sha, _inviato, ...pulito } = loc;
    const contenuto = aBase64Testo(JSON.stringify(pulito, null, 1));
    let sha = _sha;
    for (let tentativo = 0; tentativo < 2; tentativo++) {
      try {
        const res = await gh("PUT", `appuntamenti/${loc.id}.json`, { message: "Appuntamento " + (loc.cliente || loc.id), content: contenuto, ...(sha ? { sha } : {}) });
        const fresco = (await db.leggiApp(loc.id)) || loc;               // se nel frattempo è stato modificato, resta da inviare
        fresco._sha = res.content.sha;
        if (fresco.modificato === loc.modificato) fresco._inviato = loc.modificato;
        await db.salvaApp(fresco); inviati++; break;
      } catch (e) {
        if (tentativo || (e.stato !== 409 && e.stato !== 422)) throw e;
        const es = await gh("GET", `appuntamenti/${loc.id}.json`);
        sha = es ? es.sha : undefined;
      }
    }
  }
  return { scaricati, inviati };
}

async function aggiornaCalendario(silenzioso) {
  if (sincronizzandoApp || sincronizzandoTutto || !config()) return;
  if (!inRete()) { if (!silenzioso) avviso("Nessuna connessione: il calendario si aggiorna quando c'è rete.", "err"); return; }
  sincronizzandoApp = true;
  try {
    const r = await sincronizzaAppuntamenti();
    appuntamenti = await db.tuttiApp();
    if (!silenzioso || r.scaricati || r.inviati) avviso(r.scaricati || r.inviati ? "Calendario aggiornato ✓" : "Il calendario è già aggiornato.", "ok");
    if (location.hash === "#/calendario") disegnaCalendario();
  } catch (e) { if (!silenzioso) avviso(e.message || String(e), "err", 7000); }
  sincronizzandoApp = false;
}

// scheda dell'appuntamento: dati del cliente, mappa con la sua posizione, indicazioni stradali
async function foglioDettaglio(a) {
  if (!a) return;
  // il punto esatto del cliente, se c'è (più preciso dell'indirizzo scritto)
  await caricaPunti();
  const punto = puntoCliente(a.indirizzo, { id: a.cliente_id, nome: a.cliente });
  const dove = punto || unaRiga(a.indirizzo);
  const u = urlMappe(dove, !!punto);
  const v = document.createElement("div");
  v.className = "velo";
  v.innerHTML = `<div class="foglio"><h2><span>${esc(TIPI_APP[a.tipo] || a.tipo)} · ${esc(a.ora || "tutto il giorno")}</span> <button class="btn btn-piccolo" data-az="chiudi-foglio">Chiudi</button></h2>
    <div class="card">
      <div class="muted small" style="text-transform:capitalize">${esc(dataLunga(a.data))}</div>
      ${promemoria(a) ? `<div style="font-size:1.25rem;font-weight:700;margin:.2rem 0">${esc(promemoria(a))}</div>` : ""}
      ${a.cliente ?`<div style="font-size:1.15rem;font-weight:700;margin:.2rem 0">${esc(a.cliente)}</div>` : ""}
      ${a.telefono ? `<a class="btn btn-piccolo btn-primario" href="tel:${esc(a.telefono)}">📞 Chiama ${esc(a.telefono)}</a>` : ""}
      ${a.indirizzo ? `<p style="margin:.6rem 0 .2rem">${esc(a.indirizzo)}</p>` : ""}
      ${dove ? `${punto ? `<iframe class="mappa-app" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Mappa"
          src="https://maps.google.com/maps?q=${encodeURIComponent(punto)}&z=16&output=embed"></iframe>
        <p class="muted small" style="margin:.3rem 0 .5rem">📍 Punto esatto del cliente. La mappa ha bisogno della rete.</p>` : ""}
        <div class="mappa-link" style="margin-top:.5rem">
          <a class="btn btn-piccolo btn-primario" href="${esc(u.indicazioni)}" target="_blank" rel="noopener">🧭 Indicazioni Google</a>
          <a class="btn btn-piccolo" href="${esc(u.appleIndicazioni)}" target="_blank" rel="noopener">🗺 Indicazioni iPhone</a>
          <a class="btn btn-piccolo" href="${esc(u.google)}" target="_blank" rel="noopener">📍 Google Maps</a></div>`
        : `<p class="muted">Nessun indirizzo: aggiungilo con «Modifica» per vedere la mappa.</p>`}
      ${a.nota ? `<p style="white-space:pre-wrap;margin:.8rem 0 0"><strong>Nota:</strong> ${esc(a.nota)}</p>` : ""}
      <div class="riga" style="margin-top:.9rem"><button class="btn btn-primario" data-az="modifica-da-scheda">Modifica</button></div>
    </div></div>`;
  v.addEventListener("click", e => {
    if (e.target === v || e.target.dataset.az === "chiudi-foglio") v.remove();
    else if (e.target.dataset.az === "modifica-da-scheda") { v.remove(); foglioAppuntamento(a); }
  });
  document.body.appendChild(v);
}

function rigaApp(a, conData) {
  const azioni = (a.telefono ? `<a class="btn btn-piccolo btn-primario" href="tel:${esc(a.telefono)}">📞 Chiama</a>` : "") + mappeApp(a.indirizzo, { id: a.cliente_id, nome: a.cliente });
  return `<div class="app-riga t-${esc(a.tipo)}" data-az="dettaglio-app" data-id="${esc(a.id)}" style="cursor:pointer">
    <div class="riga"><strong>${conData ? esc(dataLunga(a.data)) + " · " : ""}${esc(a.ora || "tutto il giorno")}</strong><span class="badge">${esc(TIPI_APP[a.tipo] || a.tipo)}</span>
      <span class="spazio"></span><button class="btn btn-piccolo" data-az="modifica-app" data-id="${esc(a.id)}">Modifica</button></div>
    ${promemoria(a) ? `<div class="app-nome">${esc(promemoria(a))}</div>` : ""}
    ${a.cliente ?`<div><strong>${esc(a.cliente)}</strong>${a.telefono ? ` · <a href="tel:${esc(a.telefono)}">${esc(a.telefono)}</a>` : ""}</div>` : ""}
    ${a.indirizzo ? `<div class="small">${esc(a.indirizzo)}</div>` : ""}
    ${azioni ? `<div class="mappa-link">${azioni}</div>` : ""}
    ${a.nota ? `<div class="small muted" style="white-space:pre-wrap;margin-top:.3rem">${esc(a.nota)}</div>` : ""}</div>`;
}

function disegnaCalendario() {
  const vis = appVisibili(), oggiIso = oggi();
  const primo = new Date(meseApp.getFullYear(), meseApp.getMonth(), 1);
  const inizio = new Date(primo); inizio.setDate(1 - ((primo.getDay() + 6) % 7));    // la settimana parte da lunedì
  let celle = ["L", "M", "M", "G", "V", "S", "D"].map(g => `<div class="cal-int">${g}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(inizio); d.setDate(inizio.getDate() + i);
    const k = isoData(d), del = vis.filter(a => a.data === k);
    const tipi = [...new Set(del.map(a => a.tipo))];
    celle += `<button class="cal-g ${d.getMonth() !== meseApp.getMonth() ? "fuori" : ""} ${k === oggiIso ? "oggi" : ""} ${k === giornoApp ? "scelto" : ""}" data-az="giorno-app" data-g="${k}">
      <span>${d.getDate()}</span><span class="punti">${tipi.map(t => `<i class="ap-${esc(t)}"></i>`).join("")}</span></button>`;
  }
  const delGiorno = vis.filter(a => a.data === giornoApp).sort((a, b) => (a.ora || "99").localeCompare(b.ora || "99"));
  const prossimi = vis.filter(a => a.data >= oggiIso && a.data !== giornoApp).sort((a, b) => (a.data + (a.ora || "99")).localeCompare(b.data + (b.ora || "99"))).slice(0, 6);
  $app.innerHTML = barra("Rilievi Giodè", { impostazioni: true }) + `<main>${schede("calendario")}
    <div class="card"><div class="riga" style="margin-bottom:.5rem"><button class="btn btn-piccolo" data-az="mese-prec" aria-label="Mese precedente">‹</button>
      <strong class="spazio" style="text-align:center;text-transform:capitalize">${NOMI_MESI[meseApp.getMonth()]} ${meseApp.getFullYear()}</strong>
      <button class="btn btn-piccolo" data-az="mese-succ" aria-label="Mese successivo">›</button><button class="btn btn-piccolo" data-az="oggi-app">Oggi</button></div>
      <div class="cal-griglia">${celle}</div>
      <div class="legenda small muted"><i class="ap-montaggio"></i> Montaggio <i class="ap-misure"></i> Misure <i class="ap-altro"></i> Altro</div></div>
    <div class="card"><h2 style="text-transform:capitalize">${esc(dataLunga(giornoApp))}</h2>
      ${delGiorno.map(a => rigaApp(a)).join("") || `<p class="muted" style="margin:0">Nessun appuntamento.</p>`}</div>
    ${prossimi.length ? `<div class="card"><h2>Prossimi appuntamenti</h2>${prossimi.map(a => rigaApp(a, true)).join("")}</div>` : ""}
    ${config() ? "" : `<div class="banner">Per vedere gli appuntamenti fatti sul computer serve il collegamento (<a href="#/impostazioni">Impostazioni</a>).</div>`}
  </main>
  <div class="fondo"><div><button class="btn btn-primario" data-az="nuova-app">+ Appuntamento</button>
    <button class="btn" data-az="sync-app" ${config() ? "" : "disabled"}>⟳ Aggiorna</button></div></div>`;
}

async function vistaCalendario() {
  rilievo = null;
  appuntamenti = await db.tuttiApp();
  disegnaCalendario();
  window.scrollTo(0, 0);
  sincronizzaSubito();                      // in silenzio, se c'è rete: gli appuntamenti fatti al PC compaiono da soli
}

function foglioAppuntamento(esistente) {
  const a = esistente || { tipo: "montaggio", data: giornoApp, ora: "", cliente: "", telefono: "", indirizzo: "", nota: "" };
  const v = document.createElement("div");
  v.className = "velo";
  v.innerHTML = `<div class="foglio"><h2>${esistente ? "Modifica appuntamento" : "Nuovo appuntamento"} <button class="btn btn-piccolo" data-az="chiudi-foglio">Chiudi</button></h2>
    <div class="card">
      <label>Che cosa<select id="ap-tipo">${Object.entries(TIPI_APP).map(([k, n]) => `<option value="${k}" ${k === a.tipo ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label id="ap-riga-titolo" ${a.tipo === "altro" ? "" : "hidden"}>Nome del promemoria<input id="ap-titolo" value="${esc(a.titolo || "")}" autocomplete="off" autocapitalize="sentences" placeholder="Per esempio: chiamare il fornitore"></label>
      <div class="griglia"><label>Data<input id="ap-data" type="date" value="${esc(a.data)}"></label><label>Ora<input id="ap-ora" type="time" value="${esc(a.ora)}"></label></div>
      <button class="btn btn-piccolo" data-az="scegli-cliente-app" style="margin-bottom:.6rem">👥 Scegli dai clienti del PC</button>
      <label>Cliente<input id="ap-cliente" value="${esc(a.cliente)}" autocomplete="off" autocapitalize="words"></label>
      <div class="griglia"><label>Telefono<input id="ap-tel" type="tel" inputmode="tel" value="${esc(a.telefono)}" autocomplete="off"></label>
        <label>Indirizzo<input id="ap-ind" value="${esc(a.indirizzo)}" autocomplete="off"></label></div>
      <label>Nota<textarea id="ap-nota" rows="3">${esc(a.nota)}</textarea></label>
      <div class="riga"><button class="btn btn-primario" data-az="salva-app">Salva</button>
        ${esistente ? `<button class="btn btn-pericolo" data-az="elimina-app">Elimina</button>` : ""}</div></div></div>`;
  v.querySelector("#ap-tipo").addEventListener("change", e => { v.querySelector("#ap-riga-titolo").hidden = e.target.value !== "altro"; });
  let clienteId = a.cliente_id || "";   // cliente del PC scelto dall'elenco (se c'è)
  v.addEventListener("click", async e => {
    const az = e.target.dataset.az;
    if (e.target === v || az === "chiudi-foglio") { v.remove(); return; }
    if (az === "scegli-cliente-app") {
      foglioClienti(c => {
        if (!c) return;
        clienteId = c.id;
        v.querySelector("#ap-cliente").value = c.nome;
        if (c.telefono) v.querySelector("#ap-tel").value = c.telefono;
        if (indirizzoCliente(c)) v.querySelector("#ap-ind").value = indirizzoCliente(c);
      });
      return;
    }
    if (az === "salva-app") {
      const data = v.querySelector("#ap-data").value;
      if (!data) { avviso("Scegli la data.", "err"); return; }
      const t = adesso();
      const legato = clientiPC.find(c => c.id === clienteId);
      if (!legato || normNome(legato.nome) !== normNome(v.querySelector("#ap-cliente").value)) clienteId = "";   // nome cambiato: non è più quel cliente
      const nuovo = { ...(esistente || {}), id: esistente ? esistente.id : nuovoId(), tipo: v.querySelector("#ap-tipo").value, data, ora: v.querySelector("#ap-ora").value,
        cliente: v.querySelector("#ap-cliente").value.trim(), telefono: v.querySelector("#ap-tel").value.trim(), indirizzo: v.querySelector("#ap-ind").value.trim(),
        nota: v.querySelector("#ap-nota").value.trim(), creato: esistente ? esistente.creato : t, modificato: t, eliminato: false };
      if (clienteId) nuovo.cliente_id = clienteId; else delete nuovo.cliente_id;
      const titolo = v.querySelector("#ap-titolo").value.trim();
      if (nuovo.tipo === "altro" && titolo) nuovo.titolo = titolo; else delete nuovo.titolo;
      await db.salvaApp(nuovo);
      giornoApp = data; meseApp = new Date(data + "T12:00:00"); meseApp.setDate(1);
      appuntamenti = await db.tuttiApp(); v.remove(); disegnaCalendario(); avviso("Appuntamento salvato.", "ok");
      sincronizzaSubito();
    } else if (az === "elimina-app" && confirm("Eliminare questo appuntamento?")) {
      await db.salvaApp({ ...esistente, eliminato: true, modificato: adesso() });
      appuntamenti = await db.tuttiApp(); v.remove(); disegnaCalendario(); sincronizzaSubito();
    }
  });
  document.body.appendChild(v);
}

function campoTesto(percorso, etichetta, valore, extra = "") {
  return `<label>${esc(etichetta)}<input data-p='${esc(JSON.stringify(percorso))}' value="${esc(valore)}" autocomplete="off" ${extra}></label>`;
}
function campoMisura(percorso, etichetta, valore) {
  return `<label class="con-unita">${esc(etichetta)}<input data-p='${esc(JSON.stringify(percorso))}' value="${esc(valore)}" inputmode="decimal" autocomplete="off" enterkeyhint="next"></label>`;
}
function blocchiFoto(percorso, nomi, id) {
  const p = esc(JSON.stringify(percorso));
  return `<div class="foto-griglia">${(nomi || []).map(n => `<button data-foto="${esc(n)}" data-dest='${p}' aria-label="Apri foto"><img data-foto="${esc(n)}" alt=""></button>`).join("")}</div>
    <div class="foto-azioni">
      <label class="btn btn-piccolo" style="margin:0">📷 Scatta<input type="file" accept="image/*" capture="environment" data-aggiungi='${p}'></label>
      <label class="btn btn-piccolo" style="margin:0">🖼 Dalla libreria<input type="file" accept="image/*" multiple data-aggiungi='${p}'></label>
    </div>`;
}

function disegnaEditor() {
  const r = rilievo, y = window.scrollY;
  $app.innerHTML = barra(r.cliente.nome || "Nuovo rilievo", { indietro: true, stato: "Salvato ✓" }) + `<main>
    <section class="card"><h2>Cliente</h2>
      <button class="btn btn-piccolo" data-az="scegli-cliente" style="margin-bottom:.7rem">👥 Scegli dai clienti del PC</button>
      ${campoTesto(["cliente", "nome"], "Nome e cognome", r.cliente.nome, "autocapitalize=words")}
      <div id="sugg-cliente" style="margin:-.3rem 0 .6rem">${suggerimentiCliente()}</div>
      <div class="griglia">
        <label>Telefono<input data-p='["cliente","telefono"]' value="${esc(r.cliente.telefono)}" type="tel" inputmode="tel" autocomplete="off"></label>
        <label>Email<input data-p='["cliente","email"]' value="${esc(r.cliente.email)}" type="email" inputmode="email" autocapitalize="off" autocomplete="off"></label>
      </div>
    </section>
    <section class="card"><h2>Indirizzo</h2>
      <label>Via, numero, CAP e città<textarea data-p='["indirizzo","testo"]' rows="2" autocomplete="off">${esc(r.indirizzo.testo)}</textarea></label>
      <div class="riga"><button class="btn btn-piccolo" data-az="posizione">📍 Usa la mia posizione</button></div>
      <div class="mappe-link mappa-link" id="mappe">${linkMappe()}</div>
      ${haPunto(r) ? `<p class="muted small" style="margin:.5rem 0 0">Posizione presa sul posto: ${esc(r.indirizzo.lat)}, ${esc(r.indirizzo.lon)}
        <button class="btn btn-piccolo btn-pericolo" data-az="togli-posizione" style="margin-left:.3rem">Togli</button></p>` : ""}
    </section>
    ${r.preventivo_id ? `<div class="banner">Misure per il preventivo ${esc(r.preventivo_numero || "")}: ogni riquadro vale per un solo prodotto.<br>
      <button class="btn btn-piccolo" data-az="scegli-prodotti" style="margin-top:.5rem">☑ Scegli i prodotti da misurare</button></div>` : ""}
    <h2 style="margin:.3rem .2rem .5rem">Stanze</h2>
    ${(r.stanze || []).map((s, si) => `
      <details class="card stanza" data-stanza="${esc(s.id)}" ${apertiStanze.has(s.id) ? "open" : ""}>
        <summary><span class="nome">${esc(s.nome)}</span><span class="zona">${(s.aperture || []).length} ${(s.aperture || []).some(a => a.voci_id) ? "da misurare" : "aperture"}</span></summary>
        <div style="margin-top:.6rem">
          <div class="griglia">${campoTesto(["stanze", si, "nome"], "Nome della stanza", s.nome)}<label>Zona<input value="${esc(s.categoria)}" data-p='["stanze",${si},"categoria"]' autocomplete="off"></label></div>
          ${(s.aperture || []).map((a, ai) => `
            <div class="apertura">
              <div class="intest"><strong>${esc(a.titolo || `${a.tipo || "Apertura"} ${ai + 1}`)}</strong>
                ${a.voci_id ? "" : `<button class="btn btn-piccolo" data-az="duplica" data-s="${si}" data-a="${ai}">Duplica</button>`}
                <button class="btn btn-piccolo btn-pericolo" data-az="elimina-apertura" data-s="${si}" data-a="${ai}">Elimina</button></div>
              ${a.prodotti ? `<div class="prodotti-preventivo">${a.prodotti.map(p => `<div>🧵 ${esc(p)}</div>`).join("")}</div>` : ""}
              ${a.finestra || a.dettaglio ? `<div class="prodotti-preventivo">${esc([a.finestra, a.dettaglio].filter(Boolean).join(" · "))}</div>` : ""}
              ${a.voci_id ? "" : `<label>Tipo<select data-p='["stanze",${si},"aperture",${ai},"tipo"]'>${TIPI_APERTURA.map(t => `<option ${t === a.tipo ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`}
              <div class="griglia">${misureDi(a).map(([k, et]) => campoMisura(["stanze", si, "aperture", ai, k], et, a[k])).join("")}</div>
              <label>Installazione<select data-p='["stanze",${si},"aperture",${ai},"installazione"]'><option value="">—</option>${INSTALLAZIONI.map(t => `<option ${t === a.installazione ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
              ${a.voci_id ? "" : `<label>Tenda desiderata<input list="elenco-tende" data-p='["stanze",${si},"aperture",${ai},"tenda_desiderata"]' value="${esc(a.tenda_desiderata)}" autocomplete="off"></label>`}
              <label>Note<textarea data-p='["stanze",${si},"aperture",${ai},"note"]' rows="2">${esc(a.note)}</textarea></label>
              ${blocchiFoto(["stanze", si, "aperture", ai], a.foto)}
            </div>`).join("")}
          <button class="btn btn-largo" data-az="nuova-apertura" data-s="${si}">+ Aggiungi apertura (finestra, porta…)</button>
          <label style="margin-top:.8rem">Note sulla stanza<textarea data-p='["stanze",${si},"note"]' rows="2">${esc(s.note)}</textarea></label>
          <h3>Foto della stanza</h3>${blocchiFoto(["stanze", si], s.foto)}
          <button class="btn btn-piccolo btn-pericolo" style="margin-top:.8rem" data-az="elimina-stanza" data-s="${si}">Elimina questa stanza</button>
        </div>
      </details>`).join("")}
    <button class="btn btn-largo" data-az="nuova-stanza">+ Aggiungi stanza</button>
    <section class="card" style="margin-top:.8rem"><h2>Note e altre foto</h2>
      <label>Note generali<textarea data-p='["note"]' rows="3">${esc(r.note)}</textarea></label>
      ${blocchiFoto([], r.foto)}
    </section>
    <button class="btn btn-largo btn-pericolo" data-az="elimina-rilievo">Elimina questo rilievo (da tutti i telefoni e dal PC)</button>
    <datalist id="elenco-tende">${TENDE.map(t => `<option value="${esc(t)}">`).join("")}</datalist>
  </main>
  <div class="fondo"><div><button class="btn btn-primario" data-az="salva-rilievo">💾 Salva</button><button class="btn" data-az="esci-rilievo">Esci</button></div></div>`;
  window.scrollTo(0, y);
  caricaMiniature();
}

function foglioStanze() {
  const v = document.createElement("div");
  v.className = "velo";
  v.innerHTML = `<div class="foglio"><h2>Aggiungi stanza <button class="btn btn-piccolo" data-az="chiudi-foglio">Chiudi</button></h2>
    <div class="zone">${Object.entries(CATEGORIE).map(([zona, stanze]) => `<div class="gruppo"><h3>${esc(zona)}</h3><div class="scelte">
      ${stanze.map(s => `<button data-zona="${esc(zona)}" data-nome="${esc(s)}">${esc(s)}</button>`).join("")}</div></div>`).join("")}
      <div class="gruppo"><h3>Altra stanza</h3><div class="riga"><input id="altra-stanza" placeholder="Nome della stanza" style="flex:1;margin:0"><button class="btn btn-primario" data-az="altra-stanza">Aggiungi</button></div></div>
    </div></div>`;
  const aggiungi = (zona, nome) => {
    const s = { id: breve() + breve(), nome: nomeStanzaUnivoco(nome, rilievo.stanze.map(x => x.nome)), categoria: zona, note: "", foto: [], aperture: [nuovaApertura()] };
    rilievo.stanze.push(s); apertiStanze.add(s.id); cambiato(); v.remove(); disegnaEditor();
    document.querySelector(`[data-stanza="${s.id}"]`)?.scrollIntoView({ block: "start" });
  };
  v.addEventListener("click", e => {
    if (e.target === v || e.target.dataset.az === "chiudi-foglio") v.remove();
    else if (e.target.dataset.nome) aggiungi(e.target.dataset.zona, e.target.dataset.nome);
    else if (e.target.dataset.az === "altra-stanza") { const n = v.querySelector("#altra-stanza").value.trim(); if (n) aggiungi("Altri ambienti", n); }
  });
  document.body.appendChild(v);
}

async function eliminaFotoDi() {
  // i file delle foto tolte restano sul telefono fino al salvataggio (pulizia in salvaRilievoEsplicito): così «Non salvare» può riportarle
}

// ---- salvare e uscire dal rilievo: nuovo = bozza finché non si preme «Salva»; uscendo senza salvare si sceglie cosa fare ----
let modificatoAperto = "", istantanea = "";

async function salvaRilievoEsplicito() {
  clearTimeout(timerSalva); timerSalva = null;
  const r = rilievo;
  r.bozza = false; r.modificato = adesso();
  await salvaOra();
  try {   // pulizia dei file delle foto che non servono più
    const usate = new Set(nomiFoto(r).map(n => `${r.id}/${n}`));
    for (const chiave of await db.chiaviFoto(r.id)) if (!usate.has(chiave)) await db.eliminaFoto(chiave);
  } catch (e) { /* pulizia non essenziale */ }
  avviso("Rilievo salvato ✓", "ok");
  location.hash = "";
}

function foglioUscita(nuovo) {
  return new Promise(ok => {
    const v = document.createElement("div");
    v.className = "velo";
    v.innerHTML = `<div class="foglio"><h2>Salvare il rilievo?</h2><div class="card">
      <p style="margin-top:0">${nuovo ? "È un rilievo nuovo, non ancora salvato." : "Hai fatto delle modifiche a questo rilievo."}</p>
      <button class="btn btn-primario btn-largo" data-s="salva">💾 Salva</button>
      <button class="btn btn-largo btn-pericolo" style="margin-top:.5rem" data-s="scarta">${nuovo ? "Non salvare (elimina il rilievo)" : "Non salvare (annulla le modifiche)"}</button>
      <button class="btn btn-largo" style="margin-top:.5rem" data-s="continua">Continua a modificare</button></div></div>`;
    v.addEventListener("click", e => {
      const s = e.target.dataset.s;
      if (s) { v.remove(); ok(s); } else if (e.target === v) { v.remove(); ok("continua"); }
    });
    document.body.appendChild(v);
  });
}

async function uscitaEditor() {
  if (timerSalva) await salvaOra();
  const r = rilievo;
  if (!r) { location.hash = ""; return; }
  if (rilievoVuoto(r)) { await db.elimina(r.id); rilievo = null; location.hash = ""; return; }   // vuoto: niente da salvare
  if (!(r.bozza || r.modificato !== modificatoAperto)) { location.hash = ""; return; }           // nessuna modifica
  const scelta = await foglioUscita(!!r.bozza);
  if (scelta === "continua") return;
  if (scelta === "salva") { await salvaRilievoEsplicito(); return; }
  // «Non salvare»: un rilievo nuovo sparisce, uno già salvato torna com'era quando l'hai aperto
  const prima = JSON.parse(istantanea);
  if (prima.bozza) await db.elimina(r.id);
  else {
    const tenere = new Set(nomiFoto(prima));
    for (const n of nomiFoto(r)) if (!tenere.has(n)) await db.eliminaFoto(`${r.id}/${n}`);
    await db.salva(prima);
  }
  rilievo = null; location.hash = "";
}

function vistaImpostazioni() {
  rilievo = null;
  const c = config();
  $app.innerHTML = barra("Impostazioni", { indietro: true }) + `<main>
    <section class="card"><h2>Collegamento al computer</h2>
      ${c ? `<p>Collegato a <strong>${esc(c.r)}</strong>.</p>` : `<div class="banner">Non ancora collegato.</div>`}
      <p class="muted small">Il modo più semplice: sul computer apri Impostazioni → Rilievi e inquadra il codice QR con la fotocamera. Oppure compila qui sotto.</p>
      <label>Link di collegamento (incollalo qui)<textarea id="cfg-link" rows="2" placeholder="https://…/#cfg=…" autocapitalize="off" autocomplete="off"></textarea></label>
      <button class="btn btn-piccolo" data-az="usa-link">Usa questo link</button>
      <hr style="border:0;border-top:1px solid var(--line);margin:1rem 0">
      <label>Repository dei dati<input id="cfg-repo" value="${esc(c ? c.r : "")}" placeholder="nomeutente/rilievi-dati" autocapitalize="off" autocomplete="off"></label>
      <label>Chiave di accesso (token)<input id="cfg-token" type="password" value="" placeholder="${c ? "già impostata: scrivi solo per cambiarla" : "github_pat_…"}" autocapitalize="off" autocomplete="off"></label>
      <label>Ramo<input id="cfg-ramo" value="${esc(c ? c.b : "main")}" autocapitalize="off" autocomplete="off"></label>
      <div class="riga"><button class="btn btn-primario" data-az="salva-cfg">Salva</button><button class="btn" data-az="prova-cfg">Prova la connessione</button>
        ${c ? `<button class="btn btn-pericolo" data-az="scollega">Scollega</button>` : ""}</div>
    </section>
    <section class="card"><h2>Versione dell'app</h2>
      <p class="small muted" style="margin-top:0">Versione ${VERSIONE_APP}. Quando c'è una versione nuova l'app si aggiorna da sola (apri l'app con la rete attiva). Se non succede, premi il pulsante: i rilievi e gli appuntamenti sul telefono non si toccano.</p>
      <button class="btn btn-piccolo" data-az="aggiorna-app">⟳ Aggiorna l'app</button>
    </section>
    <section class="card"><h2>Come funziona</h2>
      <p class="small muted">I rilievi restano sul telefono anche senza rete. Con «Invia al PC» vanno nel repository privato su GitHub; sul computer, nel programma, si scaricano con «Scarica nuovi rilievi».
        La chiave di accesso resta solo su questo telefono. Se perdi il telefono, revoca la chiave da GitHub.</p>
    </section></main>`;
}

async function provaConnessione() {
  const r = await gh("GET", "");
  if (r === null) throw new Error("Repository o ramo non trovato.");
  const info = await fetch(`${API}/repos/${config().r}`, { headers: { Authorization: "Bearer " + config().t, Accept: "application/vnd.github+json" } }).then(x => x.json()).catch(() => ({}));
  if (info && info.private === false) avviso("Attenzione: il repository dei dati è PUBBLICO. Rendilo privato su GitHub!", "err", 9000);
  else avviso("Collegamento riuscito ✓", "ok");
}

// ------------------------------------------------------------------------------------------------ invio a GitHub
let invioInCorso = false;
// Cancellare un rilievo: su GitHub al posto dei dati resta un segno «eliminato», che arriva a tutti gli altri telefoni e al PC.
// Senza questo segno un telefono che ha ancora il rilievo lo rimanderebbe e riapparirebbe dappertutto.
async function eliminaRilievoDefinitivo(id) {
  const r = await db.leggi(id);
  if (!r) return;
  for (const n of nomiFoto(r)) await db.eliminaFoto(`${id}/${n}`);
  if (!(r._sync && (r._sync.inviato || r._sync.sha))) { await db.elimina(id); return; }   // mai arrivato su GitHub: basta toglierlo da qui
  await db.salva({ id, eliminato: true, modificato: adesso(), data: r.data, foto: [], _sync: { inviato: "", foto: {} } });
}

async function inviaCancellazione(r) {
  const contenuto = aBase64Testo(JSON.stringify({ id: r.id, eliminato: true, modificato: r.modificato }));
  let risposta = null;
  for (let tentativo = 0; tentativo < 2; tentativo++) {
    const esistente = await gh("GET", `rilievi/${r.id}.json`);
    try { risposta = await gh("PUT", `rilievi/${r.id}.json`, { message: "Rilievo eliminato", content: contenuto, ...(esistente ? { sha: esistente.sha } : {}) }); break; }
    catch (e) { if (tentativo || (e.stato !== 409 && e.stato !== 422)) throw e; }
  }
  try {   // anche le foto su GitHub, per non occupare spazio
    const foto = await gh("GET", `foto/${r.id}`);
    if (Array.isArray(foto)) for (const f of foto) { try { await gh("DELETE", `foto/${r.id}/${f.name}`, { message: "Foto di un rilievo eliminato", sha: f.sha }); } catch (e) { /* pulizia non essenziale */ } }
  } catch (e) { /* pulizia non essenziale */ }
  const fresco = (await db.leggi(r.id)) || r;
  fresco._sync = { inviato: r.modificato, foto: {}, sha: risposta && risposta.content ? risposta.content.sha : undefined };
  await db.salva(fresco);
}

// il rilievo è stato cancellato altrove (PC o altro telefono): si toglie anche da qui e si tiene il segno, così non riappare
async function applicaCancellazione(id, remoto, sha, locale) {
  if (locale) for (const n of nomiFoto(locale)) await db.eliminaFoto(`${id}/${n}`);
  await db.salva({ id, eliminato: true, modificato: remoto.modificato || adesso(), foto: [], _sync: { inviato: remoto.modificato || "", foto: {}, sha } });
}

async function inviaRilievo(id, avanza) {
  const r = await db.leggi(id);
  if (!r) return;
  if (r.eliminato) return inviaCancellazione(r);
  const inviate = { ...((r._sync && r._sync.foto) || {}) };
  const nomi = nomiFoto(r);
  for (const [n, nome] of nomi.entries()) {
    if (inviate[nome]) continue;
    avanza(`Foto ${n + 1} di ${nomi.length}…`);
    const blob = await db.leggiFoto(`${r.id}/${nome}`);
    if (!blob) { inviate[nome] = true; continue; }   // già tolta dal telefono
    try { await gh("PUT", `foto/${r.id}/${nome}`, { message: "Foto rilievo", content: await blobABase64(blob) }); }
    catch (e) { if (e.stato !== 422) throw e; }        // 422: esiste già (nomi unici), è a posto
    inviate[nome] = true;
  }
  avanza("Invio dei dati…");
  const { _sync, ...pulito } = r;
  const contenuto = aBase64Testo(JSON.stringify(pulito, null, 1));
  let risposta = null;
  for (let tentativo = 0; tentativo < 2; tentativo++) {
    const esistente = await gh("GET", `rilievi/${r.id}.json`);
    if (esistente && esistente.content) {   // nel frattempo è stato cancellato altrove: la cancellazione vince, non si rimanda
      try {
        const e = JSON.parse(decodifica64(esistente.content));
        if (e && e.eliminato) { await applicaCancellazione(r.id, e, esistente.sha, r); return; }
      } catch (err) { /* contenuto non leggibile: si procede */ }
    }
    try { risposta = await gh("PUT", `rilievi/${r.id}.json`, { message: "Rilievo " + (r.cliente.nome || r.id), content: contenuto, ...(esistente ? { sha: esistente.sha } : {}) }); break; }
    catch (e) { if (tentativo || (e.stato !== 409 && e.stato !== 422)) throw e; }
  }
  const fresco = (await db.leggi(id)) || r;           // se nel frattempo è stato modificato, resta «da inviare»
  fresco._sync = { inviato: pulito.modificato, foto: inviate, sha: risposta && risposta.content ? risposta.content.sha : undefined };
  await db.salva(fresco);
}

async function inviaTutti() {
  if (invioInCorso) return;
  if (!config()) { avviso("Prima collega il telefono al computer (Impostazioni).", "err"); return; }
  if (!inRete()) { avviso("Nessuna connessione: riprova quando c'è rete.", "err"); return; }
  if (sincronizzandoTutto) { avviso("Sto già sincronizzando: riprova tra un attimo."); return; }
  invioInCorso = true;
  const bottone = document.querySelector('[data-az="invia"]');
  if (bottone) bottone.disabled = true;
  try {
    const da = (await db.tutti()).filter(daInviare);
    let n = 0;
    for (const r of da) {
      n++;
      await inviaRilievo(r.id, t => avviso(`Rilievo ${n} di ${da.length}: ${t}`, "", 1800));
    }
    avviso(da.length ? "Inviato ✓ Ora sul PC premi «Scarica nuovi rilievi»." : "Non c'è niente da inviare.", "ok", 5000);
  } catch (e) { avviso(e.message || String(e), "err", 8000); }
  invioInCorso = false;
  if (!rilievo && !/^#\/(r|impostazioni|calendario|preventivi)/.test(location.hash)) vistaHome();
}

// ------------------------------------------------------------------------------------------------ sincronizzazione automatica
// Ogni minuto (e quando l'app torna in primo piano, torna la rete, o si finisce una modifica) l'app aggiorna da sola
// l'elenco clienti, il calendario (nei due sensi) e manda i rilievi da inviare. Non serve premere niente.
// Nota: se l'app è chiusa o in secondo piano l'iPhone la sospende: la sincronizzazione riparte appena la riapri.
let sincronizzandoTutto = false, ultimaSync = "", erroreSync = "", timerSubito = null;
const firmaClienti = () => clientiPC.map(c => [c.id, c.nome, c.telefono, c.email, c.indirizzo, c.citta, c.punto, c.punto_il].join("|")).join("§");

function testoStatoSync() {
  if (!config()) return "Non collegato al computer (Impostazioni).";
  if (erroreSync) return "⚠ Non sincronizzato: " + (inRete() ? erroreSync : "manca la rete") + (ultimaSync ? ` (ultimo aggiornamento ${ultimaSync})` : "");
  return ultimaSync ? `⟳ Sincronizzato alle ${ultimaSync} · si aggiorna da solo` : "⟳ Sincronizzazione in corso…";
}
function mostraStatoSync() { const el = document.getElementById("riga-sync"); if (el) el.textContent = testoStatoSync(); }

function aggiornaVistaDopoSync() {
  if (document.querySelector(".velo, .visore")) return;   // si sta usando una scheda: non si cambia niente sotto le dita
  const h = location.hash;
  if (h === "#/calendario") disegnaCalendario();
  else if (h === "#/preventivi") disegnaPreventivi();
  else if (!rilievo && !/^#\/(r|impostazioni)/.test(h)) vistaHome(true);
}

// Rilievi fatti con gli altri telefoni: si scaricano da GitHub (solo quelli nuovi o cambiati). Se qui ci sono modifiche
// non ancora inviate, quelle hanno la precedenza. Le bozze e il rilievo aperto in questo momento non si toccano.
async function scaricaRilievi() {
  const lista = await gh("GET", "rilievi");
  if (!Array.isArray(lista)) return 0;
  let nuovi = 0;
  for (const voce of lista.filter(v => v.name.endsWith(".json"))) {
    const id = voce.name.slice(0, -5);
    if (!/^[\w\-]{6,64}$/.test(id) || (rilievo && rilievo.id === id)) continue;
    const loc = await db.leggi(id);
    if (loc && loc._sync && loc._sync.sha === voce.sha) continue;        // invariato dall'ultima volta
    const f = await gh("GET", `rilievi/${id}.json`);
    if (!f || !f.content) continue;
    let r;
    try { r = JSON.parse(decodifica64(f.content)); } catch (e) { continue; }
    if (!r || r.id !== id) continue;
    if (r.eliminato) {                                                   // cancellato dal PC o da un altro telefono: la cancellazione vince
      if (!(loc && loc.eliminato)) { await applicaCancellazione(id, r, f.sha, loc); if (loc) nuovi++; }
      else { loc._sync = { ...(loc._sync || {}), sha: f.sha }; await db.salva(loc); }
      continue;
    }
    if (loc && loc.eliminato) continue;                                  // cancellato qui: resta cancellato
    if (loc && (loc.bozza || daInviare(loc))) continue;                  // qui ci sono modifiche in attesa: partono quelle
    if (rilievoVuoto(r)) continue;
    if (loc && String(loc.modificato) >= String(r.modificato)) { loc._sync = { ...(loc._sync || {}), sha: f.sha }; await db.salva(loc); continue; }
    const foto = {};
    nomiFoto(r).forEach(n => { foto[n] = true; });                       // le foto sono già su GitHub: non si rimandano
    await db.salva({ ...r, bozza: false, _sync: { inviato: r.modificato, foto, sha: f.sha } });
    nuovi++;
  }
  return nuovi;
}

async function sincronizzaTutto(silenzioso = true) {
  if (sincronizzandoTutto || invioInCorso || sincronizzandoApp || !config()) return;
  if (!inRete()) { mostraStatoSync(); return; }
  sincronizzandoTutto = true;
  let cambiato = false;
  try {
    const prima = firmaClienti();
    await aggiornaClienti();                                       // clienti del PC (quelli eliminati spariscono)
    if (await aggiornaPreventivi()) cambiato = true;                // preventivi in corso
    if (firmaClienti() !== prima) cambiato = true;
    const a = await sincronizzaAppuntamenti();                      // calendario: dal PC al telefono e viceversa
    if (a.scaricati || a.inviati) cambiato = true;
    const da = (await db.tutti()).filter(r => daInviare(r) && !(rilievo && rilievo.id === r.id));   // il rilievo aperto parte quando lo si chiude
    for (const r of da) { await inviaRilievo(r.id, () => {}); cambiato = true; }
    if (await scaricaRilievi()) cambiato = true;                    // rilievi fatti con gli altri telefoni
    appuntamenti = await db.tuttiApp();
    await caricaPunti();                                            // posizioni nuove arrivate dagli altri telefoni
    const t = new Date();
    ultimaSync = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    erroreSync = "";
  } catch (e) { erroreSync = e.message || String(e); }
  sincronizzandoTutto = false;
  if (cambiato) aggiornaVistaDopoSync();
  mostraStatoSync();
  if (!silenzioso) avviso(erroreSync || "Sincronizzato ✓", erroreSync ? "err" : "ok", erroreSync ? 7000 : 2500);
}
// dopo una modifica (appuntamento salvato, rilievo chiuso) si manda quasi subito, senza aspettare il minuto
function sincronizzaSubito() { clearTimeout(timerSubito); timerSubito = setTimeout(() => sincronizzaTutto(true), 1500); }

setInterval(() => { if (document.visibilityState === "visible") sincronizzaTutto(true); }, 60000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") setTimeout(() => sincronizzaTutto(true), 600); });
addEventListener("online", () => sincronizzaTutto(true));
setTimeout(() => sincronizzaTutto(true), 2500);

// ------------------------------------------------------------------------------------------------ eventi
$app.addEventListener("input", e => {
  if (e.target.id === "cerca-preventivo") { cercaPreventivo = e.target.value; disegnaPreventivi(); return; }
  if (e.target.id === "cerca-rilievo") { cercaRilievo = e.target.value; document.getElementById("elenco-rilievi").innerHTML = schedeRilievi(); return; }
  const p = e.target.dataset && e.target.dataset.p;
  if (!p || !rilievo) return;
  const percorso = JSON.parse(p);
  impostaPercorso(rilievo, percorso, e.target.value);
  if (percorso.join() === "indirizzo,testo") {   // correggendo l'indirizzo il punto preso sul posto resta (si toglie con «Togli»)
    if (!rilievo.indirizzo.gps) { rilievo.indirizzo.lat = null; rilievo.indirizzo.lon = null; }   // vecchie posizioni calcolate: non valgono più
    aggiornaLinkMappe();
  }
  if (percorso.join() === "cliente,nome") {
    const t = document.querySelector(".barra h1"); if (t) t.textContent = e.target.value || "Nuovo rilievo";
    const legato = rilievo.cliente_id && clientiPC.find(c => c.id === rilievo.cliente_id);
    if (legato && normNome(legato.nome) !== normNome(e.target.value)) delete rilievo.cliente_id;   // nome cambiato: non è più quel cliente
    const sg = document.getElementById("sugg-cliente"); if (sg) sg.innerHTML = suggerimentiCliente();
  }
  cambiato();
});
$app.addEventListener("change", e => {
  if (e.target.dataset && e.target.dataset.aggiungi !== undefined) {
    const files = [...e.target.files]; e.target.value = "";
    if (files.length) aggiungiFoto(files, JSON.parse(e.target.dataset.aggiungi));
  } else if (e.target.tagName === "SELECT" && e.target.dataset.p && rilievo) {
    impostaPercorso(rilievo, JSON.parse(e.target.dataset.p), e.target.value); cambiato();
    if (e.target.dataset.p.endsWith('"tipo"]')) disegnaEditor();
  }
});
$app.addEventListener("toggle", e => {
  const id = e.target.dataset && e.target.dataset.stanza;
  if (id) e.target.open ? apertiStanze.add(id) : apertiStanze.delete(id);
}, true);

$app.addEventListener("click", async e => {
  const apriRilievo = e.target.closest("[data-apri]");
  if (apriRilievo) { location.hash = "#/r/" + apriRilievo.dataset.apri; return; }
  const miniatura = e.target.closest("button[data-foto]");
  if (miniatura) { apriVisore(miniatura.dataset.foto, JSON.parse(miniatura.dataset.dest)); return; }
  if (e.target.closest("a[href]")) return;   // telefono, mappe e altri collegamenti seguono il loro corso
  const b = e.target.closest("[data-az]");
  if (!b) return;
  const az = b.dataset.az, s = +b.dataset.s, a = +b.dataset.a;
  try {
    if (az === "indietro") { if (rilievo) await uscitaEditor(); else history.length > 1 ? history.back() : (location.hash = ""); }
    else if (az === "esci-rilievo") await uscitaEditor();
    else if (az === "salva-rilievo") await salvaRilievoEsplicito();
    else if (az === "impostazioni") location.hash = "#/impostazioni";
    else if (az === "nuovo") { const r = nuovoRilievo(); await db.salva(r); location.hash = "#/r/" + r.id; }
    else if (az === "invia") await inviaTutti();
    else if (az === "giorno-app") { giornoApp = b.dataset.g; const d = new Date(giornoApp + "T12:00:00"); if (d.getMonth() !== meseApp.getMonth()) { meseApp = new Date(d.getFullYear(), d.getMonth(), 1); } disegnaCalendario(); }
    else if (az === "mese-prec") { meseApp = new Date(meseApp.getFullYear(), meseApp.getMonth() - 1, 1); disegnaCalendario(); }
    else if (az === "mese-succ") { meseApp = new Date(meseApp.getFullYear(), meseApp.getMonth() + 1, 1); disegnaCalendario(); }
    else if (az === "oggi-app") { giornoApp = oggi(); meseApp = new Date(); meseApp.setDate(1); disegnaCalendario(); }
    else if (az === "nuova-app") foglioAppuntamento(null);
    else if (az === "modifica-app") foglioAppuntamento(appuntamenti.find(x => x.id === b.dataset.id));
    else if (az === "dettaglio-app") await foglioDettaglio(appuntamenti.find(x => x.id === b.dataset.id));
    else if (az === "sync-app") { if (!inRete()) avviso("Nessuna connessione: si aggiorna da solo appena c'è rete.", "err"); else await sincronizzaTutto(false); }
    else if (az === "aggiorna-app") await aggiornaApp();
    else if (az === "posizione") await usaPosizione();
    else if (az === "scegli-prodotti") {
      const p = preventiviPC.find(x => x.id === rilievo.preventivo_id);
      if (p) await foglioPreventivo(p); else avviso("Questo preventivo non è più tra quelli «In corso» arrivati dal computer.", "err", 5000);
    }
    else if (az === "nuova-stanza") foglioStanze();
    else if (az === "nuova-apertura") { rilievo.stanze[s].aperture.push(nuovaApertura()); cambiato(); disegnaEditor(); }
    else if (az === "scegli-cliente") foglioClienti(c => applicaCliente(c));
    else if (az === "togli-posizione") {
      if (!confirm("Togliere la posizione presa sul posto da questo rilievo?\n\nSe è già arrivata nella scheda del cliente sul PC, cancellala anche lì.")) return;
      rilievo.indirizzo.lat = null; rilievo.indirizzo.lon = null; delete rilievo.indirizzo.gps; delete rilievo.indirizzo.gps_il;
      aggiornaPunto(rilievo); cambiato(); disegnaEditor();
    }
    else if (az === "usa-cliente") applicaCliente(clientiPC.find(c => c.id === b.dataset.id));
    else if (az === "apri-preventivo") await foglioPreventivo(preventiviPC.find(p => p.id === b.dataset.id));
    else if (az === "duplica") { const copia = JSON.parse(JSON.stringify(rilievo.stanze[s].aperture[a])); copia.foto = []; copia.id = breve() + breve(); delete copia.voci_id; delete copia.titolo; delete copia.prodotti;rilievo.stanze[s].aperture.splice(a + 1, 0, copia); cambiato(); disegnaEditor(); }
    else if (az === "elimina-apertura") {
      if (!confirm("Eliminare questa apertura e le sue foto?")) return;
      await eliminaFotoDi(rilievo.stanze[s].aperture[a]); rilievo.stanze[s].aperture.splice(a, 1); cambiato(); disegnaEditor();
    } else if (az === "elimina-stanza") {
      if (!confirm(`Eliminare la stanza «${rilievo.stanze[s].nome}» con misure e foto?`)) return;
      const st = rilievo.stanze[s];
      for (const ap of st.aperture || []) await eliminaFotoDi(ap);
      await eliminaFotoDi(st); rilievo.stanze.splice(s, 1); cambiato(); disegnaEditor();
    } else if (az === "elimina-rilievo") {
      if (!confirm("Eliminare questo rilievo?\n\nSparisce da questo telefono, dagli altri telefoni e dal PC (misure e foto).\nI preventivi già fatti non vengono toccati.")) return;
      const id = rilievo.id; clearTimeout(timerSalva); timerSalva = null; rilievo = null;
      await eliminaRilievoDefinitivo(id); location.hash = ""; sincronizzaSubito();
    } else if (az === "usa-link") {
      const c = decodificaLink(document.getElementById("cfg-link").value);
      if (!c) { avviso("Il link non è valido.", "err"); return; }
      salvaConfig(c); avviso("Collegato a " + c.r + ".", "ok"); vistaImpostazioni();
    } else if (az === "salva-cfg" || az === "prova-cfg") {
      const attuale = config();
      const r = document.getElementById("cfg-repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/^\/|\/$/g, "");
      const t = document.getElementById("cfg-token").value.trim() || (attuale ? attuale.t : "");
      if (!/^[\w.\-]+\/[\w.\-]+$/.test(r) || !t) { avviso("Scrivi il repository (nomeutente/nome) e la chiave.", "err"); return; }
      salvaConfig({ r, t, b: document.getElementById("cfg-ramo").value.trim() || "main" });
      if (az === "prova-cfg") await provaConnessione(); else { avviso("Salvato.", "ok"); vistaImpostazioni(); }
    } else if (az === "scollega") { if (confirm("Scollegare il telefono dal computer?\nI rilievi restano sul telefono.")) { localStorage.removeItem(CHIAVE_CONFIG); vistaImpostazioni(); } }
  } catch (err) { avviso(err.message || String(err), "err", 7000); }
});

// ------------------------------------------------------------------------------------------------ avvio
// all'apertura spariscono i rilievi vuoti rimasti (quelli creati senza scrivere niente)
async function pulisciVuoti() {
  try { for (const r of await db.tutti()) if (rilievoVuoto(r)) await db.elimina(r.id); } catch (e) { /* non essenziale */ }
}

async function vai() {
  const h = location.hash;
  const m = h.match(/^#\/r\/([\w\-]+)/);
  if (rilievo && !m) {   // si esce da un rilievo (anche con il tasto indietro del telefono): si salva lo stato, i vuoti spariscono, il resto va al PC
    if (timerSalva) await salvaOra();
    if (rilievoVuoto(rilievo)) { await db.elimina(rilievo.id); rilievo = null; }
    sincronizzaSubito();
  }
  await caricaPunti();   // le posizioni prese sul posto servono ai pulsanti delle mappe
  if (m) {
    const r = await db.leggi(m[1]);
    if (!r) { location.hash = ""; return; }
    modificatoAperto = r.modificato; istantanea = JSON.stringify(r);   // com'era all'apertura: serve per «Non salvare»
    rilievo = r; rilievo.stanze = rilievo.stanze || []; rilievo.foto = rilievo.foto || [];
    rilievo.cliente = rilievo.cliente || {}; rilievo.indirizzo = rilievo.indirizzo || { testo: "", lat: null, lon: null };
    disegnaEditor();
  } else if (h.startsWith("#/calendario")) await vistaCalendario();
  else if (h.startsWith("#/preventivi")) await vistaPreventivi();
  else if (h.startsWith("#/impostazioni")) vistaImpostazioni();
  else await vistaHome();
}
addEventListener("hashchange", () => { if (location.hash.startsWith("#cfg=")) importaDaIndirizzo(); vai().catch(e => avviso(e.message, "err")); });

importaDaIndirizzo();
const clientiPronti = caricaClientiLocali().catch(() => {});   // elenco clienti del PC: quelli già scaricati subito, poi l'aggiornamento
clientiPronti.then(() => aggiornaClienti()).catch(() => {});
caricaPreventiviLocali().catch(() => {});
Promise.all([clientiPronti, pulisciVuoti()]).then(() => vai()).catch(e => { $app.innerHTML =`<main><div class="banner banner-err">Non riesco ad aprire l'archivio del telefono: ${esc(e.message || e)}<br>Se stai usando la navigazione privata, esci e riprova.</div></main>`; });
// aggiornamento dell'app: quando il sito pubblicato cambia, il service worker nuovo prende il posto del vecchio e la pagina si ricarica da sola
async function aggiornaApp() {
  if (timerSalva) await salvaOra();
  avviso("Aggiorno l'app…");
  try {
    for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
    for (const nome of await caches.keys()) await caches.delete(nome);   // solo i file del sito: i dati (IndexedDB) restano
  } catch (e) { /* senza service worker si ricarica e basta */ }
  location.reload();
}
if ("serviceWorker" in navigator) {
  const aveva = !!navigator.serviceWorker.controller;
  let ricarica = false;
  navigator.serviceWorker.addEventListener("controllerchange", async () => {
    if (!aveva || ricarica) return;          // il primo servizio installato non deve ricaricare la pagina
    ricarica = true;
    if (timerSalva) await salvaOra();         // quello che si stava scrivendo è già al sicuro
    location.reload();
  });
  addEventListener("load", () => navigator.serviceWorker.register("sw.js").then(reg => reg.update()).catch(() => {}));
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
