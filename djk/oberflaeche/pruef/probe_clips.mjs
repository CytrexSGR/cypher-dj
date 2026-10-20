// Browserprobe Clips, Piano-Roll, FREEZE und EXPORT (D1 V2). Prüfstapel auf einer Prüfinstanz (Kern-Attrappe, Zähl-Relais,
// Leitstand, echter Seiten-Server mit Test-Katalog), davor die Projekt-Attrappe (pruef/proj_attrappe.mjs: Clip- und Notenbefehle
// über den echten S2-Kern, Freeze/Export simuliert), kopfloser Chrome über cdp.mjs mit echten Maus- und Tastenereignissen.
// Kein Ton, kein Fenster, kein Betrieb. Jede Teilprobe sät ihr eigenes Projekt.
// Aufruf: node pruef/probe_clips.mjs [--instanz i] [--teil 6]   (Teil n prüft die Slices 1..n)
// Ergebnis: pruef/ergebnisse/<zeit>-clips/bericht.md und ergebnis.json; Exit 1, wenn ein Punkt FEHL ist.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';
import { starteProjAttrappe, neuesProjekt } from './proj_attrappe.mjs';
import { baueKatalog } from '../tests/hilfen/katalog.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: process.env.CYPHERDJ_PROBE_INSTANZ ?? 'i' }, teil: { type: 'string', default: '6' } } });
const TEIL = Number(opt.teil);
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;   // wie probe_produktion.mjs: die Mediathek-Hilfe sperrt sonst Instanz h
const { baueMediathek } = await import('../tests/hilfen/mediathek.mjs');
const d0 = new Date();
const zwei = (n) => String(n).padStart(2, '0');
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = path.join(HIER, 'ergebnisse', `${zeit}-clips`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnis = { zeit, instanz: opt.instanz, teil: TEIL, punkte: {} };
const zeilen = [];
const notiere = (k, ok, text) => { ergebnis.punkte[k] = { ok, text }; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

// ---------- Test-Katalog: ein Kick (0,5 s) ----------
const SHA = 'a'.repeat(64);
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-clips-'));
const kickWav = path.join(fix, 'kick.wav');
execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'sine=f=80:d=0.5,volume=0.9', '-ar', '44100', kickWav]);
const mt = baueMediathek(path.join(fix, 'mt'));
baueKatalog(fix, [{ typ: 'oneshot', sha: SHA, shas: SHA, name: 'Kick 1', instrument: 'kick', pack: 'Probe', dauer_s: 0.5, pfad: kickWav }]);

