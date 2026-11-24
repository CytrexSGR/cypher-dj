// LIBRARY (browser plan 2, task 8): tracks, loops, one-shots, MIDI files and patterns, the import keys, the folders, the state of the catalogue and the
// first-start card. Rows are built with DOM calls and textContent only (a file name is text). The catalogue state is read once on open and after each batch,
// then once a second only while a job runs (a setTimeout chain that ends at phase `ruht`); there is no other polling.
import { baueAbschnitt } from './abschnitt.js';
import { ZIEH_TYP, nutzlast, clipName } from '../production/drag.js';
import { menuePunkte, postenVonSample } from '../collections.js';
import { oeffneMenue } from '../production/context_menu.js';
import { suche as tagSuche } from './tags_client.js';
import { baueChipWahl } from './suche.js';
import { setzeTagsBatch, zeigeVerwandt } from './verwandt.js';

const PHASE_WORT = { scan: 'Scanning', merkmale: 'Reading audio features', schreiben: 'Writing the catalogue', analyse: 'Analysing loops' };
const zahl = (n) => Number(n).toLocaleString('en-US');
const ok2 = (r) => r.status >= 200 && r.status < 300;
export const NICHT_DA = 'Not available in this build yet';

// the line and the bar of the state; hinweis names the sentence the section adds (only while no build runs: an old error is stale then)
export function standText(s) {
  const lauf = s.phase !== 'ruht';
  const wort = PHASE_WORT[s.phase] ?? s.phase;
  let zeile, balken = null;
  if (lauf) {
    if (typeof s.gesamt === 'number' && s.gesamt > 0) { balken = Math.min(1, Math.max(0, s.fertig / s.gesamt)); zeile = `${wort}, ${zahl(s.fertig)} of ${zahl(s.gesamt)}`; }
    else zeile = `${wort}, ${zahl(s.fertig ?? 0)} files so far`;
  } else if (s.letzter_bau) zeile = `${zahl(s.letzter_bau.dateien)} files, last build ${String(s.letzter_bau.zeit).slice(0, 16).replace('T', ' ')}`;
  else zeile = s.leer ? 'No files in the library yet' : 'No build yet';
  let hinweis = null;
  if (!lauf) {
    const rc = s.letzter_bau?.rc;
    if (s.fremd || rc === 3) hinweis = 'fremd';
    else if (rc === 4) hinweis = 'ordner_fehlt';
    else if (rc === 5) hinweis = 'nicht_schreibbar';
    else if (rc === 6) hinweis = 'luecken';
  }
  return { zeile, balken, hinweis };
}
const HINWEIS_TEXT = {
  fremd: () => "This library is managed by another tool. Files you import are listed in the shelf's FOLDERS mode in STUDIO.",
  ordner_fehlt: (s) => `A library folder is missing: ${s.letzter_bau?.grund ?? 'see the folder list'}.`,
  nicht_schreibbar: (s) => `The library cannot be written: ${s.letzter_bau?.grund ?? 'the target is not writable'}.`,
  luecken: () => 'The last scan found no files or left gaps: check that the library drives are connected, then RESCAN.',
};
export const hinweisText = (art, s) => (art ? HINWEIS_TEXT[art](s) : '');

export const ersterStart = ({ stand, quellen }) => !!stand && !!quellen && stand.leer === true && Array.isArray(quellen.quellen) && quellen.quellen.length === 0;

const kb = (b) => `${Math.max(1, Math.round(b / 1024))} KB`;
export function midiZeilen(a) {
  return (a?.dateien ?? []).map((d) => ({ name: d.name, zusatz: kb(d.groesse), pfad: d.pfad }));
}
export const midiUrl = (text) => `/bibliothek/midi?text=${encodeURIComponent(String(text ?? '').trim())}`;

