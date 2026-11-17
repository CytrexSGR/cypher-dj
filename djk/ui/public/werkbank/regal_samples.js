// Workbench shelf tab SAMPLES (sample player stage 1): the sample folders of the person, a folder browser with search, a click previews a file,
// TO TRACK puts it on a new instrument track. regal.js builds the tab button and calls bindeSamples; this file owns the body of the tab.
// Routes (page server): GET /sampler/dateien, GET /sampler/datei/hoer, POST /sampler/datei/spur. All class names carry the prefix w-smp-
// (regal.css and dock.css both style .w-karte*, a collision there caused a bug before).
import { bindeQuellenDialog, QUELLEN_TEXT } from './sources_dialog.js';

export const SAMPLES_TEXT = {
  hint: 'click plays a file · arrow keys move and play · Enter or TO TRACK puts it on a new track',
  keineWurzeln: 'No sample folders yet. Add one with SOURCES.',
  fehlt: 'This folder is not on disk',
  liest: 'Reading…',
  mehr: 'More files than shown: narrow the search',
  leerOrdner: 'No audio files or folders here',
  leerSuche: 'Nothing found',
  keinModul: 'Open a module first.',
  spurTitel: 'Put this file on a new instrument track that plays it across the keys',
  instrumentTitel: 'Build an instrument from the samples of this folder and put it on a new track',
  baut: 'An instrument is being built',
  vorhoerFehler: 'This file cannot be previewed',
  keinAudio: 'Preview is not available in this browser',
};
const SPEICHER = 'djk-wb-regal-samples';
const SUCH_MS = 300;
const LAUF_MS = 500;

// --- pure helpers (exported for the tests) ---

// 'Kicks/Acoustic/Tight' → [{name:'Kicks', rel:'Kicks'}, {name:'Acoustic', rel:'Kicks/Acoustic'}, ...]; the root itself is not part of it
export function krumen(rel) {
  const teile = String(rel ?? '').split('/').filter((t) => t !== '' && t !== '.');
  return teile.map((name, i) => ({ name, rel: teile.slice(0, i + 1).join('/') }));
}

// 512 → '512 B', 2048 → '2.0 KB', 3 MB → '3.0 MB'; one decimal below 10, none above
export function groesseText(bytes) {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let wert = bytes, i = 0;
  const einheiten = ['B', 'KB', 'MB', 'GB'];
  while (wert >= 1024 && i < einheiten.length - 1) { wert /= 1024; i++; }
  return `${wert < 10 ? wert.toFixed(1) : Math.round(wert)} ${einheiten[i]}`;
}

// The rows of a listing or search answer: the folders first, then the files. `suche`: the answer is a search, so a file row shows the
// folder it lives in (`ort`). `mehr`: the server cut the answer off.
export function zeilenModell(antwort, { suche = false } = {}) {
  const a = antwort ?? {};
  const ordner = typeof a.ordner === 'string' ? a.ordner : '';
  const zeilen = [
    ...(Array.isArray(a.ordner_liste) ? a.ordner_liste : []).filter((n) => typeof n === 'string')
      .map((name) => ({ art: 'ordner', name, rel: [ordner, name].filter(Boolean).join('/'), ...(typeof a.ordner_zahl?.[name] === 'number' ? { zahl: a.ordner_zahl[name] } : {}) })),
    ...(Array.isArray(a.dateien) ? a.dateien : []).filter((d) => typeof d?.rel === 'string').map((d) => ({
      art: 'datei', name: typeof d.name === 'string' ? d.name : d.rel.split('/').at(-1), rel: d.rel, bytes: d.bytes, groesse: groesseText(d.bytes),
      ...(suche ? { ort: d.rel.split('/').slice(0, -1).join('/') } : {}),
    })),
  ];
  return { zeilen, mehr: a.mehr === true };
}

// Arrow keys: the index of the row the cursor moves to (-1 when there are no rows); the ends do not wrap
export function naechsteZeile(zeilen, index, taste) {
  const n = Array.isArray(zeilen) ? zeilen.length : typeof zeilen === 'number' ? zeilen : 0;
  if (n <= 0) return -1;
  if (taste === 'ArrowDown') return index < 0 ? 0 : Math.min(n - 1, index + 1);
  if (taste === 'ArrowUp') return index < 0 ? 0 : Math.max(0, index - 1);
  return index;
}

