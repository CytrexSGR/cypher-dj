// Library table: loading, rows and the action buttons of a row.
import { stoebernUrl, SPALTEN, zelle, aktionenFuer, loopBoxStatus, IMPORT_FEHLER_TEXT } from './browse.js';
import { $, $$, BUCHSTABE, LADE_DECKS, el, klasseLaden, melde, postJson, zustand } from './page_state.js';
import { TYP_ART, behalteWahl, ladeListe, leereDetail, oeffneListenMenue, postenKoerper } from './browse_detail.js';
import { zeigeReiterInfo } from './seitenrahmen.js';
import { BOXEN, ladeLoopSlot, ladeLoops } from './loop_rec_view.js';
import { HINWEIS_LOOPS, loopsPlatzDa } from './slots_view.js';
import { instanzen, waehleRolle } from './instanzen.js';
import { aktivesSet, libKnoepfe } from './library_view.js';
import { laden } from './deck_view.js';

// ---------- Library: Browser über die Mediathek (Plan 2026-10-10-mediathek-browser) ----------
export const stz = { typ: 'track', sort: null, ab: false, seite: 0, treffer: [], gesamt: 0, limit: 100, wahl: -1, lauf: 0, seiteOk: 0, ordner: null, feld: null, wert: null, facetteOffen: {}, baumLauf: 0,
  liste: null, listeArt: null, listenOffen: {} };   // liste: Slug der in der Mitte gezeigten Liste (S2b), sonst null