const GRUND_KEIN = { oneshot: 'The file is not on disk (is the drive connected?)' };
export function bibliotheksZeilen(treffer, typ) {
  return (Array.isArray(treffer) ? treffer : []).map((t) => {
    const n = typ === 'strudel' ? null : nutzlast(t);
    const name = typ === 'track' ? (t.mix && t.titel ? `${t.titel} (${t.mix})` : t.titel ?? t.name ?? '–') : typ === 'strudel' ? (t.name ?? '–') : (clipName(t) ?? t.name ?? '–');
    const teile = [];
    if (typ === 'strudel') { if (t.rolle) teile.push(t.rolle); if (t.bpm) teile.push(`${t.bpm} BPM`); }
    else {
      if (t.instrument) teile.push(t.instrument);
      if (t.bpm) teile.push(`${t.bpm} BPM`);
      if (t.camelot) teile.push(t.camelot);
    }
    const grund = n ? '' : typ === 'strudel' ? 'Patterns are played from the library, not dragged here' : t.nur_live ? 'Ableton Live only (encrypted)' : t.pfad_da === false ? (GRUND_KEIN[typ] ?? 'The file is not on disk (is the drive connected?)') : 'This entry cannot be placed';
    return { name, zusatz: teile.join(' · '), nutzlast: n, ...(typeof t.sha === 'string' ? { sha: t.sha } : {}), pruefen: typ === 'track' && t.status === 'prepare', grund, roh: t };
  });
}

// ---- actions: {status: 'ok'|'nicht_da'|'fehler'|'abgebrochen', text?} ----
const FEHLER = (r) => r.j?.text || `The request failed (${r.status || 'no connection'})`;
export async function fuegeOrdnerHinzu(host, dienste) {
  const pfad = await dienste.waehleOrdner?.();
  if (!pfad) return { status: 'abgebrochen' };
  const r = await host.holeJson('/bibliothek/quellen/dazu', { pfad, typ: 'auto' });
  if (r.status === 404) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  host.melde('Folder added: the library builds now', false);
  return { status: 'ok', pfad };
}
export async function baueNeu(host) {
  const r = await host.holeJson('/bibliothek/bauen', {});
  if (r.status === 404) return { status: 'nicht_da' };
  if (!ok2(r) || r.j?.ok === false) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  return { status: 'ok' };
}
export async function midiHinzufuegen(host, pfad) {
  const r = await host.holeJson('/proj/midi_import', { pfad });
  if (r.status === 404) return { status: 'nicht_da' };
  if (!ok2(r)) { const text = FEHLER(r); host.melde(text, true); return { status: 'fehler', text }; }
  if (r.j?.text) host.melde(r.j.text, false);
  return { status: 'ok' };
}

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const taste = (text, titel, fn) => {
  const b = el('button', 'b-taste', text);
  b.type = 'button'; b.title = titel;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
  return b;
};

// one row of the list: name, class or key and tempo, PREVIEW; draggable when the row can be placed
export function bauZeile(z, host, opt = {}) {
  const r = el('div', `b-zeile b-bib${z.nutzlast ? ' klickbar' : ' aus'}`);
  r.append(el('span', 'b-text', z.name));
  r.children?.[0] && (r.children[0].title = z.name);
  if (z.zusatz) r.append(el('span', 'b-zusatz', z.zusatz));
  if (z.pruefen) r.append(el('span', 'b-zusatz b-pruefen', 'PREPARE'));
  if (z.roh?.typ !== 'strudel') { const v = taste('▶', 'Preview on the cue output', () => host.vorhoeren?.(z.roh)); v.className = 'b-taste b-vorschau'; r.append(v); }
  if (opt.verwandt && z.sha) r.append(taste('RELATED', 'Where this file comes from, where it is used, what fits it', (b) => opt.verwandt(`datei:${z.sha}`, b)));
  if (opt.waehle && z.sha) r.addEventListener('click', (e) => { if (e.ctrlKey || e.shiftKey || e.metaKey) { e.preventDefault(); opt.waehle(r, z, e.shiftKey); } });
  if (z.nutzlast) {
    r.draggable = true;
    r.title = 'Drag onto an audio track';
    r.addEventListener('dragstart', (e) => { e.dataTransfer.setData(ZIEH_TYP, JSON.stringify(z.nutzlast)); e.dataTransfer.effectAllowed = 'copy'; });
  } else if (z.grund) r.title = z.grund;
  if (opt.rechts && postenVonSample(z.roh)) r.addEventListener('contextmenu', (e) => { e.preventDefault(); opt.rechts(z.roh, e.clientX, e.clientY); });
  return r;
}

