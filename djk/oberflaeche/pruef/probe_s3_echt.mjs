// Browserprobe gegen den ECHTEN Seiten-Server (D1 S3, Auftrag 14 e, Spec 6.34): Prüfstapel auf einer Prüfinstanz (Kern-Attrappe, Zähl-Relais,
// Leitstand, Seiten-Server mit S2-Integration und S3), OHNE die Projekt-Attrappe davor. Der Stapel gibt Server und Kern-Attrappe eigene Ordner
// (Projekte, Arbeitsordner im tmp-Ordner der Probe, pruef/stapel.mjs proj), der Render ist das Test-Doppel tests/hilfen/render_attrappe.mjs
// (CYPHERDJ_RENDER), die Lautheit misst das echte ffmpeg. Kopfloser Chrome nur über cdp.mjs. Kein Ton, kein Fenster, kein Betrieb.
// Gefahren werden die Teil-6-Punkte der zwei V2-Proben, soweit sie ohne Attrappen-Steuerung gehen:
//   P6.x wie probe_produktion.mjs Teil 6 (Undo/Redo per Taste und Knopf, Verlauf mit Quelle Cypher, Undo-Titel),
//   C6.x wie probe_clips.mjs Teil 6 (FREEZE nur an der Wirt-Spur, Freeze mit Fortschritt, Unfreeze, Export mit Phasen und Ergebnis samt Lautheit,
//   Grund bei laufendem Transport, Reload während eines Freeze), dazu die Konsole.
// Aufruf: node pruef/probe_s3_echt.mjs [--instanz i]   Ergebnis: pruef/ergebnisse/<zeit>-echt/bericht.md und ergebnis.json; Exit 1 bei FEHL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';
import { baueKatalog } from '../tests/hilfen/katalog.mjs';
import { starteWirtProzess, schreibeWirtStatus } from '../tests/hilfen/wirt_prozess.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: process.env.CYPHERDJ_PROBE_INSTANZ ?? 'i' } } });
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;   // wie probe_produktion.mjs: die Mediathek-Hilfe sperrt sonst Instanz h
const { baueMediathek } = await import('../tests/hilfen/mediathek.mjs');
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = path.join(HIER, 'ergebnisse', `${zeit}-s3-echt`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnis = { zeit, instanz: opt.instanz, punkte: {} };
const zeilen = [];
const notiere = (k, ok, text) => { ergebnis.punkte[k] = { ok, text }; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

// ---------- Ordner der Probe: Katalog mit einem Kick, Projekte und Arbeitsordner (nie ~/cypherdj-projekte, nie ~/.cache/cypherdj-<i>/arr) ----------
const SHA = 'a'.repeat(64);
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-echt-'));
const kickWav = path.join(fix, 'kick.wav');
execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'sine=f=80:d=0.5,volume=0.9', '-ar', '44100', kickWav]);
const mt = baueMediathek(path.join(fix, 'mt'));
baueKatalog(fix, [{ typ: 'oneshot', sha: SHA, shas: SHA, name: 'Kick 1', instrument: 'kick', pack: 'Probe', dauer_s: 0.5, pfad: kickWav }]);
const proj = { wurzel: path.join(fix, 'proj'), arbeitsordner: path.join(fix, 'arr') };
// Vorgaben der Instanz, die ein Server ohne proj-Ordner nähme (projekt/ablage.ts, bereiche/proj/konfig.ts): vorher und nachher gleich
const VORGABE_ORDNER = [`/dev/shm/cypherdj-${opt.instanz}/projekte`, path.join(os.homedir(), '.cache', `cypherdj-${opt.instanz}`, 'arr')];
const liste = (d) => { try { return fs.readdirSync(d).sort(); } catch { return null; } };
const vorherOrdner = new Map(VORGABE_ORDNER.map((d) => [d, liste(d)]));
const RENDER = path.join(HIER, '..', 'tests', 'hilfen', 'render_attrappe.mjs');

const s = await starteStapel(ORDNER, opt.instanz, { CYPHERDJ_RENDER: RENDER },
  { serverArgs: ['--katalog', path.join(fix, 'katalog.sqlite'), '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle')], proj });