const mehrzahl = (n, eins, viele) => `${n} ${n === 1 ? eins : viele}`;
export { mehrzahl };

// The bar above the list of a folder that reads as an instrument: {zeile, varianten} (varianten is null without other variants).
// `instrument` is the `instrument` field of the listing answer: {noten, lagen, takes, dateien, varianten?, schleifen?, release?}.
export function instrumentBalken(instrument) {
  const i = instrument ?? {};
  const teile = [mehrzahl(i.noten, 'note', 'notes'), mehrzahl(i.lagen, 'layer', 'layers')];
  if (typeof i.takes === 'number' && i.takes > 1) teile.push(`${i.takes} takes`);
  if (typeof i.schleifen === 'number' && i.schleifen > 0) teile.push('looped');
  if (typeof i.release === 'number' && i.release > 0) teile.push(mehrzahl(i.release, 'release sample', 'release samples'));
  const namen = Array.isArray(i.varianten) ? i.varianten.filter((n) => typeof n === 'string' && n !== '') : [];
  return {
    zeile: `This folder is an instrument: ${teile.join(', ')}`,
    varianten: namen.length ? `Uses the largest set; also here: ${namen.join(', ')}` : null,
  };
}

// `lauf` is the answer of GET /sampler/instrument/lauf: {laeuft, name, fertig, von}; null while nothing builds
export const baufortschritt = (lauf) => (lauf?.laeuft === true ? `Building ${lauf.name ?? ''}: ${lauf.fertig ?? 0} of ${lauf.von ?? 0}` : null);

export const vorhoerUrl = (wurzel, rel) => `/sampler/datei/hoer?wurzel=${encodeURIComponent(wurzel)}&rel=${encodeURIComponent(rel)}`;
export const listenUrl = (wurzel, ordner, suche) => {
  const teile = [`wurzel=${encodeURIComponent(wurzel)}`];
  if (ordner) teile.push(`ordner=${encodeURIComponent(ordner)}`);
  if (suche) teile.push(`suche=${encodeURIComponent(suche)}`);
  return `/sampler/dateien?${teile.join('&')}`;
};

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const markiere = (e, name) => { e.setAttribute('data-w', name); return e; };

