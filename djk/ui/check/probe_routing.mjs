// Browserprobe Routing (1.10 Slice 1): Gruppe anlegen, Spur einstecken, Gruppen- und Master-Fader, Mute, Undo, Löschen, Spurkopf-Raster.
// Prüfstapel auf einer Prüfinstanz (Kern-Attrappe, Zähl-Relais, Leitstand, echter Seiten-Server) mit der Projekt-Attrappe davor (rechnet
// Gruppen- und Master-Befehle mit dem echten S2-Kern), kopfloser Chrome über cdp.mjs mit echten Mausereignissen. Kein Ton, kein Fenster, kein Betrieb.
// Aufruf: node check/probe_routing.mjs [--instanz e]   Ergebnis: pruef/ergebnisse/<zeit>-routing/bericht.md; Exit 1 bei FEHL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { reglerVonDb, REGLER_MAX } from '../public/production/fader_curve.js';
import { starteStapel } from './stack.mjs';
import { starteBrowser } from './cdp.mjs';
import { starteProjAttrappe, neuesProjekt } from './proj_mock.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: process.env.CYPHERDJ_PROBE_INSTANZ ?? 'e' } } });
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = path.join(HIER, 'ergebnisse', `${zeit}-routing`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnis = { zeit, instanz: opt.instanz, punkte: {} };
const zeilen = [];
const notiere = (k, ok, text) => { ergebnis.punkte[k] = { ok, text }; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const s = await starteStapel(ORDNER, opt.instanz, {}, {});
const at = await starteProjAttrappe({ oben: s.url });
const b = await starteBrowser();
const w = (x) => b.werte(x);
const projekt = () => w('window.djkProd.projekt');
const postA = (weg, d) => fetch(at.url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => r.json());
const gruppenKoepfe = () => w(`document.querySelectorAll('.p-gruppenkopf').length`);
const setzeRegler = (sel, wert, ereignis = 'input') => w(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(String(wert))}; e.dispatchEvent(new Event(${JSON.stringify(ereignis)}, { bubbles: true })); })()`);

async function saat(name, spuren) {
  const p0 = neuesProjekt(name);
  p0.spuren = spuren.map(([id, nr, nm, art, geraet, extra]) => ({ id, nr, name: nm, farbe: '#3b8de0', art: art ?? 'audio', ...(geraet ? { geraet, ...(geraet.art === 'wirt' ? { freeze: null } : {}) } : {}), fader_db: 0, pan: 0, mute: false, solo: false, clips: [], ...(extra ?? {}) }));
  const r = await postA('/attrappe/saat', { projekt: p0 });
  await postA('/attrappe/sse', { a: 'proj', f: { slug: r.slug, rev: 1, label: 'seed', quelle: 'cypher' } });
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== r.slug; i++) await warte(50);
  await warte(200);
}
// Raster des Spurkopfs (Nachzug N3): Breiten per getBoundingClientRect, Überlappung je Paar von Kindern
const rastermessung = (sel) => w(`(() => {
  const k = document.querySelector(${JSON.stringify(sel)}); if (!k) return null;
  const kr = k.getBoundingClientRect();
  const kinder = [...k.children].filter((e) => !e.hidden && getComputedStyle(e).display !== 'none').map((e) => { const r = e.getBoundingClientRect(); return { k: e.className.split(' ')[0], x: r.x, y: r.y, b: r.width, h: r.height }; });
  const ueber = [];
  for (let i = 0; i < kinder.length; i++) for (let j = i + 1; j < kinder.length; j++) {
    const a = kinder[i], c = kinder[j];
    if (a.x < c.x + c.b - 0.5 && c.x < a.x + a.b - 0.5 && a.y < c.y + c.h - 0.5 && c.y < a.y + a.h - 0.5) ueber.push(a.k + '×' + c.k);
  }
  const breite = (n) => kinder.find((e) => e.k === n)?.b ?? null;
  return { kopf: { b: kr.width, h: kr.height }, ueber, fader: breite('p-fader'), ausgang: breite('p-ausgang'), eingang: breite('p-eingang'), freeze: breite('p-freeze'), kinder: kinder.map((e) => e.k) };
})()`);

try {
  await b.oeffne(at.url);
  await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1000);
  await saat('Routing', [['s1', 1, 'Kick'], ['s2', 2, 'Bass'], ['s3', 3, 'Pad'], ['s4', 4, 'Surge', 'instrument', { art: 'wirt', name: 'surge', slot: 1 }]]);
  notiere('R1.1 ohne Gruppe: Block sichtbar, kein Gruppenkopf (Negativ-Kontrolle)', (await w(`document.querySelector('[data-p="mixer"]').hidden`)) === false && (await gruppenKoepfe()) === 0, 'der Block steht, es gibt keinen Gruppenkopf');
  await b.klick('[data-p="neu-gruppe"]'); await warte(600);
  notiere('R1.2 + GROUP legt eine Gruppe an', (await gruppenKoepfe()) === 1 && (await projekt()).gruppen.length === 1 && (await w(`document.querySelector('.p-gruppenkopf .p-spurname').textContent`)) === 'Group 1',
    `Gruppenköpfe ${await gruppenKoepfe()}, Projekt ${JSON.stringify((await projekt()).gruppen.map((g) => g.name))}, Meldung „${await w(`document.querySelector('[data-p="meldung"]').textContent`)}“, Knopf gesperrt ${await w(`document.querySelector('[data-p="neu-gruppe"]').disabled`)}`);
  await setzeRegler('.p-kopf[data-spur="s2"] .p-ausgang', 'g1', 'change'); await warte(600);
  await setzeRegler('.p-kopf[data-spur="s3"] .p-ausgang', 'g1', 'change'); await warte(600);
  const p1 = await projekt();
  notiere('R1.3 Ausgang-Wahl steckt Bass und Pad in die Gruppe (ziel_setzen), Kick bleibt auf Master', p1.spuren[1].ausgang?.id === 'g1' && p1.spuren[2].ausgang?.id === 'g1' && p1.spuren[0].ausgang === undefined
    && (await w(`document.querySelector('.p-kopf[data-spur="s2"] .p-ausgang').value`)) === 'g1',
    `Ziele ${JSON.stringify(p1.spuren.map((s) => s.ausgang?.id ?? 'master'))}`);
  await setzeRegler('.p-gruppenkopf[data-gruppe="g1"] .p-fader', reglerVonDb(-6)); await warte(700);
  notiere('R1.4 Gruppen-Fader landet im Projekt (gruppenspur_aendern)', (await projekt()).gruppen[0].fader_db === -6, `fader_db ${(await projekt()).gruppen[0].fader_db}`);
  await setzeRegler('[data-p="pm-fader"]', reglerVonDb(-3)); await warte(700);
  notiere('R1.5 Master-Fader landet im Projekt (master_aendern)', (await projekt()).master.fader_db === -3, `master.fader_db ${(await projekt()).master.fader_db}`);
  await b.klick('.p-gruppenkopf[data-gruppe="g1"] .p-mute'); await warte(600);
  const m1 = (await projekt()).gruppen[0].mute;
  await b.klick('[data-p="undo"]'); await warte(600);
  notiere('R1.6 Mute der Gruppe, Undo nimmt es zurück', m1 === true && (await projekt()).gruppen[0].mute === false, `Mute ${m1}, nach Undo ${(await projekt()).gruppen[0].mute}`);
  const kanaele = await w(`[...document.querySelectorAll('.meter')].map((m) => m.dataset.kanal).filter(Boolean)`);
  notiere('R1.7 Pegelanzeigen grp/1 und pm vorhanden', kanaele.includes('grp/1') && kanaele.includes('pm') && !kanaele.includes('grp/2'), `Kanäle ${JSON.stringify(kanaele)}`);
  // Raster (N3): Audio-Spur und Surge-Spur (FREEZE) nebeneinander; Ausgang-Wahl mit dem längsten Gruppennamen
  const ra = await rastermessung('.p-kopf[data-spur="s2"]'), ri = await rastermessung('.p-kopf[data-spur="s4"]');
  notiere('R1.10 Raster Audio-Spur: nichts überlappt, Ausgang ≥ 38 px, Fader ≥ 60 px', ra && ra.ueber.length === 0 && ra.ausgang >= 38 && ra.fader >= 60, JSON.stringify(ra));
  notiere('R1.11 Raster Instrument-Spur mit FREEZE: nichts überlappt, Ausgang ≥ 38 px, Fader ≥ 60 px', ri && ri.ueber.length === 0 && ri.ausgang >= 38 && ri.fader >= 60 && ri.freeze > 0, JSON.stringify(ri));
  // R2 (1.10 Slice 2, Task 22): Lampe SET LIMITER. Die Attrappe meldet /zustand/arr selbst (ohne limiter_db), darum hält /attrappe/stumm ihre Meldungen
  // für die Dauer des Punkts zurück: die Lampe folgt dann nur den hier eingespeisten Meldungen.
  const lampe = () => w(`document.querySelector('[data-p="limiter"]').hidden`);
  const sse = (f) => postA('/attrappe/sse', { a: '/zustand/arr', f: { nr: 1, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0, start_beat: 0, metronom_an: 0, limiter_db: -3, ...f } });
  await postA('/attrappe/stumm', { ms: 900 });
  await sse({ limiter_db: 0 }); await warte(100);
  notiere('R2.1 ohne Eingriff ist die Lampe aus (Negativ-Kontrolle)', (await lampe()) === true, 'SET LIMITER versteckt');
  const t0 = Date.now(); await sse({});
  let an = false; for (let i = 0; i < 20 && !an; i++) { an = (await lampe()) === false; if (!an) await warte(20); }
  notiere('R2.2 Eingriff des Limiters: Lampe innerhalb 200 ms', an && Date.now() - t0 < 200, `${an ? 'an' : 'AUS'} nach ${Date.now() - t0} ms`);
  await b.bild(path.join(ORDNER, 'limiter-lampe.png'));
  await sse({ limiter_db: 0 }); await warte(150);
  notiere('R2.3 Limiter ruhig: Lampe geht aus', (await lampe()) === true, 'SET LIMITER versteckt');
  // R2.4: der Kern verstummt (älter als ARR_ALTER_MS): die Lampe darf nicht auf dem letzten Wert stehen bleiben
  await postA('/attrappe/stumm', { ms: 4000 }); await sse({});
  const brannte = (await lampe()) === false;
  let aus = false; for (let i = 0; i < 40 && !aus; i++) { aus = (await lampe()) === true; if (!aus) await warte(50); }
  notiere('R2.4 Kern verstummt: die Lampe erlischt (Zustand unbekannt), sie brannte zuvor', brannte && aus, `brannte ${brannte}, danach ${aus ? 'versteckt' : 'AN'}`);
  await postA('/attrappe/stumm', { ms: 0 }); await warte(700);
  // R2.5: Export-Zeile mit Decke (die Attrappe antwortet wie der Server beim Produktions-Abgriff, P10/P11), danach ein ruhiger Export ohne den Zusatz
  const ausgabeText = () => w(`document.querySelector('[data-p="ausgabe"]').textContent`);
  const ausgabeWarn = () => w(`document.querySelector('[data-p="ausgabe"]').classList.contains('warnung')`);
  const exportiere = async () => { await b.klick('[data-p="export"]'); for (let i = 0; i < 60 && !/^Exported/.test(await ausgabeText()); i++) await warte(100); return ausgabeText(); };
  await postA('/attrappe/ausgabe', { freezeMs: 50, renderMs: 50, spitze_db: 2.4, true_peak_dbtp: 2.6, ueber_decke: true, limiter_db_max: 3.4 });
  const laut = await exportiere(), lautWarn = await ausgabeWarn();
  // sichtbar heißt: nicht abgeschnitten (die Zeile hat sonst max-width 44ch mit Auslassung; der Hinweis stünde im Text, aber nicht auf dem Bildschirm)
  const abgeschnitten = await w(`(() => { const e = document.querySelector('[data-p="ausgabe"]'); return e.scrollWidth > e.clientWidth + 1; })()`);
  await b.bild(path.join(ORDNER, 'export-zeile.png'));
  notiere('R2.5 Export über der Decke: Zeile nennt SET LIMITER CEILING und die Absenkung, Warnfarbe', /ABOVE SET LIMITER CEILING \(set limiter would take 3\.4 dB\)/.test(laut) && lautWarn && !abgeschnitten, `„${laut}“, Warnfarbe ${lautWarn}, abgeschnitten ${abgeschnitten}`);
  await postA('/attrappe/ausgabe', { spitze_db: -4, true_peak_dbtp: -4.2, ueber_decke: false, limiter_db_max: 0 });
  await w(`document.querySelector('[data-p="ausgabe"]').textContent = ''`);
  const leise = await exportiere(), leiseWarn = await ausgabeWarn();
  notiere('R2.6 Export unter der Decke: kein SET-LIMITER-Zusatz, keine Warnfarbe (Negativ-Kontrolle)', /^Exported/.test(leise) && !/SET LIMITER/.test(leise) && !leiseWarn, `„${leise}“, Warnfarbe ${leiseWarn}`);
  await b.bild(path.join(ORDNER, 'routing.png'));
  await b.klick('.p-gruppenkopf[data-gruppe="g1"] .p-loeschen'); await warte(700);
  const p2 = await projekt();
  notiere('R1.8 Gruppe löschen: Mitglieder zurück auf Master, Auswahl zeigt master', p2.gruppen.length === 0 && p2.spuren.every((s) => s.ausgang === undefined)
    && (await w(`document.querySelector('.p-kopf[data-spur="s2"] .p-ausgang').value`)) === 'master', `Gruppen ${p2.gruppen.length}, Ziele ${JSON.stringify(p2.spuren.map((s) => s.ausgang?.id ?? 'master'))}`);

  // ---- 1.10 slice 6 (T3): groups in the arrangement (L1 to L5). A fresh project: Kick, Bass (instrument, one clip), Pad (with an input to arm), Lead.
  const BILDER = process.env.PROBE_BILDER ?? ORDNER;   // screenshots: t3-*.png
  const RB = { art: 'intern', name: 'rb338', parameter: {} };
  const MIDI_CLIP = { id: 'c1', art: 'midi', name: 'Riff', start_beat: 0, laenge_beats: 8, noten: [{ id: 'n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 }] };
  await saat('Gruppen', [['s1', 1, 'Kick'], ['s2', 2, 'Bass', 'instrument', RB, { clips: [MIDI_CLIP] }], ['s3', 3, 'Pad', 'audio', null, { aufnahme: { scharf: false, eingang: { art: 'extern', paar: 1, modus: 'stereo' } } }], ['s4', 4, 'Lead']]);
  const nGr0 = await gruppenKoepfe();
  const strg = (typ, x, y) => b.maus(typ, x, y, { modifiers: 2, buttons: typ === 'mouseReleased' ? 0 : 1 });
  const strgKlick = async (sel) => { const m = await b.mitte(sel); await b.maus('mouseMoved', m.x, m.y, { buttons: 0 }); await strg('mousePressed', m.x, m.y); await strg('mouseReleased', m.x, m.y); };
  const taste = async (key, code, vk, modifiers) => { for (const type of ['rawKeyDown', 'keyUp']) await b.sende('Input.dispatchKeyEvent', { type, modifiers, key, code, windowsVirtualKeyCode: vk }); };
  const flaecheH = () => w(`parseFloat(document.querySelector('[data-p="flaeche"]').style.height)`);
  const zaehle = (sel) => w(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
  const sichtbarZahl = (sel) => w(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((e) => getComputedStyle(e).display !== 'none').length`);
  const links = (sel) => w(`document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().left`);
  const flaecheKlick = async (x, y) => { const f = await w(`(() => { const r = document.querySelector('[data-p="ueber"]').getBoundingClientRect(); return { l: r.left, t: r.top }; })()`); await b.maus('mouseMoved', f.l + x, f.t + y, { buttons: 0 }); await b.maus('mousePressed', f.l + x, f.t + y); await b.maus('mouseReleased', f.l + x, f.t + y); await warte(250); };
  // L0: negative control, Ctrl+G with nothing selected: toast, no request
  const n0 = at.zustand.log.length;
  await taste('g', 'KeyG', 71, 2); await warte(300);
  notiere('L0 Ctrl+G without a selection: the hint, no request, no group', /Select tracks first/.test(await w(`document.querySelector('[data-p="meldung"]').textContent`)) && at.zustand.log.slice(n0).every((e) => e.weg !== '/proj/aendern') && (await projekt()).gruppen.length === 0, 'toast shown, nothing sent');
  // L1: Ctrl+click on three names, Ctrl+G: ONE group with three members, header row, indent
  const hoeheVor = await flaecheH(), x0 = await links('.p-kopf[data-spur="s1"]');
  for (const id of ['s2', 's3', 's4']) { await strgKlick(`.p-kopf[data-spur="${id}"] .p-spurname`); await warte(80); }
  const gewaehlt = await zaehle('.p-kopf.gewaehlt');
  const nL1 = at.zustand.log.length;
  await taste('g', 'KeyG', 71, 2); await warte(700);
  const pL1 = await projekt(), anfragenL1 = at.zustand.log.slice(nL1).filter((e) => e.weg === '/proj/aendern');
  const ind = (await links('.p-kopf[data-spur="s2"]')) - x0;
  notiere('L1 Ctrl+G on three tracks: one gruppenspur_neu, three members, header row, indent 12 px', gewaehlt === 3 && anfragenL1.length === 1 && anfragenL1[0].koerper.befehle.length === 1 && anfragenL1[0].koerper.befehle[0].befehl === 'gruppenspur_neu'
    && pL1.gruppen.length === 1 && pL1.spuren.filter((x) => x.ausgang?.id === 'g1').length === 3 && (await zaehle('.p-arr-gruppe')) === 1 && (await zaehle('.p-kopf--mitglied')) === 3 && Math.abs(ind - 12) < 1.5
    && (await flaecheH()) === hoeheVor + 28 && (await zaehle('.p-kopf.gewaehlt')) === 0,
    `meldung „${await w(`document.querySelector('[data-p="meldung"]').textContent`)}“ body ${JSON.stringify(anfragenL1[0]?.koerper)} antwort ${JSON.stringify(anfragenL1[0]?.antwort ?? anfragenL1[0]?.status)}, selected ${gewaehlt}, requests ${anfragenL1.length}, members ${pL1.spuren.filter((x) => x.ausgang?.id === 'g1').length}, indent ${ind.toFixed(1)} px, height ${hoeheVor} -> ${await flaecheH()}`);
  notiere('L1b the mixer group strips are unchanged: .p-gruppenkopf counts the strip only, the header row is .p-arr-gruppe', (await gruppenKoepfe()) === nGr0 + 1 && (await zaehle('.p-gruppenkopf.p-arr-gruppe')) === 0, `.p-gruppenkopf ${await gruppenKoepfe()} (before ${nGr0}), .p-arr-gruppe ${await zaehle('.p-arr-gruppe')}`);
  await b.bild(path.join(BILDER, 't3-gruppe-1280.png'));
  // L4 positive half: the clip of Bass is hit while the group is open
  await flaecheKlick(60, 64 + 28 + 40);   // Kick 0..64, header 64..92, Bass 92..156
  const treffOffen = JSON.stringify(await w('window.djkProd.auswahl'));
  notiere('L4a clip of a member of an open group is hit (positive control)', treffOffen === '["c1"]', treffOffen);
  const punktVorher = await w(`!document.querySelector('.p-arr-gruppe .p-punkt--arm').hidden || !document.querySelector('.p-arr-gruppe .p-punkt--stumm').hidden`);   // nobody armed or muted yet
  // L2: fold hides the members, unfold brings them back
  const nF = at.zustand.log.length;
  await b.klick('.p-arr-gruppe .p-arr-falte'); await warte(700);
  const pF = await projekt(), hF = await flaecheH();
  const fAnfragen = at.zustand.log.slice(nF).filter((e) => e.weg === '/proj/aendern').flatMap((e) => e.koerper.befehle);
  notiere('L2a fold: members hidden (heads and rows), height = Kick + header, one gruppenspur_aendern gefaltet', pF.gruppen[0].gefaltet === true && (await sichtbarZahl('.p-kopf--mitglied')) === 0 && hF === 64 + 28
    && fAnfragen.length === 1 && fAnfragen[0].befehl === 'gruppenspur_aendern' && fAnfragen[0].gefaltet === true, `gefaltet ${pF.gruppen[0].gefaltet}, sichtbare Mitglieder ${await sichtbarZahl('.p-kopf--mitglied')}, Höhe ${hF}`);
  // L4: the clip of the hidden Bass cannot be hit: the row at its old position now belongs to the next track
  await flaecheKlick(60, 64 + 28 + 20); await flaecheKlick(60, 64 + 28 + 40);
  const treffZu = JSON.stringify(await w('window.djkProd.auswahl'));
  notiere('L4 a clip of a hidden member cannot be hit (Error case)', treffZu === '[]', `Auswahl ${treffZu}`);
  await b.klick('.p-arr-gruppe .p-arr-falte'); await warte(700);
  notiere('L2b unfold brings the members and the height back', (await projekt()).gruppen[0].gefaltet === false && (await sichtbarZahl('.p-kopf--mitglied')) === 3 && (await flaecheH()) === hoeheVor + 28, `sichtbare Mitglieder ${await sichtbarZahl('.p-kopf--mitglied')}, Höhe ${await flaecheH()}`);
  // L3: Pad is armed in the project (the Attrappe core does not know the arm setting, so it is seeded), Bass muted by a click; group, fold: both dots light the folded header
  await saat('Gruppen 3', [['s1', 1, 'Kick'], ['s2', 2, 'Bass'], ['s3', 3, 'Pad', 'audio', null, { aufnahme: { scharf: true, eingang: { art: 'extern', paar: 1, modus: 'stereo' } } }], ['s4', 4, 'Lead']]);
  await b.klick('.p-kopf[data-spur="s2"] .p-mute'); await warte(500);
  for (const id of ['s2', 's3']) { await strgKlick(`.p-kopf[data-spur="${id}"] .p-spurname`); await warte(80); }
  await taste('g', 'KeyG', 71, 2); await warte(700);
  const dot = (k) => w(`!document.querySelector('.p-arr-gruppe .p-punkt--${k}').hidden`);
  const offenDots = [await dot('arm'), await dot('stumm'), await dot('solo')];
  await b.klick('.p-arr-gruppe .p-arr-falte'); await warte(700);
  const zuDots = [await dot('arm'), await dot('stumm'), await dot('solo')];
  notiere('L3 an armed or muted member lights the folded header (dots arm and mute; solo stays dark; nobody armed gave no dot)', punktVorher === false && JSON.stringify(zuDots) === '[true,true,false]' && JSON.stringify(offenDots) === '[true,true,false]'
    && (await w(`document.querySelector('.p-arr-gruppe .p-arr-zahl').textContent`)) === '2 tracks', `before ${punktVorher}, open ${JSON.stringify(offenDots)}, folded ${JSON.stringify(zuDots)}`);
  await b.bild(path.join(BILDER, 't3-gruppe-gefaltet-1280.png'));
  // phone width
  await b.sende('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await warte(400);
  await b.bild(path.join(BILDER, 't3-gruppe-390.png'));
  await b.sende('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await warte(300);
  // L5: a fresh project, Ctrl+G on three tracks, ONE click on UNDO takes the group away
  await saat('Gruppen 2', [['s1', 1, 'Kick'], ['s2', 2, 'Bass'], ['s3', 3, 'Pad'], ['s4', 4, 'Lead']]);
  for (const id of ['s1', 's2', 's3']) { await strgKlick(`.p-kopf[data-spur="${id}"] .p-spurname`); await warte(80); }
  await taste('g', 'KeyG', 71, 2); await warte(700);
  const mitGruppe = (await projekt()).gruppen.length === 1 && (await zaehle('.p-arr-gruppe')) === 1;
  await b.klick('[data-p="undo"]'); await warte(600);
  const pL5 = await projekt();
  notiere('L5 undo of Ctrl+G is one step: no group, no header row, no member head, every track on the master', mitGruppe && pL5.gruppen.length === 0 && (await zaehle('.p-arr-gruppe')) === 0 && (await zaehle('.p-kopf--mitglied')) === 0 && pL5.spuren.every((x) => x.ausgang === undefined),
    `group before undo ${mitGruppe}, after: groups ${pL5.gruppen.length}, header rows ${await zaehle('.p-arr-gruppe')}`);
  await b.bild(path.join(BILDER, 't3-nach-undo-1280.png'));
  // ---- 1.10 slice 6 (T4): the matrix view and the gate (M1 to M8). A fresh project: Kick, Bass, Pad, Lead.
  await saat('Matrix', [['s1', 1, 'Kick'], ['s2', 2, 'Bass'], ['s3', 3, 'Pad'], ['s4', 4, 'Lead']]);
  const scrolle = (sel) => w(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
  const klickM = async (sel) => { await scrolle(sel); await warte(40); await b.klick(sel); };
  const doppelM = async (sel) => { await scrolle(sel); await warte(40); const m = await b.mitte(sel); await b.maus('mouseMoved', m.x, m.y, { buttons: 0 });
    for (const n of [1, 2]) { await b.maus('mousePressed', m.x, m.y, { clickCount: n }); await b.maus('mouseReleased', m.x, m.y, { clickCount: n }); } };
  const aendernN = (ab) => at.zustand.log.slice(ab).filter((e) => e.weg === '/proj/aendern' && e.methode === 'POST');
  const meldung = () => w(`document.querySelector('[data-p="meldung"]').textContent`);
  const bis = async (fn, ms = 4000) => { for (let t = 0; t < ms; t += 50) { if (await fn()) return true; await warte(50); } return false; };
  // M1: Ctrl+G on two tracks makes one group (the matrix gets its column)
  for (const id of ['s2', 's3']) { await strgKlick(`.p-kopf[data-spur="${id}"] .p-spurname`); await warte(80); }
  await taste('g', 'KeyG', 71, 2); await warte(700);
  notiere('M1 Ctrl+G groups two tracks: one group g1 with two members and a header row', (await projekt()).gruppen.length === 1 && (await zaehle('.p-arr-gruppe')) === 1 && (await zaehle('.p-kopf--mitglied')) === 2, `groups ${(await projekt()).gruppen.length}, header rows ${await zaehle('.p-arr-gruppe')}`);
  // M2: fold and unfold
  await b.klick('.p-arr-gruppe .p-arr-falte'); await warte(600);
  const gef = (await projekt()).gruppen[0].gefaltet === true && (await sichtbarZahl('.p-kopf--mitglied')) === 0;
  await b.klick('.p-arr-gruppe .p-arr-falte'); await warte(600);
  notiere('M2 fold hides the members, unfold brings them back', gef && (await projekt()).gruppen[0].gefaltet === false && (await sichtbarZahl('.p-kopf--mitglied')) === 2, `folded ${gef}, after unfold members ${await sichtbarZahl('.p-kopf--mitglied')}`);
  // M3: create a return (two, so the matrix has R1 and R2)
  await scrolle('[data-p="neu-return"]'); await b.klick('[data-p="neu-return"]'); await warte(500); await b.klick('[data-p="neu-return"]'); await warte(600);
  notiere('M3 + Return twice: two returns r1, r2', (await projekt()).returns?.length === 2, `returns ${JSON.stringify((await projekt()).returns?.map((r) => r.id))}`);
  // open the matrix
  await scrolle('[data-p="matrix"] > summary'); await b.klick('[data-p="matrix"] > summary');
  const da = await bis(async () => (await zaehle('.p-mx-zeile')) > 0);
  const kopfTexte = await w(`[...document.querySelectorAll('.p-mx-kopf-ziel, .p-mx-retname')].map((e) => e.textContent)`);
  // M4: send level by double click
  await doppelM('.p-mx-send[data-strang="s1"][data-ret="r1"]'); await warte(400);
  await w(`(() => { const e = document.querySelector('.p-mx-sendfeld'); e.value = '-9'; e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
  const m4 = await bis(async () => (await projekt()).spuren[0].sends?.some((x) => x.id === 'r1' && x.db === -9));
  const m4t = await bis(async () => (await w(`document.querySelector('.p-mx-send[data-strang="s1"][data-ret="r1"]').textContent`)) === '-9.0');
  notiere('M4 double click on a send cell and typing -9 sets the send level, the cell shows it', da && m4 && m4t, `matrix columns ${JSON.stringify(kopfTexte)}, sends ${JSON.stringify((await projekt()).spuren[0].sends)}`);
  // M5: pre/post switch in the return header
  await klickM('.p-mx-pre[data-ret="r1"]');
  const m5 = await bis(async () => (await projekt()).returns[0].pre === true && (await w(`document.querySelector('.p-mx-pre[data-ret="r1"]').textContent`)) === 'PRE');
  notiere('M5 the PRE/POST switch of the return header sets return_aendern pre', m5, `r1.pre ${(await projekt()).returns[0].pre}`);
  // M6: key choice in a compressor: menu with disabled entries and reasons
  await postA('/proj/aendern', { rev: (await projekt()).rev, label: 'probe compressor', befehle: [{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp' }] });
  await bis(async () => (await zaehle('.p-mx-zeile[data-strang="s2"] .p-mx-key')) === 1);
  await klickM('.p-mx-zeile[data-strang="s2"] .p-mx-key');
  const opts = await bis(async () => (await zaehle('.p-mx-keysel option')) > 5);
  const gesperrt = await w(`(() => { const o = document.querySelector('.p-mx-keysel option[value="spur:2:pre"]'); return o ? { disabled: o.disabled, title: o.title } : null; })()`);
  await b.bild(path.join(BILDER, 't4-matrix-schluessel-1280.png'));
  await w(`(() => { const e = document.querySelector('.p-mx-keysel'); e.value = 'spur:1:post'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const m6 = await bis(async () => (await projekt()).spuren[1].inserts?.[0]?.key?.quelle === 'spur');
  notiere('M6 key cell: the menu has the own pre key disabled with a reason, a choice sets the key', opts && gesperrt?.disabled === true && gesperrt.title.length > 0 && m6, `own pre ${JSON.stringify(gesperrt)}, key ${JSON.stringify((await projekt()).spuren[1].inserts?.[0]?.key)}`);
  // M7: the matrix lists every connection; a click changes a target, one undo takes it back
  const pM7 = await projekt();
  const aktive = await w(`[...document.querySelectorAll('.p-mx-zeile.p-mx-spur .p-mx-ziel.aktiv')].map((e) => e.dataset.strang + '>' + e.dataset.ziel)`);
  const erwartet = pM7.spuren.map((x) => `${x.id}>${x.ausgang?.id ?? 'master'}`);
  const sendZellen = await w(`[...document.querySelectorAll('.p-mx-send.an')].map((e) => e.dataset.strang + ':' + e.dataset.ret)`);
  const sendErwartet = [...pM7.spuren, ...(pM7.gruppen ?? [])].flatMap((x) => (x.sends ?? []).map((e) => `${x.id}:${e.id}`));
  const nM7 = at.zustand.log.length;
  await klickM('.p-mx-ziel[data-strang="s1"][data-ziel="g1"]');
  const gesetzt = await bis(async () => (await projekt()).spuren[0].ausgang?.id === 'g1');
  const anf7 = aendernN(nM7);
  await klickM('[data-p="undo"]');
  const zurueck = await bis(async () => (await projekt()).spuren[0].ausgang === undefined);
  notiere('M7 the matrix lists every connection (targets and sends); a target click is one request, one undo takes it back',
    JSON.stringify(aktive) === JSON.stringify(erwartet) && JSON.stringify(sendZellen.sort()) === JSON.stringify(sendErwartet.sort()) && gesetzt && anf7.length === 1 && zurueck,
    `active ${JSON.stringify(aktive)} (expected ${JSON.stringify(erwartet)}), sends ${JSON.stringify(sendZellen)} (expected ${JSON.stringify(sendErwartet)}), requests ${anf7.length}, undone ${zurueck}`);
  // M8: a cycle (group to itself) is refused with a text and no request
  const nM8 = at.zustand.log.length;
  const grau = await w(`document.querySelector('.p-mx-ziel[data-strang="g1"][data-ziel="g1"]').classList.contains('gesperrt')`);
  await klickM('.p-mx-ziel[data-strang="g1"][data-ziel="g1"]'); await warte(500);
  notiere('M8 a group clicked onto itself is refused: greyed, text, no request', grau && aendernN(nM8).length === 0 && /itself/.test(await meldung()), `greyed ${grau}, requests ${aendernN(nM8).length}, text "${await meldung()}"`);
  // UI English
  const uiText = await w(`(() => { const e = document.querySelector('[data-p="matrix"]'); return [e.textContent, ...[...e.querySelectorAll('[title],[aria-label]')].map((x) => (x.title || '') + ' ' + (x.getAttribute('aria-label') || ''))].join(' | '); })()`);
  notiere('M9 every string of the matrix is English', !/[äöüÄÖÜß]|\b(Spur|Gruppe|Schlüssel|Wahl|nicht|Fehler|Ausgang)\b/.test(uiText) && uiText.length > 50, `${uiText.length} characters checked`);
  await scrolle('[data-p="matrix"] > summary'); await warte(200);
  await b.bild(path.join(BILDER, 't4-matrix-1280.png'));
  await b.sende('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false }); await warte(400);
  await scrolle('[data-p="matrix"] > summary'); await warte(200);
  await b.bild(path.join(BILDER, 't4-matrix-390.png'));
  const seitlich = await w(`document.documentElement.scrollWidth - document.documentElement.clientWidth`);
  await b.sende('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await warte(300);
  notiere('M10 phone width 390: the matrix scrolls inside its own box (the page gets no sideways scroll beyond what it had)', seitlich <= 1 || seitlich === 0, `page overflow ${seitlich} px`);
  const fk = b.konsole.filter((k) => k.typ === 'exception' || (k.typ === 'error' && !/Failed to load resource/.test(k.text)));
  notiere('R1.9 Konsole', fk.length === 0, `Fehler/Exceptions ${fk.length}${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text).join(' | ')}` : ''}`);
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await at.stoppe();
  await s.stoppe();
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe Routing ${zeit} (Instanz ${opt.instanz})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