const URL = s.url;
const b = await starteBrowser();
const w = (x) => b.werte(x);
const fehlerKonsole = () => b.konsole.filter((k) => k.typ === 'exception' || k.typ === 'error');
const api = async (methode, weg, d, kopf = {}) => {
  const r = await fetch(URL + weg.slice(1), methode === 'GET' ? {} : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(d ?? {}) });
  return { code: r.status, j: await r.json() };
};
const aktuell = async () => (await api('GET', '/proj/aktuell')).j;
const projekt = () => w('window.djkProd.projekt');
const VK = { ArrowRight: 39 };
const taste = async (key, code, modifiers = 0) => {
  const vk = VK[key] ?? key.toUpperCase().charCodeAt(0);
  await b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: vk });
  await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: vk });
};
const geladen = async () => { for (let i = 0; i < 150; i++) { const a = await aktuell(); if (a.kern?.rev_geladen === a.projekt?.wiedergabe_rev && a.kern?.status === 0) return true; await warte(50); } return false; };

const WIRT = `/dev/shm/cypherdj-${opt.instanz}`;   // Wirt-Ordner der Prüfinstanz (nie der Betrieb): die Status-Datei, die djk-instrumente --arr1 schreibt
fs.mkdirSync(WIRT, { recursive: true });
// S3-Fix W2: der Server prüft bereit:true und eine lebende pid namens wirt.py; ein Stellvertreter (tests/hilfen/wirt_prozess.mjs) steht dafür ein
const wirtProzess = await starteWirtProzess({ after: () => {} });   // beendet wird im finally unten (beende)
schreibeWirtStatus(WIRT, { pid: wirtProzess.pid });

