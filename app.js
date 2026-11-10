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
const MISURE = [["larghezza", "Larghezza"], ["altezza", "Altezza"], ["altezza_davanzale", "Altezza davanzale"],
                ["altezza_soffitto", "Altezza soffitto"], ["spazio_sx", "Spazio a sinistra"], ["spazio_dx", "Spazio a destra"]];
const CHIAVE_CONFIG = "giode_rilievi_cfg";
const API = "https://api.github.com";

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
    const r = indexedDB.open("giode-rilievi", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("rilievi", { keyPath: "id" }); r.result.createObjectStore("foto"); };
    r.onsuccess = () => ok(r.result);
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
    salvaFoto: (chiave, blob) => op("foto", "readwrite", s => s.put(blob, chiave)),
    leggiFoto: chiave => op("foto", "readonly", s => s.get(chiave)),
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
const daInviare = r => !(r._sync && r._sync.inviato === r.modificato) || nomiFoto(r).some(n => !(r._sync.foto || {})[n]);
const contaAperture = r => (r.stanze || []).reduce((n, s) => n + (s.aperture || []).length, 0);

function nuovoRilievo() {
  const t = adesso();
  return { id: nuovoId(), versione: 1, data: oggi(), creato: t, modificato: t, cliente: { nome: "", telefono: "", email: "" },
           indirizzo: { testo: "", lat: null, lon: null }, note: "", stanze: [], foto: [], _sync: { inviato: "", foto: {} } };
}
const nuovaApertura = () => ({ tipo: "Finestra", larghezza: "", altezza: "", altezza_davanzale: "", altezza_soffitto: "", spazio_sx: "", spazio_dx: "",
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

async function caricaMiniature() {
  urlFoto.splice(0).forEach(u => URL.revokeObjectURL(u));
  for (const img of document.querySelectorAll("img[data-foto]")) {
    const blob = await db.leggiFoto(`${rilievo.id}/${img.dataset.foto}`);
    if (blob) { const u = URL.createObjectURL(blob); urlFoto.push(u); img.src = u; }
  }
}

async function apriVisore(nome, percorso) {
  const blob = await db.leggiFoto(`${rilievo.id}/${nome}`);
  if (!blob) { avviso("Questa foto non è più sul telefono.", "err"); return; }
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
      d.foto = d.foto.filter(n => n !== nome);
      await db.eliminaFoto(`${rilievo.id}/${nome}`);
      cambiato(); await salvaOra(); chiudi(); disegnaEditor();
    }
  });
  document.body.appendChild(v);
}

// ------------------------------------------------------------------------------------------------ indirizzo e mappe
function linkMappe() {
  const i = rilievo.indirizzo;
  const coordinate = i.lat != null && i.lon != null ? `${i.lat},${i.lon}` : "";
  const q = i.testo || coordinate;
  if (!q) return `<span class="muted small">Scrivi l'indirizzo o usa la posizione per aprire le mappe.</span>`;
  const ap = `https://maps.apple.com/?q=${encodeURIComponent(i.testo || coordinate)}` + (coordinate ? `&ll=${coordinate}` : "");
  const go = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(coordinate || i.testo)}`;
  return `<a class="btn btn-piccolo" href="${esc(ap)}" target="_blank" rel="noopener">🗺 Mappe</a><a class="btn btn-piccolo" href="${esc(go)}" target="_blank" rel="noopener">📍 Google Maps</a>`;
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
  let testo = "";
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=it&lat=${rilievo.indirizzo.lat}&lon=${rilievo.indirizzo.lon}`);
    if (r.ok) testo = indirizzoDa(await r.json());
  } catch (e) { /* senza rete restano le coordinate */ }
  if (testo) { rilievo.indirizzo.testo = testo; avviso("Indirizzo trovato: controllalo e correggi se serve.", "ok", 4500); }
  else { if (!rilievo.indirizzo.testo) rilievo.indirizzo.testo = `Posizione ${rilievo.indirizzo.lat}, ${rilievo.indirizzo.lon}`; avviso("Posizione salvata (l'indirizzo non si è potuto cercare: scrivilo a mano).", "", 5000); }
  cambiato(); disegnaEditor();
}

