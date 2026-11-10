# Rilievi Giodè — sito per iPhone e iPad

Sito (app web) per prendere le misure delle tende dai clienti: cliente, indirizzo con mappe, stanze, misure di ogni
finestra, foto. Funziona anche **senza rete** (i dati restano sul telefono) e, quando c'è connessione, con «Invia al PC»
manda tutto a un archivio **privato** su GitHub. Sul computer, nel programma «Preventivi e Ordini Giodè», alla pagina
**Rilievi** si preme «Scarica nuovi rilievi» e misure, indirizzo e foto sono lì, pronti per fare il preventivo.

```
iPhone/iPad  ──(Invia al PC)──▶  repository PRIVATO su GitHub  ◀──(Scarica nuovi rilievi)──  programma sul PC
   (sito pubblicato con GitHub Pages: contiene solo il programma, nessun dato)
```

## Cosa serve (una volta sola, circa 15 minuti)

Servono **due repository** sul tuo account GitHub:

| Repository | Visibilità | Contiene |
|---|---|---|
| `rilievi` (nome a piacere) | **Pubblico** | i file di questa cartella (il sito). Nessun dato di clienti. |
| `rilievi-dati` (nome a piacere) | **Privato** | i rilievi e le foto dei clienti (li scrive il telefono) |

> Il sito deve stare in un repository pubblico perché GitHub Pages gratuito lo richiede. Per questo i dati stanno in un
> repository **separato e privato**: nel sito pubblico non c'è mai niente di un cliente.

### 1. Il repository privato dei dati
1. Su github.com: **New repository** → nome `rilievi-dati` → **Private** → spunta **Add a README file** → Create.

### 2. La chiave di accesso (token)
1. GitHub → foto profilo → **Settings** → in fondo **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. Nome: `Rilievi Giodè`. Scadenza: la più lunga consentita (poi andrà rinnovata).
3. **Repository access → Only select repositories** → scegli **solo** `rilievi-dati`.
4. **Permissions → Repository permissions → Contents → Read and write**. Nient'altro.
5. **Generate token** e copia il codice (`github_pat_…`): GitHub lo mostra una volta sola.

Con questa chiave si può leggere e scrivere **solo** `rilievi-dati`: non dà accesso a nient'altro del tuo account.

### 3. Il sito (GitHub Pages)
1. **New repository** → nome `rilievi` → **Public** → Create.
2. Carica dentro **tutti i file di questa cartella** (`index.html`, `app.js`, `stile.css`, `sw.js`, `manifest.webmanifest` e la cartella `icone`): *Add file → Upload files*.
3. **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch `main` / `(root)` → Save**.
4. Dopo un minuto il sito è su `https://TUONOME.github.io/rilievi/`.

### 4. Collegare il PC
Nel programma: **Impostazioni → Rilievi da iPhone / iPad** e compila
- *Repository dei dati*: `TUONOME/rilievi-dati`
- *Chiave di accesso*: il token del punto 2
- *Indirizzo del sito*: `https://TUONOME.github.io/rilievi/`

Premi **Salva** e **Prova la connessione** (deve dire «Collegato a TUONOME/rilievi-dati» e **non** avvisare che il repository è pubblico).

### 5. Collegare l'iPhone/iPad
1. Nel programma, sempre in Impostazioni → Rilievi, premi **Mostra il codice** e inquadra il codice QR con la **fotocamera** del telefono: si apre il sito già collegato.
2. **Subito**, da quella pagina: **Condividi ⬆︎ → Aggiungi alla schermata Home**. Poi apri l'app dall'icona.
3. Se l'app sulla Home risulta «non collegata» (su iPhone ha uno spazio dati suo): in **⚙︎ Impostazioni** dell'app incolla il link di collegamento (in Impostazioni del programma → **Copia il link**) e premi «Usa questo link».

> Il codice QR e il link contengono la chiave di accesso: non mostrarli né mandarli a chi non deve usare il sistema.
> Se il telefono va perso o la chiave viene condivisa per errore: su GitHub, nelle impostazioni dei token, **Revoke**, e crea una nuova chiave.

## Uso dal cliente
1. **+ Nuovo rilievo** → nome, telefono, email.
2. **Indirizzo**: scrivilo, oppure **📍 Usa la mia posizione** (compila via e città) e **🔎 Trova sulla mappa**. I pulsanti **Mappe** e **Google Maps** aprono l'indirizzo per la navigazione.
3. **+ Aggiungi stanza** (Soggiorno, Camera…) e per ogni stanza le aperture: tipo, **larghezza, altezza, altezza del davanzale, soffitto, spazi laterali** (in cm), installazione, tenda desiderata, note.
4. **📷 Scatta** o **🖼 Dalla libreria** per le foto di ogni apertura, della stanza o generali (si riducono da sole: poche centinaia di KB l'una).
5. Tutto si salva da solo. A fine sopralluogo (con rete) premi **⟳ Invia al PC**.
6. Sul computer: **Rilievi → Scarica nuovi rilievi** → apri il rilievo → **Crea preventivo dal rilievo**.

## Cose da sapere
- Senza rete i rilievi restano sul telefono (badge «da inviare») e si inviano appena c'è connessione.
- Le foto, una volta scaricate sul PC, si tolgono da GitHub (impostazione in Impostazioni → Rilievi) per non riempire l'archivio.
- «Elimina rilievo» sul telefono lo toglie solo dal telefono.
- Le stanze proposte sono quelle di partenza (Soggiorno, Camera da letto…); per altre si usa «Altra stanza».
- La mappa usa i servizi di OpenStreetMap (ricerca/indirizzo dalla posizione) e Apple/Google Maps (apertura): servono i permessi di posizione di Safari.
- Per aggiornare il sito dopo una modifica ai file, ricaricali nel repository `rilievi`.