try {
  // Projekt über die echte API (wie Cypher über MCP): Kick (Audio aus dem Katalog), Snare (leer), Bass (RB-338), Lead (Surge, 8 Beats), Loop 0..16,
  // Projekttempo = Master-Tempo der Kern-Attrappe (128): keine Rampe vor dem Freeze (Spec 6.33)
  const neu = await api('POST', '/proj/neu', { name: 'Echt' });
  if (neu.code !== 200) throw new Error(`/proj/neu ${neu.code} ${JSON.stringify(neu.j)}`);
  const slug = neu.j.slug;
  const auf = await api('POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'Aufbau', befehle: [
    { befehl: 'tempo_setzen', bpm: 128 },
    { befehl: 'spur_neu', art: 'audio', name: 'Kick' }, { befehl: 'spur_neu', art: 'audio', name: 'Snare' },
    { befehl: 'spur_neu', art: 'instrument', name: 'Bass', geraet: { art: 'intern' } },
    { befehl: 'spur_neu', art: 'instrument', name: 'Lead', geraet: { art: 'wirt' } },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 4, laenge_beats: 4, sha256: SHA },
    { befehl: 'clip_neu', spur_id: 's3', art: 'midi', start_beat: 8, laenge_beats: 4, noten: [{ beat: 0, laenge: 0.5, ton: 36, vel: 100 }] },
    { befehl: 'clip_neu', spur_id: 's4', art: 'midi', start_beat: 0, laenge_beats: 8, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }] },
    { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }] });
  if (auf.code !== 200) throw new Error(`/proj/aendern ${auf.code} ${JSON.stringify(auf.j)}`);
  for (let i = 0; i < 100 && (await aktuell()).projekt.spuren[0].clips[0].dekodiert !== 'fertig'; i++) await warte(100);
  await warte(2500);   // die Tempo-Rampe aus tempo_setzen (ab dem nächsten Takt, 4 Beats) ist vorbei
  await geladen();

  await b.oeffne(URL);
  await warte(1500);
  await w(`localStorage.setItem('djk-prod-raster', 'beat')`);
  await b.klick('[data-ansicht="produktion"]'); await warte(1200);
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== slug; i++) await warte(100);
  notiere('E0 Seite zeigt das Projekt des echten Servers', (await w('window.djkProd.slug')) === slug && (await projekt())?.spuren.length === 4, `slug ${await w('window.djkProd.slug')}, Spuren ${(await projekt())?.spuren.length}`);

  // ---------- P6: Undo/Redo, Verlauf, Quelle Cypher (probe_produktion.mjs Teil 6) ----------
  {
    const sel = '.p-kopf[data-spur="s1"] .p-fader';
    const f0 = (await projekt()).spuren[0].fader_db;
    await w(`document.querySelector(${JSON.stringify(sel)}).focus()`);
    await taste('ArrowRight', 'ArrowRight'); await warte(600);
    const f1 = (await aktuell()).projekt.spuren[0].fader_db;
    await taste('z', 'KeyZ', 2); await warte(600);
    const f2 = (await aktuell()).projekt.spuren[0].fader_db;
    await w(`document.activeElement?.blur()`);
    await taste('z', 'KeyZ', 2 | 8); await warte(600);
    const f3 = (await aktuell()).projekt.spuren[0].fader_db;
    notiere('P6.1 Undo/Redo per Taste am echten Server', f1 !== f0 && f2 === f0 && f3 === f1, `fader_db ${f0} → Pfeiltaste ${f1} → Strg+Z ${f2} → Strg+Umschalt+Z ${f3}`);
    const rev = (await aktuell()).projekt.rev;
    const cy = await api('POST', '/proj/aendern', { rev, label: 'Cypher mute', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', mute: true }] }, { 'x-djk-quelle': 'cypher' });
    await warte(800);
    await b.klick('[data-p="verlauf"]'); await warte(400);
    const liste = await w(`[...document.querySelectorAll('[data-p="verlauf-liste"] li')].map((li) => li.textContent)`);
    const verlauf = (await api('GET', '/proj/verlauf')).j;
    notiere('P6.2 Verlauf mit Quelle', cy.code === 200 && liste.length === Math.min(40, verlauf.length) && liste[0]?.endsWith('Cypher mute  · Cypher') && liste.slice(1).some((z) => z.endsWith('· You')) && (await projekt()).spuren[1].mute === true,
      `${liste.length} Zeilen (Server ${verlauf.length}); oben „${liste[0]}“; Cyphers Änderung ${cy.code}`);
    await b.klick('[data-p="verlauf"]'); await warte(200);
    const undoTitel = await w(`document.querySelector('[data-p="undo"]').title`);
    await b.klick('[data-p="undo"]'); await warte(700);
    const mNach = (await aktuell()).projekt.spuren[1].mute, redoTitel = await w(`document.querySelector('[data-p="redo"]').title`);
    await b.klick('[data-p="redo"]'); await warte(700);
    const mRedo = (await aktuell()).projekt.spuren[1].mute, redoSperre = await w(`document.querySelector('[data-p="redo"]').disabled`);
    notiere('P6.3 Knöpfe UNDO und REDO mit Titel', undoTitel === 'Undo: Cypher mute (Ctrl+Z)' && mNach === false && redoTitel === 'Redo: Cypher mute (Ctrl+Shift+Z)' && mRedo === true && redoSperre === true,
      `Undo-Titel „${undoTitel}“; nach UNDO mute ${mNach}, Redo-Titel „${redoTitel}“; nach REDO mute ${mRedo}, REDO danach gesperrt ${redoSperre}`);
  }
  await geladen();

  // ---------- C6: FREEZE und EXPORT (probe_clips.mjs Teil 6) ----------
  const ausgabe = () => w(`({ text: document.querySelector('[data-p="ausgabe"]').textContent, titel: document.querySelector('[data-p="ausgabe"]').title })`);
  const knopf = await w(`[...document.querySelectorAll('.p-kopf')].map((k) => k.dataset.spur + ':' + (k.querySelector('.p-freeze') ? 1 : 0)).join(' ')`);
  notiere('C6.1 FREEZE nur an der Wirt-Spur', knopf === 's1:0 s2:0 s3:0 s4:1', `Köpfe ${knopf}`);
  {
    await b.klick('.p-kopf[data-spur="s4"] .p-freeze');
    let waehrend = null, lauf = null;
    for (let i = 0; i < 60; i++) {
      await warte(100);
      waehrend = await w(`({ text: document.querySelector('[data-p="ausgabe"]').textContent, laeuft: document.querySelector('.p-freeze').classList.contains('laeuft'), gesperrt: document.querySelector('.p-freeze').disabled, exp: document.querySelector('[data-p="export"]').disabled })`);
      lauf = (await aktuell()).ausgabe_lauf;
      if (/· bar /.test(waehrend.text)) break;
    }
    let nach = null;
    for (let i = 0; i < 200; i++) { await warte(100); nach = await w(`({ an: document.querySelector('.p-freeze').classList.contains('an'), geraet: document.querySelector('.p-kopf[data-spur="s4"] .p-geraet').textContent, exp: document.querySelector('[data-p="export"]').disabled, text: document.querySelector('[data-p="ausgabe"]').textContent })`); if (nach.an) break; }
    const fz = (await aktuell()).projekt.spuren[3].freeze;
    const datei = fz ? path.join(proj.arbeitsordner, fz.datei) : '';
    notiere('C6.2 Freeze mit Fortschritt am echten Server (Kern-Attrappe, Echtzeit)', /^Freezing Lead · bar \d+\.\d\.\d · \d+ s$/.test(waehrend.text) && waehrend.laeuft && waehrend.gesperrt && waehrend.exp
      && JSON.stringify(lauf) === '{"art":"freeze","spur_id":"s4"}' && nach.an && nach.geraet === 'SURGE · 1 · FROZEN' && !nach.exp && !!fz && fs.existsSync(datei) && fs.statSync(datei).size === fz.frames * 8,
      `während: „${waehrend.text}“, läuft ${waehrend.laeuft}, gesperrt ${waehrend.gesperrt}, EXPORT gesperrt ${waehrend.exp}, ausgabe_lauf ${JSON.stringify(lauf)}; danach an ${nach.an}, Kopf „${nach.geraet}“, freeze ${JSON.stringify(fz)}, Datei ${fs.existsSync(datei) ? `${fs.statSync(datei).size} Bytes` : 'fehlt'}`);
  }
  await geladen();
  await b.klick('.p-kopf[data-spur="s4"] .p-freeze'); await warte(800);
  notiere('C6.3 Unfreeze', (await aktuell()).projekt.spuren[3].freeze === null && !(await w(`document.querySelector('.p-freeze').classList.contains('an')`)), `freeze ${JSON.stringify((await aktuell()).projekt.spuren[3].freeze)}`);
  await geladen();
  {
    await b.klick('[data-p="export"]');
    const texte = new Set();
    for (let i = 0; i < 300; i++) { const t = (await ausgabe()).text; texte.add(t); if (/^Exported /.test(t)) break; await warte(60); }
    const erg = await ausgabe();
    const phasen = [...texte].map((t) => t.replace(/ · .*$/, '').replace(/^(Exporting: \w+).*/, '$1'));
    // Loop 0..16 bei 128 BPM = 7,5 s; Spitze und True Peak des Sinus aus dem Render-Doppel −6 dB, LUFS-I vom echten ffmpeg
    const name = new RegExp(`^Exported ${slug}-\\d{8}-\\d{6}\\.wav · 7\\.5 s · peak −6\\.0 dBFS · −\\d+\\.\\d LUFS, true peak −6\\.0 dBTP$`);
    notiere('C6.4 Export mit Phasen und Ergebnis (Render-Doppel, echtes ffmpeg)', phasen.includes('Exporting: freezing') && phasen.includes('Exporting: rendering') && name.test(erg.text)
      && erg.titel.startsWith(path.join(proj.wurzel, slug, 'export') + '/') && fs.existsSync(erg.titel) && !!(await aktuell()).projekt.spuren[3].freeze,
      `Phasen ${JSON.stringify([...new Set(phasen)])}; Ergebnis „${erg.text}“ (Titel ${erg.titel}, Datei ${fs.existsSync(erg.titel)}); Lead danach eingefroren ${!!(await aktuell()).projekt.spuren[3].freeze}`);
  }
  {
    const k0 = fehlerKonsole().length;
    await b.klick('[data-p="play"]');
    for (let i = 0; i < 40 && (await aktuell()).kern.status !== 2; i++) await warte(50);
    await b.klick('[data-p="export"]'); await warte(600);
    const m1 = await w(`document.querySelector('[data-p="meldung"]').textContent`);
    await b.klick('[data-p="stopp"]'); await warte(600);
    const neuK = fehlerKonsole().slice(k0);
    notiere('C6.5 Grund bei laufendem Transport', m1 === 'Stop the transport first' && neuK.length === 1 && /409/.test(neuK[0].text), `Meldung „${m1}“; Konsole ${neuK.map((k) => k.text.slice(-60)).join(' | ')}`);
  }
  await geladen();
  {
    // Reload mitten im Freeze (Spec 6.34): erst verwerfen, dann FREEZE, nach gut 1 s neu laden; die Seite sieht den Lauf (ausgabe_lauf), danach den Freeze
    await b.klick('.p-kopf[data-spur="s4"] .p-freeze');                  // Unfreeze über die Seite, bis sie es zeigt
    for (let i = 0; i < 40 && (await w(`document.querySelector('.p-kopf[data-spur="s4"] .p-freeze').classList.contains('an')`)); i++) await warte(100);
    await geladen();
    await b.klick('.p-kopf[data-spur="s4"] .p-freeze'); await warte(1300);
    await b.oeffne(URL); await warte(1500);
    if ((await w('document.querySelector("#produktion")?.hidden')) !== false) { await b.klick('[data-ansicht="produktion"]'); await warte(800); }
    const lauf = () => w(`({ text: document.querySelector('[data-p="ausgabe"]').textContent, laeuft: document.querySelector('.p-kopf[data-spur="s4"] .p-freeze')?.classList.contains('laeuft') ?? null,
      exp: document.querySelector('[data-p="export"]').disabled, an: document.querySelector('.p-kopf[data-spur="s4"] .p-freeze')?.classList.contains('an') ?? null })`);
    const waehrend = await lauf();
    let danach = null;
    for (let i = 0; i < 100; i++) { await warte(150); danach = await lauf(); if (danach.an) break; }
    notiere('C6.10 Reload während eines Freeze: Lauf sichtbar, danach der Freeze', /^Freezing Lead/.test(waehrend.text) && waehrend.laeuft && waehrend.exp && danach.an && !danach.exp,
      `nach dem Reload: „${waehrend.text}“, läuft ${waehrend.laeuft}, EXPORT gesperrt ${waehrend.exp}; danach an ${danach.an}, EXPORT gesperrt ${danach.exp}`);
  }
  const fk = fehlerKonsole().filter((k) => !/status of 409/.test(k.text));
  notiere('E9 Konsole', fk.length === 0, `Fehler/Exceptions außer dem provozierten 409: ${fk.length}${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text).join(' | ')}` : ''}`);
  const ausserhalb = VORGABE_ORDNER.map((d) => [d, liste(d)]).filter(([d, l]) => JSON.stringify(l) !== JSON.stringify(vorherOrdner.get(d)));
  notiere('E10 Nichts in den Vorgabe-Ordnern der Instanz', ausserhalb.length === 0 && fs.readdirSync(proj.wurzel).includes(slug),
    `Projekte unter ${proj.wurzel}: ${fs.readdirSync(proj.wurzel).join(', ')}; Arbeitsordner ${fs.readdirSync(proj.arbeitsordner).length} Einträge; verändert außerhalb: ${ausserhalb.map(([d]) => d).join(', ') || 'nichts'} (${VORGABE_ORDNER.join(', ')})`);
  await b.bild(path.join(ORDNER, 'echt.png'));
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  fs.rmSync(path.join(WIRT, 'wirt-arr1.json'), { force: true });
  await wirtProzess.beende();
  await b.zu();
  await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe gegen den echten Server ${zeit} (Instanz ${opt.instanz})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