async function cercaIndirizzo() {
  const testo = rilievo.indirizzo.testo.trim();
  if (!testo) { avviso("Scrivi prima l'indirizzo.", "err"); return; }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=it&q=${encodeURIComponent(testo)}`);
    const dati = r.ok ? await r.json() : [];
    if (!dati.length) { avviso("Indirizzo non trovato sulla mappa: prova ad aggiungere la città.", "err", 5000); return; }
    rilievo.indirizzo.lat = +(+dati[0].lat).toFixed(6); rilievo.indirizzo.lon = +(+dati[0].lon).toFixed(6);
    cambiato(); aggiornaLinkMappe(); avviso("Trovato: " + dati[0].display_name, "ok", 5000);
  } catch (e) { avviso("Nessuna connessione: la ricerca sulla mappa ha bisogno di rete.", "err"); }
}

// ------------------------------------------------------------------------------------------------ viste
function barra(titolo, { indietro, impostazioni, stato } = {}) {
  return `<header class="barra">${indietro ? `<button data-az="indietro" aria-label="Indietro">‹</button>` : ""}<h1>${esc(titolo)}</h1>
    ${stato ? `<span class="stato" id="stato-salvataggio">${esc(stato)}</span>` : ""}
    ${impostazioni ? `<button data-az="impostazioni" aria-label="Impostazioni">⚙︎</button>` : ""}</header>`;
}

async function vistaHome() {
  rilievo = null;
  const elenco = (await db.tutti()).sort((a, b) => (b.data + b.modificato).localeCompare(a.data + a.modificato));
  const cfg = config();
  const attesa = elenco.filter(daInviare).length;
  const appenaCollegato = cfg && !standalone() && location.hash.startsWith("#cfg=");
  $app.innerHTML = barra("Rilievi Giodè", { impostazioni: true }) + `<main>
    ${appenaCollegato ? `<div class="banner"><strong>Collegato ✓</strong> Per avere l'app sulla schermata Home, <strong>adesso</strong> tocca Condividi <span aria-hidden="true">⬆︎</span> → «Aggiungi alla schermata Home» da questa pagina, poi aprila dall'icona.</div>` : ""}
    ${cfg ? "" :`<div class="banner"><strong>Manca il collegamento al computer.</strong> Puoi già fare i rilievi, ma per mandarli al PC serve il collegamento: apri <a href="#/impostazioni">Impostazioni</a>.</div>`}
    ${elenco.map(r => {
      const nFoto = nomiFoto(r).length;
      return `<div class="card cliccabile" data-apri="${esc(r.id)}">
        <div class="riga"><span class="rilievo-titolo">${esc(r.cliente.nome || "Cliente senza nome")}</span><span class="spazio"></span>
          ${daInviare(r) ? `<span class="badge badge-attesa">da inviare</span>` : `<span class="badge badge-ok">inviato</span>`}</div>
        <div class="rilievo-riga">${esc(r.data)}${r.indirizzo.testo ? " · " + esc(r.indirizzo.testo) : ""}</div>
        <div class="rilievo-riga">${(r.stanze || []).length} stanze · ${contaAperture(r)} aperture · ${nFoto} foto</div></div>`;
    }).join("") || `<div class="vuoto">Nessun rilievo.<br>Premi «Nuovo rilievo» per cominciare il primo sopralluogo.</div>`}
  </main>
  <div class="fondo"><div><button class="btn btn-primario" data-az="nuovo">+ Nuovo rilievo</button>
    <button class="btn" data-az="invia" ${cfg && attesa ? "" : "disabled"}>⟳ Invia al PC${attesa ? ` (${attesa})` : ""}</button></div></div>`;
  window.scrollTo(0, 0);
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
      ${campoTesto(["cliente", "nome"], "Nome e cognome", r.cliente.nome, "autocapitalize=words")}
      <div class="griglia">
        <label>Telefono<input data-p='["cliente","telefono"]' value="${esc(r.cliente.telefono)}" type="tel" inputmode="tel" autocomplete="off"></label>
        <label>Email<input data-p='["cliente","email"]' value="${esc(r.cliente.email)}" type="email" inputmode="email" autocapitalize="off" autocomplete="off"></label>
      </div>
    </section>
    <section class="card"><h2>Indirizzo</h2>
      <label>Via, numero, CAP e città<textarea data-p='["indirizzo","testo"]' rows="2" autocomplete="off">${esc(r.indirizzo.testo)}</textarea></label>
      <div class="riga"><button class="btn btn-piccolo" data-az="posizione">📍 Usa la mia posizione</button><button class="btn btn-piccolo" data-az="cerca">🔎 Trova sulla mappa</button></div>
      <div class="mappe-link mappa-link" id="mappe">${linkMappe()}</div>
      ${r.indirizzo.lat != null ? `<p class="muted small" id="pos-salvata" style="margin:.5rem 0 0">Posizione salvata: ${esc(r.indirizzo.lat)}, ${esc(r.indirizzo.lon)}</p>` : ""}
    </section>
    <h2 style="margin:.3rem .2rem .5rem">Stanze</h2>
    ${(r.stanze || []).map((s, si) => `
      <details class="card stanza" data-stanza="${esc(s.id)}" ${apertiStanze.has(s.id) ? "open" : ""}>
        <summary><span class="nome">${esc(s.nome)}</span><span class="zona">${(s.aperture || []).length} aperture</span></summary>
        <div style="margin-top:.6rem">
          <div class="griglia">${campoTesto(["stanze", si, "nome"], "Nome della stanza", s.nome)}<label>Zona<input value="${esc(s.categoria)}" data-p='["stanze",${si},"categoria"]' autocomplete="off"></label></div>
          ${(s.aperture || []).map((a, ai) => `
            <div class="apertura">
              <div class="intest"><strong>${esc(a.tipo || "Apertura")} ${ai + 1}</strong>
                <button class="btn btn-piccolo" data-az="duplica" data-s="${si}" data-a="${ai}">Duplica</button>
                <button class="btn btn-piccolo btn-pericolo" data-az="elimina-apertura" data-s="${si}" data-a="${ai}">Elimina</button></div>
              <label>Tipo<select data-p='["stanze",${si},"aperture",${ai},"tipo"]'>${TIPI_APERTURA.map(t => `<option ${t === a.tipo ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
              <div class="griglia">${MISURE.map(([k, et]) => campoMisura(["stanze", si, "aperture", ai, k], et, a[k])).join("")}</div>
              <label>Installazione<select data-p='["stanze",${si},"aperture",${ai},"installazione"]'><option value="">—</option>${INSTALLAZIONI.map(t => `<option ${t === a.installazione ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
              <label>Tenda desiderata<input list="elenco-tende" data-p='["stanze",${si},"aperture",${ai},"tenda_desiderata"]' value="${esc(a.tenda_desiderata)}" autocomplete="off"></label>
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
    <button class="btn btn-largo btn-pericolo" data-az="elimina-rilievo">Elimina questo rilievo dal telefono</button>
    <datalist id="elenco-tende">${TENDE.map(t => `<option value="${esc(t)}">`).join("")}</datalist>
  </main>
  <div class="fondo"><div><button class="btn btn-primario" data-az="fatto">Fatto</button></div></div>`;
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

async function eliminaFotoDi(oggetto) {
  for (const n of oggetto.foto || []) await db.eliminaFoto(`${rilievo.id}/${n}`);
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
async function inviaRilievo(id, avanza) {
  const r = await db.leggi(id);
  if (!r) return;
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
  for (let tentativo = 0; tentativo < 2; tentativo++) {
    const esistente = await gh("GET", `rilievi/${r.id}.json`);
    try { await gh("PUT", `rilievi/${r.id}.json`, { message: "Rilievo " + (r.cliente.nome || r.id), content: contenuto, ...(esistente ? { sha: esistente.sha } : {}) }); break; }
    catch (e) { if (tentativo || (e.stato !== 409 && e.stato !== 422)) throw e; }
  }
  const fresco = (await db.leggi(id)) || r;           // se nel frattempo è stato modificato, resta «da inviare»
  fresco._sync = { inviato: pulito.modificato, foto: inviate };
  await db.salva(fresco);
}

async function inviaTutti() {
  if (invioInCorso) return;
  if (!config()) { avviso("Prima collega il telefono al computer (Impostazioni).", "err"); return; }
  if (!inRete()) { avviso("Nessuna connessione: riprova quando c'è rete.", "err"); return; }
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
  if (!rilievo && !/^#\/(r|impostazioni)/.test(location.hash)) vistaHome();
}

// ------------------------------------------------------------------------------------------------ eventi
$app.addEventListener("input", e => {
  const p = e.target.dataset && e.target.dataset.p;
  if (!p || !rilievo) return;
  const percorso = JSON.parse(p);
  impostaPercorso(rilievo, percorso, e.target.value);
  if (percorso.join() === "indirizzo,testo") {   // l'indirizzo è stato cambiato a mano: la posizione trovata prima non vale più
    rilievo.indirizzo.lat = null; rilievo.indirizzo.lon = null;
    const p = document.getElementById("pos-salvata"); if (p) p.remove();
    aggiornaLinkMappe();
  }
  if (percorso.join() === "cliente,nome") { const t = document.querySelector(".barra h1"); if (t) t.textContent = e.target.value || "Nuovo rilievo"; }
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
  const b = e.target.closest("[data-az]");
  if (!b) return;
  const az = b.dataset.az, s = +b.dataset.s, a = +b.dataset.a;
  try {
    if (az === "indietro") { if (timerSalva) await salvaOra(); history.length > 1 ? history.back() : (location.hash = ""); }
    else if (az === "impostazioni") location.hash = "#/impostazioni";
    else if (az === "nuovo") { const r = nuovoRilievo(); await db.salva(r); location.hash = "#/r/" + r.id; }
    else if (az === "invia") await inviaTutti();
    else if (az === "fatto") { await salvaOra(); location.hash = ""; }
    else if (az === "posizione") await usaPosizione();
    else if (az === "cerca") await cercaIndirizzo();
    else if (az === "nuova-stanza") foglioStanze();
    else if (az === "nuova-apertura") { rilievo.stanze[s].aperture.push(nuovaApertura()); cambiato(); disegnaEditor(); }
    else if (az === "duplica") { const copia = JSON.parse(JSON.stringify(rilievo.stanze[s].aperture[a])); copia.foto = []; rilievo.stanze[s].aperture.splice(a + 1, 0, copia); cambiato(); disegnaEditor(); }
    else if (az === "elimina-apertura") {
      if (!confirm("Eliminare questa apertura e le sue foto?")) return;
      await eliminaFotoDi(rilievo.stanze[s].aperture[a]); rilievo.stanze[s].aperture.splice(a, 1); cambiato(); disegnaEditor();
    } else if (az === "elimina-stanza") {
      if (!confirm(`Eliminare la stanza «${rilievo.stanze[s].nome}» con misure e foto?`)) return;
      const st = rilievo.stanze[s];
      for (const ap of st.aperture || []) await eliminaFotoDi(ap);
      await eliminaFotoDi(st); rilievo.stanze.splice(s, 1); cambiato(); disegnaEditor();
    } else if (az === "elimina-rilievo") {
      if (!confirm("Eliminare questo rilievo dal telefono?\nSe lo hai già inviato e scaricato sul PC, resta lì.")) return;
      const id = rilievo.id; clearTimeout(timerSalva); timerSalva = null; rilievo = null; await db.elimina(id); location.hash = "";
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
async function vai() {
  const h = location.hash;
  const m = h.match(/^#\/r\/([\w\-]+)/);
  if (m) {
    const r = await db.leggi(m[1]);
    if (!r) { location.hash = ""; return; }
    rilievo = r; rilievo.stanze = rilievo.stanze || []; rilievo.foto = rilievo.foto || [];
    rilievo.cliente = rilievo.cliente || {}; rilievo.indirizzo = rilievo.indirizzo || { testo: "", lat: null, lon: null };
    disegnaEditor();
  } else if (h.startsWith("#/impostazioni")) vistaImpostazioni();
  else await vistaHome();
}
addEventListener("hashchange", () => { if (location.hash.startsWith("#cfg=")) importaDaIndirizzo(); vai().catch(e => avviso(e.message, "err")); });
addEventListener("online", () => { if (!rilievo && config() && !invioInCorso) db.tutti().then(l => { if (l.some(daInviare)) avviso("Torna la rete: premi «Invia al PC».", "", 4000); }); });

importaDaIndirizzo();
vai().catch(e => { $app.innerHTML = `<main><div class="banner banner-err">Non riesco ad aprire l'archivio del telefono: ${esc(e.message || e)}<br>Se stai usando la navigazione privata, esci e riprova.</div></main>`; });
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
