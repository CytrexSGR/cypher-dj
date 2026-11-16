// Workbench region TRACKS (plan task 4): the track list. One row per instrument track (by track number, letters A..H, a ninth and later show their
// number), the other tracks only counted. A click selects the track (ctx.waehle, remembered per module by werkbank.js). This file also sets up the
// instrument info cache and installs it as ctx.info(spur) (info.js); it runs before the grid and sound regions, which read it.
//
// Row markup (task 9 extends the row; every element carries data-w):
//   div[data-w="spur"][data-spur-id][.aktiv]
//     span[data-w="spur-buchstabe"]  letter badge in the track colour
//     span[data-w="spur-name"]       name
//     span[data-w="spur-art"]        chip DRUM / NOTE (empty while the info loads)
//     span[data-w="spur-geraet"]     instrument text
//     span[data-w="spur-rechts"]     controls (task 9): input[range] spur-fader + span spur-faderwert, button spur-mute (M), spur-solo (S),
//                                    spur-loeschen (x), and the meter div.meter.waagrecht[data-kanal="spur/<nr>"] (filled by the page's /pegel path:
//                                    stream event /pegel {kanal, spitze_db} -> zeigePegel in deck_view.js)
// Below the rows: button[data-w="spur-neu"] "+ INSTRUMENT TRACK" (menu of instruments, ctx.oeffneMenue for tests).
// Rows are kept per track id and updated in place, so later additions to a row survive a project change. Hook for those additions:
// ctx.spurZeile = [fn(zeileEl, spur)] runs after a row was created (once) and after every update.
import { geraetText } from '../seq_field.js';
import { geraetArt } from '../seq_logic.js';
import { neuerInfoSpeicher } from './info.js';
import { geraetWahl, freierName } from '../seq_field.js';
import { REGLER_MAX, REGLER_SCHRITT, reglerVonDb, dbVonRegler, tasteMerke, tasteWert } from '../production/fader_curve.js';
import { oeffneMenue } from '../production/context_menu.js';
import { modulTakte } from './kopf.js';

export const SPUREN_TEXT = { titel: 'TRACKS', andere: (n) => `${n} other track${n === 1 ? '' : 's'}: open PRODUCTION` };
const BUCHSTABEN = 'ABCDEFGH';
// pinned equal to MAX_WERKBANK_SPUREN (project/werkbank.ts) by the test
export const MAX_SPUREN_MODUL = 8;
export const NEU_TEXT = { knopf: '+ INSTRUMENT TRACK', voll: 'A module holds 8 instrument tracks' };
const FADER_MIN = -60, FADER_AUS = -200, FADER_MAX = 6;   // the same thresholds as the PRODUCTION track head
const faderWert = (db) => (db <= FADER_MIN ? FADER_AUS : Math.min(FADER_MAX, db));
const anzahlInstrument = (p) => (p?.spuren ?? []).filter((s) => s.art === 'instrument').length;