const s = await starteStapel(ORDNER, opt.instanz, {}, { serverArgs: ['--katalog', path.join(fix, 'katalog.sqlite'), '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle')] });
const at = await starteProjAttrappe({ oben: s.url, dekodierMs: 100, freezeMs: 1500, renderMs: 700 });
const URL = at.url;
const b = await starteBrowser();
const w = (x) => b.werte(x);
const log = () => at.zustand.log;
const aenderungen = (n0) => log().slice(n0).filter((e) => e.weg === '/proj/aendern');
const rect = (sel) => w(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; })()`);
const fehlerKonsole = () => b.konsole.filter((k) => k.typ === 'exception' || k.typ === 'error');
const gewollt = new Set();   // Konsolenzeilen der absichtlich provozierten Ablehnungen (6.5), gezählt und ausgenommen
const projekt = () => w('window.djkProd.projekt');
const clip = async (id) => (await projekt()).spuren.flatMap((x) => x.clips.map((c) => ({ ...c, spur: x.id }))).find((c) => c.id === id);
const postA = (weg, d, kopf = {}) => fetch(URL + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(d) }).then((r) => r.json());
const maus = (type, x, y, extra = {}) => b.maus(type, x, y, extra);
// Ziehen von (x0, y0) nach (x1, y1) in Schritten; mitte() läuft vor dem Loslassen (Zustand während des Zugs)
async function zieh(x0, y0, x1, y1, { schritte = 8, mod = 0, mitte } = {}) {
  await maus('mouseMoved', x0, y0, { buttons: 0, modifiers: mod });
  await maus('mousePressed', x0, y0, { modifiers: mod });
  for (let i = 1; i <= schritte; i++) await maus('mouseMoved', x0 + ((x1 - x0) * i) / schritte, y0 + ((y1 - y0) * i) / schritte, { modifiers: mod });
  const m = mitte ? await mitte() : null;
  await maus('mouseReleased', x1, y1, { modifiers: mod });
  return m;
}
const klick = async (x, y, mod = 0) => { await maus('mouseMoved', x, y, { buttons: 0, modifiers: mod }); await maus('mousePressed', x, y, { modifiers: mod }); await maus('mouseReleased', x, y, { modifiers: mod }); };
async function doppel(x, y) {
  await maus('mouseMoved', x, y, { buttons: 0 });
  for (const n of [1, 2]) { await maus('mousePressed', x, y, { clickCount: n }); await maus('mouseReleased', x, y, { clickCount: n }); }
}
const VK = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Escape: 27, Enter: 13 };
async function taste(key, mod = 0) {
  const code = VK[key] ? key : `Key${key.toUpperCase()}`, vk = VK[key] ?? key.toUpperCase().charCodeAt(0);
  await b.sende('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers: mod, windowsVirtualKeyCode: vk });
  await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers: mod, windowsVirtualKeyCode: vk });
}
const tippe = async (text) => { for (const c of text) await b.sende('Input.dispatchKeyEvent', { type: 'char', text: c }); };
const STRG = 2, UMSCHALT = 8;
// Seiten-Koordinate: Beat in Spur i, dy Pixel unter der Oberkante der Spurzeile (Namenszeile 1..14, Mitte 32)
async function xy(beat, spur, dy = 32) {
  const f = await rect('[data-p="flaeche"]'), a = await w('window.djkProd.ansicht');
  return { x: f.l + (beat - a.beat0) * a.pxProBeat, y: f.t + spur * 64 + dy };
}
// Seiten-Koordinate in der Piano-Roll: Clip-Beat, Ton (Mitte der Zeile)
async function rollXY(beat, ton) {
  const r = await rect('[data-r="roll"]'), a = await w('window.djkProd.rolle.ansicht');
  return { x: r.l + 40 + (beat - a.beat0) * a.pxProBeat, y: r.t + (a.tonOben - ton) * 9 + 4 };
}
// helle Pixel (R, G, B > 200) der Überlagerung in einem Rechteck der Spurfläche: Auswahlrahmen und Fade-Linien
// Trennstriche der Loop-Kacheln (Spec 6.17) in Spurzeile i: helle Spalten-Läufe der Überlagerung auf einer Zeile im Clip-Körper
const trenner = (i) => w(`(() => { const c = document.querySelector('[data-p="ueber"]'); const d = c.getContext('2d').getImageData(0, ${i * 64 + 48}, c.width, 1).data; let n = 0, vor = false; for (let x = 0; x < c.width; x++) { const k = x * 4, an = d[k] > 200 && d[k + 1] > 200 && d[k + 2] > 200 && d[k + 3] > 150; if (an && !vor) n++; vor = an; } return n; })()`);
const hell = (x, y, bw, bh) => w(`(() => { const c = document.querySelector('[data-p="ueber"]'); const d = c.getContext('2d').getImageData(${Math.round(x)}, ${Math.round(y)}, ${Math.round(bw)}, ${Math.round(bh)}).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200 && d[i + 3] > 200) n++; return n; })()`);

// Saat: zwei Audio-Spuren, RB-338 mit einem MIDI-Clip, Surge (Wirt-Slot 1) mit Noten; gültig nach S2 (pruefeProjekt)
function saat(name) {
  const p = neuesProjekt(name);
  const spur = (id, nr, nm, farbe, art, extra, clips) => ({ id, nr, name: nm, farbe, art, ...extra, fader_db: 0, pan: 0, mute: false, solo: false, clips });
  const audio = (id, start, laenge, extra = {}) => ({ id, art: 'audio', name: 'kick', start_beat: start, laenge_beats: laenge, quelle: { sha256: SHA, pfad_hinweis: '' },
    dekodiert: 'fertig', offset_s: 0.25, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0, ...extra });
  p.spuren.push(spur('s1', 1, 'Kick', '#e0563b', 'audio', {}, [audio('c1', 4, 4)]));
  p.spuren.push(spur('s2', 2, 'Snare', '#e0a33e', 'audio', {}, []));
  p.spuren.push(spur('s3', 3, 'Bass', '#3b8de0', 'instrument', { geraet: { art: 'intern', name: 'rb338', parameter: {} } }, [{ id: 'c2', art: 'midi', name: 'bassline', start_beat: 8, laenge_beats: 4,
    noten: [{ id: 'n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 }, { id: 'n2', beat: 1, laenge: 1, ton: 38, vel: 90 }, { id: 'n3', beat: 2.1, laenge: 0.5, ton: 43, vel: 80 }] }]));
  p.spuren.push(spur('s4', 4, 'Lead', '#9b59d0', 'instrument', { geraet: { art: 'wirt', name: 'surge', slot: 1 }, freeze: null }, [{ id: 'c3', art: 'midi', name: 'lead', start_beat: 0, laenge_beats: 8,
    noten: [{ id: 'n1', beat: 0, laenge: 1, ton: 60, vel: 100 }] }]));
  return p;
}
// Cypher ändert während eines Zugs (V2 Fix F2): Änderung über die Attrappe mit Quelle cypher, warten, bis die Seite den neuen Stand hat
async function fremdWaehrend(label, befehle) {
  const rev = (await projekt()).rev;
  const r = await postA('/proj/aendern', { rev, label, befehle }, { 'x-djk-quelle': 'cypher' });
  for (let i = 0; i < 40 && (await projekt()).rev !== r.rev; i++) await warte(50);
  return r.rev;
}
// V2 Fix-Runde 2 H1 (Spec 6.34): fetch-Haken der Seite, der jede Antwort von /proj/aendern um ms zurückhält (der Server hat sie schon
// angenommen); 0 schaltet ihn ab. So steht eine eigene Änderung „unterwegs“, während die Person weiter bedient.
const verzoegere = (ms) => w(`(() => { if (!window.__fz) { window.__fz = window.fetch.bind(window); window.fetch = async (u, o) => { const r = await window.__fz(u, o); const d = window.__verzug ?? 0; if (d && String(u).includes('/proj/aendern')) await new Promise((ok) => setTimeout(ok, d)); return r; }; } window.__verzug = ${ms}; return true; })()`);
// V2 Fix-Runde 2 H5/H7: Haken in der Seite, die nächste Anfrage auf weg antwortet roh (status, JSON-Körper oder leer), nie beim Server
const rohSeite = (weg, status, koerper) => w(`(() => { if (!window.__f0) { window.__f0 = window.fetch.bind(window); window.fetch = async (u, o) => { const h = window.__roh; if (h && String(u).endsWith(h.weg)) { window.__roh = null; return new Response(h.body, { status: h.status, headers: h.body ? { 'content-type': 'application/json' } : {} }); } return window.__f0(u, o); }; } window.__roh = ${JSON.stringify({ weg, status, body: koerper === null ? null : JSON.stringify(koerper) })}; return true; })()`);
async function seed(name, aendere = null) {
  const p0 = saat(name);
  aendere?.(p0);
  const r = await postA('/attrappe/saat', { projekt: p0 });
  await postA('/attrappe/sse', { a: 'proj', f: { slug: r.slug, rev: 1, label: 'seed', quelle: 'cypher' } });
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== r.slug; i++) await warte(50);
  await w(`window.djkProd.ansicht = { beat0: 0, pxProBeat: 24 }`);
  await warte(200);
  return r.slug;
}

try {
  await b.oeffne(URL);
  await warte(1500);
  await w(`localStorage.setItem('djk-prod-raster', 'beat')`);
  await b.klick('[data-ansicht="produktion"]'); await warte(1000);

  // ================= Teil 1: Clip wählen und verschieben (A2), ein Zug = eine Änderung =================
  if (TEIL >= 1) {
    await seed('Teil 1');
    const c = await xy(5, 0);
    await klick(c.x, c.y); await warte(200);
    const wahl = await w('window.djkProd.auswahl');
    const startNach = await w('window.djkProd.start');
    const k = await rect('[data-p="flaeche"]');
    const rahmen = await hell(4 * 24, 1, 4 * 24, 62);
    await klick(k.l + 20 * 24, c.y); await warte(200);
    const rahmenWeg = await hell(4 * 24, 1, 4 * 24, 62);
    notiere('1.1 Clip wählen', JSON.stringify(wahl) === '["c1"]' && startNach === 5 && rahmen > 100 && rahmenWeg === 0 && (await w('window.djkProd.auswahl.length')) === 0,
      `Auswahl ${JSON.stringify(wahl)}, Startmarke ${startNach} (Klick in den Clip setzt sie wie in Ableton); Rahmen-Pixel ${rahmen}, nach Klick ins Leere ${rahmenWeg} (Negativ-Kontrolle), Auswahl danach ${await w('window.djkProd.auswahl.length')}`);
    const n0 = log().length;
    const mitte = await zieh(c.x, c.y, c.x + 2.3 * 24, c.y, { mitte: async () => ({ anfragen: aenderungen(n0).length, entwurf: await w(`window.djkProd.projektEntwurf?.spuren[0].clips[0].start_beat`), server: (await clip('c1')).start_beat }) });
    await warte(400);
    const a1 = aenderungen(n0);
    notiere('1.2 Verschieben gerastet, ein Zug eine Änderung', mitte.anfragen === 0 && mitte.entwurf === 6 && mitte.server === 4 && a1.length === 1 && a1[0].koerper.label === 'Move clip'
      && JSON.stringify(a1[0].koerper.befehle) === '[{"befehl":"clip_aendern","clip_id":"c1","start_beat":6}]' && (await clip('c1')).start_beat === 6 && (await w('window.djkProd.projektEntwurf')) === null,
      `während des Zugs: Anfragen ${mitte.anfragen}, Entwurf start ${mitte.entwurf}, Server ${mitte.server}; danach ${a1.length} Anfrage „${a1[0]?.koerper.label}“ ${JSON.stringify(a1[0]?.koerper.befehle)}, Clip start ${(await clip('c1')).start_beat}`);
    const c2 = await xy(7, 0);
    const n1 = log().length;
    await zieh(c2.x, c2.y, c2.x, c2.y + 64); await warte(400);
    const auf2 = await clip('c1');
    const n2 = log().length;
    const c3 = await xy(7, 1);
    await zieh(c3.x, c3.y, c3.x, c3.y + 64); await warte(400);
    notiere('1.3 Spurwechsel nur bei passender Art', auf2.spur === 's2' && aenderungen(n1).length === 1 && aenderungen(n2).length === 0 && (await clip('c1')).spur === 's2',
      `Audio-Clip auf Snare: Spur ${auf2.spur} (${aenderungen(n1).length} Anfrage); weiter auf Bass (Instrument): ${aenderungen(n2).length} Anfragen, Clip bleibt auf ${(await clip('c1')).spur}`);
    const vorUndo = (await (await fetch(URL + 'proj/verlauf')).json()).length;
    await taste('z', STRG); await warte(400);
    const u = await clip('c1');
    notiere('1.4 Undo nimmt den ganzen Zug zurück', u.spur === 's1' && u.start_beat === 6 && vorUndo === 2,
      `Verlauf vor Undo ${vorUndo} Einträge (Saat ohne Eintrag, Move, Move auf Snare); nach Strg+Z: Spur ${u.spur}, start ${u.start_beat}`);
    const cA = await xy(7, 0), cB = await xy(9, 2);
    await klick(cA.x, cA.y); await klick(cB.x, cB.y, UMSCHALT); await warte(150);
    const zwei = await w('window.djkProd.auswahl');
    const n3 = log().length;
    await zieh(cA.x, cA.y, cA.x + 24, cA.y); await warte(400);
    const a3 = aenderungen(n3);
    notiere('1.5 Mehrere Clips', JSON.stringify(zwei) === '["c1","c2"]' && a3.length === 1 && a3[0].koerper.label === 'Move 2 clips' && (await clip('c1')).start_beat === 7 && (await clip('c2')).start_beat === 9,
      `Auswahl ${JSON.stringify(zwei)}; Zug: ${a3.length} Anfrage „${a3[0]?.koerper.label}“, c1 ${(await clip('c1')).start_beat}, c2 ${(await clip('c2')).start_beat}`);
  }

  // 1.6 (V2 Fix F1, Spec 6.34): der Entwurf ist nur Anzeige. Antwort des Servers 800 ms verzögert (fetch-Haken der Seite); Clip c1 um 2 Beats
  // ziehen, vor der Antwort auf den Clip klicken (ein neuer Zug ohne Ziehen), danach verschiebt Cypher c1 auf 12: die Anzeige folgt dem Server.
  // Negativ-Kontrolle: derselbe Ablauf ohne Zwischenklick.
  if (TEIL >= 1) {
    const ablauf = async (name, zwischenklick) => {
      await seed(name);
      await w(`(() => { if (!window.__f) window.__f = window.fetch; window.fetch = (u, o) => (o?.method === 'POST' && String(u).includes('/proj/aendern') ? new Promise((r) => setTimeout(r, 800)).then(() => window.__f(u, o)) : window.__f(u, o)); })()`);
      const ent = () => w(`window.djkProd.projektEntwurf?.spuren.flatMap((s) => s.clips).find((c) => c.id === 'c1')?.start_beat ?? null`);
      const zustand = async () => ({ entwurf: await ent(), server: (await clip('c1')).start_beat, rev: (await projekt()).rev });
      const c = await xy(5, 0);
      await zieh(c.x, c.y, c.x + 2 * 24, c.y);
      if (zwischenklick) await klick(c.x + 2 * 24, c.y);
      const direkt = await zustand();
      await warte(1200);
      const nachAntwort = await zustand();
      const fremd = await postA('/proj/aendern', { rev: nachAntwort.rev, label: 'Cypher moves the clip', befehle: [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 12 }] }, { 'x-djk-quelle': 'cypher' });
      await warte(600);
      const nachFremd = await zustand();
      await w(`window.fetch = window.__f`);
      return { direkt, nachAntwort, fremd: fremd.rev, nachFremd };
    };
    const ohne = await ablauf('Teil 1 Entwurf ohne', false), mit = await ablauf('Teil 1 Entwurf mit', true);
    const folgt = (x) => x.nachAntwort.entwurf === null && x.nachAntwort.server === 6 && x.nachFremd.entwurf === null && x.nachFremd.server === 12;
    notiere('1.6 Entwurf nur Anzeige: Klick vor der Antwort, dann fremde Änderung', folgt(mit) && folgt(ohne) && mit.direkt.entwurf === null,
      `mit Zwischenklick: direkt Entwurf ${mit.direkt.entwurf}/Server ${mit.direkt.server}, nach der Antwort ${mit.nachAntwort.entwurf}/${mit.nachAntwort.server}, nach Cyphers Änderung ${mit.nachFremd.entwurf}/${mit.nachFremd.server}; `
      + `ohne (Negativ-Kontrolle): direkt ${ohne.direkt.entwurf}/${ohne.direkt.server}, nach der Antwort ${ohne.nachAntwort.entwurf}/${ohne.nachAntwort.server}, danach ${ohne.nachFremd.entwurf}/${ohne.nachFremd.server}`);
  }

  // 1.7 (V2 Fix F7, Spec 6.34): pointercancel und Esc verwerfen den Entwurf, ohne zu senden; das Loslassen danach schickt nichts
  if (TEIL >= 1) {
    const fall = [];
    for (const [name, abbrechen] of [['pointercancel', () => w(`document.querySelector('[data-p="ueber"]').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))`)], ['Esc', () => taste('Escape')]]) {
      await seed(`Teil 1 Abbruch ${name}`);
      const c = await xy(5, 0), n0 = log().length;
      const m = await zieh(c.x, c.y, c.x + 2 * 24, c.y, { mitte: async () => { const vor = await w(`window.djkProd.projektEntwurf?.spuren[0].clips[0].start_beat ?? null`); await abbrechen(); await warte(50); return { vor, nach: await w('window.djkProd.projektEntwurf') }; } });
      await warte(400);
      fall.push({ name, vor: m.vor, nach: m.nach, anfragen: aenderungen(n0).length, start: (await clip('c1')).start_beat });
    }
    notiere('1.7 pointercancel und Esc verwerfen den Zug ohne Senden', fall.every((x) => x.vor === 6 && x.nach === null && x.anfragen === 0 && x.start === 4),
      fall.map((x) => `${x.name}: Entwurf ${x.vor} → ${x.nach}, Anfragen ${x.anfragen}, Clip start ${x.start}`).join('; '));
  }

  // ================= Teil 2: Kürzen, Fades, Teilen, Duplizieren, Löschen (A2) =================
  if (TEIL >= 2) {
    await seed('Teil 2');
    const startVor = await w('window.djkProd.start');
    const re = await xy(8, 0);
    let n0 = log().length;
    await zieh(re.x - 2, re.y, re.x - 2 - 1.4 * 24, re.y); await warte(400);
    const r1 = await clip('c1');
    notiere('2.1 Rechts kürzen', r1.laenge_beats === 3 && aenderungen(n0).length === 1 && aenderungen(n0)[0].koerper.label === 'Trim clip' && (await w('window.djkProd.start')) === startVor,
      `Länge ${r1.laenge_beats} (Ende 8 − 1,4 gerastet auf 7); Startmarke unverändert ${await w('window.djkProd.start')} (Griff, preventDefault)`);
    const li = await xy(4, 0);
    n0 = log().length;
    await zieh(li.x + 2, li.y, li.x + 2 - 2 * 24, li.y); await warte(400);
    const l1 = await clip('c1');
    await zieh(li.x - 0.5 * 24 + 2, li.y, li.x - 0.5 * 24 + 2 + 1.2 * 24, li.y); await warte(400);
    const l2 = await clip('c1');
    notiere('2.2 Links kürzen mit offset_s', l1.start_beat === 3.5 && l1.laenge_beats === 3.5 && l1.offset_s === 0 && l2.start_beat === 5 && l2.laenge_beats === 2 && l2.offset_s === 0.75 && aenderungen(n0).length === 2,
      `nach links −2: start ${l1.start_beat}, Länge ${l1.laenge_beats}, offset ${l1.offset_s} (Quelle beginnt 0,25 s = 0,5 Beat früher: weiter geht es nicht); dann +1,2: start ${l2.start_beat}, Länge ${l2.laenge_beats}, offset ${l2.offset_s}`);
    const fe = await xy(5, 0, 6);
    const vorFade = await hell(5 * 24 + 2, 16, 22, 46);
    n0 = log().length;
    await zieh(fe.x + 2, fe.y, fe.x + 2 + 24, fe.y); await warte(400);
    const f1 = await clip('c1');
    const nachFade = await hell(5 * 24 + 2, 16, 22, 46);
    notiere('2.3 Einblende ziehen', f1.fade_ein_beats === 1 && aenderungen(n0)[0]?.koerper.label === 'Fade in' && nachFade > vorFade + 10,
      `fade_ein ${f1.fade_ein_beats} Beat; helle Pixel der Fade-Linie im ersten Beat ${vorFade} → ${nachFade}`);
    const innen = await xy(6.2, 0);
    await klick(innen.x, innen.y); await warte(150);
    n0 = log().length;
    await taste('e', STRG); await warte(400);
    const p1 = await projekt();
    const teile = p1.spuren[0].clips.map((c) => [c.id, c.start_beat, c.laenge_beats]);
    const wahlT = await w('window.djkProd.auswahl');
    notiere('2.4 Teilen an der Startmarke (Strg+E)', JSON.stringify(teile) === '[["c1",5,1],["c4",6,1]]' && JSON.stringify(wahlT) === '["c4"]' && aenderungen(n0)[0]?.koerper.label === 'Split clip',
      `Clips ${JSON.stringify(teile)}; Auswahl danach ${JSON.stringify(wahlT)}`);
    n0 = log().length;
    await taste('d', STRG); await warte(400);
    const p2 = await projekt();
    const dup = p2.spuren[0].clips.map((c) => [c.id, c.start_beat]);
    notiere('2.5 Duplizieren (Strg+D)', JSON.stringify(dup) === '[["c1",5],["c4",6],["c5",7]]' && JSON.stringify(await w('window.djkProd.auswahl')) === '["c5"]' && aenderungen(n0).length === 1,
      `Clips ${JSON.stringify(dup)}; Auswahl ${JSON.stringify(await w('window.djkProd.auswahl'))}`);
    n0 = log().length;
    await w(`document.activeElement?.blur()`);
    await taste('Delete'); await warte(300);
    const ohneFokus = aenderungen(n0).length;
    const c3 = await xy(7.5, 0);
    // 2.6b (V2 Fix F6): Löschen wartet auf die Antwort; abgelehnt (409 beschaeftigt während eines Freeze-Durchlaufs) bleibt die Auswahl
    await postA('/attrappe/lauf', { art: 'freeze' });
    const kL = fehlerKonsole().length, nL = log().length;
    await klick(c3.x, c3.y); await taste('Delete'); await warte(400);
    const abgelehnt = { anfragen: aenderungen(nL).length, auswahl: await w('window.djkProd.auswahl'), clips: (await projekt()).spuren[0].clips.length, meldung: await w(`document.querySelector('[data-p="meldung"]').textContent`) };
    await postA('/attrappe/lauf', { art: null });
    for (const k of fehlerKonsole().slice(kL)) gewollt.add(k);
    notiere('2.6b Löschen abgelehnt: Auswahl bleibt', abgelehnt.anfragen === 1 && JSON.stringify(abgelehnt.auswahl) === '["c5"]' && abgelehnt.clips === 3 && abgelehnt.meldung === 'A freeze is running; changes to the playback wait until it is done',   // H7: Text des Servers
      `Entf während eines Freeze: ${abgelehnt.anfragen} Anfrage, 409 beschaeftigt „${abgelehnt.meldung}“; Auswahl ${JSON.stringify(abgelehnt.auswahl)}, Clips ${abgelehnt.clips}`);
    await taste('Delete'); await warte(400);
    notiere('2.6 Löschen (Entf) nur mit Fokus auf der Spurfläche', ohneFokus === 0 && (await projekt()).spuren[0].clips.length === 2 && (await w('window.djkProd.auswahl.length')) === 0,
      `Entf ohne Fokus: ${ohneFokus} Anfragen (Negativ-Kontrolle); mit Fokus: Clips ${(await projekt()).spuren[0].clips.length}`);
    const ml = await xy(8, 2);
    n0 = log().length;
    await zieh(ml.x + 2, ml.y, ml.x + 2 + 24, ml.y); await warte(400);
    const m = await clip('c2');
    const ma = aenderungen(n0)[0]?.koerper.befehle.map((x) => x.befehl);
    notiere('2.7 MIDI-Clip links kürzen: Noten bleiben an ihrer Stelle', m.start_beat === 9 && JSON.stringify(m.noten.map((n) => [n.id, n.beat])) === '[["n2",0],["n3",1.1]]' && JSON.stringify(ma) === '["clip_aendern","noten_loeschen","noten_aendern"]',
      `start ${m.start_beat}, Noten ${JSON.stringify(m.noten.map((n) => [n.id, n.beat]))} (n1 endete vor dem neuen Anfang); eine Anfrage ${JSON.stringify(ma)}`);
    // 2.8 Clip-Loop (Spec 6.17, A1-Kick): ein Kick-Clip von 1 Beat, Loop an (Strg+L), die rechte Kante auf 32 Beats gezogen: 32 Kacheln mit
    // Trennstrich, EIN Clip im Projekt. Teilen (Strg+E) lehnt die Seite selbst ab (S2: argument_ungueltig), keine Anfrage.
    await seed('Teil 2 Loop', (p) => { Object.assign(p.spuren[0].clips[0], { start_beat: 0, laenge_beats: 1, offset_s: 0 }); });
    const ohne = await trenner(0);
    const k0 = await xy(0.5, 0);
    await klick(k0.x, k0.y); await warte(150);
    n0 = log().length;
    await taste('l', STRG); await warte(400);
    const an = await clip('c1');
    const kante = await xy(1, 0);
    await zieh(kante.x - 2, kante.y, kante.x - 2 + 31 * 24, kante.y); await warte(400);
    const lang = await clip('c1'), labels = aenderungen(n0).map((e) => e.koerper.label);
    const frei = await xy(40, 1);
    await klick(frei.x, frei.y); await warte(200);                                       // abwählen: kein Auswahlrahmen über den Strichen
    const striche = await trenner(0), aufSpur = (await projekt()).spuren[0].clips.length;
    const imLoop = await xy(5.3, 0);
    await klick(imLoop.x, imLoop.y); await warte(150);
    const nT = log().length;
    await taste('e', STRG); await warte(300);
    const tMeld = await w(`document.querySelector('[data-p="meldung"]').textContent`), tAnfr = aenderungen(nT).length;
    notiere('2.8 Clip-Loop (A1-Kick): 32 Kacheln, ein Clip', an.loop_beats === 1 && lang.laenge_beats === 32 && lang.loop_beats === 1 && aufSpur === 1 && striche === 31 && ohne === 0
      && JSON.stringify(labels) === '["Loop on","Trim clip"]' && tAnfr === 0 && tMeld === 'Loop clip: turn the loop off before splitting',
      `Loop an: loop_beats ${an.loop_beats}; rechte Kante gezogen: Länge ${lang.laenge_beats}, loop_beats ${lang.loop_beats}, Clips auf der Spur ${aufSpur}; Trennstriche ${striche} (= ${striche + 1} Kacheln; ohne Loop ${ohne}); Anfragen ${JSON.stringify(labels)}; Strg+E: ${tAnfr} Anfragen, „${tMeld}“`);
    // 2.9 (V2 Fix F5): keine stille Grenze der Kacheln. MIDI-Loop 1/16 Beat auf 1024 Beats (16384 Durchläufe; MIDI rollt Noten aus, nicht Clips,
    // also innerhalb der Grenzen aus 3.2), Ansicht bei Beat 1010 mit 10 px je Kachel: Trennstriche bis an den rechten Rand der Fläche.
    await seed('Teil 2 Kacheln', (p) => { Object.assign(p.spuren[2].clips[0], { start_beat: 0, laenge_beats: 1024, loop_beats: 1 / 16, noten: [{ id: 'n1', beat: 0, laenge: 0.05, ton: 36, vel: 100 }] }); });
    await w(`window.djkProd.ansicht = { beat0: 1010, pxProBeat: 160 }`); await warte(300);
    const lagen = await w(`(() => { const c = document.querySelector('[data-p="ueber"]'); const d = c.getContext('2d').getImageData(0, 2 * 64 + 48, c.width, 1).data; const xs = []; let vor = false; for (let x = 0; x < c.width; x++) { const k = x * 4, an = d[k] > 200 && d[k + 1] > 200 && d[k + 2] > 200 && d[k + 3] > 150; if (an && !vor) xs.push(x); vor = an; } return { xs, breite: c.width }; })()`);
    const erwartet = Math.ceil((lagen.breite / 160) * 16 - 1e-9);   // Kachelanfänge in [1010, 1010 + Breite/160), 16 je Beat
    const letzter = lagen.xs.at(-1) ?? -1;
    notiere('2.9 Kacheln bis zum Ende des sichtbaren Bereichs (Loop 1/16 auf 1024 Beats)', Math.abs(lagen.xs.length - erwartet) <= 1 && letzter >= lagen.breite - 11,
      `Fläche ${lagen.breite} px bei Beat 1010 (160 px je Beat): Trennstriche ${lagen.xs.length} (erwartet ${erwartet}), letzter bei x ${letzter}`);
    await w(`window.djkProd.ansicht = { beat0: 0, pxProBeat: 24 }`);
    // 2.10 (V2 Fix F2, Spec 6.34): ein Zug wird beim Loslassen aus dem aktuellen Stand berechnet und mit dessen rev geschickt. Linken Rand des
    // MIDI-Clips c2 (Start 8) um 2 Beats ziehen; währenddessen setzt Cypher n9 auf Clip-Beat 3 (Projekt-Beat 11). Danach liegt n9 auf 11, n3 auf 10.
    await seed('Teil 2 Basis', (p) => { p.spuren[2].clips[0].noten[2].beat = 2; });
    const rl = await xy(8, 2), nB = log().length;
    let fremdRev = null;
    await zieh(rl.x + 2, rl.y, rl.x + 2 + 2 * 24, rl.y, { mitte: async () => { fremdRev = await fremdWaehrend('Cypher adds a note', [{ befehl: 'noten_neu', clip_id: 'c2', noten: [{ id: 'n9', beat: 3, laenge: 0.5, ton: 48, vel: 100 }] }]); } });
    await warte(400);
    const cb = await clip('c2'), lage = Object.fromEntries(cb.noten.map((n) => [n.id, cb.start_beat + n.beat]));
    const gesendet = aenderungen(nB).filter((e) => e.quelle === 'andreas');
    notiere('2.10 Zug aus dem aktuellen Stand: linker Rand, Cypher setzt währenddessen n9', cb.start_beat === 10 && lage.n9 === 11 && lage.n3 === 10 && gesendet.length === 1 && gesendet[0].koerper.rev === fremdRev,
      `Start ${cb.start_beat}; Projekt-Beats ${JSON.stringify(lage)} (n9 soll 11, Negativ-Kontrolle n3 10); Zug geschickt mit rev ${gesendet[0]?.koerper.rev} (Stand nach Cyphers Änderung: ${fremdRev})`);
    // 2.11 (V2 Fix-Runde 2 H1, Spec 6.34): Strg+D, während der Zug davor noch unterwegs ist (Antwort 800 ms zurückgehalten). c1 (4..8) um 2 Beats
    // ziehen, sofort Strg+D: das Duplikat gehört hinter den verschobenen Clip (ziel_beat 10), nicht hinter den alten Stand (8). Negativ-Kontrolle ohne Verzögerung.
    const dupFall = [];
    for (const [name, ms] of [['ohne Verzögerung', 0], ['800 ms', 800]]) {
      await seed(`Teil 2 Dup ${name}`);
      await verzoegere(ms);
      const d0 = await xy(5, 0), nD = log().length;
      await zieh(d0.x, d0.y, d0.x + 2 * 24, d0.y);
      if (!ms) await warte(700);                       // Negativ-Kontrolle: die Antwort ist da, bevor die Taste kommt
      await taste('d', STRG);
      await warte(ms ? 2600 : 900);
      await verzoegere(0);
      const a = aenderungen(nD);
      dupFall.push({ name, clips: (await projekt()).spuren[0].clips.map((c) => [c.id, c.start_beat]), anfragen: a.map((e) => [e.koerper.label, e.koerper.rev, ...e.koerper.befehle.map((x) => x.ziel_beat ?? x.start_beat)]) });
    }
    notiere('2.11 Strg+D während der Zug davor unterwegs ist: aus dem Stand, dessen rev mitgeht', dupFall.every((x) => JSON.stringify(x.clips) === '[["c1",6],["c4",10]]' && x.anfragen.length === 2 && x.anfragen[1][1] === x.anfragen[0][1] + 1),
      dupFall.map((x) => `${x.name}: Clips ${JSON.stringify(x.clips)} (soll [["c1",6],["c4",10]]), Anfragen ${JSON.stringify(x.anfragen)}`).join('; '));
    // 2.12 (V2 Fix-Runde 2 H1, die übrigen Stellen der Klasse): je eine Bedienung, deren Befehl aus dem Stand folgt, während die davor unterwegs ist:
    // Klammerzug im Lineal (neu 40..44), sofort LOOP: aus bleibt 40..44 (vorher: an mit der alten Klammer 0..32); zweimal M: am Ende nicht stumm;
    // rechten Rand von c1 um 2 Beats ziehen (Länge 6), sofort Strg+L: loop_beats 6 (vorher die alte Länge 4). Negativ-Kontrolle ohne Verzögerung.
    const klasse = [];
    for (const ms of [0, 800]) {
      await seed(`Teil 2 Klasse ${ms}`);
      await verzoegere(ms);
      const li = await rect('[data-p="lineal"]'), an = await w('window.djkProd.ansicht'), lx = (beat) => li.l + (beat - an.beat0) * an.pxProBeat;
      let nK = log().length;
      await zieh(lx(40.2), li.t + 5, lx(44.2), li.t + 5);
      if (!ms) await warte(700);
      await b.klick('[data-p="loop"]');
      await warte(ms ? 2600 : 900);
      const lp = (await projekt()).loop, aL = aenderungen(nK).map((e) => e.koerper.label);
      nK = log().length;
      await b.klick('.p-kopf[data-spur="s1"] .p-mute');
      if (!ms) await warte(700);
      await b.klick('.p-kopf[data-spur="s1"] .p-mute');
      await warte(ms ? 2600 : 900);
      const mute = (await projekt()).spuren[0].mute, aM = aenderungen(nK).map((e) => e.koerper.label);
      const rk = await xy(8, 0);
      nK = log().length;
      await zieh(rk.x - 2, rk.y, rk.x - 2 + 2 * 24, rk.y);
      if (!ms) await warte(700);
      await taste('l', STRG);
      await warte(ms ? 2600 : 900);
      await verzoegere(0);
      const c1 = await clip('c1'), aC = aenderungen(nK).map((e) => e.koerper.label);
      // TEMPO 60 + Enter, sofort ein Kick (0,5 s) aus LIBRARY auf Snare (Beat 20, Ablegen als synthetisches drop mit der Nutzlast von ziehen.js):
      // Länge 0,5 Beat bei 60 BPM (vorher 1 Beat aus dem alten Tempo 120)
      await verzoegere(ms);
      nK = log().length;
      await w(`(() => { const f = document.querySelector('[data-p="tempo"]'); f.focus(); f.value = '60'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
      if (ms === 0) await warte(700);
      const ziel = await xy(20, 1), fl = await rect('[data-p="flaeche"]');
      await w(`(() => { const u = document.querySelector('[data-p="ueber"]'), dt = new DataTransfer(); dt.setData('application/x-djk-clip', JSON.stringify({ sha: '${SHA}', dauer_s: 0.5, name: 'Kick 1' }));
        u.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true, clientX: ${ziel.x}, clientY: ${ziel.y} })); return true; })()`);
      await warte(ms ? 2600 : 900);
      await verzoegere(0);
      const abgelegt = (await projekt()).spuren[1].clips.map((c) => [c.start_beat, c.laenge_beats]), aT = aenderungen(nK).map((e) => e.koerper.label);
      klasse.push({ ms, loop: [lp.an, lp.von_beat, lp.bis_beat], aL, mute, aM, clip: [c1.laenge_beats, c1.loop_beats ?? null], aC, abgelegt, aT, fl: fl.l });
    }
    notiere('2.12 Klammerzug + LOOP, zweimal M, Kürzen + Strg+L, TEMPO + Ablegen: aus dem Stand beim Senden', klasse.every((x) => JSON.stringify(x.loop) === '[false,40,44]' && x.mute === false
      && JSON.stringify(x.aM) === '["Mute Kick","Unmute Kick"]' && JSON.stringify(x.clip) === '[6,6]' && x.aL.length === 2 && x.aC.length === 2
      && JSON.stringify(x.abgelegt) === '[[20,0.5]]' && JSON.stringify(x.aT) === '["Tempo 60","Add clip"]'),
      klasse.map((x) => `${x.ms ? '800 ms' : 'ohne Verzögerung'}: Loop ${JSON.stringify(x.loop)} (soll [false,40,44]) ${JSON.stringify(x.aL)}; mute ${x.mute} ${JSON.stringify(x.aM)}; c1 Länge/loop ${JSON.stringify(x.clip)} (soll [6,6]) ${JSON.stringify(x.aC)}; abgelegt ${JSON.stringify(x.abgelegt)} (soll [[20,0.5]]) ${JSON.stringify(x.aT)}`).join('; '));
  }

  // ================= Teil 3: Clip-Ansicht im Detailbereich (Audio) =================
  if (TEIL >= 3) {
    await seed('Teil 3');
    const c = await xy(5, 0);
    await klick(c.x, c.y); await warte(300);
    const det = await w(`({ titel: document.querySelector('[data-d="titel"]').textContent, info: document.querySelector('[data-d="info"]').textContent, offset: document.querySelector('[data-f="offset_s"]').value, gain: document.querySelector('[data-f="gain_db"]').value, audio: !document.querySelector('[data-d="audio"]').hidden, midi: !document.querySelector('[data-d="midi"]').hidden })`);
    notiere('3.1 Audio-Clip im Detail', det.titel === 'AUDIO CLIP' && det.offset === '0.25' && det.gain === '0' && det.audio && !det.midi && det.info.startsWith('kick · Kick · bar 2.1.1 · 4 beats'),
      `${det.titel} „${det.info}“, offset ${det.offset}, gain ${det.gain}, Audio sichtbar ${det.audio}, Roll ${det.midi}`);
    let n0 = log().length;
    await b.klick('[data-f="gain_db"]'); await w(`document.querySelector('[data-f="gain_db"]').select()`);
    await tippe('-6,5'); await taste('Enter'); await warte(400);
    const g1 = (await clip('c1')).gain_db, a1 = aenderungen(n0);
    notiere('3.2 Gain per Eingabe', g1 === -6.5 && a1.length === 1 && a1[0].koerper.label === 'Clip gain', `gain ${g1}; ${a1.length} Anfrage „${a1[0]?.koerper.label}“`);
    n0 = log().length;
    const rg = await rect('[data-d="gainregler"]');
    const mitteG = await zieh(rg.l + rg.w / 2, rg.t + rg.h / 2, rg.l + rg.w * 0.9, rg.t + rg.h / 2, { mitte: async () => aenderungen(n0).length });
    await warte(400);
    const g2 = (await clip('c1')).gain_db;
    notiere('3.3 Gain-Regler: eine Änderung beim Loslassen', mitteG === 0 && aenderungen(n0).length === 1 && g2 > 0, `während des Zugs ${mitteG} Anfragen, danach ${aenderungen(n0).length}; gain ${g2}`);
    n0 = log().length;
    await b.klick('[data-f="fade_ein_beats"]'); await w(`document.querySelector('[data-f="fade_ein_beats"]').select()`);
    await tippe('9'); await taste('Enter'); await warte(300);
    const meld = await w(`document.querySelector('[data-p="meldung"]').textContent`);
    notiere('3.4 Ungültige Eingabe: Meldung, keine Anfrage', aenderungen(n0).length === 0 && meld === 'The fades are longer than the clip' && (await w(`document.querySelector('[data-f="fade_ein_beats"]').value`)) === '0',
      `Anfragen ${aenderungen(n0).length}; Meldung „${meld}“; Feld zurück auf ${await w(`document.querySelector('[data-f="fade_ein_beats"]').value`)}`);
    const innen = await xy(6, 0);
    await klick(innen.x, innen.y); await warte(150);
    n0 = log().length;
    await b.klick('[data-d="teilen"]'); await warte(400);
    const nachSplit = (await projekt()).spuren[0].clips.length;
    await b.klick('[data-d="loeschen"]'); await warte(400);
    notiere('3.5 SPLIT und DELETE im Detail', nachSplit === 2 && (await projekt()).spuren[0].clips.length === 1 && aenderungen(n0).length === 2 && (await w(`document.querySelector('[data-d="leer"]').hidden`)) === false,
      `nach SPLIT ${nachSplit} Clips, nach DELETE ${(await projekt()).spuren[0].clips.length}; Detail leer ${!(await w(`document.querySelector('[data-d="leer"]').hidden`))}`);
    const m = await xy(9, 2);
    await klick(m.x, m.y); await warte(300);
    const md = await w(`({ titel: document.querySelector('[data-d="titel"]').textContent, roll: !document.querySelector('[data-d="midi"]').hidden, audio: !document.querySelector('[data-d="audio"]').hidden, h: document.querySelector('[data-r="roll"]').getBoundingClientRect().height })`);
    notiere('3.6 MIDI-Clip zeigt die Piano-Roll', md.titel === 'MIDI CLIP' && md.roll && !md.audio && md.h > 120, `${md.titel}, Roll sichtbar ${md.roll} (Höhe ${md.h | 0} px), Audio-Felder ${md.audio}`);
    // 3.7 LOOP im Detail (Spec 6.17): der Schalter setzt loop_beats auf die Länge und zeigt es; nochmals: aus
    const nL = log().length;
    await b.klick('[data-d="loop"]'); await warte(400);
    const lAn = { loop: (await clip('c2')).loop_beats, gedrueckt: await w(`document.querySelector('[data-d="loop"]').getAttribute('aria-pressed')`), info: await w(`document.querySelector('[data-d="info"]').textContent`) };
    await b.klick('[data-d="loop"]'); await warte(400);
    const lAus = { loop: (await clip('c2')).loop_beats, gedrueckt: await w(`document.querySelector('[data-d="loop"]').getAttribute('aria-pressed')`) };
    const lLabels = aenderungen(nL).map((e) => e.koerper.label);
    notiere('3.7 LOOP im Detail', lAn.loop === 4 && lAn.gedrueckt === 'true' && lAn.info.includes('· loop 4 beats') && lAus.loop === null && lAus.gedrueckt === 'false' && JSON.stringify(lLabels) === '["Loop on","Loop off"]',
      `an: loop_beats ${lAn.loop}, gedrückt ${lAn.gedrueckt}, „${lAn.info}“; aus: loop_beats ${lAus.loop}, gedrückt ${lAus.gedrueckt}; Anfragen ${JSON.stringify(lLabels)}`);
  }

  // 3.8 (V2 Fix F8, Spec 6.27): der Gain-Regler nimmt den Bereich aus FELDER.gain_db (−96..+24). Ein Clip mit +20 dB zeigt +20 und bleibt beim
  // Antippen des Reglers (Klick auf den Knopf, ohne Ziehen) +20; Negativ-Kontrolle ein Clip mit −6 dB.
  if (TEIL >= 3) {
    const tippe8 = async (gain) => {
      await w(`document.activeElement?.blur()`);   // ein fokussierter Regler wird beim neuen Stand nicht überschrieben (detail.js zeige)
      await seed(`Teil 3 Gain ${gain}`, (p) => { p.spuren[0].clips[0].gain_db = gain; });
      const c = await xy(5, 0);
      await klick(c.x, c.y); await warte(300);
      const r = await w(`(() => { const e = document.querySelector('[data-d="gainregler"]'); const b = e.getBoundingClientRect(); return { min: e.min, max: e.max, wert: e.value, l: b.left, w: b.width, t: b.top, h: b.height }; })()`);
      const anteil = (Number(r.wert) - Number(r.min)) / (Number(r.max) - Number(r.min)), knopf = 16;
      const n0 = log().length;
      await klick(r.l + knopf / 2 + anteil * (r.w - knopf), r.t + r.h / 2); await warte(400);
      return { ...r, anfragen: aenderungen(n0).length, gain: (await clip('c1')).gain_db };
    };
    const hoch = await tippe8(20), tief = await tippe8(-6);
    notiere('3.8 Gain-Regler −96..+24: +20 dB bleibt beim Antippen', hoch.min === '-96' && hoch.max === '24' && hoch.wert === '20' && hoch.anfragen === 0 && hoch.gain === 20 && tief.wert === '-6' && tief.gain === -6,
      `Regler ${hoch.min}..${hoch.max}, zeigt ${hoch.wert} bei +20 dB; angetippt: ${hoch.anfragen} Anfragen, gain ${hoch.gain}; Negativ-Kontrolle −6 dB: zeigt ${tief.wert}, gain ${tief.gain}, ${tief.anfragen} Anfragen`);
  }
  // 3.9 (V2 Fix-Runde 2 H6): der Gain-Regler mit bloßem Fokus übernimmt einen neuen Serverstand (vorher zeigte ein −6-dB-Clip weiter 12). Geschützt
  // ist er nur, solange er bedient wird: während des Ziehens setzt Cypher den Gain, der Regler springt nicht, beim Loslassen geht der gezogene Wert.
  if (TEIL >= 3) {
    const regler = () => w(`(() => { const e = document.querySelector('[data-d="gainregler"]'); return { wert: e.value, fokus: document.activeElement === e, feld: document.querySelector('[data-f="gain_db"]').value }; })()`);
    await w(`document.activeElement?.blur()`);           // sauberer Anfang: 3.8 ließ den Fokus auf dem Regler
    await seed('Teil 3 Fokus', (p) => { p.spuren[0].clips[0].gain_db = 12; });
    const c = await xy(5, 0);
    await klick(c.x, c.y); await warte(300);
    await w(`document.querySelector('[data-d="gainregler"]').focus()`);
    const vor = await regler();
    await fremdWaehrend('Cypher sets the gain', [{ befehl: 'clip_aendern', clip_id: 'c1', gain_db: -6 }]); await warte(200);
    const fokus = await regler();
    const r = await w(`(() => { const e = document.querySelector('[data-d="gainregler"]'), b = e.getBoundingClientRect(); return { l: b.left, w: b.width, t: b.top, h: b.height }; })()`);
    const knopf = 16, x0 = r.l + knopf / 2 + ((-6 + 96) / 120) * (r.w - knopf), y = r.t + r.h / 2, n0 = log().length;
    const zug = await zieh(x0, y, r.l + r.w * 0.85, y, { mitte: async () => {
      const a = await regler();
      await fremdWaehrend('Cypher sets the gain again', [{ befehl: 'clip_aendern', clip_id: 'c1', gain_db: 3 }]); await warte(200);
      return { a, b: await regler() };
    } });
    await warte(500);
    const gain = (await clip('c1')).gain_db, gesendet = aenderungen(n0).filter((e) => e.quelle === 'andreas');
    notiere('3.9 Gain-Regler: Fokus allein schützt nicht, Ziehen schon', vor.wert === '12' && fokus.fokus && fokus.wert === '-6' && zug.a.wert === zug.b.wert && zug.b.wert !== '3'
      && gain === Number(zug.b.wert) && gesendet.length === 1,
      `mit Fokus: ${vor.wert} → nach Cyphers −6: ${fokus.wert} (Fokus ${fokus.fokus}); während des Ziehens ${zug.a.wert}, nach Cyphers +3: ${zug.b.wert} (Negativ-Kontrolle: kein Sprung); danach gain ${gain}, ${gesendet.length} Anfrage`);
  }

  // ================= Teil 4: MIDI-Clip anlegen, Noten setzen, verschieben, Länge, löschen (A3) =================
  if (TEIL >= 4) {
    await seed('Teil 4');
    let n0 = log().length;
    const leer = await xy(1.7, 2);
    await doppel(leer.x, leer.y); await warte(500);
    const p = await projekt();
    const neu = p.spuren[2].clips.find((c) => c.id !== 'c2');
    const wahl = await w('window.djkProd.auswahl');
    notiere('4.1 Doppelklick legt einen MIDI-Clip an', neu?.art === 'midi' && neu.start_beat === 1 && neu.laenge_beats === 4 && JSON.stringify(wahl) === JSON.stringify([neu.id]) && (await w('window.djkProd.rolle.clipId')) === neu.id,
      `Clip ${neu?.id} start ${neu?.start_beat} Länge ${neu?.laenge_beats}; Auswahl ${JSON.stringify(wahl)}; Roll zeigt ${await w('window.djkProd.rolle.clipId')}`);
    const nAudio = log().length;
    const la = await xy(12, 1);
    await doppel(la.x, la.y); await warte(300);
    notiere('4.1b Auf einer Audio-Spur nicht', aenderungen(nAudio).length === 0 && (await w(`document.querySelector('[data-p="meldung"]').textContent`)).startsWith('Double click makes MIDI clips'), `Anfragen ${aenderungen(nAudio).length}`);
    await klick(leer.x + 24, leer.y); await warte(300);
    n0 = log().length;
    const pn = await rollXY(0.6, 48);
    await doppel(pn.x, pn.y); await warte(500);
    let c = await clip(neu.id);
    const vorschau = await w(`(() => { const a = window.djkProd.ansicht; const c = document.querySelector('[data-p="spuren"]'); const d = c.getContext('2d').getImageData(Math.round((1 - a.beat0) * a.pxProBeat), 2 * 64 + 15, Math.round(4 * a.pxProBeat), 46).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x3b) < 12 && Math.abs(d[i + 1] - 0x8d) < 12 && Math.abs(d[i + 2] - 0xe0) < 12) n++; return n; })()`);
    // ID n4: S2 führt EINEN Noten-Zähler je Projekt (Spec 6.28 Nachsatz, 6.30); die Saat hat Noten bis n3, die Seite vergibt den nächsten
    notiere('4.2 Note setzen (Doppelklick in der Roll)', JSON.stringify(c.noten) === '[{"id":"n4","beat":0.5,"laenge":0.25,"ton":48,"vel":100}]' && JSON.stringify(await w('window.djkProd.rolle.auswahl')) === '["n4"]' && vorschau > 0,
      `Noten ${JSON.stringify(c.noten)} (SNAP 1/16 abgerundet, NOTE 1/16, ID aus dem Projekt-Zähler); gewählt ${JSON.stringify(await w('window.djkProd.rolle.auswahl'))}; Vorschau im Arrangement ${vorschau} Pixel`);
    n0 = log().length;
    const pm = await rollXY(0.6, 48);
    await zieh(pm.x, pm.y, pm.x + 1 * (await w('window.djkProd.rolle.ansicht.pxProBeat')), pm.y - 2 * 9); await warte(400);
    c = await clip(neu.id);
    notiere('4.3 Note verschieben (Beat und Ton)', c.noten[0].beat === 1.5 && c.noten[0].ton === 50 && aenderungen(n0).length === 1 && aenderungen(n0)[0].koerper.label === 'Move note',
      `Note beat ${c.noten[0].beat}, ton ${c.noten[0].ton}; ${aenderungen(n0).length} Anfrage „${aenderungen(n0)[0]?.koerper.label}“`);
    n0 = log().length;
    const pr = await rollXY(1.5 + 0.25, 50);
    const px = await w('window.djkProd.rolle.ansicht.pxProBeat');
    await zieh(pr.x - 2, pr.y, pr.x - 2 + 0.5 * px, pr.y); await warte(400);
    c = await clip(neu.id);
    notiere('4.4 Länge ziehen (rechter Rand)', c.noten[0].laenge === 0.75 && aenderungen(n0)[0]?.koerper.label === 'Length of note', `Länge ${c.noten[0].laenge}`);
    n0 = log().length;
    const pd = await rollXY(1.6, 50);
    await doppel(pd.x, pd.y); await warte(400);
    notiere('4.5 Note löschen (Doppelklick)', (await clip(neu.id)).noten.length === 0 && aenderungen(n0).some((e) => e.koerper.befehle[0].befehl === 'noten_loeschen'), `Noten ${(await clip(neu.id)).noten.length}`);
  }

  // ================= Teil 5: Mehrfachauswahl, Tasten, Velocity, Quantisieren (A3) =================
  if (TEIL >= 5) {
    await seed('Teil 5');
    const m = await xy(9, 2);
    await klick(m.x, m.y); await warte(400);
    const o = await rollXY(0.02, 39), u = await rollXY(1.9, 35);
    await zieh(o.x, o.y - 6, u.x, u.y + 6); await warte(200);
    const wahl = await w('window.djkProd.rolle.auswahl');
    notiere('5.1 Rechteck wählt mehrere', JSON.stringify(wahl) === '["n1","n2"]', `Auswahl ${JSON.stringify(wahl)}`);
    let n0 = log().length;
    for (let i = 0; i < 4; i++) await taste('ArrowRight');
    await warte(600);
    let c = await clip('c2');
    const anfr = aenderungen(n0).length;
    notiere('5.2 Pfeiltasten: kein Schritt verloren, gestaute zusammengefasst', c.noten[0].beat === 1 && c.noten[1].beat === 2 && c.noten[2].beat === 2.1 && anfr >= 1 && anfr <= 4,
      `n1 ${c.noten[0].beat}, n2 ${c.noten[1].beat} (je +4 × 1/16), n3 unberührt ${c.noten[2].beat}; ${anfr} Anfragen für 4 Tasten`);
    n0 = log().length;
    await taste('ArrowUp', UMSCHALT); await warte(400);
    c = await clip('c2');
    notiere('5.3 Umschalt+↑: eine Oktave', c.noten[0].ton === 48 && c.noten[1].ton === 50 && aenderungen(n0).length === 1, `Töne ${c.noten.map((n) => n.ton)}`);
    n0 = log().length;
    const rr = await rect('[data-r="roll"]');
    const a = await w('window.djkProd.rolle.ansicht');
    const vx = rr.l + 40 + (1 - a.beat0) * a.pxProBeat + 1;
    await zieh(vx, rr.b - 20, vx, rr.t + 5); await warte(400);
    c = await clip('c2');
    notiere('5.4 Velocity-Spur ziehen (Auswahl relativ)', c.noten[0].vel === 127 && c.noten[1].vel === 117 && c.noten[2].vel === 80 && aenderungen(n0).length === 1,
      `vel ${c.noten.map((n) => n.vel)} (n1 an den Anschlag 127, n2 um denselben Betrag +27, n3 nicht gewählt)`);
    n0 = log().length;
    await b.klick('[data-r="vel"]'); await w(`document.querySelector('[data-r="vel"]').select()`);
    await tippe('64'); await taste('Enter'); await warte(400);
    c = await clip('c2');
    notiere('5.5 VEL-Feld setzt die Auswahl', c.noten[0].vel === 64 && c.noten[1].vel === 64 && c.noten[2].vel === 80, `vel ${c.noten.map((n) => n.vel)}`);
    n0 = log().length;
    await b.klick('[data-r="quant"]'); await warte(300);
    const nichts = aenderungen(n0).length, meld = await w(`document.querySelector('[data-p="meldung"]').textContent`);
    const rf = await rollXY(3.5, 45);
    await klick(rf.x, rf.y); await taste('q'); await warte(400);
    c = await clip('c2');
    notiere('5.6 Quantisieren 1/16', nichts === 0 && meld === 'Already on the 1/16 grid' && c.noten[2].beat === 2 && aenderungen(n0).length === 1,
      `gewählte schon auf dem Raster: ${nichts} Anfragen „${meld}“ (Negativ-Kontrolle); ohne Auswahl Q: n3 2.1 → ${c.noten[2].beat}`);
    await taste('a', STRG); await warte(100);
    const alle = await w('window.djkProd.rolle.auswahl.length');
    await taste('Delete'); await warte(400);
    notiere('5.7 Strg+A und Entf', alle === 3 && (await clip('c2')).noten.length === 0, `gewählt ${alle}, danach Noten ${(await clip('c2')).noten.length}`);
    // 5.8 (V2 Fix F2): Notenzug in der Roll aus dem aktuellen Stand. n3 (Beat 2, Ton 43) um 1 Beat und 2 Halbtöne ziehen; währenddessen verschiebt
    // Cypher n3 auf Beat 2,5. Danach steht n3 auf 3,5 (aus dem Stand beim Loslassen), nicht auf 3 (aus dem Stand beim pointerdown); n1 bleibt.
    await seed('Teil 5 Basis', (p) => { p.spuren[2].clips[0].noten[2].beat = 2; });
    const mb = await xy(9, 2);
    await klick(mb.x, mb.y); await warte(400);
    const pn3 = await rollXY(2.1, 43), ppx = await w('window.djkProd.rolle.ansicht.pxProBeat');
    let fr = null;
    await zieh(pn3.x, pn3.y, pn3.x + ppx, pn3.y - 2 * 9, { mitte: async () => { fr = await fremdWaehrend('Cypher moves a note', [{ befehl: 'noten_aendern', clip_id: 'c2', noten: [{ id: 'n3', beat: 2.5 }] }]); } });
    await warte(400);
    const cr = await clip('c2'), n3 = cr.noten.find((n) => n.id === 'n3'), n1 = cr.noten.find((n) => n.id === 'n1');
    notiere('5.8 Notenzug aus dem aktuellen Stand', n3.beat === 3.5 && n3.ton === 45 && n1.beat === 0 && n1.ton === 36 && fr !== null,
      `n3 beat ${n3.beat} ton ${n3.ton} (soll 3,5 / 45; aus dem alten Stand wäre es 3); Negativ-Kontrolle n1 beat ${n1.beat} ton ${n1.ton}`);
    // 5.9 (V2 Fix F7): in der Roll ebenso, pointercancel und Esc während eines Notenzugs senden nichts
    const fall = [];
    for (const [name, abbrechen] of [['pointercancel', () => w(`document.querySelector('[data-r="roll"]').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))`)], ['Esc', () => taste('Escape')]]) {
      await seed(`Teil 5 Abbruch ${name}`);
      const mc = await xy(9, 2);
      await klick(mc.x, mc.y); await warte(400);
      const q = await rollXY(0.2, 36), n0 = log().length, ppx = await w('window.djkProd.rolle.ansicht.pxProBeat');
      const m = await zieh(q.x, q.y, q.x + ppx, q.y, { mitte: async () => { const vor = await w(`window.djkProd.projektEntwurf?.spuren[2].clips[0].noten.find((n) => n.id === 'n1')?.beat ?? null`); await abbrechen(); await warte(50); return { vor, nach: await w('window.djkProd.projektEntwurf') }; } });
      await warte(400);
      fall.push({ name, vor: m.vor, nach: m.nach, anfragen: aenderungen(n0).length, beat: (await clip('c2')).noten.find((n) => n.id === 'n1').beat });
    }
    notiere('5.9 Roll: pointercancel und Esc verwerfen den Notenzug ohne Senden', fall.every((x) => x.vor === 1 && x.nach === null && x.anfragen === 0 && x.beat === 0),
      fall.map((x) => `${x.name}: Entwurf n1 ${x.vor} → ${x.nach}, Anfragen ${x.anfragen}, n1 beat ${x.beat}`).join('; '));
    // 5.10 und 5.11 (V2 Fix-Runde 2 H1, Spec 6.34): Pfeiltaste und Q, während der Notenzug davor unterwegs ist (Antwort 800 ms zurückgehalten).
    // 5.10: n1 (Beat 0) um 1 Beat ziehen, sofort →: n1 auf 1,25 (Zug + 1/16), nicht 0,25 (Taste aus dem alten Stand, der Zug verloren).
    // 5.11: n1 und n3 (2,1) gewählt, n1 um 1 Beat ziehen (n3 folgt auf 3,1), sofort Q (1/16 = 0,25 Beat): n3 auf 3, nicht 2. Je mit Negativ-Kontrolle ohne Verzögerung.
    const rollFall = [];
    for (const [art, ms] of [['taste', 0], ['taste', 800], ['quant', 0], ['quant', 800]]) {
      await seed(`Teil 5 ${art} ${ms}`);
      const mc = await xy(9, 2);
      await klick(mc.x, mc.y); await warte(400);
      const q1 = await rollXY(0.2, 36), px = await w('window.djkProd.rolle.ansicht.pxProBeat');
      if (art === 'quant') { await klick(q1.x, q1.y); const q3 = await rollXY(2.2, 43); await klick(q3.x, q3.y, UMSCHALT); await warte(200); }
      await verzoegere(ms);
      const nR = log().length;
      await zieh(q1.x, q1.y, q1.x + px, q1.y);
      if (!ms) await warte(700);                       // Negativ-Kontrolle: die Antwort ist da, bevor die Taste kommt
      await taste(art === 'taste' ? 'ArrowRight' : 'q');
      await warte(ms ? 2600 : 900);
      await verzoegere(0);
      const cr = await clip('c2'), beat = (id) => cr.noten.find((n) => n.id === id).beat;
      rollFall.push({ art, ms, n1: beat('n1'), n3: beat('n3'), anfragen: aenderungen(nR).map((e) => [e.koerper.label, e.koerper.rev]) });
    }
    const zwei = (x) => x.anfragen.length === 2 && x.anfragen[1][1] === x.anfragen[0][1] + 1;
    notiere('5.10 Pfeiltaste während der Notenzug davor unterwegs ist', rollFall.filter((x) => x.art === 'taste').every((x) => x.n1 === 1.25 && x.n3 === 2.1 && zwei(x)),
      rollFall.filter((x) => x.art === 'taste').map((x) => `${x.ms ? '800 ms' : 'ohne Verzögerung'}: n1 ${x.n1} (soll 1,25), n3 ${x.n3}, Anfragen ${JSON.stringify(x.anfragen)}`).join('; '));
    notiere('5.11 Quantisieren während der Notenzug davor unterwegs ist', rollFall.filter((x) => x.art === 'quant').every((x) => x.n1 === 1 && x.n3 === 3 && zwei(x)),
      rollFall.filter((x) => x.art === 'quant').map((x) => `${x.ms ? '800 ms' : 'ohne Verzögerung'}: n1 ${x.n1}, n3 ${x.n3} (soll 3), Anfragen ${JSON.stringify(x.anfragen)}`).join('; '));
    // 5.12 (D1 S3 Auftrag 16 c, V2-Rest): die Auswahl gehört zum Tastendruck, nicht zum Senden. n1 gewählt, Notenzug n1 +1 Beat unterwegs (Antwort
    // 800 ms zurückgehalten), → gedrückt, sofort n3 gewählt: es bewegt sich n1 (Zug + 1/16 = 1,25), n3 bleibt auf 2,1. Vorher rechnete der Schritt
    // beim Senden mit der dann aktuellen Auswahl und schob n3. Negativ-Kontrolle ohne Auswahlwechsel: n1 auf 1,25.
    const wahlFall = [];
    for (const wechsel of [true, false]) {
      await seed(`Teil 5 Wahl ${wechsel ? 'mit' : 'ohne'}`);
      const mc = await xy(9, 2);
      await klick(mc.x, mc.y); await warte(400);
      const q1 = await rollXY(0.2, 36), q3 = await rollXY(2.2, 43), px = await w('window.djkProd.rolle.ansicht.pxProBeat');
      await klick(q1.x, q1.y); await warte(200);
      await verzoegere(800);
      const nR = log().length;
      await zieh(q1.x, q1.y, q1.x + px, q1.y);
      await taste('ArrowRight');
      if (wechsel) await klick(q3.x, q3.y);
      const wahl = await w('[...window.djkProd.rolle.auswahl]');
      await warte(2600);
      await verzoegere(0);
      const cr = await clip('c2'), beat = (id) => cr.noten.find((n) => n.id === id).beat;
      wahlFall.push({ wechsel, n1: beat('n1'), n3: beat('n3'), wahl, anfragen: aenderungen(nR).map((e) => e.koerper.label) });
    }
    notiere('5.12 Pfeiltaste: die Auswahl beim Drücken zählt, nicht die beim Senden', wahlFall.every((x) => x.n1 === 1.25 && x.n3 === 2.1 && x.anfragen.length === 2)
      && JSON.stringify(wahlFall[0].wahl) === '["n3"]' && JSON.stringify(wahlFall[1].wahl) === '["n1"]',
      wahlFall.map((x) => `${x.wechsel ? 'Auswahl nach dem Drücken auf n3' : 'ohne Wechsel'}: Auswahl ${JSON.stringify(x.wahl)}, n1 ${x.n1} (soll 1,25), n3 ${x.n3} (soll 2,1), Anfragen ${JSON.stringify(x.anfragen)}`).join('; '));
  }

  // ================= Teil 6: FREEZE (Spurkopf) und EXPORT (Transportleiste) =================
  if (TEIL >= 6) {
    await seed('Teil 6');
    const knopf = await w(`[...document.querySelectorAll('.p-kopf')].map((k) => k.dataset.spur + ':' + (k.querySelector('.p-freeze') ? 1 : 0)).join(' ')`);
    notiere('6.1 FREEZE nur an der Wirt-Spur', knopf === 's1:0 s2:0 s3:0 s4:1', `Köpfe ${knopf}`);
    let n0 = log().length;
    await b.klick('.p-kopf[data-spur="s4"] .p-freeze'); await warte(700);
    const waehrend = await w(`({ text: document.querySelector('[data-p="ausgabe"]').textContent, laeuft: document.querySelector('.p-freeze').classList.contains('laeuft'), gesperrt: document.querySelector('.p-freeze').disabled, exp: document.querySelector('[data-p="export"]').disabled })`);
    await b.klick('.p-kopf[data-spur="s4"] .p-freeze'); await warte(100);
    const doppelt = log().slice(n0).filter((e) => e.weg === '/proj/freeze').length;
    await warte(1400);
    const nach = await w(`({ an: document.querySelector('.p-freeze').classList.contains('an'), geraet: document.querySelector('.p-kopf[data-spur="s4"] .p-geraet').textContent, exp: document.querySelector('[data-p="export"]').disabled })`);
    const fz = (await projekt()).spuren[3].freeze;
    notiere('6.2 Freeze mit Fortschritt', /^Freezing Lead · bar \d+\.\d\.\d · \d s$/.test(waehrend.text) && waehrend.laeuft && waehrend.gesperrt && waehrend.exp && doppelt === 1 && nach.an && nach.geraet === 'SURGE · 1 · FROZEN' && !nach.exp && fz?.kennung >= 1,
      `während: „${waehrend.text}“, Schalter läuft ${waehrend.laeuft} und gesperrt ${waehrend.gesperrt}, EXPORT gesperrt ${waehrend.exp}; zweiter Klick: ${doppelt} Anfrage(n); danach an ${nach.an}, Kopf „${nach.geraet}“, freeze ${JSON.stringify(fz)}`);
    await b.klick('.p-kopf[data-spur="s4"] .p-freeze'); await warte(500);
    notiere('6.3 Unfreeze', (await projekt()).spuren[3].freeze === null && !(await w(`document.querySelector('.p-freeze').classList.contains('an')`)), `freeze ${JSON.stringify((await projekt()).spuren[3].freeze)}`);
    n0 = log().length;
    await b.klick('[data-p="export"]');
    const texte = new Set();
    for (let i = 0; i < 60; i++) { texte.add(await w(`document.querySelector('[data-p="ausgabe"]').textContent`)); if (log().slice(n0).some((e) => e.weg === '/proj/export') && !(await w('window.djkProd.lauf'))) break; await warte(60); }
    await warte(200);
    const erg = await w(`({ text: document.querySelector('[data-p="ausgabe"]').textContent, titel: document.querySelector('[data-p="ausgabe"]').title })`);
    const phasen = [...texte].map((t) => t.replace(/ · .*$/, '').replace(/^(Exporting: \w+).*/, '$1'));
    notiere('6.4 Export mit Phasen und Ergebnis', phasen.includes('Exporting: freezing') && phasen.includes('Exporting: rendering') && /^Exported teil-6-\d{8}-\d{6}\.wav · 16\.0 s · peak −6\.0 dBFS · −14\.2 LUFS, true peak −1\.0 dBTP$/.test(erg.text) && /^\/attrappe\/projekte\/teil-6\/export\/teil-6-\d{8}-\d{6}\.wav$/.test(erg.titel) && !!(await projekt()).spuren[3].freeze,
      `Phasen ${JSON.stringify([...new Set(phasen)])}; Ergebnis „${erg.text}“ (Titel ${erg.titel}); Lead danach eingefroren ${!!(await projekt()).spuren[3].freeze}`);
    const k0 = fehlerKonsole().length;
    await b.klick('[data-p="play"]'); await warte(400);
    await b.klick('[data-p="export"]'); await warte(400);
    const m1 = await w(`document.querySelector('[data-p="meldung"]').textContent`);
    await b.klick('[data-p="stopp"]'); await warte(400);
    await postA('/attrappe/ausgabe', { fehler: 'render_fehler' });
    await b.klick('[data-p="export"]'); await warte(1200);
    const m2 = await w(`document.querySelector('[data-p="meldung"]').textContent`);
    const offline2 = await w('window.djkProd.getrennt');   // 502 mit Grund (S3) ist eine Antwort, kein Ausfall (Nachzug 7b)
    await postA('/attrappe/ausgabe', { fehler: null, spitze_db: 0.4 });
    await b.klick('[data-p="export"]'); await warte(1200);
    const warn = await w(`({ t: document.querySelector('[data-p="ausgabe"]').textContent, w: document.querySelector('[data-p="ausgabe"]').classList.contains('warnung') })`);
    const neuK = fehlerKonsole().slice(k0);
    for (const k of neuK) gewollt.add(k);
    const nurGewollt = neuK.length === 2 && /409/.test(neuK[0].text) && /502/.test(neuK[1].text);
    notiere('6.5 Gründe und Übersteuerung', m1 === 'Stop the transport first' && m2 === 'The export render failed' && offline2 === false && warn.w && warn.t.endsWith('· CLIPPING') && nurGewollt,
      `bei laufendem Transport „${m1}“; Render-Fehler (502 render_fehler wie S3) „${m2}“, OFFLINE ${offline2}; Spitze +0,4 dB: „${warn.t}“, Warnfarbe ${warn.w}; Konsole: genau die zwei provozierten Ablehnungen (409, 502): ${nurGewollt} (${neuK.map((k) => k.text.slice(-40)).join(' | ')})`);
    const lay = await w('({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth })');
    const ui = await w(`[document.querySelector('#produktion').innerText, ...[...document.querySelectorAll('#produktion [title], #produktion [aria-label]')].map((e) => (e.title ?? '') + ' ' + (e.getAttribute('aria-label') ?? ''))].join(' ')`);
    notiere('6.6 Seite passt weiter, Oberfläche englisch', lay.sh <= lay.ih && lay.sw <= lay.iw && !/[äöüÄÖÜß]/.test(ui) && ui.includes('EXPORT'),
      `Seite ${lay.sw}×${lay.sh} in ${lay.iw}×${lay.ih}; Umlaute in Text, Titeln und Labels ${/[äöüÄÖÜß]/.test(ui)}`);
    // Zeichenzeit mit offener Piano-Roll, 3 s mit Rad in Arrangement und Roll (window.djkProdBild: Dauer der Zeichen-Haken je Bild in ms).
    // 6.7a wie bisher (Bass, 3 Noten); 6.7 (V2 Fix F4) ein Clip mit 5000 Noten, alle gewählt. Dazu die Auflösung: performance.now() ist im
    // Browser ohne Cross-Origin-Isolation auf 0,1 ms vergröbert; liegen alle Werte auf 0,1-ms-Stufen, misst 6.7a nur die Größenordnung.
    const messe = async () => {
      await w('window.djkProdBild.length = 0');
      const f = await rect('[data-p="flaeche"]'), rr = await rect('[data-r="roll"]');
      for (let i = 0; i < 60; i++) {
        await b.sende('Input.dispatchMouseEvent', { type: 'mouseWheel', x: f.l + 200, y: f.t + 20, deltaX: 0, deltaY: i % 2 ? 30 : -30 });
        await b.sende('Input.dispatchMouseEvent', { type: 'mouseWheel', x: rr.l + 200, y: rr.t + 40, deltaX: 0, deltaY: i % 2 ? 30 : -30 });
        await warte(50);
      }
      const bilder = await w('[...window.djkProdBild]'), sort = [...bilder].sort((x, y) => x - y);
      return { n: bilder.length, p50: sort[Math.floor(sort.length / 2)] ?? Infinity, p99: sort[Math.floor(sort.length * 0.99)] ?? Infinity, max: sort.at(-1) ?? Infinity,
        stufen: bilder.every((x) => Math.abs(x * 10 - Math.round(x * 10)) < 1e-6), rolle: await w('({ clip: window.djkProd.rolle.clipId, gewaehlt: window.djkProd.rolle.auswahl.length })') };
    };
    const mm = await xy(9, 2);
    await klick(mm.x, mm.y); await warte(300);
    const klein = await messe();
    notiere('6.7a Zeichenzeit mit kleiner Roll (3 Noten)', klein.n > 60 && klein.p99 < 8 && klein.rolle.clip === 'c2',
      `${klein.n} Bilder, p50 ${klein.p50.toFixed(2)} ms, p99 ${klein.p99.toFixed(2)} ms; Roll zeigt ${klein.rolle.clip} mit ${klein.rolle.gewaehlt} gewählten; alle Werte auf 0,1-ms-Stufen ${klein.stufen}`);
    await seed('Teil 6 Zeichnen', (p) => {
      p.spuren[2].clips[0].laenge_beats = 256;
      p.spuren[2].clips[0].noten = Array.from({ length: 5000 }, (_, i) => ({ id: `n${i + 1}`, beat: Math.round(i * 0.05 * 1000) / 1000, laenge: 0.05, ton: 36 + (i % 24), vel: 40 + (i % 80) }));
    });
    const m5 = await xy(9, 2);
    await klick(m5.x, m5.y); await warte(400);
    const rk = await rect('[data-r="roll"]');
    await klick(rk.l + 10, rk.t + 20); await taste('a', STRG); await warte(300);
    const gross = await messe();
    notiere('6.7 Zeichenzeit: Clip mit 5000 Noten, alle gewählt', gross.n > 60 && gross.p50 <= 8 && gross.rolle.clip === 'c2' && gross.rolle.gewaehlt === 5000,
      `${gross.n} Bilder, p50 ${gross.p50.toFixed(2)} ms, p99 ${gross.p99.toFixed(2)} ms, max ${gross.max.toFixed(2)} ms (Ziel p50 ≤ 8 ms); Roll zeigt ${gross.rolle.clip} mit ${gross.rolle.gewaehlt} gewählten`);
    // 6.7b (V2 Fix-Runde 2 H8, Klasse F4): die Überlagerung des Arrangements nimmt die Clip-Auswahl je Bild einmal als Set, nicht includes je Clip.
    // n Audio-Clips (je 0,1 bzw. 0,025 Beat, alle sichtbar) auf Snare, alle gewählt (Strg+A); 3 s ohne Eingabe. Gezählt werden die includes-Aufrufe
    // auf st.auswahl je Bild (vorher n je Bild, quadratisch), gemessen die Zeichendauer aus window.djkProdBild.
    const vieleClips = [];
    for (const n of [500, 2000]) {
      await seed(`Teil 6 Clips ${n}`, (p) => {
        const l = 50 / n;
        p.spuren[1].clips = Array.from({ length: n }, (_, i) => ({ id: `cz${i + 1}`, art: 'audio', name: 'kick', start_beat: Math.round(i * l * 1e6) / 1e6, laenge_beats: Math.round(l * 0.9 * 1e6) / 1e6,
          quelle: { sha256: SHA, pfad_hinweis: '' }, dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }));
      });
      await w(`window.djkProd.ansicht = { beat0: 0, pxProBeat: 24 }`);
      const fz = await rect('[data-p="flaeche"]');
      await klick(fz.l + 30 * 24, fz.t + 64 + 40); await taste('a', STRG); await warte(300);
      await w(`(() => { window.__inc = 0; const a = window.djkProd.auswahl; a.includes = function (x) { window.__inc++; return Array.prototype.includes.call(this, x); }; window.djkProdBild.length = 0; return true; })()`);
      await warte(3000);
      const bilder = await w('[...window.djkProdBild]'), sort = [...bilder].sort((x, y) => x - y), inc = await w('window.__inc');
      vieleClips.push({ n, gewaehlt: await w('window.djkProd.auswahl.length'), bilder: bilder.length, p50: sort[Math.floor(sort.length / 2)] ?? Infinity, p99: sort[Math.floor(sort.length * 0.99)] ?? Infinity, includesJeBild: bilder.length ? inc / bilder.length : Infinity });
    }
    notiere('6.7b Zeichenzeit: 500 und 2000 gewählte Clips, Auswahl je Bild als Set', vieleClips.every((x) => x.gewaehlt >= x.n && x.bilder > 60 && x.includesJeBild < 1),
      vieleClips.map((x) => `${x.n} Clips (${x.gewaehlt} gewählt): ${x.bilder} Bilder, p50 ${x.p50.toFixed(2)} ms, p99 ${x.p99.toFixed(2)} ms, includes auf der Auswahl je Bild ${x.includesJeBild.toFixed(1)}`).join('; '));
  }
  // ================= Teil 6.8 (V2 Fix F3): 5xx ohne Grund im Freeze/Export-Weg wie im Schreibweg =================
  if (TEIL >= 6) {
    const sv = 'The project server did not answer: showing the last state';
    const k8 = fehlerKonsole().length, faelle = [];
    for (const [weg, code, koerper, knopf] of [['/proj/export', 503, null, '[data-p="export"]'], ['/proj/export', 502, { text: 'bad gateway' }, '[data-p="export"]'],
      ['/proj/freeze', 503, null, '.p-kopf[data-spur="s4"] .p-freeze'], ['/proj/freeze', 502, { text: 'bad gateway' }, '.p-kopf[data-spur="s4"] .p-freeze']]) {
      await postA('/attrappe/rohantwort', { weg, code, koerper });
      await w(`document.querySelector('[data-p="meldung"]').textContent = ''`);
      await b.klick(knopf); await warte(500);
      faelle.push({ weg, code, meldung: await w(`document.querySelector('[data-p="meldung"]').textContent`), offline: await w('window.djkProd.getrennt') });
    }
    const neu8 = fehlerKonsole().slice(k8);
    for (const k of neu8) gewollt.add(k);
    notiere('6.8 Freeze/Export: 5xx ohne Grund heißt „Server antwortet nicht“, nie „Rejected: HTTP 5xx“', faelle.every((x) => x.meldung === sv && x.offline === true) && neu8.length === 4,
      `${faelle.map((x) => `${x.weg} ${x.code}${x.code === 502 ? ' (nur text)' : ' (ohne Körper)'}: „${x.meldung}“, OFFLINE ${x.offline}`).join('; ')}; provozierte Konsolenzeilen ${neu8.length}`);
  }
  // ================= Teil 6.9 (V2 Fix F12, Spec 6.34): mehrdeutige Gründe mit dem text der Antwort, sonst neutral =================
  if (TEIL >= 6) {
    await seed('Teil 6 Gruende');
    const k9 = fehlerKonsole().length, faelle = [];
    const meldung = () => w(`document.querySelector('[data-p="meldung"]').textContent`);
    const freezeKlick = async () => { await w(`document.querySelector('[data-p="meldung"]').textContent = ''`); await b.klick('.p-kopf[data-spur="s4"] .p-freeze'); await warte(500); return meldung(); };
    await postA('/attrappe/ausgabe', { fehler: 'tempo_rampe' });
    faelle.push(['beschaeftigt mit text (Tempo-Rampe, 6.33)', await freezeKlick(), 'The core is still ramping the tempo; a freeze waits until the ramp is done']);
    await postA('/attrappe/ausgabe', { fehler: null });
    await postA('/attrappe/rohantwort', { weg: '/proj/freeze', code: 409, koerper: { fehler: 'beschaeftigt' } });
    faelle.push(['beschaeftigt ohne text', await freezeKlick(), await w(`(async () => (await import('/produktion/ausgabe.js')).AUSGABE_FEHLER.beschaeftigt)()`)]);
    await postA('/attrappe/rohantwort', { weg: '/proj/freeze', code: 400, koerper: { fehler: 'zu_gross' } });
    faelle.push(['zu_gross ohne text', await freezeKlick(), await w(`(async () => (await import('/produktion/ausgabe.js')).AUSGABE_FEHLER.zu_gross)()`)]);
    await seed('Teil 6 Gross', (p) => { p.spuren[3].clips.push({ id: 'c9', art: 'midi', name: 'spaet', start_beat: 300, laenge_beats: 8, noten: [{ id: 'n9', beat: 0, laenge: 1, ton: 62, vel: 100 }] }); });
    // D1 S3 (Auftrag 14 c): die Attrappe trägt jetzt den Wortlaut des Servers (bereiche/proj/ausgabe.ts), die Seite schreibt ihn groß an
    faelle.push(['zu_gross mit text', await freezeKlick(), 'A freeze covers at most 256 beats (Lead: beat 0 to 308)']);
    const neu9 = fehlerKonsole().slice(k9);
    for (const k of neu9) gewollt.add(k);
    notiere('6.9 Mehrdeutige Gründe: text der Antwort, sonst neutral', faelle.every(([, ist, soll]) => ist === soll) && neu9.length === 4 && !(await projekt()).spuren[3].freeze,
      `${faelle.map(([n, ist, soll]) => `${n}: „${ist}“${ist === soll ? '' : ` (erwartet „${soll}“)`}`).join('; ')}; Lead eingefroren ${!!(await projekt()).spuren[3].freeze}; provozierte Konsolenzeilen ${neu9.length}`);
  }
  // ================= Teil 6.10 (V2 Fix F14, Spec 6.34): Reload mitten im Freeze; die Seite sieht den Lauf (ausgabe_lauf) und danach den Freeze-Clip =================
  if (TEIL >= 6) {
    await seed('Teil 6 Reload');
    await postA('/attrappe/ausgabe', { freezeMs: 5000 });
    // V2 Fix-Runde 2 H3: Reload erst nach gut 2 s; der eigene Lauf zeigt Sekunden (Negativ-Kontrolle), der fremde nach dem Reload keine (vorher: seit dem Reload)
    const tKlick = Date.now();
    await b.klick('.p-kopf[data-spur="s4"] .p-freeze'); await warte(2300);
    const eigen = await w(`document.querySelector('[data-p="ausgabe"]').textContent`);
    await b.oeffne(URL); await warte(1200);
    const lauf = async () => w(`({ text: document.querySelector('[data-p="ausgabe"]').textContent, laeuft: document.querySelector('.p-kopf[data-spur="s4"] .p-freeze')?.classList.contains('laeuft') ?? null,
      gesperrt: document.querySelector('.p-kopf[data-spur="s4"] .p-freeze')?.disabled ?? null, exp: document.querySelector('[data-p="export"]').disabled, an: document.querySelector('.p-kopf[data-spur="s4"] .p-freeze')?.classList.contains('an') ?? null })`);
    const waehrend = await lauf();
    waehrend.ms = Date.now() - tKlick;
    let danach = null;
    for (let i = 0; i < 40; i++) { await warte(150); danach = await lauf(); if (danach.an) break; }
    await warte(300); danach = await lauf();
    const fz = (await projekt()).spuren[3].freeze;
    await postA('/attrappe/ausgabe', { freezeMs: 1500 });
    notiere('6.10 Reload während eines Freeze: Lauf sichtbar ohne Sekunden (eigener Lauf mit), danach der Freeze-Clip', /^Freezing Lead · bar \d+\.\d\.\d · 2 s$/.test(eigen) && /^Freezing Lead( · bar \d+\.\d\.\d)?$/.test(waehrend.text) && waehrend.laeuft && waehrend.gesperrt && waehrend.exp && danach.an && !danach.gesperrt && !danach.exp && danach.text === '' && fz?.kennung >= 1,
      `eigener Lauf nach 2,3 s: „${eigen}“; nach dem Reload (${waehrend.ms} ms nach dem Klick): „${waehrend.text}“, Schalter läuft ${waehrend.laeuft}, gesperrt ${waehrend.gesperrt}, EXPORT gesperrt ${waehrend.exp}; danach: an ${danach.an}, gesperrt ${danach.gesperrt}, EXPORT gesperrt ${danach.exp}, Text „${danach.text}“, freeze ${JSON.stringify(fz)}`);
  }
  // ================= Teil 6.11 (V2 Fix-Runde 2 H5, Klasse F3): PLAY, NEW und OPEN zeigen ein 5xx ohne Grund wie der Schreibweg =================
  // fetch-Haken in der Seite (unabhängig von der Attrappe): die nächste Anfrage auf weg antwortet roh. Negativ-Kontrolle: 409 mit Grund zeigt dessen Text.
  if (TEIL >= 6) {
    await seed('Teil 6 Fuenfhundert');
    const sv = 'The project server did not answer: showing the last state', k11 = fehlerKonsole().length, faelle = [];
    const auslöser = {
      '/proj/transport': () => b.klick('[data-p="play"]'),
      '/proj/neu': () => w(`(() => { document.querySelector('[data-p="neu"]').click(); const f = document.querySelector('[data-p="neu-name"]'); f.value = 'Probe Neu'; f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`),
      '/proj/oeffnen': () => w(`(() => { const s = document.querySelector('[data-p="oeffnen"]'); s.append(new Option('x', 'teil-6')); s.value = 'teil-6'; s.dispatchEvent(new Event('change')); return true; })()`),
    };
    for (const [weg, code, koerper, soll] of [
      ['/proj/transport', 409, { fehler: 'ki_gestoppt' }, 'Stop Cypher is set'], ['/proj/transport', 503, null, sv], ['/proj/transport', 502, { text: 'bad gateway' }, sv],
      ['/proj/neu', 409, { fehler: 'projekt_busy' }, 'Another process has this project open'], ['/proj/neu', 503, null, sv], ['/proj/neu', 502, { text: 'bad gateway' }, sv],
      ['/proj/oeffnen', 409, { fehler: 'projekt_busy' }, 'Another process has this project open'], ['/proj/oeffnen', 503, null, sv], ['/proj/oeffnen', 502, { text: 'bad gateway' }, sv]]) {
      await rohSeite(weg, code, koerper);
      await w(`document.querySelector('[data-p="meldung"]').textContent = ''`);
      await auslöser[weg](); await warte(500);
      faelle.push({ weg, code, soll, meldung: await w(`document.querySelector('[data-p="meldung"]').textContent`), offline: await w('window.djkProd.getrennt'), offen: await w('window.__roh !== null') });
    }
    for (const k of fehlerKonsole().slice(k11)) gewollt.add(k);
    notiere('6.11 PLAY, NEW, OPEN: 5xx ohne Grund heißt „Server antwortet nicht“, 409 mit Grund dessen Text', faelle.every((x) => x.meldung === x.soll && !x.offen && (x.code < 500 || x.offline === true)),
      faelle.map((x) => `${x.weg} ${x.code}${x.code === 503 ? ' (ohne Körper)' : x.code === 502 ? ' (nur text)' : ''}: „${x.meldung}“${x.meldung === x.soll ? '' : ` (soll „${x.soll}“)`}${x.code >= 500 ? `, OFFLINE ${x.offline}` : ''}`).join('; '));
    await w('window.__roh = null');
  }
  // ================= Teil 6.12 (V2 Fix-Runde 2 H7, Spec 6.34): Schreibweg, mehrdeutige Gründe mit dem text der Antwort, sonst neutral =================
  // METRO schickt ein metronom_setzen; der fetch-Haken der Seite antwortet roh. Negativ-Kontrolle: ein eindeutiger Grund behält seinen festen Text.
  if (TEIL >= 6) {
    await seed('Teil 6 Schreibweg');
    const neutral = await w(`(async () => { const a = (await import('/produktion/ausgabe.js')).AUSGABE_FEHLER; return { beschaeftigt: a.beschaeftigt, zu_gross: a.zu_gross }; })()`);
    const k12 = fehlerKonsole().length, faelle = [];
    for (const [name, code, koerper, soll] of [
      ['beschaeftigt mit text', 409, { fehler: 'beschaeftigt', text: 'a project is being opened; a freeze waits until it is open' }, 'A project is being opened; a freeze waits until it is open'],
      ['beschaeftigt ohne text', 409, { fehler: 'beschaeftigt' }, neutral.beschaeftigt],
      ['zu_gross mit text (S2, heute deutsch)', 400, { fehler: 'zu_gross', text: 'ausgerollt 700 Clips, 3 Noten (höchstens 512, 65536)' }, 'Ausgerollt 700 Clips, 3 Noten (höchstens 512, 65536)'],
      ['zu_gross ohne text', 400, { fehler: 'zu_gross' }, neutral.zu_gross],
      ['ki_gestoppt mit text (Negativ-Kontrolle)', 409, { fehler: 'ki_gestoppt', text: 'stop cypher is set' }, 'Stop Cypher is set']]) {
      await rohSeite('/proj/aendern', code, koerper);
      await w(`document.querySelector('[data-p="meldung"]').textContent = ''`);
      await b.klick('[data-p="metronom"]'); await warte(500);
      faelle.push({ name, soll, meldung: await w(`document.querySelector('[data-p="meldung"]').textContent`), offen: await w('window.__roh !== null') });
    }
    for (const k of fehlerKonsole().slice(k12)) gewollt.add(k);
    notiere('6.12 Schreibweg: beschaeftigt und zu_gross mit dem text der Antwort, sonst neutral', faelle.every((x) => x.meldung === x.soll && !x.offen) && !(await projekt()).metronom.an,
      faelle.map((x) => `${x.name}: „${x.meldung}“${x.meldung === x.soll ? '' : ` (soll „${x.soll}“)`}`).join('; '));
  }
  const fk = fehlerKonsole().filter((k) => !gewollt.has(k));
  notiere('9 Konsole', fk.length === 0, `Fehler/Exceptions ${fk.length} (ohne die ${gewollt.size} provozierten aus 6.5)${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text).join(' | ')}` : ''}`);
  await b.bild(path.join(ORDNER, 'clips.png'));
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await at.stoppe();
  await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe Clips ${zeit} (Instanz ${opt.instanz}, Teil ${TEIL})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
