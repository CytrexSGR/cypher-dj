// Browser probe of package 1.16 rest U6 (T6.5): the browser mode switch of PRODUCTION, the DEVICES list and the device drop.
// Stack as pruef/probe_produktion.mjs: probe stack on a test instance (core stand-in + counting relay + control stand + the real page server with a
// test catalogue), the project stand-in pruef/proj_attrappe.mjs in front of it (it runs the real S2 command core and logs every request), headless
// Chrome over cdp.mjs with real mouse and HTML5 drag events. No sound, no window, no studio.
// Call: node pruef/probe_b116_browser.mjs [--instanz e] [--ausgabe <folder>]
//   The default output folder is /dev/shm/b116-probe-<time> (not in the repo). Result: bericht.md, ergebnis.json, produktion.png; exit 1 on any FEHL.
// Points: 1 computed style of the four mode elements per mode (also with body.bereich-effekte), 2 the DJ state never changes (AK-B16-9 part 1),
//   3 the DEVICES list against GET /presets/katalog, 4 real drag RB-338 -> exactly one spur_neu, 5 Compressor on a track row -> exactly one
//   insert_setzen, 6 EQ on a track row -> zero commands and the reason text, 7 Compressor beside the tracks -> zero commands and the text,
//   8 Compressor on a strip row of INSERTS -> one insert_setzen, 9 console.
//   U7 (T7.5, AK-B16-9 part 2): 10.x PRESETS list is draggable; a komp preset dropped on a stage -> one insert_werte_setzen (one undo step), the origin
//   mark and "modified"; a hall preset -> no write and the server's reason; an instrument preset on an audio row -> no request; an rb338 preset on its track
//   -> one spur_aendern with the preset; SAVE CURRENT from a stage -> POST /presets/von_ziel with the stage as target (the stand-in does not write).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';
import { starteProjAttrappe, neuesProjekt } from './proj_attrappe.mjs';
import { baueKatalog } from '../tests/hilfen/katalog.mjs';
import { PRESET_TEXT } from '../presets/modell.ts';

const d0 = new Date();
const zeit = `${d0.getFullYear()}${String(d0.getMonth() + 1).padStart(2, '0')}${String(d0.getDate()).padStart(2, '0')}T${String(d0.getHours()).padStart(2, '0')}${String(d0.getMinutes()).padStart(2, '0')}${String(d0.getSeconds()).padStart(2, '0')}`;
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: process.env.CYPHERDJ_PROBE_INSTANZ ?? 'e' }, ausgabe: { type: 'string', default: `/dev/shm/b116-probe-${zeit}` } } });
// tests/hilfen/mediathek.mjs claims the test instance at import (lock /dev/shm/cypherdj-testinstanz-<i>.sperre): set it first, import after
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const { baueMediathek } = await import('../tests/hilfen/mediathek.mjs');
const ORDNER = opt.ausgabe;
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnis = { zeit, instanz: opt.instanz, punkte: {} };
const zeilen = [];
const notiere = (k, ok, text) => { ergebnis.punkte[k] = { ok, text }; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const SHA = { kick: 'a'.repeat(64) };
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-b116-'));
const daten = path.join(fix, 'daten'); fs.mkdirSync(daten);
const kickWav = path.join(daten, 'kick.wav');
execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'sine=f=80:d=0.5,volume=0.9', '-ar', '44100', kickWav]);
const mt = baueMediathek(path.join(fix, 'mt'));
baueKatalog(fix, [{ typ: 'oneshot', sha: SHA.kick, shas: SHA.kick, name: 'Kick 1', instrument: 'kick', pack: 'Probe', dauer_s: 0.5, pfad: kickWav }]);

