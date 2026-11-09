// Browser probe for the lane row of PRODUCTION (Automation Slice 1, task 10, AK28). Same stack as probe_production.mjs (kernel dummy, relay, page server,
// project dummy), headless Chrome through cdp.mjs with real mouse and key events. No sound, no window, nothing of the live system.
//   node check/probe_lanes.mjs [--instanz e] [--grundlinie] [--ausgabe <folder>]
// --grundlinie: only capture the closed state (for the tree BEFORE this slice: it has no A button). The captured canvas pixels are written as
// <folder>/geschlossen-*.rgba; check/probe_lanes_diff.py compares two folders.
// Slice 2 (task 6): target choice (+ Lane), pan gesture sends one auto_punkte, lock sends auto_aendern and a locked lane sends nothing.
// Checks (new tree): rows without an open lane are the old fixed grid (head tops, surface height), A button opens a row of 48 px, a click in a lane row never
// hits a clip, exactly ONE auto_punkte request per gesture (nothing while the pointer moves), Del and double click delete, "+ Lane" creates the lane only on
// choosing a target, the open state survives a reload from the server, closing gives the pixels of the closed state again.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stack.mjs';
import { starteBrowser } from './cdp.mjs';
import { starteProjAttrappe, neuesProjekt } from './proj_mock.mjs';
import { baueKatalog } from '../tests/support/catalog.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: 'e' }, grundlinie: { type: 'boolean', default: false }, ausgabe: { type: 'string' } } });
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const { baueMediathek } = await import('../tests/support/media_library.mjs');
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe) : path.join(HIER, 'ergebnisse', `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-lanen`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (k, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const SHA = { kick: 'a'.repeat(64) };
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-lanen-'));
const daten = path.join(fix, 'data'); fs.mkdirSync(daten);
const kickWav = path.join(daten, 'kick.wav');
execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'sine=f=80:d=0.5,volume=0.9', '-ar', '44100', kickWav]);
const mt = baueMediathek(path.join(fix, 'mt'));
baueKatalog(fix, [{ typ: 'oneshot', sha: SHA.kick, shas: SHA.kick, name: 'Kick 1', instrument: 'kick', pack: 'Probe', dauer_s: 0.5, pfad: kickWav }]);

