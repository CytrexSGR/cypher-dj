// Library detail view, filter facets, tree and Traktor lists.
import { vorhoerFolgt, welleStatus, detailFakten, feldText, filterFuer, filterBereinigt, baueBaum, LISTEN_TEXT, listenArtFuer, LISTEN_SPALTEN, ziehZiel } from './browse.js';
import { leseWelle, Uebersicht } from './wave.js';
import { $, $$, el, melde, postJson, zustand } from './page_state.js';
import { aktionsKnoepfe, stoebernLaden, stoebernZeile, stz, zeigeKopfzeile } from './browse_table.js';
import { hoerId, vorhoerKnoepfe, vorhoeren, zeigeHoert } from './prelisten_view.js';
import { zeigeReiterInfo } from './seitenrahmen.js';
// ---------- Detail-Spalte (S5): Fakten, Welle, Angaben mit Quelle, Aktionen ----------
let detailLauf = 0, welleTimer = 0, welleAbbruch = null;   // welleAbbruch: AbortController der laufenden Wellen-Anfrage (S5-Review B2)
const brichWelleAb = () => { clearTimeout(welleTimer); welleAbbruch?.abort(); welleAbbruch = null; };
const wahlSchluessel = (t) => `${t.typ}:${t.sha ?? t.id ?? t.material_id}`;
function markiereWahl() {
  for (const tr of $$('#libliste tr')) tr.classList.toggle('gewaehlt', tr.dataset.i === String(stz.wahl));
}
export function leereDetail() {
  ++detailLauf; brichWelleAb();
  Object.assign(stz, { wahl: -1, wahlKey: null });
  $('#st-detail').textContent = '';
  markiereWahl();
}
// Nach jedem Neuladen der Mitte: die gewählte Zeile bleibt gewählt (z. B. nach PREPARE), wenn sie noch da ist, sonst wird das Detail leer
export function behalteWahl() {
  const i = stz.wahlKey ? stz.treffer.findIndex((t) => wahlSchluessel(t) === stz.wahlKey) : -1;
  if (i < 0) return leereDetail();
  zeigeDetail(i, false);
}
export async function zeigeDetail(i, scrollen = true) {
  const t = stz.treffer[i]; if (!t) return;
  if (scrollen && i === stz.wahl && stz.wahlKey === wahlSchluessel(t) && $('#st-detail').firstChild) return;   // ↓ auf der letzten, ↑ auf der ersten Zeile: nichts neu starten (Re-Review L4)
  const nr = ++detailLauf; brichWelleAb(); stz.detailWelle = null;   // S7: die Position wird nur in die Welle der gehörten Zeile gezeichnet                    // die alte Welle wird nicht mehr gebraucht: Anfrage abbrechen, der Server beendet ffmpeg
  Object.assign(stz, { wahl: i, wahlKey: wahlSchluessel(t) });
  markiereWahl();
  if (scrollen) $$('#libliste tr')[i]?.scrollIntoView({ block: 'nearest' });
  const d = $('#st-detail'); d.textContent = '';
  d.append(el('h3', '', t.typ === 'track' ? `${t.kuenstler ?? '–'} – ${t.titel ?? '–'}${t.mix ? ` (${t.mix})` : ''}` : (t.name ?? '–')));
  const knoepfe = el('div', 'st-aktionen'); aktionsKnoepfe(knoepfe, t); if (t.typ !== 'strudel') knoepfe.append(vorhoerKnoepfe(t)); d.append(knoepfe);
  zeigeHoert();
  if (vorhoerFolgt(t, hoerId(t), { wartet: stz.wartet, hoert: stz.hoert })) vorhoeren(t);   // Wahl wechselt während des Hörens: die neue Zeile spielt sofort, wie im Finder
  const fakten = el('dl', 'st-fakten');
  for (const [k, v] of detailFakten(t)) { fakten.append(el('dt', '', k)); const dd = el('dd', k === 'Folder' ? 'st-ordner' : '', v); if (k === 'Folder') dd.title = v; fakten.append(dd); }
  d.append(fakten);
  if (t.typ === 'strudel') {                                  // Muster: Code statt Welle, nichts vom Server nötig
    d.append(el('div', 'st-hinweis', t.ladbar ? 'Loading puts the code into the editor; nothing is sent until you press PLAY.' : 'Archive pattern: view and copy only. Adapt it, then SAVE it as your own.'));
    d.append(el('pre', 'st-code', t.text || '(empty)'));
    return;
  }
  const feld = el('div', 'st-wellefeld'); d.append(feld);
  const status = welleStatus(t);
  if (status.grund) feld.textContent = status.grund;
  let j;
  try {
    const r = await fetch(`/stoebern/detail?${t.sha ? `sha=${t.sha}` : `mid=${t.material_id}`}`);
    if (nr !== detailLauf) return;
    j = r.ok ? await r.json() : null;
    if (!j) { d.append(el('div', 'st-hinweis', r.status === 404 ? 'This entry is not in the library catalog anymore (the catalog may have been rebuilt); search again' : `Details unavailable (${r.status}).`)); if (!status.anfordern) return; }
  } catch (e) { if (nr === detailLauf) d.append(el('div', 'st-hinweis', `Details unavailable: ${e.message}`)); return; }
  if (nr !== detailLauf) return;
  if (j) {
    const e = j.eintrag;
    if (j.pfad) { fakten.append(el('dt', '', 'File')); const dd = el('dd', 'st-ordner', j.pfad.split('/').pop()); dd.title = j.pfad; fakten.append(dd); }
    const tab = el('table', 'st-angaben');
    const kopf = tab.insertRow(); for (const x of ['Field', 'Value', 'Source']) kopf.append(el('th', '', x));
    for (const a of j.angaben) {
      const r = tab.insertRow(); if (!a.gilt) r.className = 'ueberstimmt';
      r.title = a.gilt ? `Wins · seen ${a.erhoben_am}` : `Overridden by a higher-ranked source · seen ${a.erhoben_am}`;
      for (const x of [feldText(a.feld), a.wert, a.quelle]) r.insertCell().textContent = x;
    }
    if (j.angaben.length) d.append(tab); else d.append(el('div', 'st-hinweis', 'No Mediathek tags for this file.'));
    // Welle: erst nach kurzer Ruhe (↑/↓ im Schnelldurchlauf rechnet nicht jede Datei an), und nur, wenn sie gelingen kann
    const ws = welleStatus(e);
    feld.textContent = ws.grund ?? '';
    if (ws.anfordern) {
      feld.textContent = 'Waveform …';
      welleAbbruch = new AbortController();
      const signal = welleAbbruch.signal;
      welleTimer = setTimeout(() => ladeDetailWelle(nr, j.objekt_sha ?? e.sha, feld, signal), 150);   // objekt_sha: die Datei des angeklickten Objekts (B6)
    }
  }
}
async function ladeDetailWelle(nr, sha, feld, signal) {
  try {
    const r = await fetch(`/welle?sha=${sha}`, { signal });
    if (nr !== detailLauf) return;
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      feld.textContent = `Waveform unavailable (${r.status === 422 ? 'cannot decode this file' : r.status === 504 ? 'waveform timed out' : r.status === 404 ? 'file not found' : `error ${r.status}`})`;
      feld.title = j.fehler ?? '';                         // der Wortlaut (ffmpeg-Meldung) nur als Tooltip
      return;
    }
    const w = leseWelle(await r.arrayBuffer());
    if (nr !== detailLauf) return;
    feld.textContent = '';
    const cv = el('canvas', 'st-welle'); feld.append(cv);
    const u = new Uebersicht(cv); u.setzeWelle(w); u.zeichne(0, 0); stz.detailWelle = u;
  } catch (e) { if (nr === detailLauf && e.name !== 'AbortError') feld.textContent = `Waveform unavailable (${e.message})`; }
}
// Ordner-Baum und Facetten (Plan 2.3). Zähler gelten je Typ, nicht je Filter (Plan Abweichung 4). Ein Klick setzt genau einen Filter.
const FACETTEN_TITEL = { genre: 'Genre', pack: 'Pack', instrument: 'Instrument', quelle: 'Source', rolle: 'Role' };
const FACETTEN_WERT = { quelle: { eigen: 'mine', track: 'track', dirigent: 'archive' }, rolle: { drums: 'DRUMS', bass: 'BASS', melodie: 'MELODY' } };
export const TYP_ART = { track: 'tracks', loop: 'loops', oneshot: 'samples', strudel: 'patterns' };
function waehleFilter(f) {
  Object.assign(stz, { ordner: null, feld: null, wert: null, seite: 0, liste: null, listeArt: null }, f);
  markiereTyp(); stoebernLaden(); ladeBaum();
}
// Der Typ-Knopf des gezeigten Typs ist markiert; in der Listenansicht keiner
export function markiereTyp() {
  for (const x of $$('[data-typ]')) x.classList.toggle('an', !stz.liste && x.dataset.typ === stz.typ);
  // Filterleiste je Typ (S3-Concern): nur die Felder des Typs, der Rest wird zurückgesetzt und verschwindet, nie unsichtbar wirksam.
  // In der Listenansicht gelten keine Filter: Leiste weg, Zustand bleibt für die Rückkehr.
  $('#lib-suche').closest('.lib-filter').hidden = !!stz.liste;
  if (stz.liste) return;
  const ok = filterFuer(stz.typ);
  Object.assign(stz, filterBereinigt(stz.typ, stz));
  $('#lib-key').hidden = !ok.includes('camelot'); $('#lib-nachbarn').closest('label').hidden = !ok.includes('camelot');
  $('#lib-bpm').hidden = !ok.includes('bpm'); $('#lib-energie').hidden = !ok.includes('energie');
  $('#lib-suche').value = stz.text ?? '';
  $('#lib-key').value = stz.camelot ?? ''; $('#lib-nachbarn').checked = !!stz.nachbarn; $('#lib-bpm').value = stz.bpm ?? ''; $('#lib-energie').value = stz.energie ?? '';
  $('#lib-mehr').classList.toggle('an', !!(stz.camelot || stz.bpm || stz.energie || stz.nachbarn));   // FILTER mark follows the values after a type change
}
// Knoten: Name (kürzt bei Platzmangel, der volle Name steht im title), Zähler (kürzt nie). opt.vorn: Ellipse vorn, damit das
// unterscheidende Ende eines Ordnerpfads sichtbar bleibt (<bdi> hält die Zeichenfolge dabei in Leserichtung).
function baumKnoten(text, n, an, klick, opt = {}) {
  const d = document.createElement('div'); d.className = 'st-knoten' + (an ? ' an' : ''); d.title = text;
  const nm = document.createElement('span'); nm.className = 'st-name';
  if (opt.vorn) { const b = document.createElement('bdi'); b.textContent = text; nm.append(b); nm.classList.add('vorn'); } else nm.textContent = text;
  d.append(nm, ' ');
  const z = document.createElement('span'); z.className = 'zahl'; z.textContent = n.toLocaleString('en'); d.append(z);
  d.addEventListener('click', klick); return d;
}
export async function ladeBaum() {
  const nr = ++stz.baumLauf;
  const r = await fetch(`/stoebern/baum?typ=${stz.typ}`);
  const j = await r.json();
  if (nr !== stz.baumLauf) return;
  const nav = $('#st-baum'); nav.textContent = '';
  // Der Lists-Ast steht gleich unter „All …“ (nicht am Ende): hinter 40 Genres und den Ordnern wäre er nie zu sehen
  const listenBox = document.createElement('div');
  if (!r.ok) { nav.append(listenBox); return zeichneListen(listenBox, nr); }   // ohne Katalog bleiben die Listen erreichbar
  const alle = baumKnoten(`All ${TYP_ART[stz.typ]}`, 0, !stz.ordner && !stz.feld, () => waehleFilter({}));
  alle.querySelector('.zahl').remove();
  nav.append(alle, listenBox);
  // Ordner stehen vor den Facetten: hinter bis zu 64 Facettenknoten lagen sie 1228 px tief und der gewählte Ordner war nicht zu sehen (S2-Review B3)
  if (j.ordner.length) { const h = document.createElement('h4'); h.textContent = 'Folders'; nav.append(h); }
  // Ein Ordner klappt auf, sobald er oder ein Nachfahre gewählt ist (mit „/" geprüft: /m/A ist kein Vorfahr von /m/AB).
  const zeichne = (liste, tiefe) => {
    for (const k of liste) {
      const d = baumKnoten(k.name, k.n, stz.ordner === k.pfad, () => waehleFilter({ ordner: k.pfad }), { vorn: true });
      d.style.paddingLeft = `${tiefe * 10}px`; d.title = k.pfad; nav.append(d);
      if (k.kinder.length && stz.ordner && (stz.ordner === k.pfad || stz.ordner.startsWith(`${k.pfad}/`))) zeichne(k.kinder, tiefe + 1);
    }
  };
  zeichne(baueBaum(j.ordner), 0);
  for (const [feld, werte] of Object.entries(j.facetten)) {
    const h = document.createElement('h4'); h.textContent = FACETTEN_TITEL[feld] ?? feld; nav.append(h);
    // 40 zeigen, Rest hinter „+N more" (Tracks haben 66 Genres; Review m6). Ein gewählter Wert bleibt immer sichtbar.
    const offen = stz.facetteOffen[feld];
    werte.forEach(({ wert, n }, i) => {
      const an = stz.feld === feld && stz.wert === wert;
      if (i < 40 || offen || an) nav.append(baumKnoten(FACETTEN_WERT[feld]?.[wert] ?? (wert || '(none)'), n, an, () => waehleFilter({ feld, wert })));
    });
    if (!offen && werte.length > 40) {
      const mehr = document.createElement('div'); mehr.className = 'st-knoten st-mehr'; mehr.textContent = `+${werte.length - 40} more`;
      mehr.addEventListener('click', () => { stz.facetteOffen = { ...stz.facetteOffen, [feld]: true }; ladeBaum(); });
      nav.append(mehr);
    }
  }
  await zeichneListen(listenBox, nr);
  if (nr !== stz.baumLauf) return;
  // Der gewählte Knoten bleibt im Bild (erst nach den Listen, die schieben den Rest nach unten; nur der Baum scrollt, nie die Seite)
  const gewaehlt = nav.querySelector('.st-knoten.an');
  if (gewaehlt) { const k = gewaehlt.getBoundingClientRect(), v = nav.getBoundingClientRect(); if (k.top < v.top) nav.scrollTop -= v.top - k.top; else if (k.bottom > v.bottom) nav.scrollTop += k.bottom - v.bottom; }
}

