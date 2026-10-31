// Browserprobe Paket 1.13 Warp, Slice 3b: der Sample-Editor im Detailbereich gegen den ECHTEN Seiten-Server mit Kern-Attrappe (Prüfstapel, Instanz c (CYPHERDJ_PROBE_INSTANZ), kein Ton,
// kopfloser Chrome über cdp.mjs). AK30: die Gesten erzeugen die richtigen Befehle; hier mit echten Mausereignissen, die die Node-Tests nicht erreichen.
//   E1  Clip mit Karte wählen: Editor sichtbar, Zeichenfeld hat Größe, Marker-Leiste gelb (Pixelprobe), Welle gezeichnet (Pixelprobe), Segment-Anzeige
//   E2  Doppelklick auf eine leere Stelle: ein Marker mehr, beim Server an der Quellzeit unter der Maus, sein Beat liegt zwischen den Nachbarn
//   E3  Ziehen ohne Taste: die Quellzeit wandert (um die Zugweite), der Beat bleibt
//   E4  Ziehen mit Umschalt: die Quellzeit bleibt, der Beat wandert (auf Sechzehntel)
//   E5  Rechtsklick auf einen Marker: Menü mit vier Punkten (Delete Marker frei); „Set 1.1.1 Here“ → dieser Marker hat Beat 0, eins_unsicher false; das Menü ist weg
//   E6  Rechtsklick neben einem Marker: Delete Marker gesperrt; Esc schließt das Menü; ein Klick daneben schließt es auch
//   E7  Doppelklick auf einen Marker löscht ihn; Rechtsklick auf den ersten Marker, „Warp From Here (Straight)“: danach zwei Marker
//   E8  ×2, :2 und SET PROJECT TEMPO im Detailbereich: Länge doppelt/halb, das Projekttempo ändert sich
//   E9  Strg+Rad zoomt hinein (die Seite ändert die Ansicht, sendet nichts)
//   E10 jede Geste war genau EIN Verlaufseintrag
//   E11 Höhe des Editors bei 1280x800 und 2560x1440 gemessen (Zeichenfeld nicht abgeschnitten, nicht unter 72 px), je ein Bild nach ~/messungen/2026-10-30-w3b2/editor-<B>x<H>.png
//   E12 Clip ohne Warp gewählt: ×2, :2 und SET PROJECT TEMPO sind gesperrt, der Editor ist weg; Positivkontrolle: bei dem Clip mit Warp sind sie frei
//   E13 ein Klick auf ×2 und danach Undo (Knopf) bringt den Clip auf den Stand davor zurück (Negativkontrolle: nach ×2 war er anders)
//   E14 Fenster 1600 -> 900 breit, ohne Mausbewegung: die Bitmap des Zeichenfelds folgt der Breite (canvas.width == gemessene Breite)
//   K   keine Ausnahme und kein Fehler in der Konsole
// Aufruf: node pruef/probe_warp_editor.mjs      Exit 0 alle OK, 1 FEHL
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';
import { baueKatalog, ksha } from '../tests/hilfen/katalog.mjs';
import { schreibeKarte } from '../tests/hilfen/karte.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const INSTANZ = process.env.CYPHERDJ_PROBE_INSTANZ ?? 'c';   // Prüfinstanz des Stapels (nie g, h, i); eine laufende Suite auf derselben Instanz sperrt
process.env.CYPHERDJ_TEST_INSTANZ = INSTANZ;
const { baueMediathek } = await import('../tests/hilfen/mediathek.mjs');
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (k, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'w3b-probe-'));
const aufbau = JSON.parse(execFileSync('node', [path.join(HIER, 'w1_aufbau.mjs'), '--ziel', fix], { encoding: 'utf8' }));
const katalog = baueKatalog(path.join(fix, 'kat2'), [
  { n: 4, typ: 'track', werk_id: 2, titel: 'Mit Karte', bpm: 125, dauer_s: aufbau.dauer_s, pfad: path.join(fix, 'klick125.wav') },
]);
const analyse = path.join(fix, 'analyse');
const KARTE = Array.from({ length: 8 }, (_, i) => [Math.round((0.1 + 0.48 * i) * 1e6) / 1e6, i]);   // 125 BPM, Schlag i bei 0,1 + 0,48 i s; Eins bei Karten-Beat 0, unsicher
schreibeKarte(analyse, ksha(4), { karte: KARTE, eins: 0, unsicher: true, dauer_s: aufbau.dauer_s });
const mt = baueMediathek(path.join(fix, 'mt'));
const proj = { wurzel: path.join(fix, 'proj'), arbeitsordner: path.join(fix, 'arr') };
const s = await starteStapel(path.join(fix, 'stapel'), INSTANZ, {}, { serverArgs: ['--katalog', katalog, '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle'), '--analyse', analyse], proj });
const URL = s.url.replace(/\/$/, '');
const b = await starteBrowser();
const w = (x) => b.werte(x);
const api = async (methode, weg, d, kopf = {}) => {
  const r = await fetch(URL + weg, methode === 'GET' ? {} : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(d ?? {}) });
  return { code: r.status, j: await r.json().catch(() => null) };
};
const aktuell = async () => (await api('GET', '/proj/aktuell')).j;
const clipServer = async (id) => (await aktuell()).projekt.spuren.flatMap((x) => x.clips).find((c) => c.id === id);
const eintraege = async () => (await api('GET', '/proj/verlauf')).j.length;
const dom = (sel, was) => w(`(() => { const e = document.querySelector('[data-d="${sel}"]'); return e ? ${was} : null; })()`);
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const ed = (ausdruck) => w(`window.djkProd.editor.${ausdruck}`);
const SHIFT = 8, STRG = 2;
const zeiger = async (art, x, y, extra = {}) => b.maus(art, x, y, extra);
async function doppelklick(x, y) {
  await zeiger('mouseMoved', x, y, { buttons: 0 });
  await zeiger('mousePressed', x, y, { clickCount: 1 }); await zeiger('mouseReleased', x, y, { clickCount: 1 });
  await zeiger('mousePressed', x, y, { clickCount: 2 }); await zeiger('mouseReleased', x, y, { clickCount: 2 });
}
async function ziehen(von, dx, modifiers = 0) {
  await zeiger('mouseMoved', von.x, von.y, { buttons: 0, modifiers });
  await zeiger('mousePressed', von.x, von.y, { modifiers });
  for (let i = 1; i <= 6; i++) await zeiger('mouseMoved', von.x + (dx * i) / 6, von.y, { modifiers });
  await zeiger('mouseReleased', von.x + dx, von.y, { modifiers });
}
async function rechtsklick(p) {
  await zeiger('mouseMoved', p.x, p.y, { buttons: 0 });
  await zeiger('mousePressed', p.x, p.y, { button: 'right', buttons: 2 });
  await zeiger('mouseReleased', p.x, p.y, { button: 'right', buttons: 0 });
}
const menue = () => w(`(() => { const u = document.querySelector('.p-menue'); return u ? [...u.querySelectorAll('button')].map((e) => ({ text: e.textContent, aus: e.disabled })) : null; })()`);
const menuePunkt = (text) => w(`(() => { const e = [...document.querySelectorAll('.p-menue button')].find((x) => x.textContent === ${JSON.stringify(text)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
async function waehle(beat, spur) {
  const f = await w(`(() => { const r = document.querySelector('[data-p="flaeche"]').getBoundingClientRect(); return { l: r.left, t: r.top }; })()`), a = await w('window.djkProd.ansicht');
  const x = f.l + (beat - a.beat0) * a.pxProBeat, y = f.t + spur * 64 + 32;
  await zeiger('mouseMoved', x, y, { buttons: 0 }); await zeiger('mousePressed', x, y); await zeiger('mouseReleased', x, y);
  await warte(300);
}
const marker = async () => (await clipServer('c1')).warp.marker;
const markerBeat = async (beat) => (await marker()).find((m) => Math.abs(m[1] - beat) < 1e-6);

try {
  const neu = await api('POST', '/proj/neu', { name: 'W3b Probe' });
  await warte(1500);
  await api('POST', '/proj/aendern', { rev: (await aktuell()).projekt.rev, label: 'Tempo', befehle: [{ befehl: 'tempo_setzen', bpm: 128 }] });
  await warte(4000);
  const auf = await api('POST', '/proj/aendern', { rev: (await aktuell()).projekt.rev, label: 'Aufbau', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'Karte' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 1, sha256: ksha(4), warp: 'auto' }] });
  if (auf.code !== 200) throw new Error(`Aufbau ${auf.code} ${JSON.stringify(auf.j)}`);
  await b.oeffne(URL);
  await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1200);
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== neu.j.slug; i++) await warte(100);
  await w(`window.djkProd.ansicht = { beat0: 0, pxProBeat: 24 }`);
  await warte(300);
  await waehle(5, 0);

  // E1
  const sichtbar = (await dom('editor', '!e.hidden')) === true;
  const gross = await dom('editorcanvas', 'e.width > 200 && e.height > 60');
  await bisWahr(async () => (await w(`(() => { const c = document.querySelector('[data-d="editorcanvas"]'); const g = c.getContext('2d'); const d = g.getImageData(0, 22, c.width, c.height - 22).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++; return n; })()`)) > 5);
  const pixel = await w(`(() => { const c = document.querySelector('[data-d="editorcanvas"]'), g = c.getContext('2d'), m = window.djkProd.editor.markerFenster(2), r = c.getBoundingClientRect();
    const gelb = g.getImageData(Math.round(m.x - r.left), 2, 1, 1).data; const d = g.getImageData(0, 22, c.width, c.height - 22).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 120) n++;
    return { gelb: [gelb[0], gelb[1], gelb[2]], welle: n }; })()`);
  { const m = await ed('markerFenster(2)'); await zeiger('mouseMoved', m.x + 20, m.y + 40, { buttons: 0 }); await warte(150); }
  const seg = await dom('segment', 'e.textContent');
  const c0 = await clipServer('c1');
  notiere('E1 Editor: sichtbar, Zeichenfeld hat Größe, Marker-Leiste gelb am Marker, Welle gezeichnet, Segment-Anzeige',
    sichtbar && gross && pixel.gelb[0] > 180 && pixel.gelb[1] > 130 && pixel.gelb[2] < 120 && pixel.welle > 5 && /segment/.test(seg) && c0.warp.marker.length === 8,
    `sichtbar ${sichtbar}, Größe ${gross}, Pixel an Marker 2 ${JSON.stringify(pixel.gelb)}, Wellenpixel ${pixel.welle}, Anzeige „${seg}“, Marker ${c0.warp.marker.length}`);

  // E2
  let n0 = await eintraege();
  const leer = await ed('stelleFenster(0.82)');
  await doppelklick(leer.x, leer.y);
  const gesetzt = await bisWahr(async () => (await marker()).length === 9);
  const neuM = (await marker()).find((m) => Math.abs(m[0] - 0.82) < 0.03);
  notiere('E2 Doppelklick leer: ein Marker mehr bei der Quellzeit unter der Maus, Beat dazwischen (Klang unverändert)', gesetzt && neuM && neuM[1] > 1.3 && neuM[1] < 1.7, `Marker ${(await marker()).length}, neuer ${JSON.stringify(neuM)}`);
  const e2 = (await eintraege()) - n0;

  // E3
  n0 = await eintraege();
  const m3 = await ed('markerFenster(3)');
  await ziehen(m3, 10);
  const q3 = await bisWahr(async () => Math.abs((await markerBeat(3))[0] - 1.79) < 0.04);
  notiere('E3 Ziehen ohne Taste: die Quellzeit wandert (+10 px = +0,25 s), der Beat bleibt 3', q3, `Beat 3: ${JSON.stringify(await markerBeat(3))}`);
  const e3 = (await eintraege()) - n0;

  // E4
  n0 = await eintraege();
  const m5 = await ed('markerFenster(5)');
  const quellVorher = (await markerBeat(5))[0];
  await ziehen(m5, 8, SHIFT);
  const b4 = await bisWahr(async () => (await marker()).some((m) => m[1] > 5.3 && m[1] < 5.6 && Math.abs(m[0] - quellVorher) < 1e-6));
  notiere('E4 Ziehen mit Umschalt: die Quellzeit bleibt, der Beat wandert um 0,42 (auf Sechzehntel: 5,4375)', b4, `Marker um 5,4: ${JSON.stringify((await marker()).filter((m) => m[1] > 5.3 && m[1] < 5.6))}`);
  const e4 = (await eintraege()) - n0;

  // E5
  n0 = await eintraege();
  await rechtsklick(await ed('markerFenster(6)'));
  await bisWahr(async () => (await menue()) !== null);
  const punkte = await menue();
  const vier = punkte?.map((p) => p.text).join('|') === 'Warp From Here (Straight)|Warp From Here (Start)|Set 1.1.1 Here|Delete Marker' && punkte.every((p) => p.aus === false);
  const eins = await menuePunkt('Set 1.1.1 Here');
  await zeiger('mouseMoved', eins.x, eins.y, { buttons: 0 }); await zeiger('mousePressed', eins.x, eins.y); await zeiger('mouseReleased', eins.x, eins.y);
  const e5ok = await bisWahr(async () => { const c = await clipServer('c1'); return c.warp.eins_unsicher === false && c.warp.marker.some((m) => Math.abs(m[1]) < 1e-9 && Math.abs(m[0] - 2.98) < 1e-6); });
  await warte(200);
  notiere('E5 Rechtsklick auf Marker 6: vier Punkte, alle frei; „Set 1.1.1 Here“ → der Marker bei 2,98 s hat Beat 0, eins_unsicher false, quelle hand; das Menü ist weg',
    vier && e5ok && (await menue()) === null && (await clipServer('c1')).warp.quelle === 'hand', `Punkte ${JSON.stringify(punkte)}, Server ${JSON.stringify((await clipServer('c1')).warp.marker.find((m) => Math.abs(m[1]) < 1e-9))}, Menü danach ${JSON.stringify(await menue())}`);
  const e5 = (await eintraege()) - n0;

  // E6
  await rechtsklick(await ed('stelleFenster(1.3)'));
  await bisWahr(async () => (await menue()) !== null);
  const m6 = await menue();
  await b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await warte(200);
  const nachEsc = await menue();
  await rechtsklick(await ed('stelleFenster(1.3)'));
  await bisWahr(async () => (await menue()) !== null);
  await zeiger('mouseMoved', 5, 5, { buttons: 0 }); await zeiger('mousePressed', 5, 5); await zeiger('mouseReleased', 5, 5);
  await warte(200);
  notiere('E6 Rechtsklick neben einem Marker: Delete Marker gesperrt, die anderen frei; Esc und ein Klick daneben schließen das Menü',
    m6?.length === 4 && m6[3].aus === true && m6.slice(0, 3).every((p) => p.aus === false) && nachEsc === null && (await menue()) === null, `Menü ${JSON.stringify(m6)}, nach Esc ${JSON.stringify(nachEsc)}, nach Klick daneben ${JSON.stringify(await menue())}`);

  // E7
  const vorher7 = (await marker()).length, erster = (await marker())[0][1];
  n0 = await eintraege();
  const pe = await ed(`markerFenster(${erster})`);
  await doppelklick(pe.x, pe.y);
  const e7b = await bisWahr(async () => (await marker()).length === vorher7 - 1);
  const eDel = (await eintraege()) - n0;
  n0 = await eintraege();
  await rechtsklick(await ed(`markerFenster(${(await marker())[0][1]})`));
  await bisWahr(async () => (await menue()) !== null);
  const gerade = await menuePunkt('Warp From Here (Straight)');
  await zeiger('mouseMoved', gerade.x, gerade.y, { buttons: 0 }); await zeiger('mousePressed', gerade.x, gerade.y); await zeiger('mouseReleased', gerade.x, gerade.y);
  const e7a = await bisWahr(async () => (await marker()).length === 2);
  const e7 = (await eintraege()) - n0;
  notiere('E7 Doppelklick auf einen Marker löscht ihn (ein Eintrag); Warp From Here (Straight) ab dem ersten Marker lässt zwei Marker (ein Eintrag)', e7a && e7b && e7 === 1 && eDel === 1,
    `Marker ${vorher7} → ${vorher7 - 1} → ${(await marker()).length}, Einträge ${eDel} und ${e7}`);

  // E8
  const c8 = await clipServer('c1'), tempo0 = (await aktuell()).projekt.tempo_bpm;
  await b.klick('[data-d="tempo2"]');
  const x2 = await bisWahr(async () => Math.abs((await clipServer('c1')).laenge_beats - 2 * c8.laenge_beats) < 1e-6);
  await b.klick('[data-d="tempohalb"]');
  const x1 = await bisWahr(async () => Math.abs((await clipServer('c1')).laenge_beats - c8.laenge_beats) < 1e-6);
  await b.klick('[data-d="projekttempo"]');
  const pt = await bisWahr(async () => Math.abs((await aktuell()).projekt.tempo_bpm - tempo0) > 0.5, 12000);
  notiere('E8 ×2 verdoppelt die Clip-Länge, :2 halbiert sie, SET PROJECT TEMPO ändert das Projekttempo auf das Tempo des Clips', x2 && x1 && pt && (await aktuell()).projekt.tempo_bpm >= 60 && (await aktuell()).projekt.tempo_bpm <= 200,
    `Länge ${c8.laenge_beats} → ×2 ${x2} → :2 ${x1}; Tempo ${tempo0} → ${(await aktuell()).projekt.tempo_bpm}`);

  // E9
  const p0 = (await ed('ansicht()')).pxProS, n9 = await eintraege();
  const mitte = await ed('stelleFenster(1.5)');
  await b.sende('Input.dispatchMouseEvent', { type: 'mouseWheel', x: mitte.x, y: mitte.y, deltaX: 0, deltaY: -200, modifiers: STRG });
  await warte(300);
  const p1 = (await ed('ansicht()')).pxProS;
  notiere('E9 Strg+Rad zoomt hinein und sendet nichts', p1 > p0 && (await eintraege()) === n9, `Pixel je Sekunde ${p0} → ${p1}, Einträge ${n9} → ${await eintraege()}`);

  notiere('E10 jede Geste (setzen, ziehen, Umschalt-Ziehen, Set 1.1.1, löschen, Straight) war genau EIN Verlaufseintrag', [e2, e3, e4, e5, eDel, e7].every((n) => n === 1), `Einträge je Geste: ${[e2, e3, e4, e5, eDel, e7].join(', ')}`);

  // E11
  const BILDER = process.env.CYPHERDJ_PROBE_BILDER ?? path.join(os.homedir(), 'messungen', '2026-10-30-w3b2');
  fs.mkdirSync(BILDER, { recursive: true });
  const hoehen = [];
  for (const [bw, bh] of [[1280, 800], [2560, 1440]]) {
    await b.sende('Emulation.setDeviceMetricsOverride', { width: bw, height: bh, deviceScaleFactor: 1, mobile: false });
    await warte(800);
    const m = await w(`(() => { const c = document.querySelector('[data-d="editorcanvas"]'), r = c.getBoundingClientRect(), dt = document.querySelector('.p-detail'), dr = dt.getBoundingClientRect();
      return { h: r.height, w: r.width, unten: r.bottom, detailUnten: dr.bottom, detailH: dr.height, scroll: dt.scrollHeight, client: dt.clientHeight, fenster: innerHeight }; })()`);
    await b.bild(path.join(BILDER, `editor-${bw}x${bh}.png`));
    hoehen.push([bw, bh, m]);
  }
  await b.sende('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await warte(500);
  notiere('E11 Editor-Höhe gemessen: das Zeichenfeld ist mindestens 72 px hoch und nicht vom Detailbereich abgeschnitten (scrollHeight <= clientHeight) bei 1280x800 und 2560x1440',
    hoehen.every(([, , m]) => m.h >= 72 && m.unten <= m.detailUnten + 0.5 && m.scroll <= m.client + 1),
    hoehen.map(([bw, bh, m]) => `${bw}x${bh}: Zeichenfeld ${m.w}x${m.h} px, unten ${m.unten}, Detailbereich ${m.detailH} px hoch bis ${m.detailUnten}, scroll ${m.scroll}/${m.client}`).join(' | '));

  // E12
  const mitWarpFrei = await dom('tempo2', '!e.disabled') && await dom('tempohalb', '!e.disabled') && await dom('projekttempo', '!e.disabled');
  const roh = await api('POST', '/proj/aendern', { rev: (await aktuell()).projekt.rev, label: 'Clip ohne Warp', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 24, laenge_beats: 4, sha256: ksha(4) }] });
  if (roh.code !== 200) throw new Error(`Clip ohne Warp ${roh.code} ${JSON.stringify(roh.j)}`);
  const ohne = (await aktuell()).projekt.spuren[0].clips.find((c) => c.id !== 'c1');
  await warte(500);
  await waehle(26, 0);
  const gesperrt = [await dom('tempo2', 'e.disabled'), await dom('tempohalb', 'e.disabled'), await dom('projekttempo', 'e.disabled')];
  const editorWeg = await dom('editor', 'e.hidden');
  notiere('E12 Clip ohne Warp: ×2, :2 und SET PROJECT TEMPO gesperrt, Editor versteckt; Positivkontrolle: beim Clip mit Warp sind alle drei frei',
    mitWarpFrei && gesperrt.every((x) => x === true) && editorWeg === true && !ohne.warp, `Clip ${ohne.id} ohne Warp: gesperrt ${JSON.stringify(gesperrt)}, Editor hidden ${editorWeg}; mit Warp frei ${mitWarpFrei}`);

  // E13
  await waehle(5, 0);
  const vorher13 = JSON.stringify(await clipServer('c1'));
  await b.klick('[data-d="tempo2"]');
  const anders = await bisWahr(async () => JSON.stringify(await clipServer('c1')) !== vorher13);
  const nachX2 = JSON.stringify(await clipServer('c1'));
  await b.klick('[data-p="undo"]');
  const zurueck = await bisWahr(async () => JSON.stringify(await clipServer('c1')) === vorher13);
  notiere('E13 ×2 verändert den Clip, ein Klick auf UNDO bringt genau den Stand davor zurück', anders && nachX2 !== vorher13 && zurueck, `geändert ${anders}, zurück ${zurueck}, Länge vorher ${JSON.parse(vorher13).laenge_beats}, nach ×2 ${JSON.parse(nachX2).laenge_beats}, nach Undo ${(await clipServer('c1')).laenge_beats}`);

  // E14
  const breite = () => w(`(() => { const c = document.querySelector('[data-d="editorcanvas"]'); return { bitmap: c.width, gemessen: Math.round(c.getBoundingClientRect().width) }; })()`);
  await b.sende('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await bisWahr(async () => { const x = await breite(); return x.bitmap === x.gemessen; });
  const b1 = await breite();
  await b.sende('Emulation.setDeviceMetricsOverride', { width: 900, height: 900, deviceScaleFactor: 1, mobile: false });
  const b2ok = await bisWahr(async () => { const x = await breite(); return x.bitmap === x.gemessen; }, 3000);
  const b2 = await breite();
  await b.sende('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  notiere('E14 Fenster 1600 -> 900 breit ohne Mausbewegung: die Bitmap-Breite folgt der gemessenen Breite', b1.bitmap === b1.gemessen && b2ok && b2.bitmap === b2.gemessen && b1.bitmap !== b2.bitmap,
    `1600: Bitmap ${b1.bitmap}, gemessen ${b1.gemessen}; 900: Bitmap ${b2.bitmap}, gemessen ${b2.gemessen}`);
  await b.bild(path.join(HIER, 'ergebnisse', 'probe_warp_editor.png')).catch(() => {});
  const fehlerK = b.konsole.filter((k) => (k.typ === 'exception' || k.typ === 'error') && !(/429/.test(k.text) && /\/welle\?sha=/.test(k.url ?? '')));
  notiere('K Konsole ohne Ausnahme und Fehler', fehlerK.length === 0, fehlerK.length ? JSON.stringify(fehlerK.slice(0, 3)) : 'sauber');
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
process.exit(fehl === 0 ? 0 : 1);