const s = await starteStapel(ORDNER, opt.instanz, {}, { serverArgs: ['--katalog', path.join(fix, 'katalog.sqlite'), '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle')] });
const at = await starteProjAttrappe({ oben: s.url, dekodierMs: 300 });
const URL = at.url;
const b = await starteBrowser();
const w = (x) => b.werte(x);
const log = () => at.zustand.log;
const aenderungen = (n0) => log().slice(n0).filter((e) => e.weg === '/proj/aendern');
const befehlsNamen = (n0) => aenderungen(n0).flatMap((e) => e.koerper.befehle.map((x) => x.befehl));
const rect = (sel) => w(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; })()`);
const projekt = () => w('window.djkProd.projekt');
const flaecheH = () => w(`parseFloat(document.querySelector('[data-p="flaeche"]').style.height)`);
const AUSFALL = /^Failed to load resource: (net::ERR_INCOMPLETE_CHUNKED_ENCODING|net::ERR_EMPTY_RESPONSE|the server responded with a status of (503|409|404))/;   // 404: two resources missing in the stack without a catalog entry, present in the tree before this slice as well (baseline run)
const fehlerKonsole = () => b.konsole.filter((k) => (k.typ === 'exception' || k.typ === 'error') && !AUSFALL.test(k.text));

const saat = (mitLane) => {
  const p = neuesProjekt('Lanes');
  p.spuren.push({ id: 's90', nr: 1, name: 'Kick', farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false,
    clips: [{ id: 'c91', art: 'audio', name: 'kick', start_beat: 0, laenge_beats: 4, quelle: { sha256: SHA.kick, pfad_hinweis: '' }, dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }] });
  p.spuren.push({ id: 's92', nr: 2, name: 'Bass', farbe: '#3b8de0', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} }, fader_db: 0, pan: 0, mute: false, solo: false,
    clips: [{ id: 'c93', art: 'midi', name: 'bassline', start_beat: 0, laenge_beats: 4, noten: [{ id: 'n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 }] }],
    ...(mitLane ? { automation: [{ id: 'a7', ziel: 'fader', punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: -12 }, { beat: 16, wert: -12 }] }] } : {}) });
  p.spuren.push({ id: 's94', nr: 3, name: 'Pad', farbe: '#9b59d0', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
  return p;
};
const seed = async (p) => {
  const r = await (await fetch(URL + 'attrappe/saat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projekt: p }) })).json();
  await fetch(URL + 'attrappe/sse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'proj', f: { slug: r.slug, rev: 1, label: 'seed', quelle: 'cypher' } }) });
  return r;
};
const pixel = async (sel) => w(`(() => { const c = document.querySelector(${JSON.stringify(sel)}); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
  let bin = ''; const u = d.data; for (let i = 0; i < u.length; i += 4096) bin += String.fromCharCode(...u.subarray(i, i + 4096)); return { w: c.width, h: c.height, b64: btoa(bin) }; })()`);
const schreibe = async (name) => {
  for (const [datei, sel] of [['spuren', '[data-p="spuren"]'], ['lineal', '[data-p="lineal"]']]) {
    const px = await pixel(sel);
    fs.writeFileSync(path.join(ORDNER, `${name}-${datei}.rgba`), Buffer.from(px.b64, 'base64'));
    fs.writeFileSync(path.join(ORDNER, `${name}-${datei}.json`), JSON.stringify({ w: px.w, h: px.h }));
  }
};
const koepfeLage = () => w(`(() => { const k = document.querySelector('[data-p="koepfe"]'); const t0 = k.getBoundingClientRect().top;
  return [...k.children].map((e) => ({ klasse: e.className, t: Math.round((e.getBoundingClientRect().top - t0) * 100) / 100, h: Math.round(e.getBoundingClientRect().height * 100) / 100 })); })()`);

try {
  await b.oeffne(URL);
  await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1000);
  await seed(saat(false)); await warte(1500);
  if (!(await projekt())) { await w(`(() => { const sel = document.querySelector('[data-p="oeffnen"]'); sel.dispatchEvent(new Event('focus')); })()`); await warte(300); }
  const p0 = await projekt();
  notiere('0 Aufbau', !!p0 && p0.spuren.length === 3, `${p0?.spuren.length} tracks`);

  // ---------- closed state: the old fixed grid ----------
  const lage0 = await koepfeLage();
  const hoehe0 = (await flaecheH());
  notiere('1 closed: head tops are i*64, surface height n*64', lage0.length === 3 && lage0.every((e, i) => e.t === i * 64 && e.h === 64) && hoehe0 === 192,
    `heads ${JSON.stringify(lage0.map((e) => [e.t, e.h]))}, surface ${hoehe0} px`);
  await warte(300);
  await schreibe('geschlossen');
  if (opt.grundlinie) {
    const fk = fehlerKonsole();
    notiere('9 console', fk.length === 0, `${fk.length} errors: ${fk.map((k) => k.text).join(' | ').slice(0, 300)}`);
  } else {
    const hatKnopf = await w(`document.querySelectorAll('.p-kopf .p-lane').length`);
    notiere('2 A button on every track head', hatKnopf === 3, `${hatKnopf} buttons; title "${await w(`document.querySelector('.p-lane').title`)}"`);
    const titelOk = (await w(`document.querySelector('.p-lane').title`)) === 'Show automation lanes of this track';
    notiere('2b A button title is English', titelOk, 'Show automation lanes of this track');

    // ---------- open the row under track 2 (index 1): no lane yet ----------
    let n = log().length;
    await b.klick('.p-kopf[data-spur="s92"] .p-lane'); await warte(300);
    const lage1 = await koepfeLage();
    const hoehe1 = (await flaecheH());
    notiere('3 open row: +48 px, tracks below move by 48, nothing sent', hoehe1 === 240 && lage1.length === 4 && lage1[2].klasse.includes('p-lanenkopf') && lage1[2].h === 48 && lage1[3].t === 176
      && befehlsNamen(n).length === 0, `surface ${hoehe1}, heads ${JSON.stringify(lage1.map((e) => [e.klasse.split(' ')[0], e.t, e.h]))}, requests ${befehlsNamen(n).length}`);
    const neuSichtbar = await w(`!document.querySelector('.p-lanenkopf .p-lane-neu').hidden && document.querySelector('.p-lanenkopf .p-lane-weg').hidden`);
    const optionen = await w(`[...document.querySelectorAll('.p-lanenkopf .p-lane-neu option')].map((o) => o.value)`);
    notiere('4 "+ Lane" offers the free targets (all eight on an RB-338 track), lane NOT created by opening the row', neuSichtbar && !(await projekt()).spuren[1].automation
      && JSON.stringify(optionen) === JSON.stringify(['', 'fader', 'pan', 'mute', 'solo', 'geraet.lautstaerke', 'geraet.cutoff', 'geraet.resonanz', 'geraet.env_mod']), JSON.stringify(optionen));

    // a click in the empty lane row changes nothing and never hits the clip above
    const f = await rect('[data-p="flaeche"]');
    const a = await w('window.djkProd.ansicht');
    const xB = (beat) => f.l + (beat - a.beat0) * a.pxProBeat;
    const yZeile = (zeileT, db) => f.t + zeileT + 3 + (1 - (Math.min(6, Math.max(-60, db)) + 60) / 66) * 42;
    n = log().length;
    await b.maus('mouseMoved', xB(1), f.t + 128 + 20, { buttons: 0 }); await b.maus('mousePressed', xB(1), f.t + 128 + 20); await b.maus('mouseReleased', xB(1), f.t + 128 + 20); await warte(300);
    notiere('5 click in a lane row without lane: no request, no clip selected', befehlsNamen(n).length === 0 && (await w('window.djkProd.auswahl.length')) === 0, `requests ${befehlsNamen(n).length}`);
    // the clip of track 2 sits at y 64..128 and is still hit there
    await b.maus('mouseMoved', xB(1), f.t + 64 + 40, { buttons: 0 }); await b.maus('mousePressed', xB(1), f.t + 64 + 40); await b.maus('mouseReleased', xB(1), f.t + 64 + 40); await warte(300);
    notiere('5b the clip row above is still hit', JSON.stringify(await w('window.djkProd.auswahl')) === '["c93"]', JSON.stringify(await w('window.djkProd.auswahl')));

    // ---------- "+ Lane" creates the lane when a target is chosen ----------
    const waehleZiel = (sel, wert) => w(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); s.value = ${JSON.stringify(wert)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    n = log().length;
    await waehleZiel('.p-lanenkopf .p-lane-neu', 'fader'); await warte(900);
    const namen = befehlsNamen(n);
    const pl = await projekt();
    notiere('6 "+ Lane" > Volume: exactly one auto_neu, lane arrives, row stays open', JSON.stringify(namen) === '["auto_neu"]' && pl.spuren[1].automation?.length === 1 && (await flaecheH()) === 240,
      `commands ${JSON.stringify(namen)}, points ${JSON.stringify(pl.spuren[1].automation?.[0]?.punkte)}, message "${await w(`document.querySelector('[data-p=\"meldung\"]').textContent`)}", ziel ${pl.spuren[1].automation?.[0]?.ziel}`);
    notiere('6b AUTO in front of the fader value', (await w(`getComputedStyle(document.querySelector('.p-kopf[data-spur="s92"] .p-faderwert'), '::before').content`)) === '"AUTO "', 'content "AUTO "');
    await b.klick('.p-kopf[data-spur="s92"] .p-lane'); await warte(200);   // close again
    n = log().length;
    await b.klick('.p-kopf[data-spur="s92"] .p-lane'); await warte(300);

    // ---------- gestures on the seeded lane (points at beat 0, 8, 16) ----------
    // The lane of the first creation has points at the loop bounds 0 and 32 (value 0). Delete it, then seed a project with a known lane.
    await b.klick('.p-lanenkopf .p-lane-weg'); await warte(700);
    notiere('6c delete button: one auto_loeschen, lane gone', JSON.stringify(befehlsNamen(n)) === '["auto_loeschen"]' && !(await projekt()).spuren[1].automation, JSON.stringify(befehlsNamen(n)));
    await seed(saat(true)); await warte(1500);
    await w(`1`);
    const geoeffnet = await w(`document.querySelector('.p-lanenkopf') !== null`);
    notiere('7 the open state survives a reload of the project from the server', geoeffnet && (await flaecheH()) === 240, `lane head present ${geoeffnet}`);

    const f2 = await rect('[data-p="flaeche"]');
    const a2 = await w('window.djkProd.ansicht');
    const xb = (beat) => f2.l + (beat - a2.beat0) * a2.pxProBeat;
    const laneT = 128;   // lane row of track 2 starts at 2 * 64 ... = 64 (track 1) + 64 (track 2) = 128
    const yv = (db) => f2.t + laneT + 3 + (1 - (Math.min(6, Math.max(-60, db)) + 60) / 66) * 42;
    // click on a free place: ONE auto_punkte
    n = log().length;
    await b.maus('mouseMoved', xb(12), yv(-30), { buttons: 0 }); await b.maus('mousePressed', xb(12), yv(-30)); await b.maus('mouseReleased', xb(12), yv(-30)); await warte(700);
    let an = aenderungen(n);
    notiere('8 click on a free place: exactly one auto_punkte with one point', an.length === 1 && an[0].koerper.befehle.length === 1 && an[0].koerper.befehle[0].befehl === 'auto_punkte'
      && an[0].koerper.befehle[0].setze?.length === 1, JSON.stringify(an.map((e) => e.koerper)));
    notiere('8b the label is English', an[0]?.koerper.label === 'Edit automation line', an[0]?.koerper.label);
    const pk = (await projekt()).spuren[1].automation[0].punkte;
    notiere('8c the lane now holds four points, sorted', pk.length === 4 && pk.every((q, i) => i === 0 || q.beat >= pk[i - 1].beat), JSON.stringify(pk) + ` message "${await w(`document.querySelector('[data-p=\\"meldung\\"]').textContent`)}"`);
    // drag the point at beat 8: nothing is sent while moving, one command on release
    n = log().length;
    await b.maus('mouseMoved', xb(8), yv(-12), { buttons: 0 }); await b.maus('mousePressed', xb(8), yv(-12));
    for (let i = 1; i <= 8; i++) await b.maus('mouseMoved', xb(8) + 5 * i, yv(-12) - 2 * i);
    await warte(300);
    const waehrend = aenderungen(n).length;
    await b.maus('mouseReleased', xb(8) + 40, yv(-12) - 16); await warte(700);
    an = aenderungen(n);
    notiere('9 drag: nothing sent while moving, exactly one auto_punkte on release', waehrend === 0 && an.length === 1 && an[0].koerper.befehle.length === 1
      && an[0].koerper.befehle[0].befehl === 'auto_punkte', `while moving ${waehrend}, after release ${an.length}`);
    // a twitch below 3 px changes nothing
    const pk2 = (await projekt()).spuren[1].automation[0].punkte;
    const p8 = pk2[1];
    n = log().length;
    await b.maus('mouseMoved', xb(p8.beat), yv(p8.wert), { buttons: 0 }); await b.maus('mousePressed', xb(p8.beat), yv(p8.wert));
    await b.maus('mouseMoved', xb(p8.beat) + 2, yv(p8.wert)); await b.maus('mouseReleased', xb(p8.beat) + 2, yv(p8.wert)); await warte(400);
    notiere('10 twitch of 2 px: no request', aenderungen(n).length === 0, `${aenderungen(n).length} requests`);
    // Del on the selected point (the click above selected it): one auto_punkte with loesche_von
    n = log().length;
    await b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 }); await warte(700);
    an = aenderungen(n);
    notiere('11 Del deletes the selected point: one auto_punkte with loesche_von', an.length === 1 && an[0].koerper.befehle[0].befehl === 'auto_punkte' && an[0].koerper.befehle[0].loesche_von !== undefined,
      JSON.stringify(an.map((e) => e.koerper.befehle)));
    // double click on a point deletes it
    const pk3 = (await projekt()).spuren[1].automation[0].punkte;
    const ziel = pk3[pk3.length - 1];
    n = log().length;
    await b.maus('mouseMoved', xb(ziel.beat), yv(ziel.wert), { buttons: 0 });
    await b.maus('mousePressed', xb(ziel.beat), yv(ziel.wert)); await b.maus('mouseReleased', xb(ziel.beat), yv(ziel.wert));
    await b.maus('mousePressed', xb(ziel.beat), yv(ziel.wert), { clickCount: 2 }); await b.maus('mouseReleased', xb(ziel.beat), yv(ziel.wert), { clickCount: 2 }); await warte(700);
    const nach = (await projekt()).spuren[1].automation[0].punkte;
    notiere('12 double click deletes a point', nach.length === pk3.length - 1, `${pk3.length} -> ${nach.length} points; commands ${JSON.stringify(befehlsNamen(n))}`);

    // ---------- D11: while playing, the fader value of a track with a lane shows the lane value at the playhead ----------
    const textVor = await w(`document.querySelector('.p-kopf[data-spur="s92"] .p-faderwert').textContent`);
    await b.klick('[data-p="play"]'); await warte(900);
    const textSpiel = await w(`document.querySelector('.p-kopf[data-spur="s92"] .p-faderwert').textContent`);
    const textKick = await w(`document.querySelector('.p-kopf[data-spur="s90"] .p-faderwert').textContent`);
    await b.klick('[data-p="stopp"]'); await warte(600);
    const textNach = await w(`document.querySelector('.p-kopf[data-spur="s92"] .p-faderwert').textContent`);
    notiere('12b playing: the track with a lane shows the lane value, a track without a lane keeps its base value, stop writes the base value back',
      textSpiel !== textVor && textKick === textVor && textNach === textVor, `before "${textVor}", playing "${textSpiel}", other track "${textKick}", after stop "${textNach}"`);

    // ---------- Slice 2: pan lane (bipolar), lock ----------
    n = log().length;
    await waehleZiel('.p-lanenkopf .p-lane-neu', 'pan'); await warte(900);
    const pn = (await projekt()).spuren[1];
    const panLane = pn.automation?.find((l) => l.ziel === 'pan');
    notiere('14 "+ Lane" > Pan: exactly one auto_neu for pan, the row shows the pan lane', JSON.stringify(befehlsNamen(n)) === '["auto_neu"]' && !!panLane
      && (await w(`document.querySelector('.p-lanenkopf .p-lanenwahl').value`)) === 'pan', `commands ${JSON.stringify(befehlsNamen(n))}, lanes ${JSON.stringify(pn.automation?.map((l) => l.ziel))}`);
    const optionen2 = await w(`[...document.querySelectorAll('.p-lanenkopf .p-lane-neu option')].map((o) => o.value)`);
    notiere('14b pan is no longer offered (no target twice)', !optionen2.includes('pan') && !optionen2.includes('fader'), JSON.stringify(optionen2));
    const f3 = await rect('[data-p="flaeche"]');
    const a3 = await w('window.djkProd.ansicht');
    const xp = (beat) => f3.l + (beat - a3.beat0) * a3.pxProBeat;
    const yp = (v) => f3.t + laneT + 3 + (1 - (Math.min(1, Math.max(-1, v)) + 1) / 2) * 42;
    n = log().length;
    await b.maus('mouseMoved', xp(12), yp(0.5), { buttons: 0 }); await b.maus('mousePressed', xp(12), yp(0.5)); await b.maus('mouseReleased', xp(12), yp(0.5)); await warte(700);
    an = aenderungen(n);
    const pk4 = (await projekt()).spuren[1].automation.find((l) => l.ziel === 'pan').punkte;
    const neuPunkt = pk4.find((q) => q.beat === 12);
    notiere('15 click on the pan lane: exactly one auto_punkte for the pan lane, the value is a pan value', an.length === 1 && an[0].koerper.befehle.length === 1 && an[0].koerper.befehle[0].befehl === 'auto_punkte'
      && an[0].koerper.befehle[0].lane_id === panLane.id && !!neuPunkt && Math.abs(neuPunkt.wert - 0.5) < 0.05, `${an.length} requests, point ${JSON.stringify(neuPunkt)}`);
    const zuvorGesperrt = !!(await projekt()).spuren[1].automation.find((l) => l.ziel === 'pan').gesperrt;
    n = log().length;
    await b.klick('.p-lanenkopf .p-lane-sperre'); await warte(900);
    an = aenderungen(n);
    const gesperrtLage = (await projekt()).spuren[1].automation.find((l) => l.ziel === 'pan');
    notiere('16 lock button: exactly one auto_aendern with gesperrt true, the lane arrives locked', !zuvorGesperrt && an.length === 1 && JSON.stringify(an[0].koerper.befehle) === JSON.stringify([{ befehl: 'auto_aendern', lane_id: panLane.id, gesperrt: true }])
      && gesperrtLage.gesperrt === true, `${JSON.stringify(an.map((e) => e.koerper.befehle))}, lane gesperrt ${gesperrtLage?.gesperrt}`);
    // locked: a click, a drag and Del send nothing
    n = log().length;
    await b.maus('mouseMoved', xp(14), yp(-0.5), { buttons: 0 }); await b.maus('mousePressed', xp(14), yp(-0.5)); await b.maus('mouseReleased', xp(14), yp(-0.5)); await warte(400);
    await b.maus('mouseMoved', xp(12), yp(0.5), { buttons: 0 }); await b.maus('mousePressed', xp(12), yp(0.5));
    for (let i = 1; i <= 6; i++) await b.maus('mouseMoved', xp(12) + 6 * i, yp(0.5) + 3 * i);
    await b.maus('mouseReleased', xp(12) + 36, yp(0.5) + 18); await warte(500);
    await b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
    await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 }); await warte(500);
    // the clip c93 is still selected from 5b: Del on a locked lane is not ours and goes on to the clip handling (clip_loeschen), which is not a lane change
    const fremd = befehlsNamen(n).filter((x) => !x.startsWith('auto_')), laneBefehle = befehlsNamen(n).filter((x) => x.startsWith('auto_'));
    notiere('17 locked lane: click, drag and Del send no lane command, the hint is shown', laneBefehle.length === 0
      && (await w(`document.querySelector('[data-p="meldung"]').textContent`)).includes('locked'), `lane commands ${laneBefehle.length}, other ${JSON.stringify(fremd)}, message "${await w(`document.querySelector('[data-p="meldung"]').textContent`)}"`);
    // the unlocked control: unlock sends gesperrt false, then the same click sends again
    n = log().length;
    await b.klick('.p-lanenkopf .p-lane-sperre'); await warte(900);
    const entsperrt = !(await projekt()).spuren[1].automation.find((l) => l.ziel === 'pan').gesperrt && JSON.stringify(aenderungen(n).flatMap((e) => e.koerper.befehle.map((x) => x.gesperrt))) === '[false]';
    n = log().length;
    await b.maus('mouseMoved', xp(14), yp(-0.5), { buttons: 0 }); await b.maus('mousePressed', xp(14), yp(-0.5)); await b.maus('mouseReleased', xp(14), yp(-0.5)); await warte(700);
    notiere('18 unlock: auto_aendern gesperrt false, and the click sends one auto_punkte again', entsperrt && aenderungen(n).length === 1 && aenderungen(n)[0].koerper.befehle[0].befehl === 'auto_punkte', `${entsperrt}, ${aenderungen(n).length} requests`);

    // fix round 1: two quick clicks on the lock (before the first answer) lock and then unlock: both commands are computed at send time
    n = log().length;
    await b.klick('.p-lanenkopf .p-lane-sperre'); await b.klick('.p-lanenkopf .p-lane-sperre'); await warte(1200);
    const sperren = aenderungen(n).flatMap((e) => e.koerper.befehle.filter((x) => x.befehl === 'auto_aendern').map((x) => x.gesperrt));
    notiere('19 two quick clicks on the lock: true then false (not true twice), the lane ends unlocked', JSON.stringify(sperren) === '[true,false]' && !(await projekt()).spuren[1].automation.find((l) => l.ziel === 'pan').gesperrt,
      `commands ${JSON.stringify(sperren)}, gesperrt ${(await projekt()).spuren[1].automation.find((l) => l.ziel === 'pan').gesperrt}`);
    await b.bild(path.join(ORDNER, 'lanen-offen.png'));
    // ---------- close the row: the pixels of the closed state again ----------
    await b.klick('.p-kopf[data-spur="s92"] .p-lane'); await warte(400);
    const lage2 = await koepfeLage();
    notiere('13 closed again: head tops are i*64', lage2.length === 3 && lage2.every((e, i) => e.t === i * 64 && e.h === 64) && (await flaecheH()) === 192, JSON.stringify(lage2.map((e) => [e.t, e.h])));
    const fk = fehlerKonsole();
    notiere('99 console', fk.length === 0, `${fk.length} errors${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text).join(' | ')}` : ''}`);
    await b.bild(path.join(ORDNER, 'lanen.png'));
  }
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await at.stoppe();
  await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe lanes (instance ${opt.instanz}${opt.grundlinie ? ', baseline' : ''})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALL OK' : `${fehl} FAIL`} · report ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