zustand.stoebern = stz;
export async function stoebernLaden() {
  if (stz.liste) return ladeListe();
  const nr = ++stz.lauf;                                   // nur die letzte Antwort zählt (schnelles Klicken)
  const r = await fetch(stoebernUrl(stz));
  const j = await r.json();
  if (nr !== stz.lauf) return;
  if (!r.ok) { leereDetail(); stz.seite = stz.seiteOk; $('#libliste').textContent = ''; zustand.libraryInfo = j.fehler === 'katalog_fehlt' ? 'No library catalog found (is its drive mounted?). To build one from your own folders: djk/start/djk-bibliothek dazu <folder>, then bauen'
    : j.fehler === 'suchfeld_nicht_anwendbar' ? 'Library: patterns have only name: and rolle: as search fields' : `Library: ${j.fehler}`; return zeigeReiterInfo(); }
  stz.seiteOk = j.seite;
  Object.assign(stz, { treffer: j.treffer, gesamt: j.gesamt, limit: j.limit, sort: j.sort, ab: j.richtung === 'ab' });
  zeigeKopfzeile();
  $('.st-seiten').hidden = false;
  const tb = $('#libliste');
  tb.textContent = '';
  j.treffer.forEach((t, i) => tb.append(stoebernZeile(t, i)));
  const seiten = Math.max(1, Math.ceil(j.gesamt / j.limit));
  $('#st-seite').textContent = `Page ${j.seite + 1} of ${seiten.toLocaleString('en')}`;
  $('#st-zurueck').disabled = j.seite === 0; $('#st-weiter').disabled = j.seite + 1 >= seiten;
  const art = TYP_ART[stz.typ];
  zustand.libraryInfo = stz.typ === 'strudel' ? `${j.gesamt.toLocaleString('en')} ${art}`
    : `${j.gesamt.toLocaleString('en')} ${art} · catalog ${j.gebaut_am ? new Date(j.gebaut_am).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '?'}`;
  zeigeReiterInfo();
  behalteWahl();
}
export function zeigeKopfzeile(spalten = SPALTEN[stz.typ]) {
  const k = $('#st-kopfzeile');
  k.textContent = '';
  for (const s of spalten) {
    const th = document.createElement('th');
    th.textContent = s.titel + (s.sort && s.sort === stz.sort ? (stz.ab ? ' ▾' : ' ▴') : '');
    if (s.sort) { th.dataset.sort = s.sort; th.classList.add('sortierbar'); }
    k.append(th);
  }
  k.append(document.createElement('th'));                  // Aktionen
}
// spalten: in der Listenansicht die der Liste (LISTEN_SPALTEN), sonst die des Zeilentyps
export function stoebernZeile(t, i, spalten = SPALTEN[t.typ] ?? SPALTEN[stz.typ]) {
  const tr = document.createElement('tr');
  if (t.sha) tr.dataset.sha = t.sha;
  tr.dataset.i = String(i);
  if (t.typ === 'track') tr.dataset.material = t.material_id;
  if (t.typ === 'strudel' ? !t.ladbar : !t.pfad_da) tr.classList.add('fehlt');
  for (const s of spalten) { const td = document.createElement('td'); td.textContent = zelle(s, t); if (s.klasse) td.className = s.klasse; tr.append(td); }
  const td = document.createElement('td'); td.className = 'aktion';
  aktionsKnoepfe(td, t);
  tr.append(td);
  return tr;
}
// Aktionen einer Zeile UND des Details (S5): je Typ dieselben Knöpfe, damit die Spalte nichts anbietet, was die Zeile nicht kann.
// Die Track-Knöpfe liegen in einem eigenen span: libKnoepfe leert seinen Behälter (PREPARING…), + SET und + LIST dürfen dabei nicht mitgehen.
export function aktionsKnoepfe(td, t) {
  for (const a of aktionenFuer(t)) {
    if (a === 'track') { const sp = document.createElement('span'); sp.className = 'track-aktion'; trackKnoepfe(sp, t); td.append(sp); }
    else if (a === 'loopbox') loopBoxKnoepfe(td, t);
    else if (a === 'editor' || a === 'kopieren') strudelKnoepfe(td, t);
    else if (a === 'set') {
      const plus = document.createElement('button');            // wie die alte Trefferliste (probe_sets klickt button.in-set in der Zeile)
      plus.className = 'laden in-set'; plus.textContent = '+ SET'; plus.title = 'Add to the active set (S)';
      plus.addEventListener('click', () => inSet(t));
      td.append(plus);
    } else if (a === 'liste') {
      const liste = document.createElement('button');
      liste.className = 'laden in-liste'; liste.textContent = '+ LIST ▾'; liste.title = 'Add to a list';
      liste.addEventListener('click', (e) => { e.stopPropagation(); oeffneListenMenue(t, liste); });
      td.append(liste);
    }
  }
}
// Loop aus der Mediathek → L1/L2 (S6): der Server dekodiert, dehnt auf 128 BPM, schneidet auf die exakten Frames und legt den Loop in
// die Loop-Bibliothek (POST /loops/aus-katalog), die Seite lädt ihn dann wie jeden Loop. Während ein Import läuft (der Server rechnet
// höchstens einen) sind ALLE → L-Knöpfe aus, auch die der anderen Zeilen. nur_live: kein Knopf, der Grund steht da.
export let loopImportLaeuft = false;
function loopBoxKnoepfe(td, t) {
  const s = loopBoxStatus(t);
  const sp = el('span', 'loopbox-aktion');
  if (t.nur_live) { sp.append(el('span', 'loopbox-grund', s.grund)); td.append(sp); return; }
  for (const n of BOXEN) {
    const b = el('button', `laden in-box l${n}`, `→ L${n}`);
    b.dataset.ok = s.aktiv ? '1' : '0';
    b.disabled = !s.aktiv || loopImportLaeuft || !loopsPlatzDa();
    b.dataset.titel0 = s.aktiv ? `${s.titel} L${n}` : s.titel;
    b.title = loopsPlatzDa() ? b.dataset.titel0 : HINWEIS_LOOPS;
    b.addEventListener('click', (e) => { e.stopPropagation(); loopAusKatalog(t, n); });
    sp.append(b);
  }
  if (s.grund) sp.append(el('span', 'loopbox-grund', s.grund));
  td.append(sp);
}
function setzeImportSperre(an) {
  loopImportLaeuft = an;
  for (const b of $$('button.in-box')) b.disabled = an || b.dataset.ok !== '1' || !loopsPlatzDa();
}
async function loopAusKatalog(t, n) {
  if (loopImportLaeuft) return;
  setzeImportSperre(true);
  melde(`Importing “${t.name}” — stretching to 128 BPM …`);
  try {
    const r = await postJson('/loops/aus-katalog', { sha: t.sha });
    if (!r.ok) return melde(`Loop import: ${IMPORT_FEHLER_TEXT[r.j.fehler] ?? r.j.fehler}`, true);
    const geladen = await ladeLoopSlot(r.j.name, n);
    ladeLoops();                                              // der neue Loop steht auch im Reiter LOOPS
    if (geladen) melde(r.j.schon_da ? `“${r.j.name}” was already imported — loaded into L${n}` : `“${r.j.name}” imported (${r.j.beats} beats at 128 BPM) and loaded into L${n}`);
  } catch (e) { melde(`Loop import: ${e.message}`, true); }
  finally { setzeImportSperre(false); }
}
// STRUDEL-Zeile: ladbare Muster gehen in den Editor einer Instanz, Archiv-Muster nur in die Zwischenablage
function strudelKnoepfe(td, t) {
  if (t.ladbar) {
    for (const [strom, text] of [[1, 'DRUMS'], [2, 'BASS'], [3, 'MELODY']]) {
      const b = document.createElement('button');
      b.className = 'laden in-editor'; b.dataset.strom = String(strom); b.textContent = `→ ${text}`;
      b.title = `Put the pattern into the ${text} editor (nothing is sent)`;
      b.addEventListener('click', () => inEditor(t, strom));
      td.append(b);
    }
    return;
  }
  const b = document.createElement('button');
  b.className = 'laden kopieren'; b.textContent = 'COPY'; b.title = 'Archive pattern: copy the text, adapt it, then SAVE it as your own';
  b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(t.text); melde(`“${t.name}” copied`); } catch (e) { melde(`Copy failed: ${e.message}`, true); }
  });
  td.append(b);
}
// Laden heißt: in den Editor, nicht senden. Wie Tippen: das Feld wird schmutzig, AUTO geht aus, Andreas drückt PLAY im richtigen Moment.
function inEditor(t, strom) {
  const i = instanzen.get(strom);
  if (!i) return melde('Strudel editor not ready', true);
  const f = $('.muster-feld', i.w);
  // Ungesendeter Text im Editor wird nicht still überschrieben (REVERT holt nur das Laufende zurück; Review S2b Befund 3)
  if (i.schmutzig && f.value !== t.text && !confirm(`The ${['DRUMS', 'BASS', 'MELODY'][strom - 1]} editor has text that was not played. Replace it with “${t.name}”?`)) return;
  waehleRolle(strom);
  f.value = t.text; f.dispatchEvent(new Event('input'));
  melde(`“${t.name}” is in the ${['DRUMS', 'BASS', 'MELODY'][strom - 1]} editor — press PLAY when it fits (one change per 8 bars)`);
}
// Track-Aktionen: im Bestand LOAD A/B, sonst PREPARE / MISSING / PREPARING… (wie die alte Trefferliste)
function trackKnoepfe(td, t) {
  td.textContent = '';
  const e = t.laden_mid ? zustand.bestand.find((x) => x.material_id === t.laden_mid) : null;
  if (e) {
    for (const n of LADE_DECKS) {
      const b = document.createElement('button');
      b.className = `laden ${klasseLaden(n)}`; b.textContent = `LOAD ${BUCHSTABE[n]}`;
      b.addEventListener('click', () => laden(n, e));
      td.append(b);
    }
    return;
  }
  t.vorbereitung = t.status === 'laeuft' ? 'laeuft' : null;   // libKnoepfe liest das alte Feld (Review m3): PREPARING… statt klickbarem PREPARE
  libKnoepfe(td, t);
}
// + SET postet die echte Art (Spec §7: track; loop/oneshot mit quelle mediathek, Task 1.6). Ersetzt die alte inSet (art fest 'track').
export async function inSet(t) {
  const slug = aktivesSet();
  if (!slug) return melde('No active set — create one in SETS', true);
  const r = await postJson(`/sammlungen/${encodeURIComponent(slug)}/posten`, postenKoerper(t));
  if (!r.ok) return melde(`Add to set: ${r.j.fehler}`, true);
  const n = t.titel ?? t.name;
  melde(r.j.schon_drin ? `“${n}” is already in the set` : `“${n}” added to the set`);
}