const s = await starteStapel(ORDNER, opt.instanz, {}, { serverArgs: ['--katalog', path.join(fix, 'katalog.sqlite'), '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle')] });
const at = await starteProjAttrappe({ oben: s.url, dekodierMs: 300 });
const URL = at.url;
const b = await starteBrowser();
const w = (x) => b.werte(x);
const rect = (sel) => w(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; })()`);
const log = () => at.zustand.log;
// /proj/aendern requests since index n0 -> their commands, flat
const befehleSeit = (n0) => log().slice(n0).filter((e) => e.weg === '/proj/aendern').flatMap((e) => e.koerper?.befehle ?? []);
const meldung = () => w(`document.querySelector('[data-p="meldung"]').textContent`);
const projekt = () => w('window.djkProd.projekt');
const AUSFALL = /^Failed to load resource: the server responded with a status of (409|400)/;
// the project stand-in answers neither GET /proj/aufnahme nor GET /proj/bk (old page polls, not part of U6); the page server behind it has no project
// store here and answers 404. Only these two URLs are tolerated, everything else counts (the count of tolerated ones is reported).
const STAND_IN_LUECKE = /^http:\/\/127\.0\.0\.1:\d+\/proj\/(aufnahme|bk)$/;
const luecke = (k) => /status of 404/.test(k.text) && STAND_IN_LUECKE.test(k.url ?? '');
const fehlerKonsole = () => b.konsole.filter((k) => (k.typ === 'exception' || k.typ === 'error') && !AUSFALL.test(k.text) && !luecke(k));

// the four elements of the mode switch (T6.1) with their computed display; #kollektionen has no element before U8: the probe puts a stand-in
// in the page so the CSS rule of that mode is measured too (named in the report)
const ELEMENTE = { library: '[data-tabelle="library"]', geraete: '#geraete-browser', presets: '#presets', kollektionen: '#kollektionen' };
const anzeige = () => w(`(() => { const o = {}; for (const [m, sel] of Object.entries(${JSON.stringify(ELEMENTE)})) { const e = document.querySelector(sel); o[m] = e ? getComputedStyle(e).display : 'fehlt'; } return o; })()`);
// the DJ state: stored tab, body classes of the DJ view, pressed tab buttons
const djZustand = () => w(`(() => ({ gespeichert: localStorage.getItem('djk-bereich'), klassen: [...document.body.classList].filter((c) => c !== 'produktion' && !c.startsWith('b-')).sort().join(' '),
  bereichAn: [...document.querySelectorAll('[data-bereich].an')].map((x) => x.dataset.bereich).join(','), reiterAn: [...document.querySelectorAll('[data-reiter].an')].map((x) => x.dataset.reiter).join(','),
  modusKlassen: [...document.body.classList].filter((c) => c.startsWith('b-')).join(',') }))()`);
const setzeModusKlasse = (m) => w(`(() => { for (const x of ['library', 'geraete', 'presets', 'kollektionen']) document.body.classList.toggle('b-' + x, x === ${JSON.stringify(m)}); })()`);
// the row of the DEVICES list by its title
const zeileSel = async (titel) => {
  const i = await w(`[...document.querySelectorAll('#geraete-browser [data-geraet-i]')].findIndex((li) => li.querySelector('.geraete-name').textContent === ${JSON.stringify(titel)})`);
  if (i < 0) return null;
  const sel = `#geraete-browser [data-geraet-i="${i}"]`;
  await w(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);   // the list is long (every instrument graph): the row must be in view for the pointer
  await warte(100);
  return sel;
};
const spurPunkt = async (spur, beat = 2) => {   // page coordinate in the middle of a track row at a beat
  const f = await rect('[data-p="flaeche"]');
  const a = await w('window.djkProd.ansicht');
  return { x: f.l + (beat - a.beat0) * a.pxProBeat, y: f.t + spur * 64 + 32 };
};

