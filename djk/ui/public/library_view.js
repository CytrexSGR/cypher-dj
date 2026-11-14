// Library binding, prepare state and the set list.
import { fehlerAnzeige, setzeVorbereitLive, statusText, vorbereitText, postenArtText } from './browse.js';
import { $, $$, BUCHSTABE, LADE_DECKS, klasseLaden, melde, postJson, zustand } from './page_state.js';
import { stoebernLaden, stz } from './browse_table.js';
import { ladeBaum, markiereTyp, schliesseListenMenue, zeigeDetail } from './browse_detail.js';
import { fmtZeit, ladeBestand, laden } from './deck_view.js';
export function bindeLibrary() {
  for (const b of $$('[data-typ]')) b.addEventListener('click', () => {
    for (const x of $$('[data-typ]')) x.classList.toggle('an', x === b);
    Object.assign(stz, { typ: b.dataset.typ, sort: null, ab: false, seite: 0, ordner: null, feld: null, wert: null, facetteOffen: {}, liste: null, listeArt: null });
    markiereTyp(); stoebernLaden(); ladeBaum();
  });
  // Filterleiste (S3): Enter im Textfeld, sofort bei Haken und Auswahl; Fehler (400) zeigt stoebernLaden als „Library: …"
  const filter = () => { Object.assign(stz, { text: $('#lib-suche').value, camelot: $('#lib-key').value, nachbarn: $('#lib-nachbarn').checked, bpm: $('#lib-bpm').value, energie: $('#lib-energie').value, seite: 0 }); stoebernLaden(); };
  for (const id of ['#lib-suche', '#lib-key', '#lib-bpm']) $(id).addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') filter();
    // ↑/↓ im Feld gehen an die Liste (S5-Review B5): Fokus raus, Zeile wählen. Sonst reagierten ↑/↓/S nach einer Suche nicht.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.altKey && !e.ctrlKey && !e.metaKey && stz.treffer.length) {
      e.preventDefault(); e.target.blur();
      zeigeDetail(e.key === 'ArrowDown' ? Math.min(stz.treffer.length - 1, stz.wahl + 1) : Math.max(0, stz.wahl - 1));
    }
  });
  for (const id of ['#lib-nachbarn', '#lib-energie']) $(id).addEventListener('change', filter);
  // × und Esc leeren das Suchfeld (Chrome: input mit leerem Wert) und suchen neu. Nicht „search“: Chrome feuert es auch auf Enter, das
  // keydown schon bedient, jedes Enter schickte zwei Anfragen (S4-Review 4); Firefox kennt „search“ gar nicht.
  $('#lib-suche').addEventListener('input', () => { if ($('#lib-suche').value === '' && (stz.text ?? '') !== '') filter(); });
  $('#libliste').addEventListener('click', (e) => {
    const tr = e.target.closest('tr');
    if (tr && !e.target.closest('button')) zeigeDetail(Number(tr.dataset.i));
  });
  $('#st-kopfzeile').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    if (stz.sort === th.dataset.sort) stz.ab = !stz.ab; else Object.assign(stz, { sort: th.dataset.sort, ab: false });
    stz.seite = 0; stoebernLaden();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#listen-menue, .in-liste')) schliesseListenMenue(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#listen-menue').hidden) { schliesseListenMenue(); e.stopPropagation(); } }, true);
  $('#st-zurueck').addEventListener('click', () => { if (stz.seite > 0) { stz.seite--; stoebernLaden(); } });
  // Nicht über die letzte Seite hinaus, auch bei Doppelklick vor der Antwort (stz.seite zählt schon, stz.gesamt gilt noch; Review S1 MINOR 8)
  $('#st-weiter').addEventListener('click', () => {
    if (stz.seite + 1 >= Math.max(1, Math.ceil(stz.gesamt / stz.limit))) return;
    stz.seite++; stoebernLaden();
  });
}
export function libKnoepfe(td, t) {
  td.textContent = '';
  const e = zustand.bestand.find((x) => x.material_id === t.material_id);
  if (e) {
    for (const n of LADE_DECKS) {
      const b = document.createElement('button');
      b.className = `laden ${klasseLaden(n)}`; b.textContent = `LOAD ${BUCHSTABE[n]}`;
      b.addEventListener('click', () => laden(n, e));
      td.append(b);
    }
    return;
  }
  const b = document.createElement('button');
  b.className = 'laden';
  let zeile = null, fehlerzeile = false;
  if (!t.pfad_da) { b.textContent = 'MISSING'; b.disabled = true; b.title = 'File not found (drive unplugged?)'; }
  else if (t.vorbereitung === 'laeuft') {
    b.textContent = 'PREPARING…'; b.disabled = true;   // der Knopf bleibt kurz (Spalte!), Stufe, Prozent und Zeit stehen darunter
    beobachteVorbereitung(t);   // Seite neu geladen oder Liste neu gezeichnet, Lauf besteht noch: weiter beobachten
    zeile = vorbereitAnzeigen.get(t.material_id) ?? null;
  }
  else {
    // FAILED-Grund: aus der Beobachtung dieser Sitzung, sonst aus den /stoebern-Daten (überlebt F5; der Server nennt Grund und Stufe)
    const f = fehlerAnzeige(t, vorbereitFehler.get(t.material_id));
    if (f) { zeile = f; fehlerzeile = true; }
    b.textContent = f ? 'RETRY' : 'PREPARE'; b.addEventListener('click', () => vorbereiten(t, td));
  }
  td.append(b);
  if (zeile) {
    const z = document.createElement('div');
    z.className = fehlerzeile ? 'vorbereit-zeile vorbereit-fehler' : 'vorbereit-zeile';
    z.textContent = zeile; z.title = zeile;
    td.append(z);
  }
  vorbereitZelle.set(t.material_id, { t, td });
}
async function vorbereiten(t, td) {
  const r = await fetch('/mediathek/vorbereiten', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ material_id: t.material_id }) });
  const j = await r.json();
  if (r.status === 200) { await ladeBestand(); return stoebernLaden(); }
  if (r.status !== 202) return melde(`Prepare rejected: “${t.titel}” ${j.fehler}`, true);
  vorbereitFehler.delete(t.material_id); vorbereitAnzeigen.delete(t.material_id);
  t.vorbereitung = 'laeuft'; setzeVorbereitLive(t.material_id, 'laeuft'); libKnoepfe(td, t); zeichneVorbereitung(t.material_id);
  melde(`Preparing “${t.titel}” …`);
}
// Fragt den Stand alle 2 s ab und zeigt Stufe, Prozent, Zeit und „no progress for N s“ (browse.js vorbereitText). Eine Beobachtung je Track;
// Text und Fehler liegen je material_id, weil die Liste neu gezeichnet wird (neue Zeilenobjekte) und die Beobachtung weiterläuft.
const vorbereitAnzeigen = new Map(), vorbereitFehler = new Map(), vorbereitZelle = new Map(), beobachtet = new Set();
const zeichneVorbereitung = (mid) => {
  const z = vorbereitZelle.get(mid);
  if (!z || !z.td.isConnected) return;
  libKnoepfe(z.td, z.t);
  const sz = z.td.closest('tr')?.querySelector('td.status');   // Status-Spalte der Zeile: PREPARING… bzw. FAILED statt PREPARE
  if (sz) sz.textContent = statusText(z.t);
};
async function beobachteVorbereitung(t) {
  const mid = t.material_id;
  if (beobachtet.has(mid)) return;
  beobachtet.add(mid);
  let haengtGemeldet = false;
  try {
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 2000));
      let s = null, rs = null;
      try { rs = await fetch(`/mediathek/vorbereiten?material_id=${mid}`); s = await rs.json(); } catch { /* Server kurz weg: weiter fragen */ }
      if (!rs || (rs.ok && !s)) continue;   // Server kurz weg oder 200 ohne JSON: weiter fragen
      if (rs.ok && s?.status === 'laeuft') {
        const text = vorbereitText(s);
        if (text !== vorbereitAnzeigen.get(mid)) { vorbereitAnzeigen.set(mid, text); zeichneVorbereitung(mid); }
        if (s.haengt && !haengtGemeldet) melde(`“${t.titel}”: ${text}`, true);
        haengtGemeldet = !!s.haengt;
        continue;
      }
      vorbereitAnzeigen.delete(mid);
      t.vorbereitung = null;
      if (!rs.ok || s?.status === 'fehler') {
        const text = vorbereitText(s?.status === 'fehler' ? s : { status: 'fehler', grund: s?.fehler ?? `http ${rs.status}` });
        vorbereitFehler.set(mid, text); setzeVorbereitLive(mid, 'fehler');
        for (const z of [vorbereitZelle.get(mid)]) if (z) z.t.vorbereitung = null;
        zeichneVorbereitung(mid);
        return melde(`Prepare failed — “${t.titel}”: ${text}`, true);
      }
      vorbereitFehler.delete(mid); setzeVorbereitLive(mid, null);
      await ladeBestand();
      stoebernLaden();
      return melde(`“${t.titel}” is ready to load`);
    }
  } finally { beobachtet.delete(mid); }
}
// ---------- Sets (Plan 2026-10-03-sets-mit-tracks) ----------
const SET_STATUS_TEXT = { ready: 'READY', prepare: 'PREPARE', missing: 'MISSING', wartet: 'QUEUED', kein_track: 'NOT A TRACK', laeuft: 'PREPARING…', fehler: 'FAILED', unbekannt: '?' };
export function aktivesSet() { try { return localStorage.getItem('djk-set') || ''; } catch { return ''; } }
function setzeAktivesSet(slug) { try { localStorage.setItem('djk-set', slug); } catch { /* ohne Speicher: nur jetzt */ } }
let listenGeladen = false;
async function ladeImportListen() {
  if (listenGeladen) return;
  try {
    const r = await fetch('/mediathek/listen');
    if (!r.ok) return;
    for (const l of await r.json()) {
      const o = document.createElement('option');
      o.value = String(l.id); o.textContent = `${l.name} (${l.n})`;
      $('#set-import').append(o);
    }
    listenGeladen = true;
  } catch { /* ohne Listen: nur der Import fehlt */ }
}
export async function ladeSetListe() {
  ladeImportListen();
  const liste = await (await fetch('/sammlungen?art=set')).json();
  const sel = $('#set-wahl');
  sel.textContent = '';
  for (const s of liste) {
    const o = document.createElement('option');
    o.value = s.slug; o.textContent = s.fehler ? `${s.name} (broken)` : s.name;
    sel.append(o);
  }
  const a = aktivesSet();
  if (liste.some((s) => s.slug === a)) sel.value = a; else if (liste[0]) { sel.value = liste[0].slug; setzeAktivesSet(liste[0].slug); }
  await zeigeSet();
}
async function zeigeSet() {
  const slug = $('#set-wahl').value;
  const tb = $('#setliste');
  tb.textContent = '';
  if (!slug) { $('#set-zusammenfassung').textContent = 'No set yet — name one and press NEW SET'; return; }
  const r = await fetch(`/sammlungen/${encodeURIComponent(slug)}`);
  const j = await r.json();
  if (!r.ok) return melde(`Set: ${j.fehler}`, true);
  zustand.set = j;
  for (const p of j.posten) tb.append(setZeile(p));
  const u = j.uebersicht;
  const bpm = u.bpm ? (u.bpm.min === u.bpm.max ? `${u.bpm.min} BPM` : `${u.bpm.min}–${u.bpm.max} BPM`) : 'BPM –';
  const keys = Object.entries(u.camelot).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => `${k}×${n}`).join(' ');
  const st = Object.entries(u.status).map(([k, n]) => `${n} ${(SET_STATUS_TEXT[k] ?? k).toLowerCase()}`).join(', ');
  $('#set-zusammenfassung').textContent = `${u.tracks} ${u.tracks === 1 ? 'track' : 'tracks'} · ${fmtZeit(u.dauer_s)} · ${bpm}${keys ? ` · ${keys}` : ''}${st ? ` · ${st}` : ''}`;
  $('#set-zusammenfassung').title = Object.entries(u.genre).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g}: ${n}`).join('\n');
}
function setZeile(p) {
  const tr = document.createElement('tr');
  tr.dataset.posten = p.id;
  const titel = p.mix ? `${p.titel ?? '–'} (${p.mix})` : (p.titel ?? p.material_id);
  for (const [w, k] of [[titel, 'titelzelle'], [p.kuenstler ?? '–', ''], [p.bpm ?? '–', 'zahl'], [p.camelot ?? '–', 'zahl'], [p.energie ?? '–', 'zahl'],
    [p.genre ?? '–', ''], [p.dauer_s ? fmtZeit(p.dauer_s) : '–', 'zahl'], [SET_STATUS_TEXT[p.status] ?? p.status, `status st-${p.status}`]]) {
    const td = document.createElement('td'); td.textContent = w; td.className = k; tr.append(td);
  }
  if (p.grund) tr.title = p.grund;
  const td = document.createElement('td');
  td.className = 'aktion';
  if (p.art !== 'track') {                                   // Loop/Sample: kein LOAD A/B, nur die Art als Hinweis
    const hinweis = document.createElement('span'); hinweis.className = 'grund'; hinweis.textContent = postenArtText(p.art);
    td.append(hinweis);
  }
  const e = p.laden_mid ? zustand.bestand.find((x) => x.material_id === p.laden_mid) : null;
  if (e) for (const n of LADE_DECKS) {
    const b = document.createElement('button');
    b.className = `laden ${klasseLaden(n)}`; b.textContent = `LOAD ${BUCHSTABE[n]}`;
    b.addEventListener('click', () => laden(n, e));
    td.append(b);
  }
  const weg = document.createElement('button');
  weg.className = 'laden weg'; weg.textContent = '✕'; weg.title = 'Remove from set';
  weg.addEventListener('click', async () => {
    const r = await postJson(`/sammlungen/${encodeURIComponent(zustand.set.slug)}/posten/entfernen`, { id: p.id });
    if (!r.ok) return melde(`Remove: ${r.j.fehler}`, true);
    zeigeSet();
  });
  td.append(weg);
  tr.append(td);
  return tr;
}
async function neuesSet() {
  const name = $('#set-name').value.trim();
  if (!name) return melde('Give the set a name', true);
  const r = await postJson('/sammlungen', { name });
  if (!r.ok) return melde(`New set: ${r.j.fehler}`, true);
  $('#set-name').value = '';
  setzeAktivesSet(r.j.slug);
  await ladeSetListe();
  melde(`Set “${name}” created`);
}
let setUhr = null;
function beobachteSet() {
  if (setUhr) return;
  setUhr = setInterval(async () => {
    if ($('[data-tabelle="sets"]').hidden) { clearInterval(setUhr); setUhr = null; return; }
    const vorher = (zustand.set?.posten ?? []).filter((p) => p.status === 'ready').length;
    await zeigeSet();
    const jetzt = zustand.set.posten;
    if (jetzt.filter((p) => p.status === 'ready').length > vorher) { await ladeBestand(); await zeigeSet(); }
    if (!jetzt.some((p) => p.status === 'wartet' || p.status === 'laeuft')) { clearInterval(setUhr); setUhr = null; melde('Set prepared'); }
  }, 3000);
}
export function bindeSets() {
  $('#set-neu').addEventListener('click', neuesSet);
  $('#set-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') neuesSet(); });
  $('#set-import').addEventListener('change', async () => {
    const v = $('#set-import').value;
    if (!v) return;
    const r = await postJson('/sammlungen/import', { liste_id: Number(v) });
    $('#set-import').value = '';
    if (!r.ok) return melde(`Import: ${r.j.fehler}`, true);
    setzeAktivesSet(r.j.slug);
    await ladeSetListe();
    melde(`Imported ${r.j.posten} tracks`);
  });
  $('#set-alle').addEventListener('click', async () => {
    const slug = $('#set-wahl').value;
    if (!slug) return;
    const r = await postJson(`/sammlungen/${encodeURIComponent(slug)}/vorbereiten`, {});
    if (!r.ok) return melde(`Prepare all: ${r.j.fehler}`, true);
    melde(`${r.j.eingereiht} ${r.j.eingereiht === 1 ? 'track' : 'tracks'} queued (about a minute each, two at a time)`);
    beobachteSet();
  });
  $('#set-loeschen').addEventListener('click', async () => {
    const slug = $('#set-wahl').value;
    if (!slug || !confirm(`Move set “${$('#set-wahl').selectedOptions[0].textContent}” to the trash?`)) return;
    const r = await postJson(`/sammlungen/${encodeURIComponent(slug)}/loeschen`, {});
    if (!r.ok) return melde(`Delete set: ${r.j.fehler}`, true);
    setzeAktivesSet(''); ladeSetListe();
  });
  $('#set-wahl').addEventListener('change', () => { setzeAktivesSet($('#set-wahl').value); zeigeSet(); });
}