// --- the binder ---
// opt.host: the element the tab draws into; opt.setzeHinweis(text|null): the hint line of the shelf (null = the usual text);
// opt.refusalText(r): the text of a refused answer. Returns {zeige, verberge}: regal.js calls them when the tab is shown or left.
export function bindeSamples(ctx, { host, setzeHinweis = () => {}, refusalText = (r) => ctx.antwortText(r) }) {
  const { st } = ctx;
  let aktiv = false, wurzeln = null, wurzelFehler = null, nr = 0, macht = false;
  let zeilen = [], mehr = false, cursor = -1, spielt = null;   // spielt: {rel, audio}
  const gemerkt = (() => { try { const j = JSON.parse(ctx.lies(SPEICHER, 'null')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } })();
  let wurzel = typeof gemerkt.wurzel === 'string' ? gemerkt.wurzel : null;
  let ordner = typeof gemerkt.ordner === 'string' ? gemerkt.ordner : '';
  let suche = '', suchUhr = null;

  const wurzelEl = el('div', 'w-smp');
  const kopf = el('div', 'w-smp-kopf');
  const chips = el('div', 'w-smp-chips');
  const pfad = el('div', 'w-smp-pfad');
  const feld = markiere(el('input', 'w-smp-suche'), 'samples-suche');
  feld.setAttribute('placeholder', '🔍 Search in this folder: kick 909, bass, …'); feld.setAttribute('aria-label', 'Search samples'); feld.setAttribute('maxlength', '80');
  const ordnerKnopf = markiere(el('button', 'w-smp-knopf w-smp-ordner', QUELLEN_TEXT.knopf), 'samples-quellen');   // A4: the source folder dialog
  ordnerKnopf.type = 'button'; ordnerKnopf.setAttribute('title', QUELLEN_TEXT.knopfTitel);
  kopf.append(chips, pfad, feld, ordnerKnopf);
  const liste = el('div', 'w-smp-liste');
  liste.setAttribute('tabindex', '0'); liste.setAttribute('role', 'listbox'); liste.setAttribute('aria-label', 'Sample files');
  const balken = markiere(el('div', 'w-smp-instrument'), 'samples-instrument');
  const balkenText = el('span', 'w-smp-instrument-text');
  const balkenVarianten = el('span', 'w-smp-instrument-varianten');
  const balkenLauf = el('span', 'w-smp-instrument-lauf');
  const balkenKnopf = el('button', 'w-smp-knopf', 'INSTRUMENT TO TRACK'); balkenKnopf.type = 'button'; markiere(balkenKnopf, 'samples-instrument-spur');
  balken.append(el('div', 'w-smp-instrument-kopf'), balkenVarianten, balkenLauf);
  balken.firstChild.append(balkenText, balkenKnopf);
  balken.hidden = true;
  wurzelEl.append(kopf, balken, liste);
  const quellenDialog = bindeQuellenDialog(ctx, { mount: wurzelEl, beiAenderung: () => { if (aktiv) ladeAlles(); } });
  ordnerKnopf.addEventListener('click', () => quellenDialog.oeffne());

  const speichere = () => ctx.merke(SPEICHER, JSON.stringify({ wurzel, ordner }));
  const nachricht = (text) => el('div', 'w-smp-leer', text);

  // ---- preview ----
  function stoppe() {
    const s = spielt;
    spielt = null;
    if (s) { try { s.audio.pause?.(); } catch { /* already gone */ } }
    markiereSpielt();
  }
  function markiereSpielt() {
    for (const z of liste.querySelectorAll('.w-smp-datei')) {
      const an = spielt !== null && z.getAttribute('data-rel') === spielt.rel;
      z.classList.toggle('spielt', an);
      const m = z.querySelector('.w-smp-marke');
      if (m) m.textContent = an ? '■' : '▶';
    }
  }
  function spiele(z) {
    if (spielt?.rel === z.rel) { stoppe(); setzeHinweis(null); return; }   // a second click stops it
    stoppe(); setzeHinweis(null);
    const Audio_ = ctx.Audio ?? globalThis.Audio;
    if (typeof Audio_ !== 'function') { setzeHinweis(SAMPLES_TEXT.keinAudio); return; }
    let audio;
    try { audio = new Audio_(vorhoerUrl(wurzel, z.rel)); } catch { setzeHinweis(SAMPLES_TEXT.vorhoerFehler); return; }
    const s = { rel: z.rel, audio };
    spielt = s;
    const fehler = () => { if (spielt === s) { spielt = null; markiereSpielt(); } setzeHinweis(SAMPLES_TEXT.vorhoerFehler); };
    audio.addEventListener?.('error', fehler);
    audio.addEventListener?.('ended', () => { if (spielt === s) { spielt = null; markiereSpielt(); } });
    try { const p = audio.play?.(); if (p && typeof p.catch === 'function') p.catch((e) => { if (e?.name !== 'AbortError') fehler(); }); } catch { fehler(); }
    markiereSpielt();
  }

  // ---- TO TRACK ----
  const zeigeKnoepfe = () => {
    for (const b of liste.querySelectorAll('[data-w="samples-spur"]')) {
      b.disabled = !st.projekt || macht;
      b.setAttribute('title', st.projekt ? SAMPLES_TEXT.spurTitel : SAMPLES_TEXT.keinModul);
    }
  };
  async function zuSpur(z) {
    if (macht) return;
    if (!st.projekt) { ctx.melde(SAMPLES_TEXT.keinModul, true); return; }
    const slug = st.slug;
    macht = true; zeigeKnoepfe();
    try {
      const r = await ctx.holeJson('/sampler/datei/spur', { wurzel, rel: z.rel });
      if (r.status !== 200 || !r.j?.projekt) { ctx.melde(refusalText(r), true); return; }
      if (st.slug !== slug) { ctx.melde('The track was added to the module you just left.'); return; }
      ctx.uebernimm(slug, r.j.projekt);
      if (typeof r.j.spur_id === 'string') ctx.waehle(r.j.spur_id);
      if (typeof r.j.text === 'string' && r.j.text !== '') ctx.melde(r.j.text);
    } finally { macht = false; zeigeKnoepfe(); }
  }

  // ---- INSTRUMENT TO TRACK: the folder builds one instrument; the progress comes from GET /sampler/instrument/lauf ----
  let instrument = null, baut = false, lauf = null, pollUhr = null, pollNr = 0;
  const laeuft = () => baut || lauf?.laeuft === true;
  function zeichneBalken() {
    const fortschritt = baufortschritt(lauf);
    balken.hidden = !(instrument || fortschritt);
    if (instrument) {
      const b = instrumentBalken(instrument);
      balkenText.textContent = b.zeile;
      balkenVarianten.textContent = b.varianten ?? ''; balkenVarianten.hidden = b.varianten === null;
    } else { balkenText.textContent = ''; balkenVarianten.textContent = ''; balkenVarianten.hidden = true; }
    balkenLauf.textContent = fortschritt ?? ''; balkenLauf.hidden = fortschritt === null;
    balkenKnopf.hidden = !instrument;
    balkenKnopf.disabled = !st.projekt || laeuft();
    balkenKnopf.setAttribute('title', !st.projekt ? SAMPLES_TEXT.keinModul : laeuft() ? SAMPLES_TEXT.baut : SAMPLES_TEXT.instrumentTitel);
  }
  function stoppePoll() { pollNr++; clearTimeout(pollUhr); pollUhr = null; }
  // asks for the progress now and then every ctx.laufMs (500 ms) while `weiter()` holds; a newer poll or stoppePoll() drops an old answer
  function starteDenPoll(weiter, beiEnde) {
    stoppePoll();
    const mein = pollNr;
    const tick = async () => {
      const r = await ctx.holeGet('/sampler/instrument/lauf');
      if (mein !== pollNr) return;
      lauf = r.status === 200 && r.j && typeof r.j === 'object' ? r.j : null;
      zeichneBalken();
      if (weiter()) { pollUhr = setTimeout(tick, ctx.laufMs ?? LAUF_MS); pollUhr?.unref?.(); }
      else { pollUhr = null; beiEnde?.(); }
    };
    tick();
  }
  // a build that started before a reload: show it and keep the button disabled until it ends
  const beobachteFremdenLauf = () => starteDenPoll(() => aktiv && lauf?.laeuft === true, () => { lauf = null; zeichneBalken(); ctx.beiInstrumentGebaut?.(); });
  async function baueInstrument() {
    if (laeuft() || !instrument) return;
    if (!st.projekt) { setzeHinweis(SAMPLES_TEXT.keinModul); return; }
    const slug = st.slug;
    baut = true; lauf = null; zeichneBalken(); setzeHinweis(null);
    starteDenPoll(() => baut);
    let r;
    try { r = await ctx.holeJson('/sampler/instrument', { wurzel, ordner, spur: true }); }
    finally { baut = false; stoppePoll(); lauf = null; }
    if (r.status !== 200) {
      setzeHinweis(refusalText(r));
      if (r.j?.fehler === 'laeuft_schon' && aktiv) beobachteFremdenLauf(); else zeichneBalken();
      return;
    }
    zeichneBalken();
    ctx.beiInstrumentGebaut?.();
    if (r.j?.projekt) {
      if (st.slug !== slug) { ctx.melde('The track was added to the module you just left.'); return; }
      ctx.uebernimm(slug, r.j.projekt);
      if (typeof r.j.spur_id === 'string') ctx.waehle(r.j.spur_id);
    }
    if (typeof r.j?.text === 'string' && r.j.text !== '') ctx.melde(r.j.text);
  }
  balkenKnopf.addEventListener('click', () => { baueInstrument(); });

  // ---- drawing ----
  function setzeCursor(i, spiel) {
    cursor = i;
    const rows = liste.querySelectorAll('.w-smp-zeile');
    rows.forEach((r, k) => r.classList.toggle('cursor', k === i));
    rows[i]?.scrollIntoView?.({ block: 'nearest' });
    const z = zeilen[i];
    if (!spiel || !z) return;
    if (z.art === 'datei') { if (spielt?.rel !== z.rel) spiele(z); } else stoppe();
  }
  function zeichneListe(text) {
    if (text !== undefined) { liste.replaceChildren(nachricht(text)); return; }
    const rows = zeilen.map((z, i) => {
      const r = el('div', `w-smp-zeile w-smp-${z.art}`);
      r.setAttribute('role', 'option');
      if (z.art === 'ordner') {
        markiere(r, 'samples-ordner'); r.setAttribute('data-rel', z.rel);
        r.append(el('span', 'w-smp-marke', '▸'), el('span', 'w-smp-name', z.name.split('/').join(' / ')));
        if (typeof z.zahl === 'number') r.append(el('span', 'w-smp-groesse', `${z.zahl} ${z.zahl === 1 ? 'sample' : 'samples'}`));
        r.addEventListener('click', () => { cursor = i; oeffneOrdner(z.rel); });
        return r;
      }
      markiere(r, 'samples-datei'); r.setAttribute('data-rel', z.rel); r.setAttribute('title', z.rel);
      r.append(el('span', 'w-smp-marke', '▶'), el('span', 'w-smp-name', z.name));
      if (z.ort) r.append(el('span', 'w-smp-ort', z.ort));
      r.append(el('span', 'w-smp-groesse', z.groesse));
      const b = el('button', 'w-smp-knopf', 'TO TRACK'); b.type = 'button'; markiere(b, 'samples-spur');
      b.addEventListener('click', (ev) => { ev.stopPropagation?.(); zuSpur(z); });
      r.append(b);
      r.addEventListener('click', (ev) => {
        if (ev.target?.closest?.('button')) return;   // the button has its own click
        setzeCursor(i, false); spiele(z);
      });
      return r;
    });
    if (mehr) rows.push(el('div', 'w-smp-mehr', SAMPLES_TEXT.mehr));
    if (!rows.length) rows.push(nachricht(suche ? SAMPLES_TEXT.leerSuche : SAMPLES_TEXT.leerOrdner));
    liste.replaceChildren(...rows);
    if (cursor >= 0) liste.querySelectorAll('.w-smp-zeile')[cursor]?.classList.add('cursor');
    markiereSpielt(); zeigeKnoepfe();
  }
  function zeichneKopf() {
    chips.replaceChildren(...(wurzeln ?? []).map((w) => {
      const c = el('button', `w-smp-chip${w.name === wurzel ? ' an' : ''}`, w.name); c.type = 'button'; markiere(c, 'samples-wurzel');
      if (w.fehlt) { c.disabled = true; c.setAttribute('title', SAMPLES_TEXT.fehlt); c.classList.add('fehlt'); }
      c.addEventListener('click', () => { if (w.fehlt || w.name === wurzel) return; wechsleWurzel(w.name); });
      return c;
    }));
    const k = wurzel ? krumen(ordner) : [];
    pfad.replaceChildren(...(wurzel ? [{ name: wurzel, rel: '' }, ...k] : []).flatMap((x, i, alle) => {
      const b = el('button', 'w-smp-krume', x.name); b.type = 'button'; markiere(b, 'samples-pfad'); b.setAttribute('data-rel', x.rel);
      b.addEventListener('click', () => oeffneOrdner(x.rel));
      return i < alle.length - 1 ? [b, el('span', 'w-smp-trenner', '/')] : [b];
    }));
    kopf.hidden = false;
  }

  // ---- loading: a newer request wins over an older answer ----
  async function ladeListe() {
    const mein = ++nr;
    if (!wurzel) { zeichneKopf(); zeichneListe(SAMPLES_TEXT.keineWurzeln); return; }
    zeichneKopf(); zeichneListe(SAMPLES_TEXT.liest);
    const q = suche;
    const r = await ctx.holeGet(listenUrl(wurzel, ordner, q));
    if (mein !== nr) return;
    if (r.status === 404 && ordner !== '' && !q) { ordner = ''; speichere(); return ladeListe(); }   // the remembered folder is gone: the top of the root
    if (r.status !== 200 || !r.j || typeof r.j !== 'object') { zeilen = []; mehr = false; instrument = null; zeichneBalken(); zeichneListe(refusalText(r)); return; }
    ({ zeilen, mehr } = zeilenModell(r.j, { suche: q !== '' }));
    instrument = q === '' && r.j.instrument && typeof r.j.instrument === 'object' ? r.j.instrument : null;
    zeichneBalken();
    cursor = -1;
    zeichneKopf(); zeichneListe();
  }
  async function ladeAlles() {
    const mein = ++nr;
    zeichneListe(SAMPLES_TEXT.liest);
    const r = await ctx.holeGet('/sampler/dateien');
    if (mein !== nr) return;
    if (r.status !== 200 || !Array.isArray(r.j?.wurzeln)) {
      wurzelFehler = refusalText(r); chips.replaceChildren(); pfad.replaceChildren(); zeichneListe(wurzelFehler); return;
    }
    wurzelFehler = null;
    wurzeln = r.j.wurzeln.filter((w) => typeof w?.name === 'string');
    if (!wurzeln.some((w) => w.name === wurzel && !w.fehlt)) { wurzel = wurzeln.find((w) => !w.fehlt)?.name ?? null; ordner = ''; }
    await ladeListe();
  }
  function wechsleWurzel(name) { stoppe(); wurzel = name; ordner = ''; suche = ''; feld.value = ''; speichere(); ladeListe(); }
  function oeffneOrdner(rel) { stoppe(); ordner = rel; suche = ''; feld.value = ''; speichere(); ladeListe(); }

  // ---- search and keys ----
  const sucheJetzt = () => { clearTimeout(suchUhr); suchUhr = null; const neu = feld.value.trim(); if (neu === suche) return; suche = neu; stoppe(); ladeListe(); };
  feld.addEventListener('input', () => { clearTimeout(suchUhr); suchUhr = setTimeout(sucheJetzt, ctx.suchMs ?? SUCH_MS); suchUhr?.unref?.(); });
  feld.addEventListener('keydown', (ev) => {
    ev.stopPropagation();   // the library keys of the page stay out of the field
    if (ev.key === 'Escape') { feld.value = ''; sucheJetzt(); }
    else if (ev.key === 'Enter') sucheJetzt();
    else if (ev.key === 'ArrowDown') { ev.preventDefault?.(); liste.focus?.(); setzeCursor(naechsteZeile(zeilen, cursor, 'ArrowDown'), true); }
  });
  liste.addEventListener('keydown', (ev) => {
    if (ev.target?.matches?.('button')) { ev.stopPropagation?.(); return; }   // a focused button keeps its own Enter
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault?.(); ev.stopPropagation?.();
      setzeCursor(naechsteZeile(zeilen, cursor, ev.key), true);
    } else if (ev.key === 'Enter') {
      ev.preventDefault?.(); ev.stopPropagation?.();
      const z = zeilen[cursor];
      if (z?.art === 'datei') zuSpur(z); else if (z?.art === 'ordner') oeffneOrdner(z.rel);
    }
  });

  ctx.beimProjekt.push(() => { if (aktiv) { zeigeKnoepfe(); zeichneBalken(); } });
  ctx.beimSichtwechsel.push((sichtbar) => { if (!sichtbar) stoppe(); else if (aktiv) { host.replaceChildren(wurzelEl); ladeAlles(); if (!baut) beobachteFremdenLauf(); } });

  return {
    zeige() {
      aktiv = true; setzeHinweis(null); host.replaceChildren(wurzelEl);
      if (st.sichtbar) { ladeAlles(); if (!baut) beobachteFremdenLauf(); } else zeichneListe(SAMPLES_TEXT.liest);
    },
    verberge() { aktiv = false; stoppe(); setzeHinweis(null); if (!baut) stoppePoll(); },
  };
}