try {
  await b.oeffne(URL);
  await warte(1500);

  // ================= DJ view first: the state that must stay =================
  const dj0 = await djZustand();
  const modusKlassenDj = dj0.modusKlassen;

  // ================= PRODUCTION, a project with three tracks =================
  await b.klick('[data-ansicht="produktion"]'); await warte(1200);
  const saat = neuesProjekt('Seed');
  saat.spuren.push({ id: 's90', nr: 1, name: 'Drums', farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
  saat.spuren.push({ id: 's92', nr: 2, name: 'Bass', farbe: '#3b8de0', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} }, fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
  const r = await (await fetch(URL + 'attrappe/saat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projekt: saat }) })).json();
  await fetch(URL + 'attrappe/sse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'proj', f: { slug: r.slug, rev: 1, label: 'seed', quelle: 'cypher' } }) });
  await w(`(() => { const s = document.querySelector('[data-p="oeffnen"]'); s.dispatchEvent(new Event('focus')); })()`); await warte(300);
  await w(`(() => { const s = document.querySelector('[data-p="oeffnen"]'); s.value = ${JSON.stringify(r.slug)}; s.dispatchEvent(new Event('change')); })()`); await warte(800);
  const p0 = await projekt();
  notiere('0 Setup', p0?.spuren?.length === 2 && (await w('window.djkProd.slug')) === r.slug, `project ${r.slug} open with ${p0?.spuren?.length} tracks (Drums audio, Bass rb338)`);

  // ================= 1 computed style per mode (T6.1) =================
  const knoepfe = await w(`[...document.querySelectorAll('[data-browser-modus]')].map((x) => x.textContent + (x.disabled ? '(disabled)' : ''))`);
  notiere('1.0 Mode switch buttons', JSON.stringify(knoepfe) === '["LIBRARY","DEVICES","PRESETS","COLLECTIONS"]', `buttons ${JSON.stringify(knoepfe)}`);
  const standIn = await w(`(() => { if (document.querySelector('#kollektionen')) return false; const e = document.createElement('div'); e.id = 'kollektionen'; e.hidden = true; document.querySelector('#bestand').appendChild(e); return true; })()`);
  const alle = {};
  for (const effekte of [false, true]) {
    await w(`document.body.classList.toggle('bereich-effekte', ${effekte})`);
    for (const m of ['library', 'geraete', 'presets', 'kollektionen']) {
      // every mode is clicked like a person (COLLECTIONS since U8)
      await b.klick(`[data-browser-modus="${m}"]`); await warte(150);
      const d = await anzeige();
      const sichtbar = Object.keys(d).filter((k) => d[k] !== 'none');
      alle[`${m}${effekte ? '+effekte' : ''}`] = { d, sichtbar };
    }
  }
  await w(`document.body.classList.toggle('bereich-effekte', false)`);
  const ok1 = Object.entries(alle).every(([k, v]) => v.sichtbar.length === 1 && v.sichtbar[0] === k.replace('+effekte', ''));
  notiere('1.1 Exactly one of the four elements visible per mode', ok1,
    Object.entries(alle).map(([k, v]) => `${k}: visible [${v.sichtbar}]`).join('; ') + `; #kollektionen is a stand-in put into the page by the probe: ${standIn}`);
  await b.klick('[data-browser-modus="library"]'); await warte(150);
  // the chosen mode must be visible to a person: the pressed button looks different from the others (computed border colour)
  const marke = await w(`[...document.querySelectorAll('[data-browser-modus]')].map((x) => [x.dataset.browserModus, x.getAttribute('aria-pressed'), getComputedStyle(x).borderTopColor])`);
  const gedrueckt = marke.filter((x) => x[1] === 'true'), andere = marke.filter((x) => x[1] !== 'true');
  notiere('1.1b Chosen mode is marked', gedrueckt.length === 1 && gedrueckt[0][0] === 'library' && andere.length === 3 && andere.every((x) => x[2] === andere[0][2]) && gedrueckt[0][2] !== andere[0][2],
    `border colour: pressed ${gedrueckt[0]?.[0]} ${gedrueckt[0]?.[2]}, the other three ${andere.map((x) => x[2]).join(' / ')}`);
  // U8: COLLECTIONS is a mode like the others: taken, remembered, and the DJ tab state stays
  const vorK = await w(`localStorage.getItem('djk-prod-browser')`);
  await b.klick('[data-browser-modus="kollektionen"]'); await warte(300);
  const nachK = await w(`({ s: localStorage.getItem('djk-prod-browser'), k: [...document.body.classList].filter((c) => c.startsWith('b-')).join(','), panel: !!document.querySelector('#kollektionen [data-koll-aktion="neu"]'), bereich: localStorage.getItem('djk-bereich') })`);
  notiere('1.2 COLLECTIONS taken and remembered, its panel loaded', vorK === 'library' && nachK.s === 'kollektionen' && nachK.k === 'b-kollektionen' && nachK.panel && nachK.bereich !== 'kollektionen', `djk-prod-browser ${vorK} -> ${nachK.s} after a click on COLLECTIONS; body modes ${nachK.k}; panel with NEW button ${nachK.panel}`);
  // the mode survives a reload
  await b.klick('[data-browser-modus="geraete"]'); await warte(200);
  await b.oeffne(URL); await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1000);
  const nachLaden = await w(`({ s: localStorage.getItem('djk-prod-browser'), k: [...document.body.classList].filter((c) => c.startsWith('b-')).join(','), g: getComputedStyle(document.querySelector('#geraete-browser')).display })`);
  notiere('1.3 Mode kept over a reload', nachLaden.s === 'geraete' && nachLaden.k === 'b-geraete' && nachLaden.g !== 'none', `stored ${nachLaden.s}, body ${nachLaden.k}, #geraete-browser ${nachLaden.g}`);
  await w(`(() => { const s = document.querySelector('[data-p="oeffnen"]'); s.dispatchEvent(new Event('focus')); })()`); await warte(300);
  await w(`(() => { const s = document.querySelector('[data-p="oeffnen"]'); s.value = ${JSON.stringify(r.slug)}; s.dispatchEvent(new Event('change')); })()`); await warte(800);

  // ================= 3 the DEVICES list =================
  const kat = await w(`fetch('/presets/katalog').then((x) => x.json())`);
  const liste = await w(`[...document.querySelectorAll('#geraete-browser [data-geraet-i]')].map((li) => ({ name: li.querySelector('.geraete-name').textContent, aus: li.classList.contains('aus'), titel: li.title, ziehbar: li.draggable }))`);
  const erwartet = [...kat.instrumente, ...kat.effekte];
  const kopf = await w(`[...document.querySelectorAll('#geraete-browser h4')].map((x) => x.textContent)`);
  const grundOk = erwartet.every((e, i) => liste[i]?.name === e.titel && liste[i].aus === (e.aktiv === false) && (e.grund ? liste[i].titel === e.grund : true));
  notiere('3.1 DEVICES list equals GET /presets/katalog', grundOk && liste.length === erwartet.length && JSON.stringify(kopf) === '["INSTRUMENTS","EFFECTS"]' && liste.some((x) => x.aus) && liste.some((x) => !x.aus),
    `groups ${JSON.stringify(kopf)}; rows ${liste.map((x) => `${x.name}${x.aus ? '(greyed: ' + x.titel + ')' : ''}`).join(', ')}; catalogue rows ${erwartet.length}`);

  // ================= 4 RB-338 -> one spur_neu =================
  const bsel = await zeileSel('RB-338');
  const n4 = log().length;
  const ok4 = await b.zieheDnD(bsel, ...Object.values(await spurPunkt(0, 6)));
  await warte(600);
  const bef4 = befehleSeit(n4), p4 = await projekt();
  const neu4 = bef4.filter((x) => x.befehl === 'spur_neu');
  notiere('4 Drag RB-338 -> one spur_neu', ok4 && bef4.length === 1 && neu4.length === 1 && neu4[0].art === 'instrument' && neu4[0].geraet?.name === 'rb338' && neu4[0].geraet?.art === 'intern' && p4.spuren.length === 3 && p4.spuren[2].geraet?.name === 'rb338',
    `drag ${ok4}; requests to /proj/aendern: ${bef4.length} (${JSON.stringify(bef4)}); tracks ${p0.spuren.length} -> ${p4.spuren.length}`);

  // ================= 5 Compressor on a track row -> one insert_setzen =================
  const ksel = await zeileSel('Compressor');
  const n5 = log().length;
  const ok5 = await b.zieheDnD(ksel, ...Object.values(await spurPunkt(0, 6)));
  await warte(600);
  const bef5 = befehleSeit(n5), p5 = await projekt();
  notiere('5 Drag Compressor on the Drums row -> one insert_setzen', ok5 && bef5.length === 1 && bef5[0].befehl === 'insert_setzen' && bef5[0].strang_id === 's90' && bef5[0].art === 'komp' && bef5[0].pos === 0 && p5.spuren[0].inserts?.length === 1 && p5.spuren[0].inserts[0].art === 'komp',
    `drag ${ok5}; commands ${JSON.stringify(bef5)}; inserts of Drums ${p5.spuren[0].inserts?.length ?? 0}`);

  // ================= 6 EQ on a track row -> zero commands, the reason =================
  const esel = await zeileSel('EQ');
  const n6 = log().length;
  const ok6 = await b.zieheDnD(esel, ...Object.values(await spurPunkt(1, 6)));
  await warte(500);
  const bef6 = befehleSeit(n6), m6 = await meldung(), eqGrund = kat.effekte.find((e) => e.geraet === 'eq')?.grund;
  const sendungen6 = log().slice(n6).filter((e) => e.methode === 'POST' && e.weg === '/proj/aendern').length;
  notiere('6 Drag EQ on a track row -> zero commands and the reason', ok6 && bef6.length === 0 && sendungen6 === 0 && !!eqGrund && m6 === eqGrund,
    `drag ${ok6}; requests to /proj/aendern ${sendungen6}, commands ${bef6.length}; message "${m6}" (catalogue reason "${eqGrund}")`);
  const hsel = await zeileSel('Hall');
  const n6b = log().length;
  await b.zieheDnD(hsel, ...Object.values(await spurPunkt(1, 6))); await warte(400);
  const m6b = await meldung();
  notiere('6b Drag Hall on a track row -> zero commands and its reason', befehleSeit(n6b).length === 0 && m6b === kat.effekte.find((e) => e.geraet === 'hall')?.grund, `commands ${befehleSeit(n6b).length}; message "${m6b}"`);

  // ================= 7 Compressor beside the track rows -> nothing sent =================
  const n7 = log().length;
  const f = await rect('[data-p="flaeche"]');
  const ok7 = await b.zieheDnD(await zeileSel('Compressor'), f.l + 300, f.t + 3 * 64 + 20 + 100);   // below the last track row
  await warte(500);
  const bef7 = befehleSeit(n7), m7 = await meldung();
  notiere('7 Drag Compressor beside the tracks -> zero commands and the text', ok7 && bef7.length === 0 && m7 === 'Drop the effect on a track row', `drag ${ok7}; commands ${bef7.length}; message "${m7}"`);

  // ================= 8 Compressor on a strip row of INSERTS (master) -> one insert_setzen =================
  const master = await w(`!!document.querySelector('[data-p="inserts-liste"] .p-kette[data-strang="master"]')`);
  if (master) {
    const n8 = log().length;
    await b.klick('[data-p="inserts-titel"]'); await warte(300);   // INSERTS is a closed <details> until a person opens it
    const MS = '[data-p="inserts-liste"] .p-kette[data-strang="master"]';
    await w(`document.querySelector(${JSON.stringify(MS)}).scrollIntoView({ block: 'nearest' })`); await warte(100);   // the strip list scrolls (max-height)
    const mp = await w(`(() => { const r = document.querySelector(${JSON.stringify(MS)}).getBoundingClientRect(); return { x: r.left + Math.min(r.width / 2, 100), y: r.top + r.height / 2, h: r.height, ziel: document.elementFromPoint(r.left + Math.min(r.width / 2, 100), r.top + r.height / 2)?.closest('.p-kette')?.dataset.strang ?? null }; })()`);
    await b.bild(path.join(ORDNER, 'vor-master-drop.png'));
    const ok8 = await b.zieheDnD(await zeileSel('Compressor'), mp.x, mp.y);
    await warte(600);
    const bef8 = befehleSeit(n8), p8 = await projekt();
    notiere('8 Drag Compressor on the master strip row -> one insert_setzen', ok8 && bef8.length === 1 && bef8[0].befehl === 'insert_setzen' && bef8[0].strang_id === 'master' && bef8[0].art === 'komp' && (p8.master?.inserts?.length ?? 0) === 1,
      `drag ${ok8}; element under the pointer: strip ${mp.ziel}; commands ${JSON.stringify(bef8)}; master inserts ${p8.master?.inserts?.length ?? 0}`);
  } else notiere('8 Drag Compressor on the master strip row', false, 'no master strip row in the INSERTS block ([data-p="inserts-liste"] .p-kette[data-strang="master"])');


  // ================= U7 PRESETS in PRODUCTION (T7.5, AK-B16-9 part 2) =================
  // The page also asks /presets/anwenden by itself for the origin mark (T7.4, after a write), so a drop's plan requests are those BEFORE its write
  const planAnfragen = (n0) => { const l = log().slice(n0), w0 = l.findIndex((e) => e.weg === '/proj/aendern'); return (w0 < 0 ? l : l.slice(0, w0)).filter((e) => e.weg === '/presets/anwenden'); };
  const aendernAnfragen = (n0) => log().slice(n0).filter((e) => e.weg === '/proj/aendern').length;
  const schreibAnfragen = (n0) => log().slice(n0).filter((e) => e.weg === '/proj/aendern' || e.weg === '/presets/anwenden' || e.weg === '/presets/von_ziel').length;   // background reads (/proj/aktuell, /proj/verlauf) do not count
  const setzeFeld = (sel, wert, ereignis = 'change') => w(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(wert)}; e.dispatchEvent(new Event(${JSON.stringify(ereignis)}, { bubbles: true })); })()`);
  const filtereGeraet = async (g) => { await setzeFeld('[data-preset-feld="geraet"]', g); await warte(200); };
  const presetZeile = async (id) => {
    const sel = `#presets [data-preset-id="${id}"][data-preset-ziehen]`;
    if (!(await w(`!!document.querySelector(${JSON.stringify(sel)})`))) return null;
    await w(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`); await warte(100);
    return sel;
  };
  const stufePunkt = async (spurId) => {   // the middle of the first stage on a strip row of the INSERTS block
    const sel = `[data-p="inserts-liste"] .p-kette[data-strang="${spurId}"] .p-stufe`;
    await w(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'nearest' })`); await warte(100);
    return { sel, ...(await rect(sel)) };
  };
  await b.klick('[data-browser-modus="presets"]'); await warte(900);
  const kopf10 = await w(`({ klasse: [...document.body.classList].filter((c) => c.startsWith('b-')).join(','), anzeige: getComputedStyle(document.querySelector('#presets')).display,
    zeilen: document.querySelectorAll('#presets .preset-zeile').length, ziehbar: document.querySelectorAll('#presets .preset-zeile[draggable="true"][data-preset-ziehen]').length,
    anwenden: document.querySelectorAll('#presets [data-preset-aktion="anwenden"]').length, hinweis: !!document.querySelector('#presets .preset-ziehen-hinweis'), bereich: localStorage.getItem('djk-bereich') })`);
  const liste10 = await w(`fetch('/presets').then((x) => x.json())`), komp10 = liste10.filter((e) => e.geraet === 'komp');   // the panel starts with the compressor filter
  notiere('10.0 PRESETS list in PRODUCTION: every readable row draggable, no APPLY button', kopf10.klasse === 'b-presets' && kopf10.anzeige !== 'none' && kopf10.zeilen === komp10.length && kopf10.ziehbar === komp10.filter((e) => !e.fehler).length && komp10.length >= 4 && kopf10.anwenden === 0 && kopf10.hinweis && kopf10.bereich === 'library',
    `body ${kopf10.klasse}; #presets display ${kopf10.anzeige}; rows ${kopf10.zeilen} (GET /presets: ${komp10.length} compressor of ${liste10.length}); draggable ${kopf10.ziehbar}; APPLY buttons ${kopf10.anwenden}; hint line ${kopf10.hinweis}; djk-bereich ${kopf10.bereich}`);
  await b.bild(path.join(ORDNER, 'presets-liste.png'));

  // ---- a compressor preset onto a stage: one plan request, one write, one undo step ----
  await filtereGeraet('komp');
  const dbSel = await presetZeile('werk/komp/drum-bus');
  const stufe0 = await projekt();
  const stufeId = stufe0.spuren[0].inserts[0].id;
  const vorWerte = JSON.stringify(stufe0.spuren[0].inserts[0].werte);
  const sp = await stufePunkt('s90');
  const n10 = log().length;
  const ok10 = dbSel ? await b.zieheDnD(dbSel, sp.l + sp.w / 2, sp.t + sp.h / 2) : false;
  await warte(900);
  const plan10 = planAnfragen(n10), bef10 = befehleSeit(n10), p10 = await projekt(), s10 = p10.spuren[0].inserts[0];
  const erwartetDB = { schwelle: -18, ratio: 4, knie: 6, attack: 30, release: 100, makeup: 3, mix: 1, schp: 90 };
  notiere('10.1 Drag werk:komp/drum-bus onto a stage -> one plan request, one insert_werte_setzen',
    ok10 && plan10.length === 1 && plan10[0].koerper.id === 'werk:komp/drum-bus' && plan10[0].koerper.ziel?.insert_id === stufeId && bef10.length === 1 && bef10[0].befehl === 'insert_werte_setzen' && bef10[0].insert_id === stufeId
      && bef10[0].preset === 'werk:komp/drum-bus' && !('extsc' in bef10[0].werte) && Object.entries(erwartetDB).every(([k, v]) => s10.werte[k] === v) && s10.preset === 'werk:komp/drum-bus' && vorWerte !== JSON.stringify(s10.werte),
    `drag ${ok10}; plan requests ${plan10.length} (${JSON.stringify(plan10[0]?.koerper)}); writes ${bef10.length} (${JSON.stringify(bef10)}); stage before ${vorWerte}; stage after ${JSON.stringify(s10)}`);
  const marke10 = await w(`document.querySelector('[data-p="inserts-liste"] .p-stufe[data-insert="${stufeId}"] .p-ins-preset')?.textContent ?? null`);
  notiere('10.1b The stage shows the preset name (not modified)', marke10 === 'Drum Bus', `mark "${marke10}"`);
  // one undo step brings the old values and the empty origin back
  await b.klick('[data-p="undo"]'); await warte(700);
  const pU = await projekt(), sU = pU.spuren[0].inserts[0];
  const markeU = await w(`document.querySelector('[data-p="inserts-liste"] .p-stufe[data-insert="${stufeId}"] .p-ins-preset')?.textContent ?? null`);
  notiere('10.1c One undo step restores the values and clears the origin (AK-B16-6 in the page)', JSON.stringify(sU.werte) === vorWerte && sU.preset === undefined && markeU === null,
    `after UNDO: values ${JSON.stringify(sU.werte)} (before ${vorWerte}); preset ${sU.preset}; mark ${markeU}`);
  await b.klick('[data-p="redo"]'); await warte(900);
  const pR = await projekt();
  notiere('10.1d REDO brings the preset back', pR.spuren[0].inserts[0].preset === 'werk:komp/drum-bus', `preset ${pR.spuren[0].inserts[0].preset}`);
  // "modified": a value changes by hand (here: a direct command to the stand-in, as a slider would send it)
  const revJetzt = pR.rev;
  await fetch(URL + 'proj/aendern', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev: revJetzt, label: 'ratio by hand', befehle: [{ befehl: 'insert_param_setzen', insert_id: stufeId, param: 'ratio', wert: 6 }] }) });
  let markeM = null;
  for (let i = 0; i < 40 && markeM !== 'Drum Bus · modified'; i++) { await warte(100); markeM = await w(`document.querySelector('[data-p="inserts-liste"] .p-stufe[data-insert="${stufeId}"] .p-ins-preset')?.textContent ?? null`); }
  const titelM = await w(`document.querySelector('[data-p="inserts-liste"] .p-stufe[data-insert="${stufeId}"] .p-ins-preset')?.title ?? null`);
  notiere('10.1e A value changed by hand: the mark says modified', markeM === 'Drum Bus · modified', `mark "${markeM}", title "${titelM}"`);
  await b.bild(path.join(ORDNER, 'presets-marke.png'));

  // ---- a hall preset: the server's reason, no write ----
  await filtereGeraet('hall');
  const hallSel = await presetZeile('werk/hall/small-room');
  const n11 = log().length;
  const ok11 = hallSel ? await b.zieheDnD(hallSel, ...Object.values(await spurPunkt(0, 6))) : false;
  await warte(700);
  const m11 = await meldung();
  notiere('10.2 Drag a hall preset on a track row -> the plan is asked, the server refuses (kein_ziel), no write', ok11 && planAnfragen(n11).length === 1 && aendernAnfragen(n11) === 0 && m11 === PRESET_TEXT.kein_ziel,
    `drag ${ok11}; plan requests ${planAnfragen(n11).length}; /proj/aendern ${aendernAnfragen(n11)}; message "${m11}"`);
  const sp2 = await stufePunkt('s90');
  const n11b = log().length;
  const ok11b = hallSel ? await b.zieheDnD(await presetZeile('werk/hall/small-room'), sp2.l + sp2.w / 2, sp2.t + sp2.h / 2) : false;
  await warte(500);
  const m11b = await meldung();
  notiere('10.2b Drag a hall preset on a compressor stage -> refused on the page, no plan and no write', ok11b && schreibAnfragen(n11b) === 0 && m11b === 'This preset belongs to another device than the target', `drag ${ok11b}; plan and write requests ${schreibAnfragen(n11b)}; message "${m11b}"`);

  // ---- an instrument preset: on an audio row nothing is sent; on its own track one spur_aendern with the preset ----
  await filtereGeraet('rb338');
  const acid = await presetZeile('werk/rb338/classic-acid');
  const n12 = log().length;
  const ok12 = acid ? await b.zieheDnD(acid, ...Object.values(await spurPunkt(0, 6))) : false;   // row 0 = Drums (audio)
  await warte(500);
  const m12 = await meldung();
  notiere('10.3 Drag an rb338 preset on an audio row -> no plan and no write, the reason', ok12 && schreibAnfragen(n12) === 0 && m12 === 'Instrument presets go on instrument tracks', `drag ${ok12}; plan and write requests ${schreibAnfragen(n12)}; message "${m12}"`);
  const n13 = log().length;
  const ok13 = await b.zieheDnD(await presetZeile('werk/rb338/classic-acid'), ...Object.values(await spurPunkt(1, 6)));   // row 1 = Bass (rb338)
  await warte(900);
  const bef13 = befehleSeit(n13), p13 = await projekt(), bass = p13.spuren[1];
  const kopf13 = await w(`document.querySelector('[data-p="koepfe"] .p-kopf[data-spur="${bass.id}"] .p-geraet')?.textContent ?? null`);
  notiere('10.4 Drag werk:rb338/classic-acid on the Bass row -> one plan request, one spur_aendern with the preset', ok13 && planAnfragen(n13).length === 1 && planAnfragen(n13)[0].koerper.ziel?.spur_id === bass.id && bef13.length === 1 && bef13[0].befehl === 'spur_aendern'
      && bef13[0].geraet?.preset === 'werk:rb338/classic-acid' && bass.geraet?.preset === 'werk:rb338/classic-acid' && Object.keys(bass.geraet.parameter ?? {}).length > 3 && /Classic Acid/.test(kopf13 ?? '') && !/modified/.test(kopf13 ?? ''),
    `drag ${ok13}; plan requests ${planAnfragen(n13).length}; writes ${JSON.stringify(bef13.map((x) => [x.befehl, x.spur_id, x.geraet?.preset, Object.keys(x.geraet?.parameter ?? {}).length + ' parameters']))}; head label "${kopf13}"`);

  // ---- SAVE CURRENT from a stage ----
  await filtereGeraet('komp');
  const ziele = await w(`[...document.querySelectorAll('#presets [data-preset-ziel] option')].map((o) => o.value + '=' + o.textContent)`);
  await setzeFeld('[data-preset-entwurf="name"]', 'Probe Sound', 'input');
  await setzeFeld('[data-preset-entwurf="art"]', 'compressor');
  await setzeFeld('[data-preset-entwurf="unterart"]', 'glue');
  await setzeFeld('[data-preset-entwurf="charakter"]', 'warm', 'input');
  await setzeFeld('[data-preset-entwurf="einsatz"]', 'mixdown', 'input');
  await setzeFeld('[data-preset-entwurf="energie"]', '2');
  await setzeFeld('[data-preset-entwurf="text"]', 'Taken from the probe stage.', 'input');
  const n14 = log().length;
  await b.klick('#presets [data-preset-aktion="speichern"]'); await warte(900);
  const von14 = log().slice(n14).filter((e) => e.weg === '/presets/von_ziel'), gesp = at.zustand.gespeichertePresets;
  const stufeJetzt = (await projekt()).spuren[0].inserts[0];
  const m14 = await w(`document.querySelector('#presets .preset-meldung')?.textContent ?? null`);
  notiere('10.5 SAVE CURRENT from a stage -> POST /presets/von_ziel with the stage as target and its values', ziele.length >= 2 && ziele[0] === `insert:${stufeId}=Drums, compressor 1` && von14.length === 1 && von14[0].koerper.ziel?.insert_id === stufeId && !('werte' in von14[0].koerper)
      && gesp.length === 1 && gesp[0].geraet === 'komp' && gesp[0].werte.ratio === stufeJetzt.werte.ratio && gesp[0].werte.ratio === 6 && gesp[0].werte.thresh === -18 && m14 === 'Saved Probe Sound',
    `targets ${JSON.stringify(ziele)}; requests ${von14.length} (${JSON.stringify(von14[0]?.koerper?.ziel)}, keys ${Object.keys(von14[0]?.koerper ?? {})}); the values the server read from the project: ${JSON.stringify(gesp[0]?.werte)} (stage ratio now ${stufeJetzt.werte.ratio}); status line "${m14}"; the stand-in did not write the preset`);
  await b.bild(path.join(ORDNER, 'presets-gespeichert.png'));
  await b.klick('[data-browser-modus="library"]'); await warte(200);

  // ================= 2 the DJ state never changed (AK-B16-9 part 1) =================
  await b.klick('[data-ansicht="dj"]'); await warte(500);
  const dj1 = await djZustand();
  notiere('2 DJ state unchanged after all mode switches and drops (AK-B16-9 part 1)', JSON.stringify({ ...dj0, modusKlassen: '' }) === JSON.stringify({ ...dj1, modusKlassen: '' }) && dj1.modusKlassen === modusKlassenDj && dj1.modusKlassen === '',
    `before ${JSON.stringify(dj0)}; after ${JSON.stringify(dj1)}; no b-* class in the DJ view: ${dj1.modusKlassen === ''}`);
  // in the DJ view the switch is not shown and the DJ library table is the DJ one
  const djSchalter = await w(`getComputedStyle(document.querySelector('#p-browserwahl')).display`);
  notiere('2b Mode switch hidden in the DJ view', djSchalter === 'none', `#p-browserwahl display ${djSchalter}`);
  await b.klick('[data-ansicht="produktion"]'); await warte(600);

  const fk = fehlerKonsole();
  notiere('9 Console', fk.length === 0, `errors/exceptions ${fk.length} (without ${b.konsole.filter(luecke).length} 404 of the stand-in gaps /proj/aufnahme and /proj/bk)${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text + ' ' + (k.url ?? '')).join(' | ')}` : ''}`);
  await b.bild(path.join(ORDNER, 'produktion.png'));
} catch (e) {
  notiere('ABORT', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await at.stoppe();
  await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe b116 browser ${zeit} (instance ${opt.instanz})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · report ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