export const faderText = (db) => (db <= FADER_MIN ? '-inf' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`);

// The command that adds an instrument track for the picker entry `eintrag` ({name, geraet}), or null at MAX_SPUREN_MODUL instrument tracks.
// The pattern is as long as the module (16 beats when the module has no length).
export function neueSpurBefehl(p, eintrag) {
  if (anzahlInstrument(p) >= MAX_SPUREN_MODUL) return null;
  const takte = modulTakte(p);
  return { befehl: 'werkbank_spur_neu', name: freierName(eintrag.name, (p?.spuren ?? []).map((s) => s.name)), geraet: eintrag.geraet, loop_beats: takte === null ? 16 : takte * 4 };
}

// The instrument menu of the workbench (new track and CHANGE): geraetWahl, with the Baukasten entries grouped by their category (bass, drums, keys,
// lead, pad, textur; graphs without one under "other") instead of one alphabetical list of over a hundred names. `aktion(eintrag)` runs on a click.
const KATEGORIEN = ['bass', 'drums', 'keys', 'lead', 'pad', 'textur'];
export function instrumentMenue(graphen, kits, behalte, aktion) {
  const kat = new Map((graphen ?? []).map((g) => [g?.name, KATEGORIEN.includes(g?.kategorie) ? g.kategorie : 'other']));
  const rang = (e) => (e.gruppe === 'Baukasten' ? KATEGORIEN.indexOf(kat.get(e.name)) + 1 || KATEGORIEN.length + 1 : e.gruppe === 'Kit' ? 100 : 101);
  const wahl = geraetWahl(graphen, kits, behalte)
    .map((e) => (e.gruppe === 'Baukasten' ? { ...e, gruppe: `Baukasten \u00b7 ${kat.get(e.name) ?? 'other'}` } : e))
    .map((e, i) => ({ e, i, r: rang({ ...e, gruppe: e.gruppe.startsWith('Baukasten') ? 'Baukasten' : e.gruppe }) }))
    .sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.e);
  const punkte = []; let gruppe = null;
  for (const e of wahl) {
    if (e.gruppe !== gruppe) { gruppe = e.gruppe; punkte.push({ gruppe: true, text: gruppe }); }
    punkte.push({ text: e.text, aktion: () => aktion(e) });
  }
  return punkte;
}

// D8: a kit, or an instrument whose info lists sounds, is a drum grid; anything else a note grid.
export function rasterArt(spur, info) {
  if (geraetArt(spur, info) === 'kit') return 'drum';
  return (info?.klaenge?.length ?? 0) > 0 ? 'drum' : 'note';
}

// infoVon(spur) -> info | null. art is null while the info of a device that is not a kit is still unknown.
export function spurZeilen(projekt, infoVon) {
  const alle = projekt?.spuren ?? [];
  const inst = alle.filter((s) => s.art === 'instrument').sort((a, b) => a.nr - b.nr);
  const zeilen = inst.map((s, i) => {
    const info = infoVon(s);
    const art = info || geraetArt(s, null) === 'kit' ? rasterArt(s, info) : null;
    return { id: s.id, nr: s.nr, buchstabe: i < BUCHSTABEN.length ? BUCHSTABEN[i] : String(s.nr), name: s.name, art, geraet: geraetText(s) };
  });
  return { zeilen, andere: alle.length - inst.length };
}

export function bindeSpuren(ctx) {
  const { st, $ } = ctx;
  const host = $('spuren');
  host.innerHTML = `<h3 class="w-titel" data-w="spuren-titel">${SPUREN_TEXT.titel}</h3><div class="w-spurliste" data-w="spurliste"></div><button type="button" class="w-spurneu" data-w="spur-neu">${NEU_TEXT.knopf}</button><p class="w-andere" data-w="spuren-andere"></p>`;
  const liste = $('spurliste'), andere = $('spuren-andere');
  const neuKnopf = $('spur-neu');
  ctx.spurZeile = [];
  const speicher = neuerInfoSpeicher((weg) => ctx.holeGet(weg), () => zeichne());
  ctx.info = (spur) => speicher.info(spur);
  const reihen = new Map();   // track id -> row element

  const teil = (name, klasse) => { const e = document.createElement('span'); e.className = klasse; e.setAttribute('data-w', name); return e; };
  function baueReihe(id) {
    const r = document.createElement('div');
    r.className = 'w-spur'; r.setAttribute('data-w', 'spur'); r.setAttribute('data-spur-id', id);
    r.append(teil('spur-buchstabe', 'w-buchstabe'), teil('spur-name', 'w-spurname'), teil('spur-art', 'w-chip'), teil('spur-geraet', 'w-spurgeraet'), teil('spur-rechts', 'w-spurrechts'));
    r.addEventListener('click', () => ctx.waehle(id));
    return r;
  }
  const feld = (r, n) => r.querySelector(`[data-w="${n}"]`);
  const knopf = (name, text, titel) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'w-knopf'; b.setAttribute('data-w', name); b.textContent = text; b.setAttribute('title', titel); b.setAttribute('aria-pressed', 'false'); return b; };
  const aktuell = (id) => st.projekt?.spuren?.find((x) => x.id === id);

  // Builds the controls of a row once; later calls only set their values.
  function baueSteuerung(r, id) {
    const rechts = feld(r, 'spur-rechts');
    if (feld(r, 'spur-fader')) return;
    const f = document.createElement('input');
    f.type = 'range'; f.className = 'w-fader'; f.setAttribute('data-w', 'spur-fader');
    f.setAttribute('min', '0'); f.setAttribute('max', String(REGLER_MAX)); f.setAttribute('step', String(REGLER_SCHRITT)); f.setAttribute('aria-label', 'Level');
    const wert = teil('spur-faderwert', 'w-faderwert');
    const m = knopf('spur-mute', 'M', 'Mute'), so = knopf('spur-solo', 'S', 'Solo');
    const weg = knopf('spur-loeschen', '\u2715', 'Delete track'); weg.removeAttribute('aria-pressed');
    const pegel = document.createElement('div');
    pegel.className = 'meter waagrecht'; pegel.setAttribute('data-kanal', 'spur/0'); pegel.append(document.createElement('i'));
    f.zieht = false; f.zuletzt = 0;
    const sende = () => {
      const s = aktuell(id); if (!s) return;
      const db = faderWert(tasteWert(f));
      f.zuletzt = Date.now();
      wert.textContent = faderText(db);
      ctx.aendere(`Volume ${s.name}`, [{ befehl: 'spur_aendern', spur_id: id, fader_db: db }], `${id}:fader`, { wiederhole: true });
    };
    f.addEventListener('pointerdown', () => { f.zieht = true; });
    for (const e of ['pointerup', 'pointercancel', 'change']) f.addEventListener(e, () => { f.zieht = false; });
    f.addEventListener('keydown', (e) => tasteMerke(f, e.key));
    f.addEventListener('input', sende);
    f.addEventListener('dblclick', () => { f.value = String(reglerVonDb(0)); sende(); });
    f.addEventListener('click', (e) => e.stopPropagation?.());
    const schalter = (b, feldName, an, aus) => b.addEventListener('click', (e) => {
      e.stopPropagation?.();
      const s = aktuell(id); if (!s) return;
      const jetzt = !s[feldName];
      ctx.aendere(`${jetzt ? an : aus} ${s.name}`, [{ befehl: 'spur_aendern', spur_id: id, [feldName]: jetzt }]);
    });
    schalter(m, 'mute', 'Mute', 'Unmute'); schalter(so, 'solo', 'Solo', 'Unsolo');
    weg.addEventListener('click', async (e) => {
      e.stopPropagation?.();
      const s = aktuell(id); if (!s) return;
      if (!(await ctx.frage(`Delete track ${s.name} with its pattern?`))) return;
      ctx.aendere(`Delete track ${s.name}`, [{ befehl: 'spur_loeschen', spur_id: id }]);
    });
    rechts.append(f, wert, m, so, weg, pegel);
  }
  function zeigeSteuerung(r, spur) {
    const f = feld(r, 'spur-fader'), db = typeof spur.fader_db === 'number' ? spur.fader_db : 0;
    if (!f.zieht && Date.now() - f.zuletzt > 400) { f.value = String(reglerVonDb(db)); feld(r, 'spur-faderwert').textContent = faderText(db); }
    for (const [n, fn] of [['spur-mute', 'mute'], ['spur-solo', 'solo']]) feld(r, n).setAttribute('aria-pressed', spur[fn] === true ? 'true' : 'false');
    r.querySelector('.meter').setAttribute('data-kanal', `spur/${spur.nr}`);
  }

  function zeichne() {
    const p = st.projekt;
    const z = spurZeilen(p, (s) => ctx.info(s));
    const ids = new Set(z.zeilen.map((x) => x.id));
    for (const [id, r] of reihen) if (!ids.has(id)) { r.remove(); reihen.delete(id); }
    const folge = [];
    for (const x of z.zeilen) {
      let r = reihen.get(x.id);
      const neu = !r;
      if (neu) { r = baueReihe(x.id); reihen.set(x.id, r); }
      const spur = p.spuren.find((s) => s.id === x.id);
      const b = feld(r, 'spur-buchstabe');
      b.textContent = x.buchstabe; b.style.background = spur.farbe ?? '';
      feld(r, 'spur-name').textContent = x.name;
      feld(r, 'spur-art').textContent = x.art === 'drum' ? 'DRUM' : x.art === 'note' ? 'NOTE' : '';
      feld(r, 'spur-geraet').textContent = x.geraet;
      r.classList.toggle('aktiv', x.id === st.wahl);
      baueSteuerung(r, x.id); zeigeSteuerung(r, spur);
      for (const h of ctx.spurZeile) h(r, spur);
      folge.push(r);
    }
    liste.replaceChildren(...folge);
    const voll = anzahlInstrument(p) >= MAX_SPUREN_MODUL;
    neuKnopf.disabled = voll; if (voll) neuKnopf.setAttribute('title', NEU_TEXT.voll); else neuKnopf.removeAttribute('title');
    andere.textContent = z.andere > 0 ? SPUREN_TEXT.andere(z.andere) : '';
  }

  neuKnopf.addEventListener('click', async () => {
    if (!st.projekt || neuKnopf.disabled) return;
    const r = neuKnopf.getBoundingClientRect();
    const [g, kits] = await Promise.all([ctx.holeGet('/graphen'), ctx.holeGet('/proj/kits')]);
    const punkte = instrumentMenue(g?.j?.graphen, kits?.j?.kits, undefined, legeAn);
    (ctx.oeffneMenue ?? oeffneMenue)(punkte, r.left, r.bottom);
  });
  async function legeAn(eintrag) {
    const b = neueSpurBefehl(st.projekt, eintrag);
    if (!b) return;   // the module filled up while the menu was open
    if (await ctx.aendere(`Add track ${b.name}`, [b])) {
      const neu = st.projekt?.spuren?.find((x) => x.art === 'instrument' && x.name === b.name);
      if (neu) ctx.waehle(neu.id);
    }
  }

  ctx.beimProjekt.push((p, wechsel) => { if (wechsel) speicher.vergiss(); if (p) zeichne(); else { liste.replaceChildren(); reihen.clear(); andere.textContent = ''; } });
  ctx.beiWahl.push(() => { if (st.projekt) zeichne(); });
}