const TABS = [['track', 'TRACKS'], ['loop', 'LOOPS'], ['oneshot', 'ONE-SHOTS'], ['midi', 'MIDI'], ['strudel', 'PATTERNS']];
const KATALOG_TEXT = 'No library catalog found. To build one from your own folders: djk/start/djk-bibliothek dazu <folder>, then bauen';
let uebersprungen = false;   // SKIP of the first-start card: until the next reload only

export function baueBibliothekAbschnitt(host, dienste = {}) {
  const a = baueAbschnitt({ id: 'bibliothek', titel: 'LIBRARY', offen: true });
  const z = { tab: 'oneshot', text: '', tags: [], seite: 0, stand: null, quellen: null, gesamt: 0 };
  let timer = null, nr = 0;
  const lesen = async (url) => { const r = await host.holeGet(url); return r.status === 404 ? null : r; };
  const hatRoute = () => z.stand !== null && z.quellen !== null;

  const kopf = el('div', 'b-bib-kopf'), zustand = el('div', 'b-bib-stand'), hinweis = el('div', 'b-bib-hinweis'), balken = el('div', 'b-bib-balken'), fuell = el('div', 'b-bib-fuell');
  balken.append(fuell);
  const tabs = el('div', 'b-bib-tabs'), liste = el('div', 'b-bib-liste'), wahlLeiste = el('div', 'b-bib-wahl');   // the one search field of the browser drives filtere
  wahlLeiste.hidden = true;
  const gewaehlt = new Map();   // sha -> row element (Ctrl or Shift click)
  let letzteWahl = null;

  function zeigeStand() {
    const s = z.stand;
    zustand.hidden = balken.hidden = hinweis.hidden = !s;
    if (!s) return;
    const t = standText(s);
    zustand.textContent = t.zeile;
    balken.hidden = t.balken === null && s.phase === 'ruht';
    fuell.style.width = t.balken === null ? '100%' : `${Math.round(t.balken * 100)}%`;
    balken.classList.toggle('unbestimmt', t.balken === null);
    hinweis.textContent = hinweisText(t.hinweis, s);
    hinweis.hidden = !t.hinweis;
    rescan.disabled = s.phase !== 'ruht' || t.hinweis === 'fremd';
  }
  const rescan = taste('RESCAN', 'Scan the library folders again', (b) => aus(b, async () => { const x = await baueNeu(host); if (x.status === 'ok') planeStand(true, true); return x; }));
  const importKnopf = taste('IMPORT', 'Add audio and MIDI files from this computer', () => dienste.waehleDateien?.('bibliothek'));
  const ordnerKnopf = taste('ADD FOLDER', 'Use a folder of your music as a library source (the files stay where they are)', (b) => aus(b, async () => { const x = await fuegeOrdnerHinzu(host, dienste); if (x.status === 'ok') { await ladeKopf(); planeStand(true, true); } return x; }));
  async function aus(b, fn) {
    b.disabled = true;
    let x = null;
    try { x = await fn(); } finally { if (x?.status === 'nicht_da') { b.title = NICHT_DA; } else b.disabled = false; }
    return x;
  }
  kopf.append(importKnopf, ordnerKnopf, rescan);

  // the state chain: once a second while a job runs, never otherwise; it ends when the section is gone or the route is
  // `frisch`: a build was just asked for. The page answers before the job leaves `ruht`, so the first reads can still say `ruht` with the old
  // (or no) last build; keep reading for a few seconds until the build shows up, else the line stays at "No build yet" for good
  function planeStand(sofort = false, frisch = false) {
    clearTimeout(timer);
    const vorher = z.stand?.letzter_bau?.zeit ?? null;
    let gnade = frisch ? 5 : 0;
    const lauf = async () => {
      if (!a.wurzel.isConnected && !dienste.ohneDom) return;   // tests build the section without a document: they pass dienste.ohneDom
      const r = await lesen('/bibliothek/stand');
      if (!r || !ok2(r)) return;
      const war = z.stand?.phase ?? 'ruht';
      z.stand = r.j; zeigeStand();
      const zeit = r.j.letzter_bau?.zeit ?? null;
      if (r.j.phase !== 'ruht') { gnade = 0; timer = setTimeout(lauf, 1000); }
      else if (gnade > 0 && zeit === vorher) { gnade--; timer = setTimeout(lauf, 1000); }
      else if (war !== 'ruht' || zeit !== vorher) await ladeListe();
    };
    if (sofort) lauf(); else if (z.stand && z.stand.phase !== 'ruht') timer = setTimeout(lauf, 1000);
  }

  function zeichneTabs() {
    tabs.textContent = '';
    for (const [typ, titel] of TABS) {
      const b = taste(titel, titel, () => { z.tab = typ; z.seite = 0; zeichneTabs(); ladeListe(); });
      b.setAttribute('aria-pressed', String(z.tab === typ));
      if (z.tab === typ) b.classList.toggle('an', true);
      tabs.append(b);
    }
  }
  const menue = async (roh, x, y) => {
    const r = await host.holeGet('/kollektionen');
    if (r.status !== 200 || !Array.isArray(r.j)) { host.melde(r.j?.text ?? 'Collections are not available', true); return; }
    const posten = postenVonSample(roh);
    const punkte = menuePunkte(r.j, {
      hinzu: async (slug) => { const x2 = await host.holeJson(`/kollektionen/${encodeURIComponent(slug)}/posten`, { hinzu: [posten] }); host.melde(x2.status === 200 ? 'Added to the collection' : (x2.j?.text ?? 'Not added'), x2.status !== 200); },
      neu: async () => {
        const name = globalThis.prompt?.('Name of the new collection', '');
        if (!name?.trim()) return;
        const c = await host.holeJson('/kollektionen', { name });
        if (c.status !== 201) { host.melde(c.j?.text ?? 'Not created', true); return; }
        await host.holeJson(`/kollektionen/${encodeURIComponent(c.j.slug)}/posten`, { hinzu: [posten] });
        host.melde('Added to the new collection', false);
      } });
    oeffneMenue(punkte, x, y);
  };

  function seitenZeile() {
    const bar = el('div', 'b-zeile b-seiten');
    if (z.seite > 0) bar.append(taste('‹ PREVIOUS', 'Previous 200 rows', () => { z.seite--; ladeListe(); }));
    if ((z.seite + 1) * 200 < z.gesamt) bar.append(taste('SHOW MORE', `Show the next 200 of ${zahl(z.gesamt)}`, () => { z.seite++; ladeListe(); }));
    if (bar.kinder?.length ?? bar.children?.length) liste.append(bar);
  }

  async function ladeListe() {
    const mein = ++nr;
    liste.textContent = '';
    if (z.tab === 'midi') {
      const r = await lesen(midiUrl(z.text));
      if (mein !== nr) return;
      if (!r) { liste.append(el('div', 'b-zeile b-leer', 'MIDI listing is not available in this build yet')); return; }
      if (!ok2(r)) { liste.append(el('div', 'b-zeile b-leer', r.j?.text ?? 'The MIDI listing failed')); return; }
      const zeilen = midiZeilen(r.j);
      if (zeilen.length === 0) { liste.append(el('div', 'b-zeile b-leer', 'No MIDI files in your library folders yet')); return; }
      for (const m of zeilen.slice(0, 200)) {
        const row = el('div', 'b-zeile b-bib');
        const t = el('span', 'b-text', m.name); t.title = m.pfad;
        row.append(t, el('span', 'b-zusatz', m.zusatz), taste('ADD TO PROJECT', 'Add this MIDI file to the open project as a clip', (b) => aus(b, () => midiHinzufuegen(host, m.pfad))));
        liste.append(row);
      }
      return;
    }
    if (z.tags.length > 0 && dienste.vokabular) return ladeTagListe(mein);
    const p = new URLSearchParams({ typ: z.tab, limit: '200' });
    if (z.text.trim()) p.set('text', z.text.trim());
    if (z.seite) p.set('seite', String(z.seite));
    const r = await host.holeGet(`/stoebern?${p}`);
    if (mein !== nr) return;
    if (!ok2(r)) {
      const g = r.j?.grund ?? r.j?.fehler;
      liste.append(el('div', 'b-zeile b-leer', g === 'katalog_fehlt' ? (hatRoute() ? 'The library has no catalogue yet: add a folder' : KATALOG_TEXT) : (r.j?.text ?? `The library list failed (${r.status || 'no connection'})`)));
      return;
    }
    z.gesamt = r.j.gesamt ?? 0;
    const zeilen = bibliotheksZeilen(r.j.treffer, z.tab);
    if (zeilen.length === 0) { liste.append(el('div', 'b-zeile b-leer', z.text.trim() ? 'No match' : 'Nothing in this list yet')); return; }
    for (const row of zeilen.slice(0, 200)) { const x = bauZeile(row, host, zeilenOpt()); if (row.sha) x.dataset.sha = row.sha; liste.append(x); }
    seitenZeile();
  }

  // ---- tags: rows of /tags/suche (files only); a row becomes draggable when its detail has answered, 50 at once, the rest on first hover ----
  const zeilenOpt = () => ({ rechts: menue, ...(dienste.vokabular ? { verwandt: (item, b) => zeigeVerwandt({ item, anker: b, zeige: dienste.zeigeItem ?? (() => {}), host }), waehle } : {}) });
  async function ladeTagListe(mein) {
    tabs.hidden = true;
    let r;
    try { r = await tagSuche({ tags: z.tags, text: z.text.trim() }); } catch (e) { if (mein === nr) liste.append(el('div', 'b-zeile b-leer', e.text ?? 'The tag search failed')); return; }
    if (mein !== nr) return;
    const treffer = (r.treffer ?? []).filter((t) => String(t.item).startsWith('datei:'));
    z.gesamt = treffer.length;
    if (treffer.length === 0) { liste.append(el('div', 'b-zeile b-leer', 'No file has all of these tags')); return; }
    liste.append(el('div', 'b-zeile b-leer', `${zahl(treffer.length)} files with ${z.tags.join(', ')}`));
    const platz = [];
    for (const t of treffer.slice(0, 200)) {
      const sha = String(t.item).slice(6);
      const row = bauZeile({ name: t.name, zusatz: (t.tags ?? []).filter((x) => !z.tags.includes(x)).slice(0, 3).join(' · '), nutzlast: null, sha, grund: 'Loading the details of this file', roh: { name: t.name, sha } }, host, zeilenOpt());
      row.dataset.sha = sha;
      liste.append(row);
      platz.push({ sha, row, geholt: false });
    }
    const hole = async (x) => {
      if (x.geholt) return;
      x.geholt = true;
      const d = await host.holeGet(`/stoebern/detail?sha=${encodeURIComponent(x.sha)}`);
      if (mein !== nr || !ok2(d) || !d.j?.eintrag) { x.row.title = d.j?.text ?? 'This file is not in the catalogue'; return; }
      const [zeile] = bibliotheksZeilen([d.j.eintrag], d.j.eintrag.typ);
      if (zeile) { const neu = bauZeile({ ...zeile, sha: x.sha }, host, zeilenOpt()); neu.dataset.sha = x.sha; if (x.row.isConnected) x.row.replaceWith(neu); x.row = neu; }
    };
    for (const x of platz.slice(50)) x.row.addEventListener('mouseenter', () => hole(x), { once: true });
    const fruehe = platz.slice(0, 50);
    let i = 0;
    const lauf = async () => { while (i < fruehe.length) { const x = fruehe[i++]; await hole(x); } };
    await Promise.all([lauf(), lauf(), lauf(), lauf()]);
  }

  // ---- many at once: Ctrl or Shift click selects, TAG opens the chip picker, one request carries every selected file ----
  function waehle(row, zeile, bereich) {
    const rows = [...liste.querySelectorAll('.b-bib[data-sha]')];
    if (bereich && letzteWahl && row !== letzteWahl) {
      const von = rows.indexOf(letzteWahl), bis = rows.indexOf(row);
      if (von >= 0 && bis >= 0) for (const r2 of rows.slice(Math.min(von, bis), Math.max(von, bis) + 1)) if (r2.dataset?.sha) { gewaehlt.set(r2.dataset.sha, r2); r2.classList.add('gewaehlt'); }
    } else {
      const sha = row.dataset?.sha ?? zeile.sha;
      if (gewaehlt.has(sha)) { gewaehlt.delete(sha); row.classList.remove('gewaehlt'); } else { gewaehlt.set(sha, row); row.classList.add('gewaehlt'); }
      letzteWahl = row;
    }
    zeichneWahl();
  }
  function zeichneWahl() {
    wahlLeiste.textContent = '';
    wahlLeiste.hidden = gewaehlt.size === 0;
    if (gewaehlt.size === 0) return;
    wahlLeiste.append(el('span', 'b-text', `${gewaehlt.size} selected`));
    let an = true;
    const art = taste('ADD', 'Add the picked tag to every selected file (click to switch to REMOVE)', (b) => { an = !an; b.textContent = an ? 'ADD' : 'REMOVE'; });
    const tagKnopf = taste('TAG', 'Tag every selected file at once', () => {
      if (wahlLeiste.querySelector('.b-chips')) { wahlLeiste.querySelector('.b-chips').remove(); return; }
      const wahl = baueChipWahl({ vokabular: dienste.vokabular, beiWahl: async (tag) => {
        const items = [...gewaehlt.keys()].map((sh) => `datei:${sh}`);
        const x = await setzeTagsBatch(host, items, [tag], an);
        host.melde(x.ok ? `${an ? 'Tagged' : 'Untagged'} ${zahl(x.geaendert ?? items.length)} files with ${tag}` : x.text, !x.ok);
      } });
      wahlLeiste.append(wahl.wurzel);
    });
    const weg = taste('CLEAR', 'Deselect all', () => { for (const r2 of gewaehlt.values()) r2.classList.remove('gewaehlt'); gewaehlt.clear(); zeichneWahl(); });
    wahlLeiste.append(art, tagKnopf, weg);
  }

  function filtere(text, tags) {
    z.text = String(text ?? ''); z.tags = Array.isArray(tags) ? tags : []; z.seite = 0;
    gewaehlt.clear(); zeichneWahl();
    tabs.hidden = z.tags.length > 0 && !!dienste.vokabular;
    if (!ersterStartAn) ladeListe();
  }

  let ersterStartAn = false;
  function karte() {
    const k = el('div', 'b-karte');
    k.append(el('div', 'b-karte-titel', 'Where is your music?'),
      el('div', 'b-karte-text', 'Add the folder your samples and tracks live in. The files stay where they are.'),
      taste('ADD FOLDER', 'Choose a folder of your music', (b) => aus(b, async () => { const x = await fuegeOrdnerHinzu(host, dienste); if (x.status === 'ok') { await ladeKopf(); planeStand(true, true); await laden(); } return x; })),
      el('div', 'b-karte-zone', 'or drop audio files on this panel'),
      taste('SKIP', 'Use the demo material for now', () => { uebersprungen = true; laden(); }));
    return k;
  }

  async function ladeKopf() {
    const [s, q] = await Promise.all([lesen('/bibliothek/stand'), lesen('/bibliothek/quellen')]);
    z.stand = s && ok2(s) ? s.j : null;
    z.quellen = q && ok2(q) ? q.j : null;
  }

  async function laden() {
    a.setze('laedt');
    await ladeKopf();
    a.setze('inhalt');
    a.rumpf.textContent = '';
    ersterStartAn = !uebersprungen && ersterStart({ stand: z.stand, quellen: z.quellen });
    if (ersterStartAn) { a.rumpf.append(karte()); return; }
    if (hatRoute()) { a.rumpf.append(kopf, zustand, balken, hinweis); zeigeStand(); }
    zeichneTabs();
    a.rumpf.append(tabs, wahlLeiste, liste);
    await ladeListe();
    if (z.stand && z.stand.phase !== 'ruht') planeStand();
  }
  return { wurzel: a.wurzel, laden, filtere };
}