// ---------- Listen (S2b): PLAYLIST · LOOP LIST · STRUDEL LIST ----------
let traktorListen = null;
const neuesFeld = (platz, ok, abbruch) => {
  const i = document.createElement('input'); i.className = 'st-eingabe'; i.placeholder = platz; i.maxLength = 80; i.setAttribute('aria-label', platz);
  i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && i.value.trim()) ok(i.value.trim()); if (e.key === 'Escape') abbruch(); });
  i.addEventListener('click', (e) => e.stopPropagation());
  return i;
};
async function zeichneListen(nav, nr) {
  let alle;
  try { alle = await (await fetch('/sammlungen')).json(); } catch { return; }
  if (nr !== stz.baumLauf || !Array.isArray(alle)) return;
  const h = document.createElement('h4'); h.textContent = 'Lists'; nav.append(h);
  for (const art of Object.keys(LISTEN_TEXT)) {
    const meine = alle.filter((e) => e.art === art);
    const offen = !!stz.listenOffen[art];
    const kopf = baumKnoten(LISTEN_TEXT[art], meine.length, false, () => { stz.listenOffen = { ...stz.listenOffen, [art]: !offen }; ladeBaum(); });
    kopf.dataset.listenart = art; kopf.classList.add('st-listenart'); kopf.setAttribute('aria-expanded', String(offen));
    nav.append(kopf);
    if (!offen) continue;
    for (const e of meine) {
      const k = baumKnoten(e.name, e.posten, stz.liste === e.slug, () => waehleListe(e.slug, art));
      k.dataset.liste = e.slug; k.classList.add('st-listenknoten');
      const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = e.name; k.firstChild.replaceWith(nm);   // lange Namen kürzen, ✎ und ✕ bleiben erreichbar
      k.title = e.name;
      for (const [zeichen, titel, tun] of [['✎', 'Rename', () => benenneListe(e, k)], ['✕', 'Move to the trash', () => loescheListe(e)]]) {
        const b = document.createElement('button'); b.className = 'st-mini'; b.textContent = zeichen; b.title = titel; b.setAttribute('aria-label', `${titel} ${e.name}`);
        b.addEventListener('click', (ev) => { ev.stopPropagation(); tun(); });
        k.append(b);
      }
      nav.append(k);
    }
    const neu = document.createElement('div'); neu.className = 'st-knoten st-mehr'; neu.textContent = '+ new';
    neu.addEventListener('click', () => {
      const f = neuesFeld(`New ${LISTEN_TEXT[art].toLowerCase().replace(/s$/, '')}…`, async (name) => {
        const rr = await postJson('/sammlungen', { name, art });
        if (!rr.ok) return melde(`New list: ${rr.j.fehler}`, true);
        melde(`“${name}” created`); ladeBaum();
      }, () => ladeBaum());
      neu.replaceWith(f); f.focus();
    });
    nav.append(neu);
    if (art === 'playlist') {
      const sel = document.createElement('select'); sel.className = 'st-import'; sel.setAttribute('aria-label', 'Import a Traktor playlist');
      sel.append(new Option('Import Traktor…', ''));
      try { traktorListen ??= await (await fetch('/mediathek/listen')).json(); } catch { traktorListen = []; }
      if (nr !== stz.baumLauf) return;
      for (const l of Array.isArray(traktorListen) ? traktorListen : []) sel.append(new Option(`${l.name} (${l.n})`, String(l.id)));
      sel.addEventListener('change', async () => {
        if (!sel.value) return;
        const rr = await postJson('/sammlungen/import', { liste_id: Number(sel.value), art: 'playlist' });
        if (!rr.ok) return melde(`Import: ${rr.j.fehler}`, true);
        melde(`Imported ${rr.j.posten} tracks as a playlist`); ladeBaum();
      });
      nav.append(sel);
    }
  }
}
function waehleListe(slug, art) {
  Object.assign(stz, { liste: slug, listeArt: art, ordner: null, feld: null, wert: null, seite: 0 });
  markiereTyp(); stoebernLaden(); ladeBaum();
}
function benenneListe(e, knoten) {
  const f = neuesFeld('Name', async (name) => {
    const rr = await postJson(`/sammlungen/${encodeURIComponent(e.slug)}/umbenennen`, { name });
    if (!rr.ok) return melde(`Rename: ${rr.j.fehler}`, true);
    ladeBaum(); if (stz.liste === e.slug) stoebernLaden();
  }, () => ladeBaum());
  f.value = e.name; knoten.textContent = ''; knoten.append(f); f.focus(); f.select();
}
async function loescheListe(e) {
  if (!confirm(`Move list “${e.name}” to the trash?`)) return;
  const rr = await postJson(`/sammlungen/${encodeURIComponent(e.slug)}/loeschen`, {});
  if (!rr.ok) return melde(`Delete list: ${rr.j.fehler}`, true);
  if (stz.liste === e.slug) { Object.assign(stz, { liste: null, listeArt: null }); markiereTyp(); stoebernLaden(); }
  ladeBaum(); melde(`“${e.name}” moved to the trash`);
}
// Zeile → Körper für POST …/posten (Muster tragen ref statt material_id)
export const postenKoerper = (t) => (t.typ === 'strudel' ? { art: 'muster', ref: t.id } : { art: t.typ, material_id: t.material_id });
// „+ LIST ▾“: Menü am Knopf mit den Listen der passenden Art und „New list…“. Enter legt die Liste an UND die Zeile hinein.
export function schliesseListenMenue() { const m = $('#listen-menue'); m.hidden = true; m.textContent = ''; }
async function legeInListe(slug, name, t) {
  const rr = await postJson(`/sammlungen/${encodeURIComponent(slug)}/posten`, postenKoerper(t));
  if (!rr.ok) return melde(`Add to list: ${rr.j.fehler}`, true);
  melde(rr.j.schon_drin ? `“${t.titel ?? t.name}” is already in “${name}”` : `“${t.titel ?? t.name}” added to “${name}”`);
  if (stz.liste === slug) stoebernLaden();
  ladeBaum();
}
export async function oeffneListenMenue(t, knopf) {
  schliesseListenMenue();
  const art = listenArtFuer(t.typ);
  const m = $('#listen-menue');
  const r = knopf.getBoundingClientRect();
  m.style.top = `${Math.min(r.bottom + 2, innerHeight - 220)}px`; m.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 240))}px`;
  m.hidden = false;
  const kopf = document.createElement('div'); kopf.className = 'listen-kopf'; kopf.textContent = `Add to ${LISTEN_TEXT[art].toLowerCase().replace(/s$/, '')}`;
  const platz = document.createElement('div'); platz.className = 'listen-eintraege';
  const neu = neuesFeld('New list…', async (name) => {
    const rr = await postJson('/sammlungen', { name, art });
    if (!rr.ok) return melde(`New list: ${rr.j.fehler}`, true);
    schliesseListenMenue();
    await legeInListe(rr.j.slug, name, t);
  }, schliesseListenMenue);
  neu.id = 'listen-neu';
  m.append(kopf, platz, neu);
  try {
    const liste = await (await fetch(`/sammlungen?art=${art}`)).json();
    for (const e of liste) {
      const d = document.createElement('div'); d.className = 'listen-eintrag'; d.dataset.liste = e.slug; d.setAttribute('role', 'menuitem');
      d.textContent = `${e.name} `; const z = document.createElement('span'); z.className = 'zahl'; z.textContent = String(e.posten); d.append(z);
      d.addEventListener('click', () => { schliesseListenMenue(); legeInListe(e.slug, e.name, t); });
      platz.append(d);
    }
    if (!liste.length) platz.textContent = 'No list yet';
  } catch { platz.textContent = 'Lists unavailable'; }
}
// Die gewählte Liste in der Mitte: Zeilen = die Browser-Zeilen (eintrag), dazu ↑ ↓ ✕ und Ziehen. Reihenfolge = die des Arrays.
export async function ladeListe() {
  const nr = ++stz.lauf;
  const r = await fetch(`/sammlungen/${encodeURIComponent(stz.liste)}`);
  const j = await r.json();
  if (nr !== stz.lauf) return;
  if (!r.ok) { melde(`List: ${j.fehler}`, true); Object.assign(stz, { liste: null, listeArt: null }); markiereTyp(); return stoebernLaden(); }
  const art = j.art ?? stz.listeArt ?? 'playlist';
  const spalten = LISTEN_SPALTEN[art] ?? LISTEN_SPALTEN.playlist;
  stz.listeArt = art;
  zeigeKopfzeile(spalten);
  $('.st-seiten').hidden = true;
  const tb = $('#libliste'); tb.textContent = '';
  const ids = j.posten.map((p) => p.id);
  const sicht = [];                                          // die gezeigten Zeilen (Posten ohne Eintrag fehlen): Grundlage für Detail und ↑/↓
  j.posten.forEach((p, idx) => {
    if (!p.eintrag) return;
    const tr = stoebernZeile(p.eintrag, sicht.length, spalten);
    sicht.push(p.eintrag);
    tr.dataset.posten = p.id;
    const td = tr.querySelector('td.aktion');
    for (const [klasse, zeichen, titel, tun, aus] of [
      ['hoch', '↑', 'Move up', () => verschiebePosten(p.id, idx - 1), idx === 0],
      ['runter', '↓', 'Move down', () => verschiebePosten(p.id, idx + 1), idx === ids.length - 1],
      ['raus', '✕', 'Remove from the list', () => entfernePosten(p.id), false]]) {
      const b = document.createElement('button'); b.className = `laden ${klasse}`; b.textContent = zeichen; b.title = titel; b.disabled = aus;
      b.addEventListener('click', tun); td.append(b);
    }
    tr.draggable = true;
    tr.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; tr.classList.add('zieht'); });
    tr.addEventListener('dragend', () => tr.classList.remove('zieht'));
    tr.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    tr.addEventListener('drop', (e) => {
      e.preventDefault();
      const gezogen = e.dataTransfer.getData('text/plain');
      if (!gezogen || gezogen === p.id) return;
      const rect = tr.getBoundingClientRect();
      const nach = ziehZiel(ids, gezogen, p.id, e.clientY > rect.top + rect.height / 2);   // untere Hälfte: hinter diese Zeile; null = bleibt
      if (nach !== null) verschiebePosten(gezogen, nach);
    });
    tb.append(tr);
  });
  $('#st-seite').textContent = '';
  stz.treffer = sicht;
  zustand.libraryInfo = `${j.name} · ${j.posten.length} ${j.posten.length === 1 ? 'item' : 'items'} · ${LISTEN_TEXT[art].replace(/s$/, '').toLowerCase()}`;
  zeigeReiterInfo();
  behalteWahl();
}
async function verschiebePosten(id, nach) {
  const rr = await postJson(`/sammlungen/${encodeURIComponent(stz.liste)}/posten/verschieben`, { id, nach });
  if (!rr.ok) return melde(`Reorder: ${rr.j.fehler}`, true);
  stoebernLaden();
}
async function entfernePosten(id) {
  const rr = await postJson(`/sammlungen/${encodeURIComponent(stz.liste)}/posten/entfernen`, { id });
  if (!rr.ok) return melde(`Remove: ${rr.j.fehler}`, true);
  stoebernLaden(); ladeBaum();
}
