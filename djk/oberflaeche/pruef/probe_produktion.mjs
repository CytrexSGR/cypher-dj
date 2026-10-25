// Browserprobe PRODUCTION-Ansicht (D1 V1). Prüfstapel auf einer Prüfinstanz (Kern-Attrappe + Zähl-Relais + Leitstand +
// echter Seiten-Server mit Test-Katalog), davor die Projekt-Attrappe (pruef/proj_attrappe.mjs, S2 entsteht parallel),
// kopfloser Chrome über cdp.mjs mit echten Maus-, Rad- und Zieh-Ereignissen. Kein Ton, kein Fenster, kein Betrieb.
// Aufruf: node pruef/probe_produktion.mjs [--instanz i] [--teil 6]   (Teil n prüft die Slices 1..n; Browser-Probe ist Instanz i, Spec §4)
// Ergebnis: pruef/ergebnisse/<zeit>-produktion/bericht.md und ergebnis.json; Exit 1, wenn ein Punkt FEHL ist.
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
// tests/hilfen/mediathek.mjs belegt beim Import die Test-Instanz (Sperre /dev/shm/cypherdj-testinstanz-<i>.sperre, ab S1). Ohne
// diese Zeile wäre das Vorgabe h und die Probe blockierte jede Suite auf h (und umgekehrt): die Probe nimmt ihre eigene Instanz,
// und der Import ist deshalb dynamisch, NACH dem Setzen.
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const { baueMediathek } = await import('../tests/hilfen/mediathek.mjs');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${String(d0.getMonth() + 1).padStart(2, '0')}${String(d0.getDate()).padStart(2, '0')}T${String(d0.getHours()).padStart(2, '0')}${String(d0.getMinutes()).padStart(2, '0')}${String(d0.getSeconds()).padStart(2, '0')}`;
const ORDNER = path.join(HIER, 'ergebnisse', `${zeit}-produktion`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnis = { zeit, instanz: opt.instanz, teil: TEIL, punkte: {} };
const zeilen = [];
const notiere = (k, ok, text) => { ergebnis.punkte[k] = { ok, text }; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)) : []);

// ---------- Test-Katalog: Kick (Datei da), Ableton-geschützt, Datei fehlt ----------
const SHA = { kick: 'a'.repeat(64), live: 'c'.repeat(64), weg: 'e'.repeat(64) };
const fix = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-prod-'));
const daten = path.join(fix, 'daten'); fs.mkdirSync(daten);
const kickWav = path.join(daten, 'kick.wav');
execFileSync('ffmpeg', ['-v', 'quiet', '-y', '-f', 'lavfi', '-i', 'sine=f=80:d=0.5,volume=0.9', '-ar', '44100', kickWav]);
fs.writeFileSync(path.join(daten, 'live.aif'), 'FORM....AIFFkein Audio');
const mt = baueMediathek(path.join(fix, 'mt'));
baueKatalog(fix, [
  { typ: 'oneshot', sha: SHA.kick, shas: SHA.kick, name: 'Kick 1', instrument: 'kick', pack: 'Probe', dauer_s: 0.5, pfad: kickWav },
  { typ: 'oneshot', sha: SHA.live, shas: SHA.live, name: 'Live Kick', instrument: 'kick', pack: 'Probe', dauer_s: 0.5, schutz: 'ableton', pfad: path.join(daten, 'live.aif') },
  { typ: 'oneshot', sha: SHA.weg, shas: SHA.weg, name: 'Gone Kick', instrument: 'kick', pack: 'Probe', dauer_s: 0.5, pfad: path.join(daten, 'fehlt.wav') },
]);

const s = await starteStapel(ORDNER, opt.instanz, {}, { serverArgs: ['--katalog', path.join(fix, 'katalog.sqlite'), '--mediathek', mt.db, '--welle-cache', path.join(fix, 'welle')] });
const at = await starteProjAttrappe({ oben: s.url, dekodierMs: 300 });
const URL = at.url;
const ABO = s.ports.abo;
const relais = () => jsonl(path.join(ORDNER, 'relais.jsonl'));
const log = () => at.zustand.log;
const b = await starteBrowser();
const w = (x) => b.werte(x);
const ansicht = (a) => b.klick(`[data-ansicht="${a}"]`);
const rect = (sel) => w(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; })()`);
// Der Browser meldet die gewollten Ausfälle aus 3.8 (503 der Attrappe, gekappter Strom) und die gewollte 409-Antwort aus 3.9 als „Failed to load resource“: die zählen nicht als Fehler der Seite, alles andere schon
const AUSFALL = /^Failed to load resource: (net::ERR_INCOMPLETE_CHUNKED_ENCODING|net::ERR_EMPTY_RESPONSE|the server responded with a status of (503|409))/;
const fehlerKonsole = () => b.konsole.filter((k) => (k.typ === 'exception' || k.typ === 'error') && !AUSFALL.test(k.text));
const erwarteteKonsole = () => b.konsole.filter((k) => k.typ === 'error' && AUSFALL.test(k.text)).length;
// Seiten-Koordinate eines Beats in Spur i (Mitte der Spurzeile)
const punkt = async (beat, spur) => {
  const f = await rect('[data-p="flaeche"]');
  const a = await w('window.djkProd.ansicht');
  return { x: f.l + (beat - a.beat0) * a.pxProBeat, y: f.t + spur * 64 + 32 };
};
const rad = (x, y, deltaY, modifiers = 0) => b.sende('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, modifiers });
const taste = async (key, code, modifiers) => {
  await b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
  await b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) });
};
const tippe = async (text) => { for (const c of text) await b.sende('Input.dispatchKeyEvent', { type: 'char', text: c }); };
const enter = () => b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
const projekt = () => w('window.djkProd.projekt');
// kräftig farbige Pixel in einem Rechteck der Spurfläche: R+G+B > 300 (Hintergründe und die blasse Clip-Fläche liegen
// darunter, Welle und Noten in voller Farbe darüber; gemessen 2026-10-15: Clip-Fläche allein ergab 552 Pixel über 120)
const farbig = (x, y, bw, bh) => w(`(() => { const c = document.querySelector('[data-p="spuren"]'); const d = c.getContext('2d').getImageData(${Math.round(x)}, ${Math.round(y)}, ${Math.round(bw)}, ${Math.round(bh)}).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) n++; return n; })()`);

// Pixel im Bereich lo < R+G+B ≤ hi (Schraffur des Freeze liegt zwischen Clip-Fläche und Welle/Noten, Werte in 2.5b gemessen)
// Pixel nahe an einer Farbe (Notenkästen sind in voller Spurfarbe; der Text „FROZEN“ ist hell und grau, die Schraffur durchscheinend)
const farbTreffer = (x, y, bw, bh, rgb, tol) => w(`(() => { const c = document.querySelector('[data-p="spuren"]'); const d = c.getContext('2d').getImageData(${Math.round(x)}, ${Math.round(y)}, ${Math.round(bw)}, ${Math.round(bh)}).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - ${rgb[0]}) <= ${tol} && Math.abs(d[i + 1] - ${rgb[1]}) <= ${tol} && Math.abs(d[i + 2] - ${rgb[2]}) <= ${tol}) n++; return n; })()`);
const SCHRAF_LO = 170, SCHRAF_HI = 300;   // Schraffur (Farbe mit Alpha 0x60) liegt über der Clip-Fläche (≈ 120) und unter Welle/Noten (> 300)
const bereichPixel = (x, y, bw, bh, lo, hi) => w(`(() => { const c = document.querySelector('[data-p="spuren"]'); const d = c.getContext('2d').getImageData(${Math.round(x)}, ${Math.round(y)}, ${Math.round(bw)}, ${Math.round(bh)}).data; let n = 0; for (let i = 0; i < d.length; i += 4) { const t = d[i] + d[i + 1] + d[i + 2]; if (t > ${lo} && t <= ${hi}) n++; } return n; })()`);
// Saat-Projekt für 2.5 und 3.7: Audio-Clip mit Welle, MIDI-Clip, dazu eine eingefrorene Wirt-Spur mit Noten (die nicht gezeigt werden dürfen)
const saatProjekt = () => {
  const saat = neuesProjekt('Seed');
  saat.spuren.push({ id: 's90', nr: 1, name: 'Kick', farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false,
    clips: [{ id: 'c91', art: 'audio', name: 'kick', start_beat: 0, laenge_beats: 1, quelle: { sha256: SHA.kick, pfad_hinweis: null }, dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }] });
  saat.spuren.push({ id: 's92', nr: 2, name: 'Bass', farbe: '#3b8de0', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} }, fader_db: 0, pan: 0, mute: false, solo: false,
    clips: [{ id: 'c93', art: 'midi', name: 'bassline', start_beat: 0, laenge_beats: 4, noten: [{ id: 'n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 }, { id: 'n2', beat: 2, laenge: 0.5, ton: 43, vel: 100 }] }] });
  saat.spuren.push({ id: 's94', nr: 3, name: 'Lead', farbe: '#9b59d0', art: 'instrument', geraet: { art: 'wirt', name: 'surge', slot: 1 }, freeze: { datei: 'freeze/s94-1.f32', frames: 96000, kennung: 1 },
    fader_db: 0, pan: 0, mute: false, solo: false,
    clips: [{ id: 'c95', art: 'midi', name: 'lead', start_beat: 0, laenge_beats: 4, noten: [{ id: 'n1', beat: 0, laenge: 0.5, ton: 60, vel: 100 }, { id: 'n2', beat: 2, laenge: 0.5, ton: 67, vel: 100 }] }] });
  return saat;
};
const seed = async () => {
  const r = await (await fetch(URL + 'attrappe/saat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projekt: saatProjekt() }) })).json();
  await fetch(URL + 'attrappe/sse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'proj', f: { slug: r.slug, rev: 1, label: 'seed', quelle: 'cypher' } }) });
  return r;
};
const oeffneProjekt = async (slug) => {
  await w(`(() => { const s = document.querySelector('[data-p="oeffnen"]'); s.dispatchEvent(new Event('focus')); })()`); await warte(300);
  await w(`(() => { const s = document.querySelector('[data-p="oeffnen"]'); s.value = ${JSON.stringify(slug)}; s.dispatchEvent(new Event('change')); })()`); await warte(600);
};

try {
  await b.oeffne(URL);
  await warte(1500);
  // ================= Teil 1: Ansicht, Raster, LIBRARY, Wiederherstellung, kein Kern-Befehl (A1) =================
  const knoepfe = await w(`[...document.querySelectorAll('[data-ansicht]')].map((x) => x.textContent)`);
  notiere('1.1 Umschalter', JSON.stringify(knoepfe) === '["DJ","STUDIO","PRODUCTION"]', `Knöpfe ${JSON.stringify(knoepfe)}`);
  const t0 = Date.now();
  const gesendetVor = await w('window.djkGesendet.length');
  await ansicht('produktion'); await warte(1200);
  await ansicht('studio'); await warte(400);
  await ansicht('dj'); await warte(400);
  await ansicht('produktion'); await warte(1200);
  const t1 = Date.now();
  const vonSeite = relais().filter((z) => z.t >= t0 && z.t <= t1 && z.von_port === ABO && z.adresse !== '/k/hallo');
  const griffe = (await w('window.djkGesendet.length')) - gesendetVor;
  // Positiv-Kontrolle des Instruments: ein Griff MUSS am Relais erscheinen
  const tp = Date.now();
  await w(`fetch('/griff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad: 'cue/mix', u: 0.5 }) }).then((r) => r.status)`);
  await warte(500);
  const positiv = relais().filter((z) => z.t >= tp && z.von_port === ABO && z.adresse !== '/k/hallo').length;
  notiere('1.2 Wechsel ohne Kern-Befehl (A1)', vonSeite.length === 0 && griffe === 0 && positiv >= 1,
    `Befehle der Seite an den Kern während 4 Wechseln: ${vonSeite.length} (${[...new Set(vonSeite.map((z) => z.adresse))].join(', ') || '–'}), Griffe ${griffe}; Gegenprobe ein Griff → ${positiv} am Relais`);
  const kl = await w(`document.body.className`);
  const best = await rect('#bestand'), prod = await rect('#produktion'), tr = await rect('.p-transport'), ar = await rect('.p-arr'), de = await rect('.p-detail');
  const pult = await w(`getComputedStyle(document.querySelector('#pult')).display`);
  const lay = await w('({ sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth })');
  notiere('1.3 Raster PRODUCTION', kl.includes('produktion') && best.r <= prod.l && best.w < prod.w && tr.b <= ar.t && ar.b <= de.t && pult === 'none' && lay.sh <= lay.ih && lay.sw <= lay.iw,
    `body ${kl}; Browser x ${best.l | 0}..${best.r | 0}, Produktion ab ${prod.l | 0}; Transport ${tr.t | 0}..${tr.b | 0}, Arrangement ${ar.t | 0}..${ar.b | 0}, Detail ab ${de.t | 0}; #pult ${pult}; Seite ${lay.sw}×${lay.sh} in ${lay.iw}×${lay.ih}`);
  await b.klick('[data-typ="oneshot"]'); await warte(800);   // Reiter SAMPLES: der Test-Katalog hat nur Samples
  const lib = await w(`({ tabelle: getComputedStyle(document.querySelector('[data-tabelle="library"]')).display, andere: [...document.querySelectorAll('[data-tabelle]:not([data-tabelle="library"])')].map((t) => getComputedStyle(t).display), detail: getComputedStyle(document.querySelector('.st-detail')).display, effekte: getComputedStyle(document.querySelector('#effekte')).display, zeilen: document.querySelectorAll('#libliste tr').length })`);
  notiere('1.4 LIBRARY schmal', lib.tabelle !== 'none' && lib.andere.length >= 2 && lib.andere.every((d) => d === 'none') && lib.detail === 'none' && lib.effekte === 'none' && lib.zeilen === 3,
    `Tabelle LIBRARY ${lib.tabelle}, die anderen Tabellen ${lib.andere}, Detail ${lib.detail}, EFFECTS ${lib.effekte}, Zeilen ${lib.zeilen} (ohne Klick auf DJ-Knöpfe, per CSS-Klasse)`);
  // lib-zu in PRODUCTION (Spec 2.11: „lib-zu klappt ihn ein“): Taste L klappt den Browser auf die Schublade, nochmal L öffnet ihn
  const arrVor = await rect('.p-arr');
  await taste('l', 'KeyL', 0); await warte(400);
  const zuBest = await rect('#bestand'), zuArr = await rect('.p-arr'), zuKl = await w(`document.body.classList.contains('lib-zu')`);
  await taste('l', 'KeyL', 0); await warte(400);
  const aufBest = await rect('#bestand'), aufArr = await rect('.p-arr'), aufKl = await w(`document.body.classList.contains('lib-zu')`);
  notiere('1.4b lib-zu klappt den Browser ein', zuKl && zuBest.w <= 40 && zuArr.w > arrVor.w + 100 && !aufKl && aufBest.w > 200 && Math.abs(aufArr.w - arrVor.w) < 1,
    `zu: lib-zu ${zuKl}, Browser ${zuBest.w | 0} px, Arrangement ${arrVor.w | 0} → ${zuArr.w | 0} px; Negativ-Kontrolle nochmal L: lib-zu ${aufKl}, Browser ${aufBest.w | 0} px, Arrangement ${aufArr.w | 0} px`);
  await b.oeffne(URL); await warte(1500);
  const wieder = await w(`({ k: document.body.classList.contains('produktion'), p: document.querySelector('[data-ansicht="produktion"]').getAttribute('aria-pressed') })`);
  await w(`localStorage.setItem('djk-ansicht', 'quatsch')`);
  await b.oeffne(URL); await warte(1200);
  const quatsch = await w(`document.body.classList.contains('produktion') || document.body.classList.contains('studio')`);
  await ansicht('produktion'); await warte(800);
  notiere('1.5 Wiederherstellung', wieder.k && wieder.p === 'true' && !quatsch, `nach Neuladen PRODUCTION ${wieder.k} (aria-pressed ${wieder.p}); Negativ-Kontrolle „quatsch“ im Speicher → DJ: ${!quatsch}`);
  const text = await w(`document.querySelector('#produktion').innerText`);
  const fehlend = ['PLAY', 'STOP', 'TEMPO', 'GRID', 'UNDO', 'REDO', 'HISTORY', 'No project open'].filter((x) => !text.includes(x));
  notiere('1.6 Englisch', !/[äöüÄÖÜß]/.test(text) && fehlend.length === 0, `Umlaute ${/[äöüÄÖÜß]/.test(text)}; fehlende Wörter ${fehlend.join(', ') || '–'}`);

  // 1.7 PRODUCTION berührt keinen DJ-Zustand: kein synthetischer Klick auf BOTTOM-PANEL- oder Reiter-Knöpfe (schrieb djk-bereich
  // und setzte den Fokus in #lib-suche). DJ-Zustand vorher: EFFECTS-Bereich, Reiter LOOPS, Fokus außerhalb der Suche.
  {
    await ansicht('dj'); await warte(300);
    await w(`(() => { document.querySelector('[data-bereich="effekte"]').click(); document.querySelector('[data-reiter="loops"]').click(); document.activeElement?.blur(); })()`); await warte(300);
    const dj0 = await w(`({ bereich: localStorage.getItem('djk-bereich'), effekte: document.body.classList.contains('bereich-effekte'), loops: document.querySelector('[data-reiter="loops"]').classList.contains('an') })`);
    const abrufe = () => w(`performance.getEntriesByType('resource').filter((e) => e.name.includes('/stoebern?')).length`);
    const a0 = await abrufe();
    await ansicht('produktion'); await warte(1200);
    const geladen = (await abrufe()) - a0;     // der Test-Katalog hat keine Tracks (Liste leer): geprüft wird, dass der Abruf ohne Klick geschah
    const inP = await w(`({ bereich: localStorage.getItem('djk-bereich'), fokus: document.activeElement?.id ?? '', tabelle: getComputedStyle(document.querySelector('[data-tabelle="library"]')).display, andere: [...document.querySelectorAll('[data-tabelle]:not([data-tabelle="library"])')].map((t) => getComputedStyle(t).display), effekte: getComputedStyle(document.querySelector('#effekte')).display, zeilen: document.querySelectorAll('#libliste tr').length })`);
    // 1.8 Tastatur der Library in PRODUCTION (Fix 3.1): DJ-Reiter LOOPS ist gewählt, das hidden-Attribut der Library-Tabelle steht, PRODUCTION
    // zeigt sie nur per CSS. ↓ ↓ muss trotzdem die Zeile wählen, Leertaste das Vorhören anstoßen (POST /vorhoeren an die Kern-Attrappe).
    await b.klick('[data-typ="oneshot"]'); await warte(800);
    await w(`document.activeElement?.blur(); 1`);
    const vh = () => w(`performance.getEntriesByType('resource').filter((e) => e.name.includes('/vorhoeren')).length`);
    const gewaehlt18 = () => w(`[...document.querySelectorAll('#libliste tr')].map((tr, i) => (tr.classList.contains('gewaehlt') ? i : -1)).filter((i) => i >= 0).join(',')`);   // Zeilennummer(n) der gewählten Zeile, leer = keine
    const tab18 = await w(`document.querySelector('[data-tabelle="library"]').hidden`);
    const wahl0 = await gewaehlt18();
    await taste('ArrowDown', 'ArrowDown', 0); await taste('ArrowDown', 'ArrowDown', 0); await warte(500);
    const wahl2 = await gewaehlt18();
    const v0 = await vh();
    await taste(' ', 'Space', 0); await warte(700);
    const v1 = await vh();
    // Negativ-Kontrolle: eingeklappter Browser (lib-zu) nimmt keine Pfeiltasten, die Wahl bleibt
    await taste('l', 'KeyL', 0); await warte(300);
    await taste('ArrowDown', 'ArrowDown', 0); await warte(300);
    const wahlZu = await gewaehlt18();
    await taste('l', 'KeyL', 0); await warte(300);
    const tastatur18 = { tab18, wahl0, wahl2, vorhoer: v1 - v0, wahlZu };
    await ansicht('dj'); await warte(300);
    const dj1 = await w(`({ bereich: localStorage.getItem('djk-bereich'), effekte: document.body.classList.contains('bereich-effekte'), loops: document.querySelector('[data-reiter="loops"]').classList.contains('an'), effekteSichtbar: getComputedStyle(document.querySelector('#effekte')).display !== 'none' })`);
    await w(`(() => { document.querySelector('[data-bereich="library"]').click(); document.querySelector('[data-reiter="tracks"]').click(); document.activeElement?.blur(); })()`); await warte(200);
    await ansicht('produktion'); await warte(600);
    notiere('1.7 Kein DJ-Zustand berührt', dj0.bereich === 'effekte' && dj0.effekte && dj0.loops && inP.bereich === 'effekte' && inP.fokus !== 'lib-suche' && inP.tabelle !== 'none' && inP.andere.every((d) => d === 'none') && inP.effekte === 'none' && geladen >= 1
      && dj1.bereich === 'effekte' && dj1.effekte && dj1.loops && dj1.effekteSichtbar,
      `DJ vorher: djk-bereich ${dj0.bereich}, EFFECTS an ${dj0.effekte}, Reiter LOOPS ${dj0.loops}; in PRODUCTION: djk-bereich ${inP.bereich}, Fokus „${inP.fokus}“, Library-Tabelle ${inP.tabelle}, ${geladen} × GET /stoebern ohne Klick, andere Tabellen ${inP.andere}, EFFECTS ${inP.effekte}; zurück in DJ: djk-bereich ${dj1.bereich}, EFFECTS an ${dj1.effekte} (sichtbar ${dj1.effekteSichtbar}), Reiter LOOPS ${dj1.loops}`);
    notiere('1.8 Library-Tastatur in PRODUCTION', tastatur18.tab18 === true && tastatur18.wahl0 === '' && tastatur18.wahl2 === '1' && tastatur18.vorhoer >= 1 && tastatur18.wahlZu === '1',
      `Library-Tabelle hidden ${tastatur18.tab18} (Reiter LOOPS im DJ gewählt); Gewählte Zeile vorher „${tastatur18.wahl0}“, nach ↓ ↓ „${tastatur18.wahl2}“; Leertaste → ${tastatur18.vorhoer} Anfrage(n) an /vorhoeren; Negativ-Kontrolle lib-zu + ↓: Zeile „${tastatur18.wahlZu}“ (bleibt 1)`);
  }

  // ================= Teil 2: Projekt neu, Zeitachse (Zoom um den Zeiger, Scrollen, Raster) =================
  if (TEIL >= 2) {
    await b.klick('[data-p="neu"]'); await warte(200);
    await tippe('First Track'); await enter(); await warte(800);
    const p = await projekt();
    notiere('2.1 Projekt neu', p?.name === 'First Track' && (await w('window.djkProd.slug')) === 'first-track', `Name ${p?.name}, slug ${await w('window.djkProd.slug')}`);
    const f = await rect('[data-p="flaeche"]');
    const a0 = await w('window.djkProd.ansicht');
    const x = f.l + 300, y = f.t + 20;
    await rad(x, y, -100, 2); await warte(150);                    // Strg+Rad: hinein
    const a1 = await w('window.djkProd.ansicht');
    const vor = a0.beat0 + 300 / a0.pxProBeat, nach = a1.beat0 + 300 / a1.pxProBeat;
    notiere('2.2 Zoom um den Zeiger', a1.pxProBeat > a0.pxProBeat && Math.abs(vor - nach) < 1e-6, `px/Beat ${a0.pxProBeat} → ${a1.pxProBeat}; Beat unter dem Zeiger ${vor.toFixed(6)} → ${nach.toFixed(6)}`);
    await rad(x, y, 240, 0); await warte(150);                     // Rad: waagrecht
    const a2 = await w('window.djkProd.ansicht');
    const follow = await w('window.djkProd.follow');
    notiere('2.3 Scrollen', a2.beat0 > a1.beat0 && follow === false, `beat0 ${a1.beat0.toFixed(3)} → ${a2.beat0.toFixed(3)}, FOLLOW danach ${follow}`);
    await rad(x, y, -100000, 0); await warte(100);
    await b.klick('[data-p="follow"]');
    await w(`(() => { const s = document.querySelector('[data-p="raster"]'); s.value = 'takt'; s.dispatchEvent(new Event('change')); })()`);
    notiere('2.4 Raster gemerkt', (await w(`localStorage.getItem('djk-prod-raster')`)) === 'takt', `localStorage djk-prod-raster = ${await w(`localStorage.getItem('djk-prod-raster')`)}`);
    await w(`(() => { const s = document.querySelector('[data-p="raster"]'); s.value = 'beat'; s.dispatchEvent(new Event('change')); })()`);
    // Ansehen eines gesäten Projekts: Audio-Clip (dekodiert) mit Welle, MIDI-Clip mit Notenvorschau; danach OPEN zurück
    const r = await seed();
    await warte(1200);
    const as = await w('window.djkProd.ansicht');
    const xb = (beat) => (beat - as.beat0) * as.pxProBeat;
    const welle = await farbig(xb(0) + 1, 1 + 14, Math.max(2, as.pxProBeat - 2), 46);
    const nebenWelle = await farbig(xb(2) + 1, 1 + 14, Math.max(2, as.pxProBeat - 2), 46);
    const note = await farbig(xb(0) + 1, 64 + 15, Math.max(2, as.pxProBeat * 0.5 - 2), 46);
    const pause = await farbig(xb(1) + 1, 64 + 15, Math.max(2, as.pxProBeat * 0.5 - 2), 46);
    notiere('2.5 Clips ansehen', (await w('window.djkProd.slug')) === r.slug && welle > 20 && nebenWelle === 0 && note > 5 && pause === 0,
      `Projekt ${await w('window.djkProd.slug')}; Welle im Audio-Clip ${welle} Pixel, daneben ${nebenWelle}; Note 1 ${note} Pixel, Pause ${pause} (Negativ-Kontrollen 0)`);
    // 2.5b FROZEN: Spur 3 ist eingefroren (freeze gesetzt): Schraffur statt Noten (Spec 2.11, 5: keine Wellenform/Noten eingefrorener Spuren)
    const fy = 2 * 64 + 15, fb = Math.max(2, as.pxProBeat * 4 - 2);
    const fNote = await farbTreffer(xb(0) + 1, fy, fb, 46, [0x9b, 0x59, 0xd0], 14);          // Notenkästen in voller Spurfarbe von Lead (#9b59d0): keiner
    const bNote = await farbTreffer(xb(0) + 1, 64 + 15, fb, 46, [0x3b, 0x8d, 0xe0], 14);   // Positiv-Kontrolle: dieselbe Messung bei Bass (#3b8de0) findet seine Noten
    const fSchraf = await bereichPixel(xb(0) + 1, fy, fb, 46, SCHRAF_LO, SCHRAF_HI);
    const bSchraf = await bereichPixel(xb(0) + 1, 64 + 15, fb, 46, SCHRAF_LO, SCHRAF_HI);   // Negativ-Kontrolle: nicht eingefrorener MIDI-Clip gleicher Größe
    notiere('2.5b Eingefrorene Spur: Markierung statt Noten', fSchraf > 40 && fNote === 0 && bNote > 5 && fSchraf > 4 * bSchraf,
      `Lead (freeze gesetzt): Schraffur-Pixel ${fSchraf}, Noten-Pixel in Spurfarbe ${fNote}; Kontrolle Bass (nicht eingefroren): Noten-Pixel ${bNote} (muss > 5), Schraffur-Pixel ${bSchraf}`);
    await oeffneProjekt('first-track');
    notiere('2.6 Projekt öffnen', (await w('window.djkProd.slug')) === 'first-track', `nach OPEN: ${await w('window.djkProd.slug')}`);
  }

  // ================= Teil 3: Spuren anlegen, Spurköpfe, Mixer-Bedienung (A6) =================
  if (TEIL >= 3) {
    for (const k of ['neu-audio', 'neu-rb', 'neu-surge']) { await b.klick(`[data-p="${k}"]`); await warte(400); }
    const p = await projekt();
    const koepfe = await w(`[...document.querySelectorAll('.p-kopf')].map((k) => k.querySelector('.p-spurname').textContent + '|' + k.querySelector('.p-geraet').textContent)`);
    const surgeAus = await w(`document.querySelector('[data-p="neu-surge"]').disabled`);
    notiere('3.1 Spuren anlegen', p.spuren.length === 3 && JSON.stringify(koepfe) === '["Audio|AUDIO","RB-338|RB-338","Surge|SURGE · 1"]' && surgeAus,
      `Spuren ${p.spuren.map((x) => `${x.nr}:${x.art}`).join(' ')}; Köpfe ${JSON.stringify(koepfe)}; + SURGE danach aus ${surgeAus}`);
    const id = p.spuren[0].id;
    const n0 = log().length;
    await b.ziehe(`.p-kopf[data-spur="${id}"] .p-fader`, -40, 0, 12); await warte(600);
    const faderAnfr = log().slice(n0).filter((e) => e.weg === '/proj/aendern' && e.koerper.befehle?.[0]?.fader_db !== undefined);
    const p2 = await projekt();
    notiere('3.2 Fader', p2.spuren[0].fader_db < 0 && faderAnfr.length >= 1 && faderAnfr.length <= 13,
      `fader_db ${p2.spuren[0].fader_db}; ${faderAnfr.length} Anfragen für Druck + 12 Zugschritte (höchstens eine je Eingabe; Zusammenfassen bei Stau prüft der node-Test); Anzeige ${await w(`document.querySelector('.p-kopf[data-spur="${id}"] .p-faderwert').textContent`)}`);
    const n1 = log().length;
    await b.ziehe(`.p-kopf[data-spur="${id}"] .p-pan`, 30, 0, 6); await warte(600);
    const panAnfr = log().slice(n1).filter((e) => e.weg === '/proj/aendern' && e.koerper.befehle?.[0]?.pan !== undefined);
    const p2b = await projekt();
    notiere('3.2b Pan', p2b.spuren[0].pan > 0 && panAnfr.length >= 1 && panAnfr.every((e) => e.koerper.befehle[0].fader_db === undefined) && p2b.spuren[0].fader_db === p2.spuren[0].fader_db,
      `pan ${p2b.spuren[0].pan}; ${panAnfr.length} Anfragen mit pan (letzte ${JSON.stringify(panAnfr.at(-1)?.koerper.befehle[0])}); fader_db unverändert ${p2b.spuren[0].fader_db}; Anzeige ${await w(`document.querySelector('.p-kopf[data-spur="${id}"] .p-panwert').textContent`)}`);
        // 3.2c Anschlag: ganz nach rechts gezogen ist +6 dB (Spec §4), nicht mehr; ein höherer Wert würde der Server ablehnen
    const nA = log().length;
    await b.ziehe(`.p-kopf[data-spur="${id}"] .p-fader`, 400, 0, 8); await warte(600);
    const anschlag = log().slice(nA).filter((e) => e.weg === '/proj/aendern' && e.koerper.befehle?.[0]?.fader_db !== undefined).map((e) => e.koerper.befehle[0].fader_db);
    const p2a = await projekt();
    const faderMax = await w(`document.querySelector('.p-kopf[data-spur="${id}"] .p-fader').max`);
    const faderAnz = await w(`document.querySelector('.p-kopf[data-spur="${id}"] .p-faderwert').textContent`);
    notiere('3.2c Fader-Anschlag +6 dB', p2a.spuren[0].fader_db === 6 && anschlag.length >= 1 && Math.max(...anschlag) === 6 && faderMax === '6' && faderAnz === '+6.0',
      `Regler max ${faderMax}, gesendet ${JSON.stringify(anschlag)}, Projekt ${p2a.spuren[0].fader_db}, Anzeige ${faderAnz}`);
    await b.ziehe(`.p-kopf[data-spur="${id}"] .p-fader`, -400, 0, 8); await warte(600);   // zurück nach unten, damit 3.3 und später vom Anfangszustand ausgehen
    await b.klick(`.p-kopf[data-spur="${id}"] .p-mute`); await warte(400);
    await b.klick(`.p-kopf[data-spur="${id}"] .p-solo`); await warte(400);
    const p3 = await projekt();
    const an = await w(`[document.querySelector('.p-kopf[data-spur="${id}"] .p-mute').classList.contains('an'), document.querySelector('.p-kopf[data-spur="${id}"] .p-solo').classList.contains('an')]`);
    notiere('3.3 Mute und Solo', p3.spuren[0].mute === true && p3.spuren[0].solo === true && an[0] && an[1], `Projekt mute ${p3.spuren[0].mute} solo ${p3.spuren[0].solo}; Knöpfe ${an}`);
    // 3.3b Eigene Änderung lädt nicht doppelt nach: das SSE-Ereignis kommt vor der HTTP-Antwort; die Seite kennt ihre ausstehende rev.
    // Genau eine Änderung (Mute aus): kein GET /proj/aktuell, ein GET /proj/verlauf. Gegenprobe: dieselbe Änderung von Cypher (fremd) lädt neu.
    const zaehle = (von, methode, weg) => log().slice(von).filter((e) => e.methode === methode && e.weg === weg).length;
    const nE = log().length;
    await b.klick(`.p-kopf[data-spur="${id}"] .p-mute`); await warte(700);
    const eigenAkt = zaehle(nE, 'GET', '/proj/aktuell'), eigenVer = zaehle(nE, 'GET', '/proj/verlauf');
    const nF = log().length;
    await fetch(URL + 'proj/aendern', { method: 'POST', headers: { 'content-type': 'application/json', 'x-djk-quelle': 'cypher' }, body: JSON.stringify({ rev: (await projekt()).rev, label: 'Cypher pan', befehle: [{ befehl: 'spur_aendern', spur_id: p.spuren[2].id, pan: 0.1 }] }) });
    await warte(700);
    const fremdAkt = zaehle(nF, 'GET', '/proj/aktuell');
    notiere('3.3b Eigene Änderung lädt nicht doppelt nach', eigenAkt === 0 && eigenVer === 1 && fremdAkt === 1 && (await projekt()).spuren[2].pan === 0.1,
      `eigene Änderung: ${eigenAkt} × GET /proj/aktuell (vorher 1), ${eigenVer} × GET /proj/verlauf (vorher 2); Gegenprobe fremde Änderung (Cypher): ${fremdAkt} × GET /proj/aktuell, Pan der Spur 3 ${(await projekt()).spuren[2].pan}`);
    await b.klick(`.p-kopf[data-spur="${id}"] .p-solo`); await warte(400);
    await at.zustand.stroeme.size;   // Pegel: die Attrappe schickt /pegel spur/1 wie der Kern
    await fetch(URL + 'attrappe/sse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: '/pegel', f: { kanal: 'spur/1', spitze_db: -6 } }) });
    await warte(150);
    const breiteAn = await w(`document.querySelector('.p-kopf[data-spur="${id}"] .p-pegel i').style.width`);
    await fetch(URL + 'attrappe/sse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: '/pegel', f: { kanal: 'spur/1', spitze_db: -200 } }) });
    await warte(150);
    const breiteAus = await w(`document.querySelector('.p-kopf[data-spur="${id}"] .p-pegel i').style.width`);
    notiere('3.4 Pegel', breiteAn === '90%' && breiteAus === '0%', `/pegel spur/1 −6 dB → ${breiteAn}; Negativ-Kontrolle −200 → ${breiteAus}`);
    await b.sende('Input.dispatchMouseEvent', { type: 'mousePressed', ...(await b.mitte(`.p-kopf[data-spur="${id}"] .p-spurname`)), button: 'left', clickCount: 2 });
    await b.sende('Input.dispatchMouseEvent', { type: 'mouseReleased', ...(await b.mitte(`.p-kopf[data-spur="${id}"] .p-spurname`)), button: 'left', clickCount: 2 });
    await w(`document.querySelector('.p-namefeld')?.select()`);
    await tippe('Kick'); await enter(); await warte(500);
    notiere('3.5 Umbenennen', (await projekt()).spuren[0].name === 'Kick', `Name ${(await projekt()).spuren[0].name}`);
    // 3.5b Barrierefreiheit: jedes Bedienelement trägt den Spurnamen im zugänglichen Namen; Umbenennen per Tastatur (Enter, F2)
    {
      const KL = ['.p-mute', '.p-solo', '.p-hoch', '.p-runter', '.p-farbe', '.p-loeschen', '.p-spurname'];
      const koepfeL = await w(`[...document.querySelectorAll('.p-kopf')].map((k) => ({ name: k.querySelector('.p-spurname').textContent, labels: ${JSON.stringify(KL)}.map((c) => k.querySelector(c).getAttribute('aria-label')) }))`);
      const mitName = koepfeL.every((k) => k.labels.every((l) => l?.includes(k.name)));
      const eindeutig = KL.every((_, i) => new Set(koepfeL.map((k) => k.labels[i])).size === koepfeL.length);
      const taste2 = (key, code, vk) => b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }).then(() => b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }));
      const sid = (await projekt()).spuren[1].id, sel = `.p-kopf[data-spur="${sid}"] .p-spurname`;
      const name0 = (await projekt()).spuren[1].name;
      await w(`document.querySelector(${JSON.stringify(sel)}).focus()`);
      await enter(); await warte(150);
      const feld = await w(`document.activeElement.className`);
      await tippe('Bass'); await enter(); await warte(500);
      const nachEnter = (await projekt()).spuren[1].name, fokusZurueck = await w(`document.activeElement.className`);
      await taste2('F2', 'F2', 113); await warte(150);
      const feldF2 = await w(`document.activeElement.className`);
      await taste2('Escape', 'Escape', 27); await warte(300);           // Negativ-Kontrolle: Escape übernimmt nichts
      const nachEsc = (await projekt()).spuren[1].name;
      await enter(); await warte(150); await tippe(name0); await enter(); await warte(500);   // zurück
      notiere('3.5b Spurköpfe zugänglich', mitName && eindeutig && feld === 'p-namefeld' && nachEnter === 'Bass' && fokusZurueck === 'p-spurname' && feldF2 === 'p-namefeld' && nachEsc === 'Bass' && (await projekt()).spuren[1].name === name0,
        `Köpfe ${koepfeL.length}: alle 7 Namen tragen den Spurnamen ${mitName}, je Element verschieden ${eindeutig} (z. B. „${koepfeL[0].labels[0]}“, „${koepfeL[0].labels[2]}“, „${koepfeL[0].labels[5]}“); Enter auf dem Namen → ${feld}, getippt „Bass“ → Name ${nachEnter}, Fokus danach ${fokusZurueck}; F2 → ${feldF2}, Escape → Name ${nachEsc}; zurück auf ${(await projekt()).spuren[1].name}`);
    }

    // 3.6 Spur verschieben (↑/↓, spur_verschieben) und löschen (✕, spur_loeschen), Undo stellt her (Spec 3.4, V1 laut §4)
    const namen = async () => (await projekt()).spuren.map((x) => x.name);
    const domNamen = () => w(`[...document.querySelectorAll('.p-kopf .p-spurname')].map((e) => e.textContent)`);
    const p4 = await projekt();
    const [idK, , idS] = p4.spuren.map((x) => x.id);
    const nV = log().length;
    await b.klick(`.p-kopf[data-spur="${idK}"] .p-hoch`); await warte(300);            // erste Spur: ↑ ist gesperrt, es darf nichts hinausgehen
    const hochErste = log().slice(nV).filter((e) => e.weg === '/proj/aendern').length;
    await b.klick(`.p-kopf[data-spur="${idK}"] .p-runter`); await warte(500);
    const nachRunter = await namen(), domRunter = await domNamen(), pRunter = await projekt();
    const verschoben = log().slice(nV).filter((e) => e.weg === '/proj/aendern').map((e) => e.koerper.befehle[0]);
    await b.klick(`.p-kopf[data-spur="${idK}"] .p-hoch`); await warte(500);
    const nachHoch = await namen(), domHoch = await domNamen();
    notiere('3.6a Spur verschieben', hochErste === 0 && JSON.stringify(nachRunter) === '["RB-338","Kick","Surge"]' && JSON.stringify(domRunter) === JSON.stringify(nachRunter)
      && pRunter.spuren.find((x) => x.id === idK).nr === 1 && verschoben.length === 1 && verschoben[0].befehl === 'spur_verschieben' && verschoben[0].spur_id === idK && verschoben[0].index === 1
      && JSON.stringify(nachHoch) === '["Kick","RB-338","Surge"]' && JSON.stringify(domHoch) === JSON.stringify(nachHoch),
      `↑ der ersten Spur: ${hochErste} Anfragen (Negativ-Kontrolle); ↓ Kick: ${JSON.stringify(nachRunter)} (Köpfe ${JSON.stringify(domRunter)}), nr bleibt ${pRunter.spuren.find((x) => x.id === idK).nr}, Befehl ${JSON.stringify(verschoben[0])}; ↑ danach ${JSON.stringify(nachHoch)}`);
    const nL = log().length;
    await b.klick(`.p-kopf[data-spur="${idS}"] .p-loeschen`); await warte(600);
    const pDel = await projekt();
    const del = log().slice(nL).filter((e) => e.weg === '/proj/aendern');
    const surgeFrei = await w(`!document.querySelector('[data-p="neu-surge"]').disabled`);
    const kopfAnzahl = await w(`document.querySelectorAll('.p-kopf').length`);
    await fetch(URL + 'proj/undo', { method: 'POST', headers: { 'content-type': 'application/json', 'x-djk-quelle': 'cypher' }, body: JSON.stringify({ rev: pDel.rev }) });   // der UNDO-Knopf der Seite folgt in Slice 6
    await warte(700);
    const pUndo = await projekt();
    notiere('3.6b Spur löschen', pDel.spuren.length === 2 && del.length === 1 && del[0].koerper.label === 'Delete track Surge' && del[0].koerper.befehle[0].befehl === 'spur_loeschen' && surgeFrei && kopfAnzahl === 2
      && pUndo.spuren.length === 3 && pUndo.spuren[2].id === idS && (await w(`document.querySelector('[data-p="neu-surge"]').disabled`)) && (await w(`document.querySelectorAll('.p-kopf').length`)) === 3,
      `✕ Surge: Spuren ${p4.spuren.length} → ${pDel.spuren.length}, Anfrage „${del[0]?.koerper.label}“ ${JSON.stringify(del[0]?.koerper.befehle[0])}, + SURGE frei ${surgeFrei}, Köpfe ${kopfAnzahl}; Undo (POST /proj/undo): Spuren ${pUndo.spuren.length}, Surge wieder da (id ${pUndo.spuren[2]?.id}), + SURGE wieder aus`);
    // 3.7 eingefrorene Spur: der Kopf nennt es (Gerät · FROZEN); danach zurück zu First Track
    await oeffneProjekt('seed');
    const fkopf = await w(`document.querySelector('.p-kopf[data-spur="s94"] .p-geraet')?.textContent`);
    const normal = await w(`document.querySelector('.p-kopf[data-spur="s92"] .p-geraet')?.textContent`);
    notiere('3.7 FROZEN im Spurkopf', fkopf === 'SURGE · 1 · FROZEN' && normal === 'RB-338', `Lead „${fkopf}“; Negativ-Kontrolle Bass „${normal}“`);
    await oeffneProjekt('first-track');
    // 3.8 Server weg und wieder da: die Ansicht behält den Stand und meldet den Ausfall (kein „No project open“); nach dem
    // Wiederverbinden des Stroms lädt sie neu und zeigt, was sich inzwischen geändert hat. Negativ-Kontrolle: antwortet der
    // Server „kein Projekt“ (200 mit null), leert sich die Ansicht wirklich.
    {
      const kopfZahl = () => w(`document.querySelectorAll('.p-kopf').length`);
      const zeigt = () => w(`({ name: document.querySelector('[data-p="name"]').textContent, leer: !document.querySelector('[data-p="leer"]').hidden, meldung: document.querySelector('[data-p="meldung"]').textContent, fehler: document.querySelector('[data-p="meldung"]').classList.contains('fehler'), getrennt: window.djkProd.getrennt })`);
      const vor = { name: (await zeigt()).name, koepfe: await kopfZahl() };
      await fetch(URL + 'attrappe/weg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ an: true }) });
      await ansicht('dj'); await warte(200); await ansicht('produktion'); await warte(700);   // zeige() lädt neu: 503
      const weg = await zeigt(), kWeg = await kopfZahl();
      // Die Ausfallmeldung verschwindet nach 6 s; die Anzeige „OFFLINE“ bleibt, solange der Server weg ist (Fix 3.2)
      const offline = () => w(`(() => { const e = document.querySelector('[data-p="offline"]'); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && document.querySelector('#produktion').classList.contains('offline'); })()`);
      const offFrueh = await offline();
      await warte(7000);
      const offSpaet = await offline();
      at.zustand.projekte.get('first-track').metronom.pegel_db = -10;                        // während des Ausfalls ändert sich der Stand
      const tWieder = Date.now();
      await fetch(URL + 'attrappe/weg', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ an: false }) });
      let pegel = null;
      for (let i = 0; i < 200 && pegel !== -10; i++) { await warte(100); pegel = await w('window.djkProd.projekt?.metronom?.pegel_db'); }   // EventSource verbindet nach etwa 3 s neu
      const da = await zeigt();
      const offDa = await offline();
      const geladen = log().filter((e) => e.t >= tWieder && e.methode === 'GET' && e.weg === '/proj/aktuell').length;
      notiere('3.8 Server weg und wieder da', weg.name === vor.name && !weg.leer && kWeg === vor.koepfe && weg.fehler && weg.meldung === 'The project server did not answer: showing the last state' && weg.getrennt === true
        && pegel === -10 && da.getrennt === false && geladen >= 1 && offFrueh && offSpaet && !offDa,
        `weg: Name „${weg.name}“ (vorher „${vor.name}“), „No project open“ sichtbar ${weg.leer}, Köpfe ${kWeg}/${vor.koepfe}, Meldung „${weg.meldung}“ (Fehlerklasse ${weg.fehler}); wieder da: Metronom-Pegel ${pegel} dB nach ${((Date.now() - tWieder) / 1000).toFixed(1)} s (${geladen} × GET /proj/aktuell), getrennt ${da.getrennt}; Anzeige OFFLINE: sofort ${offFrueh}, nach 7 s ${offSpaet}, nach dem Wiederverbinden ${offDa}`);
      at.zustand.projekte.get('first-track').metronom.pegel_db = -12;
      at.zustand.slug = null;                                                                   // Negativ-Kontrolle: der Server sagt „kein Projekt“
      await ansicht('dj'); await warte(200); await ansicht('produktion'); await warte(700);
      const keins = await zeigt();
      at.zustand.slug = 'first-track';
      await ansicht('dj'); await warte(200); await ansicht('produktion'); await warte(700);
      notiere('3.8b Kein Projekt leert die Ansicht', keins.name === 'No project' && keins.leer === true && (await zeigt()).name === 'First Track' && (await kopfZahl()) === vor.koepfe,
        `Server ohne Projekt: Name „${keins.name}“, „No project open“ sichtbar ${keins.leer}; danach wieder „${(await zeigt()).name}“ mit ${await kopfZahl()} Köpfen`);
      // 3.8c (D1 V2 Nachzug 7b): bei laufendem Strom antwortet der Server 503 MIT Grund (katalog_fehlt, wie die Sitzung ohne Katalog): das ist
      // eine Antwort, kein Ausfall: kein OFFLINE, der Text des Grunds (Befund Re-Review 3: vorher OFFLINE und „Rejected: katalog_fehlt“). Danach
      // 503 OHNE Grund: OFFLINE. Die nächste erfolgreiche Schreibantwort nimmt es zurück, ohne dass der Strom neu verbinden muss.
      {
        const haken = (h) => w(`(() => { if (!window.__f0) window.__f0 = window.fetch; const f0 = window.__f0; window.__haken = ${JSON.stringify(h)};
          window.fetch = (u, o) => { if (window.__haken && String(u).includes('/proj/aendern')) { const x = window.__haken; window.__haken = null;
            return Promise.resolve(new Response(x.body, { status: x.status, headers: { 'content-type': 'application/json' } })); } return f0(u, o); }; return 1; })()`);
        const loop0 = (await projekt()).loop.an;
        await haken({ status: 503, body: JSON.stringify({ fehler: 'katalog_fehlt', index: 0 }) });
        await b.klick('[data-p="loop"]'); await warte(600);
        const mitGrund = { off: await offline(), meldung: (await zeigt()).meldung, loop: (await projekt()).loop.an };
        await haken({ status: 503, body: '' });
        await b.klick('[data-p="loop"]'); await warte(600);
        const ohneGrund = { off: await offline(), meldung: (await zeigt()).meldung };
        const n8 = log().length;
        await b.klick('[data-p="loop"]'); await warte(800);                                     // ohne Haken: die Attrappe nimmt an (200)
        const erfolg = { off: await offline(), loop: (await projekt()).loop.an, anfragen: log().slice(n8).filter((e) => e.weg === '/proj/aendern').length };
        await b.klick('[data-p="loop"]'); await warte(600);                                     // zurück
        notiere('3.8c 503 mit Grund ist kein Ausfall', !mitGrund.off && mitGrund.meldung === 'The sample catalogue is not available' && mitGrund.loop === loop0
          && ohneGrund.off && ohneGrund.meldung === 'The project server did not answer: showing the last state' && erfolg.off === false && erfolg.loop === !loop0 && erfolg.anfragen === 1,
          `503 katalog_fehlt: OFFLINE ${mitGrund.off}, Meldung „${mitGrund.meldung}“, Loop unverändert ${mitGrund.loop === loop0}; 503 ohne Grund (Negativ-Kontrolle): OFFLINE ${ohneGrund.off}, „${ohneGrund.meldung}“; danach erfolgreiche Änderung (${erfolg.anfragen} Anfrage): OFFLINE ${erfolg.off}, Loop ${erfolg.loop}`);
      }
      // 3.9 409-Kaskade: der Server steht anderswo auf einer höheren rev (kein Ereignis an die Seite). Drei Klicks im selben Takt:
      // nur der erste geht hinaus (409), die zwei wartenden werden nach dem Neuladen verworfen und gemeldet, nicht mit alter rev wiederholt.
      {
        const sid = (await projekt()).spuren[1].id, k = (n) => `.p-kopf[data-spur="${sid}"] ${n}`;
        at.zustand.projekte.get('first-track').rev += 5;
        const n409 = log().length, rev0 = (await projekt()).rev;
        await w(`(() => { for (const n of ['.p-mute', '.p-solo', '.p-farbe']) document.querySelector('.p-kopf[data-spur="${sid}"] ' + n).click(); })()`);
        await warte(800);
        const gesendet = log().slice(n409).filter((e) => e.weg === '/proj/aendern').length;
        const m = await zeigt(), p9 = await projekt();
        const unveraendert = p9.spuren[1].mute === false && p9.spuren[1].solo === false && p9.rev === rev0 + 5;
        await b.klick(k('.p-mute')); await warte(500);                    // Negativ-Kontrolle: danach geht ein Auftrag mit der neuen rev durch
        const danach = (await projekt()).spuren[1].mute;
        await b.klick(k('.p-mute')); await warte(500);                    // zurück
        notiere('3.9 409 verwirft die Wartenden', gesendet === 1 && m.meldung === 'The project changed elsewhere: reloaded, 2 waiting changes dropped, please repeat' && m.fehler && unveraendert && danach === true && (await projekt()).spuren[1].mute === false,
          `Anfragen nach 3 Klicks: ${gesendet} (vorher 3); Meldung „${m.meldung}“; Projekt unverändert (mute ${p9.spuren[1].mute}, solo ${p9.spuren[1].solo}), rev ${rev0} → ${p9.rev}; danach ein Klick: mute ${danach}`);
      }
      // 3.10 (D1 V2 Nachzug 7c, 7d): angenommen, aber der Kern zieht nicht nach. Der Server antwortet 200 mit kern.wiedergabe {nr: null, fehler}
      // (Übersetzer lehnte ab) bzw. kern.regler 'kein_kern' (Mixer ohne Kern, Spec 6.30): die Seite warnt, statt still Erfolg zu zeigen.
      // Dazu Spec 6.28: eine zweite Surge-Spur lehnt der Server mit slot_belegt ab, Text „D1 has one Surge slot“.
      {
        const steuer = (d) => fetch(URL + 'attrappe/kernantwort', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
        const leereMeldung = () => w(`document.querySelector('[data-p="meldung"]').textContent = ''`);
        const met0 = (await projekt()).metronom.an, sid = (await projekt()).spuren[1].id;
        await steuer({ kern: { wiedergabe: { nr: null, fehler: 'datei_fehlt', text: 'datei_fehlt: /arr/freeze-3-1.f32' } } });
        await b.klick('[data-p="metronom"]'); await warte(500);
        const w1 = await zeigt(), met1 = (await projekt()).metronom.an;
        await steuer({ kern: { regler: 'kein_kern' } });
        await b.klick(`.p-kopf[data-spur="${sid}"] .p-mute`); await warte(500);
        const w2 = await zeigt(), mute2 = (await projekt()).spuren[1].mute;
        await leereMeldung();
        await b.klick('[data-p="metronom"]'); await warte(500);                                 // Negativ-Kontrolle: ohne kern-Angabe keine Warnung
        const w3 = await zeigt();
        await b.klick(`.p-kopf[data-spur="${sid}"] .p-mute`); await warte(500);                 // zurück
        const gesperrt = await w(`document.querySelector('[data-p="neu-surge"]').disabled`);
        await w(`document.querySelector('[data-p="neu-surge"]').disabled = false`);             // erzwungen, wie ein Stand hinter dem Server
        const nS = log().length;
        await b.klick('[data-p="neu-surge"]'); await warte(500);
        const w4 = await zeigt(), surgeAnfragen = log().slice(nS).filter((e) => e.weg === '/proj/aendern').length;
        notiere('3.10 Kern zieht nicht nach: Warnung statt stillem Erfolg', w1.meldung === 'Saved, but the core did not load the arrangement: a frozen track file is missing' && w1.fehler && met1 === !met0
          && w2.meldung === 'Saved; the core is not running' && mute2 === true && w3.meldung === '' && gesperrt && surgeAnfragen === 1 && w4.meldung === 'D1 has one Surge slot',
          `Wiedergabe nicht geladen: „${w1.meldung}“ (Fehlerklasse ${w1.fehler}), Metronom trotzdem ${met1}; Mixer ohne Kern: „${w2.meldung}“, mute ${mute2}; Negativ-Kontrolle ohne kern-Angabe: „${w3.meldung}“; zweite Surge-Spur (Knopf war gesperrt ${gesperrt}, erzwungen, ${surgeAnfragen} Anfrage): „${w4.meldung}“`);
      }
      // 3.11 (D1 V2 Nachzug 7f, Spec 6.32): während eines Freeze antworten Transport-Start und Tempo mit 409 beschaeftigt; die Seite sagt
      // „A freeze is running“ statt OFFLINE oder „Rejected: …“. Negativ-Kontrolle: ein Mixer-Griff geht durch; nach dem Freeze startet PLAY.
      // V2 Fix-Runde 2 H7 (Spec 6.34): beschaeftigt ist mehrdeutig, die Seite zeigt den Text des Servers („A freeze is running; …“), nicht mehr einen festen.
      {
        const lauf = (art) => fetch(URL + 'attrappe/lauf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ art }) });
        const sid = (await projekt()).spuren[1].id, tempo0 = (await projekt()).tempo_bpm;
        await lauf('freeze');
        await b.klick('[data-p="play"]'); await warte(500);
        const p1 = { ...(await zeigt()), off: await offline(), transport: at.zustand.transport };
        await w(`document.querySelector('[data-p="meldung"]').textContent = ''`);
        await b.klick('[data-p="tempo"]'); await w(`document.querySelector('[data-p="tempo"]').select()`);
        await tippe('131'); await enter(); await warte(500);
        const p2 = { ...(await zeigt()), off: await offline(), tempo: (await projekt()).tempo_bpm };
        const nM = log().length;
        await b.klick(`.p-kopf[data-spur="${sid}"] .p-solo`); await warte(500);
        const solo = (await projekt()).spuren[1].solo, mixerOk = log().slice(nM).some((e) => e.weg === '/proj/aendern');
        await b.klick(`.p-kopf[data-spur="${sid}"] .p-solo`); await warte(500);               // zurück
        await lauf(null);
        await b.klick('[data-p="play"]'); await warte(400);
        const danach = at.zustand.transport !== null;
        await b.klick('[data-p="stopp"]'); await warte(400);
        notiere('3.11 Freeze läuft: Transport und Tempo gesperrt', p1.meldung === 'A freeze is running; transport start waits until it is done' && p1.fehler && !p1.off && p1.transport === null
          && p2.meldung === 'A freeze is running; changes to the playback wait until it is done' && !p2.off && p2.tempo === tempo0 && solo === true && mixerOk && danach,
          `PLAY: „${p1.meldung}“, OFFLINE ${p1.off}, Transport ${JSON.stringify(p1.transport)}; Tempo 131: „${p2.meldung}“, OFFLINE ${p2.off}, Tempo bleibt ${p2.tempo}; Negativ-Kontrolle Mixer (SOLO): ${solo}; nach dem Freeze startet PLAY: ${danach}`);
      }
    }
  }

  // ================= Teil 4: Ziehen aus LIBRARY, Clip mit Welle, MIDI-Vorschau (A2 ohne Bearbeitung) =================
  if (TEIL >= 4) {
    await b.klick('[data-typ="oneshot"]'); await warte(800);   // nach dem Neuladen in 1.5 steht der Typ wieder auf ALL TRACKS
    const ziehbar = await w(`Object.fromEntries([...document.querySelectorAll('#libliste tr')].map((tr) => [tr.dataset.sha?.slice(0, 1), tr.draggable]))`);
    notiere('4.1 Ziehbar nur, was der Server nähme', ziehbar.a === true && ziehbar.c === false && ziehbar.e === false, `Kick ${ziehbar.a}, Ableton-geschützt ${ziehbar.c}, Datei fehlt ${ziehbar.e}`);
    const ziel = await punkt(4.3, 0);
    const ok = await b.zieheDnD(`#libliste tr[data-sha="${SHA.kick}"]`, ziel.x, ziel.y);
    await warte(500);
    let p = await projekt();
    const c = p.spuren[0].clips[0];
    notiere('4.2 Ablegen gerastet', ok && c?.start_beat === 4 && Math.abs(c.laenge_beats - 1) < 1e-9 && c.quelle.sha256 === SHA.kick && c.name === 'Kick 1',
      `Ziehen ${ok}; Clip start ${c?.start_beat}, Länge ${c?.laenge_beats} Beats (0,5 s bei 120 BPM), sha ${c?.quelle.sha256.slice(0, 8)}, dekodiert ${c?.dekodiert}, Name „${c?.name}“ (Titel der Library-Zeile; ohne name nennt S2 ihn „Audio“)`);
    await warte(900);
    p = await projekt();
    const a = await w('window.djkProd.ansicht');
    const kx = (4 - a.beat0) * a.pxProBeat;
    const px = await farbig(kx + 1, 1 + 14, Math.max(2, a.pxProBeat - 2), 46);
    const leer = await farbig(kx + 3 * a.pxProBeat, 1 + 14, Math.max(2, a.pxProBeat - 2), 46);
    notiere('4.3 Welle nach dem Dekodieren', p.spuren[0].clips[0].dekodiert === 'fertig' && px > 20 && leer === 0, `dekodiert ${p.spuren[0].clips[0].dekodiert}; farbige Pixel im Clip ${px}, daneben (Negativ-Kontrolle) ${leer}`);
    const n0 = log().length;
    const ziel2 = await punkt(1, 1);
    await b.zieheDnD(`#libliste tr[data-sha="${SHA.kick}"]`, ziel2.x, ziel2.y); await warte(400);
    const meldung = await w(`document.querySelector('[data-p="meldung"]').textContent`);
    const clipNeu = log().slice(n0).filter((e) => e.weg === '/proj/aendern').length;
    notiere('4.4 Instrument-Spur lehnt ab', clipNeu === 0 && meldung === 'Samples go on audio tracks only', `Anfragen ${clipNeu}; Meldung „${meldung}“`);
    await ansicht('dj'); await warte(300);
    const djZieh = await w(`[...document.querySelectorAll('#libliste tr')].filter((tr) => tr.draggable).length`);
    await ansicht('produktion'); await warte(600);
    notiere('4.5 DJ-Ansicht ohne Ziehen', djZieh === 0, `ziehbare Zeilen in der DJ-Ansicht: ${djZieh}`);
  }

  // ================= Teil 5: Transport, Startmarke, Loop-Klammer, Abspielkopf, Metronom, Tempo (A5) =================
  if (TEIL >= 5) {
    const l = await rect('[data-p="lineal"]');
    const a = await w('window.djkProd.ansicht');
    const bx = (beat) => l.l + (beat - a.beat0) * a.pxProBeat;
    const vorher = (await projekt()).loop;                          // Vorgabe 0..32, aus
    await b.maus('mouseMoved', bx(32), l.t + 6, { buttons: 0 });     // rechter Griff der Klammer
    await b.maus('mousePressed', bx(32), l.t + 6);
    for (let i = 1; i <= 8; i++) await b.maus('mouseMoved', bx(32 - (24.2 * i) / 8), l.t + 6);
    await b.maus('mouseReleased', bx(7.8), l.t + 6); await warte(500);
    await b.klick('[data-p="loop"]'); await warte(500);
    const loop = (await projekt()).loop;
    notiere('5.1 Loop-Klammer ziehen', vorher.bis_beat === 32 && loop.an === true && loop.von_beat === 0 && loop.bis_beat === 8, `Loop vorher ${JSON.stringify(vorher)}, nach Zug am Griff und LOOP ${JSON.stringify(loop)}`);
    // 5.1b pointercancel beendet den Zug (Fix 10): Griff greifen, das System bricht die Geste ab, die Maus bewegt sich weiter: die Klammer folgt nicht mehr
    await b.maus('mouseMoved', bx(8), l.t + 6, { buttons: 0 });
    await b.maus('mousePressed', bx(8), l.t + 6);
    await w(`document.querySelector('[data-p="lineal"]').dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true }))`);
    const ent0 = await w('window.djkProd.loopEntwurf ?? null');
    await b.maus('mouseMoved', bx(5), l.t + 6);
    const ent1 = await w('window.djkProd.loopEntwurf ?? null');
    await b.maus('mouseReleased', bx(5), l.t + 6); await warte(400);
    const loopC = (await projekt()).loop;
    notiere('5.1b pointercancel beendet den Zug', ent0 === null && ent1 === null && loopC.von_beat === 0 && loopC.bis_beat === 8,
      `Entwurf nach pointercancel ${JSON.stringify(ent0)}, nach weiterer Mausbewegung ${JSON.stringify(ent1)} (vorher: folgt der Maus); Loop danach ${loopC.von_beat}..${loopC.bis_beat} (vorher: bis 5 beim Loslassen)`);
    await b.maus('mouseMoved', bx(2.1), l.t + 20, { buttons: 0 });
    await b.maus('mousePressed', bx(2.1), l.t + 20); await b.maus('mouseReleased', bx(2.1), l.t + 20); await warte(200);
    notiere('5.2 Startmarke', (await w('window.djkProd.start')) === 2, `Start ${await w('window.djkProd.start')} (gerastet 1/4)`);
    const n0 = log().length;
    await b.klick('[data-p="play"]'); await warte(1500);
    const start = log().slice(n0).find((e) => e.weg === '/proj/transport');
    const kb = await w('window.djkProd.kopfBeat');
    const tr = at.zustand.transport, bpm = at.zustand.masterBpm;
    const roh = tr.beat0 + ((Date.now() - tr.t0) / 60000) * bpm;
    const erwartet = roh >= 8 ? (roh % 8) : roh;
    notiere('5.3 Play und Abspielkopf', start?.koerper.aktion === 'start' && start.koerper.beat === 2 && (await w('window.djkProd.arr?.status')) === 2 && Math.abs(kb - erwartet) < 0.25,
      `Anfrage ${JSON.stringify(start?.koerper)}; Kopf ${kb?.toFixed(3)}, Attrappe ${erwartet.toFixed(3)} (Master ${bpm} BPM)`);
    // 5.3b Vertragsfeld nr: die Anzeige zeigt die Wiedergabe-Nummer, die die Attrappe als /zustand/arr nr sendet (Spec 3.1; vorher las die Seite rev und die Attrappe sandte rev)
    at.zustand.projekte.get(at.zustand.slug).wiedergabe_rev = 5;
    await warte(300);
    const kernAnz = await w(`document.querySelector('[data-p="kern"]').textContent`);
    notiere('5.3b Kern-Nummer aus nr', kernAnz === 'core rev 5 · playing', `Attrappe sendet nr 5 → Anzeige „${kernAnz}“`);
    await warte(3000);
    const kb2 = await w('window.djkProd.kopfBeat');
    const px = await w(`(() => { const c = document.querySelector('[data-p="ueber"]'); const a = window.djkProd.ansicht; const x = Math.round((window.djkProd.kopfBeat - a.beat0) * a.pxProBeat); const d = c.getContext('2d').getImageData(Math.max(0, x - 2), 10, 5, 1).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 3] > 200) n++; return n; })()`);
    notiere('5.4 Loop-Wrap und Kopf gezeichnet', kb2 >= 0 && kb2 < 8 && px >= 1, `Kopf nach 4,5 s ${kb2?.toFixed(3)} (in [0, 8)); weiße Pixel am Kopf ${px}`);
    // Hochrechnung über die Naht: /zustand/arr 2,5 s lang aussetzen. Bis 1 s Alter rechnet die Seite weiter und faltet selbst in die
    // Klammer (5.4b); danach ist der Zustand unbekannt, der Kopf bleibt weg und die Anzeige sagt es (5.4c, Fix 9); mit der nächsten Meldung ist alles wieder da.
    for (let i = 0; i < 200; i++) { const k = await w('window.djkProd.kopfBeat'); if (k >= 6.8 && k <= 7.4) break; await warte(25); }   // kurz vor der Naht bei 8
    const tStumm = Date.now();
    await fetch(URL + 'attrappe/stumm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms: 2500 }) });
    const proben = [];
    for (let i = 0; i < 24; i++) { await warte(80); proben.push({ t: Date.now() - tStumm, k: await w('window.djkProd.kopfBeat'), u: await w('window.djkProd.arrUnbekannt') }); }
    const jung = proben.filter((x) => x.t < 800), alt = proben.filter((x) => x.t > 1300 && x.t < 2300);
    const kernAlt = await w(`document.querySelector('[data-p="kern"]').textContent`), playAlt = await w(`document.querySelector('[data-p="play"]').classList.contains('an')`);
    notiere('5.4b Faltung ohne Meldung', jung.length >= 5 && jung.every((x) => x.k >= 0 && x.k < 8 && !x.u) && Math.min(...jung.map((x) => x.k)) < 3 && Math.max(...jung.map((x) => x.k)) > 6.5,
      `Kopf in den ersten 0,8 s ohne /zustand/arr (${jung.length} Proben): min ${Math.min(...jung.map((x) => x.k)).toFixed(2)}, max ${Math.max(...jung.map((x) => x.k)).toFixed(2)} (über die Naht bei 8 gefaltet, in [0, 8))`);
    notiere('5.4c Kein Hochrechnen ohne Meldung (Fix 9)', alt.length >= 5 && alt.every((x) => x.k === null && x.u === true) && kernAlt === 'core state unknown' && playAlt === false,
      `nach 1,3 bis 2,3 s Stille (${alt.length} Proben): Kopf ${[...new Set(alt.map((x) => x.k))]}, unbekannt ${[...new Set(alt.map((x) => x.u))]}, Anzeige „${kernAlt}“, PLAY an ${playAlt}`);
    await warte(Math.max(0, 2500 - (Date.now() - tStumm)) + 400);
    const wieder = await w(`({ k: window.djkProd.kopfBeat, u: window.djkProd.arrUnbekannt, kern: document.querySelector('[data-p="kern"]').textContent })`);
    notiere('5.4d Meldung stellt den Kopf wieder her', wieder.k !== null && wieder.u === false && /^core rev \d+ · playing$/.test(wieder.kern), `nach der ersten neuen Meldung: Kopf ${wieder.k?.toFixed(2)}, unbekannt ${wieder.u}, Anzeige „${wieder.kern}“`);
    await warte(600);
    await b.klick('[data-p="stopp"]'); await warte(600);
    notiere('5.5 Stop', (await w('window.djkProd.arr?.status')) === 0 && (await w('window.djkProd.kopfBeat')) === null && (await w(`document.querySelector('[data-p="position"]').textContent`)) === '1.3.1',
      `Status ${await w('window.djkProd.arr?.status')}, Kopf ${await w('window.djkProd.kopfBeat')}, Position ${await w(`document.querySelector('[data-p="position"]').textContent`)}`);
    await b.klick('[data-p="metronom"]'); await warte(400);
    notiere('5.6 Metronom', (await projekt()).metronom.an === true && (await w(`document.querySelector('[data-p="metronom"]').classList.contains('an')`)), `metronom ${JSON.stringify((await projekt()).metronom)}`);
    await b.klick('[data-p="tempo"]'); await w(`document.querySelector('[data-p="tempo"]').select()`);
    await tippe('124'); await enter(); await warte(400);
    const n1 = log().length;
    await b.klick('[data-p="tempo"]'); await w(`document.querySelector('[data-p="tempo"]').select()`);
    await tippe('300'); await enter(); await warte(300);
    const zuviel = log().slice(n1).filter((e) => e.weg === '/proj/aendern').length;
    notiere('5.7 Tempo', (await projekt()).tempo_bpm === 124 && zuviel === 0, `tempo ${(await projekt()).tempo_bpm}; 300 BPM → Anfragen ${zuviel}, Meldung „${await w(`document.querySelector('[data-p="meldung"]').textContent`)}“`);
    // 5.8 Start hinter bis (Spec 2.2): der Kern springt nur „beim Erreichen von bis“; wer hinter der Klammer startet, läuft
    // ungefaltet weiter, und die Seite darf den Kopf dann nicht in die Klammer falten
    const l8 = await rect('[data-p="lineal"]'), a8 = await w('window.djkProd.ansicht');
    await b.maus('mouseMoved', l8.l + (12 - a8.beat0) * a8.pxProBeat, l8.t + 20, { buttons: 0 });
    await b.maus('mousePressed', l8.l + (12 - a8.beat0) * a8.pxProBeat, l8.t + 20); await b.maus('mouseReleased', l8.l + (12 - a8.beat0) * a8.pxProBeat, l8.t + 20); await warte(200);
    const start8 = await w('window.djkProd.start'), loop8 = (await projekt()).loop;
    await b.klick('[data-p="play"]'); await warte(1500);
    const k81 = await w('window.djkProd.kopfBeat');
    await fetch(URL + 'attrappe/stumm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ms: 1500 }) });
    const k8 = [];
    for (let i = 0; i < 6; i++) { await warte(100); k8.push(await w('window.djkProd.kopfBeat')); }   // innerhalb der ersten Sekunde ohne Meldung
    notiere('5.8 Start hinter bis', loop8.an === true && start8 === 12 && k81 >= 12 && k8.every((x) => x >= 12) && k8.at(-1) > k8[0],
      `Klammer ${loop8.von_beat}..${loop8.bis_beat} an, Start ${start8}; Kopf nach 1,5 s ${k81?.toFixed(2)}, ohne /zustand/arr in der ersten Sekunde min ${Math.min(...k8).toFixed(2)} max ${Math.max(...k8).toFixed(2)} (muss ≥ 12 bleiben, nicht in die Klammer gefaltet)`);
    await warte(1000);
    await b.klick('[data-p="stopp"]'); await warte(500);
    // 5.9 Der Kern antwortet nicht (quittung null) oder lehnt ab: die Seite sagt es, nie stiller Erfolg
    const meldung9 = () => w(`document.querySelector('[data-p="meldung"]').textContent`);
    const anTransport = (q) => fetch(URL + 'attrappe/transportantwort', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quittung: q }) });
    await anTransport(null);
    await b.klick('[data-p="play"]'); await warte(500);
    const stumm9 = await meldung9(), fehlerKlasse9 = await w(`document.querySelector('[data-p="meldung"]').classList.contains('fehler')`);
    await anTransport({ status: 7, grund: 'deck_laeuft' });
    await b.klick('[data-p="play"]'); await warte(500);
    const abgelehnt9 = await meldung9();
    await b.klick('[data-p="play"]'); await warte(500);       // Negativ-Kontrolle: normale Quittung, keine neue Meldung, Kern läuft
    const status9 = await w('window.djkProd.arr?.status');
    await b.klick('[data-p="stopp"]'); await warte(500);
    notiere('5.9 Kern ohne Antwort oder abgelehnt', stumm9 === 'No answer from the core' && fehlerKlasse9 === true && abgelehnt9 === 'A deck is playing: the tempo stays until it stops' && status9 === 2,
      `quittung null → „${stumm9}“ (Fehlerklasse ${fehlerKlasse9}); Status 7 deck_laeuft → „${abgelehnt9}“; Negativ-Kontrolle: danach Kern-Status ${status9}`);
  }

  // ================= Teil 6: Undo/Redo, Verlauf, Quelle Cypher, Zeichenzeit =================
  if (TEIL >= 6) {
    await w(`document.activeElement?.blur()`);
    const vor = (await projekt()).tempo_bpm;
    const n6 = log().length;           // nur die Anfragen ab hier (3.6b hat schon direkt /proj/undo gerufen)
    await taste('z', 'KeyZ', 2); await warte(500);
    const nachUndo = (await projekt()).tempo_bpm;
    await taste('z', 'KeyZ', 2 | 8); await warte(500);
    const nachRedo = (await projekt()).tempo_bpm;
    const wege = log().slice(n6).filter((e) => e.weg === '/proj/undo' || e.weg === '/proj/redo').map((e) => e.weg);
    notiere('6.1 Undo/Redo per Taste', vor === 124 && nachUndo === 120 && nachRedo === 124 && wege.join() === '/proj/undo,/proj/redo', `Tempo ${vor} → Undo ${nachUndo} → Redo ${nachRedo}; Anfragen ${wege.join(', ')}`);
    // 6.1b Strg+Z mit der Hand am Fader: der Fader behält den Fokus (type=range), ein Schritt per Pfeiltaste ändert die Lautstärke, Strg+Z nimmt sie zurück
    {
      const sid = (await projekt()).spuren[0].id, sel = `.p-kopf[data-spur="${sid}"] .p-fader`;
      const f0 = (await projekt()).spuren[0].fader_db;
      await w(`document.querySelector(${JSON.stringify(sel)}).focus()`);
      const pfeil = (key, code, vk) => b.sende('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk }).then(() => b.sende('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }));
      await pfeil('ArrowRight', 'ArrowRight', 39); await warte(500);
      const f1 = (await projekt()).spuren[0].fader_db;
      const fokus = await w(`document.activeElement === document.querySelector(${JSON.stringify(sel)})`);
      await taste('z', 'KeyZ', 2); await warte(500);
      const f2 = (await projekt()).spuren[0].fader_db;
      // Negativ-Kontrolle: im Textfeld (TEMPO) greift Strg+Z nicht aufs Projekt
      const nT = log().length;
      await w(`document.querySelector('[data-p="tempo"]').focus()`);
      await taste('z', 'KeyZ', 2); await warte(400);
      const imFeld = log().slice(nT).filter((e) => e.weg === '/proj/undo').length;
      await w(`document.activeElement?.blur()`);
      notiere('6.1b Strg+Z am Fader', fokus && f1 !== f0 && f2 === f0 && imFeld === 0, `Fokus am Fader ${fokus}; fader_db ${f0} → ${f1} (Pfeiltaste) → Strg+Z ${f2}; Negativ-Kontrolle Strg+Z im TEMPO-Feld: ${imFeld} Undo-Anfragen`);
    }
    const rev = (await projekt()).rev;
    await fetch(URL + 'proj/aendern', { method: 'POST', headers: { 'content-type': 'application/json', 'x-djk-quelle': 'cypher' }, body: JSON.stringify({ rev, label: 'Cypher mute', befehle: [{ befehl: 'spur_aendern', spur_id: (await projekt()).spuren[1].id, mute: true }] }) });
    await warte(600);
    await b.klick('[data-p="verlauf"]'); await warte(200);
    const liste = await w(`[...document.querySelectorAll('[data-p="verlauf-liste"] li')].map((li) => li.textContent)`);
    const verlauf = await (await fetch(URL + 'proj/verlauf')).json();
    // 6.2b Präfix nur einmal: S2 schreibt „Undo: <label>“ selbst ins Label (die Attrappe auch), die Seite zeigt es unverändert
    const undoZeilen = liste.filter((z) => /Undo: |Redo: /.test(z));
    const doppelt = liste.filter((z) => /(Undo|Redo): (Undo|Redo):/.test(z));
    notiere('6.2b Verlauf: Präfix nur einmal', undoZeilen.length >= 2 && doppelt.length === 0 && undoZeilen.some((z) => /  Undo: Tempo 124  · You$/.test(z)) && undoZeilen.some((z) => /  Redo: Tempo 124  · You$/.test(z)),
      `${undoZeilen.length} Undo/Redo-Zeilen, doppelte Präfixe ${doppelt.length}; z. B. „${undoZeilen[0]}“`);
    notiere('6.2 Verlauf mit Quelle', liste.length === Math.min(40, verlauf.length) && liste[0].endsWith('Cypher mute  · Cypher') && liste.slice(1).some((z) => z.endsWith('· You')) && (await projekt()).spuren[1].mute === true,
      `${liste.length} Zeilen (Server ${verlauf.length}, Anzeige höchstens 40); oben „${liste[0]}“`);
    const undoTitel = await w(`document.querySelector('[data-p="undo"]').title`);
    notiere('6.3 Undo zeigt, was es zurücknimmt', undoTitel === 'Undo: Cypher mute (Ctrl+Z)', `Titel „${undoTitel}“`);
    // 6.3b Die Knöpfe UNDO und REDO (nicht nur die Tasten): Cyphers Mute geht zurück und wieder hin, die Knöpfe sperren sich im Rand
    await b.klick('[data-p="undo"]'); await warte(500);
    const mNach = (await projekt()).spuren[1].mute, redoTitel = await w(`document.querySelector('[data-p="redo"]').title`), redoAus = await w(`document.querySelector('[data-p="redo"]').disabled`);
    await b.klick('[data-p="redo"]'); await warte(500);
    const mRedo = (await projekt()).spuren[1].mute, redoSperre = await w(`document.querySelector('[data-p="redo"]').disabled`);
    notiere('6.3b Knöpfe UNDO und REDO', mNach === false && redoAus === false && redoTitel === 'Redo: Cypher mute (Ctrl+Shift+Z)' && mRedo === true && redoSperre === true,
      `Undo-Knopf: mute ${mNach}, Redo-Titel „${redoTitel}“; Redo-Knopf: mute ${mRedo}, Redo danach gesperrt (Negativ-Kontrolle) ${redoSperre}`);
    // Zeichenzeit: 8 Spuren × 16 Audio-Clips mit Welle, spielend, 3 s
    const voll = neuesProjekt('Load');
    const LAST_SPUREN = Number(process.env.CYPHERDJ_PROBE_SPUREN ?? 8);                      // E3 Task 12: mit 32 misst derselbe Punkt die volle Spurzahl
    for (let i = 0; i < LAST_SPUREN; i++) voll.spuren.push({ id: `l${i}`, nr: i + 1, name: `T${i + 1}`, farbe: '#e0563b', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false,
      clips: Array.from({ length: 16 }, (_, k) => ({ id: `l${i}c${k}`, art: 'audio', name: 'kick', start_beat: k * 4, laenge_beats: 1, quelle: { sha256: SHA.kick, pfad_hinweis: null }, dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 })) });
    const r = await (await fetch(URL + 'attrappe/saat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projekt: voll }) })).json();
    await fetch(URL + 'attrappe/sse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ a: 'proj', f: { slug: r.slug, rev: 1, label: 'seed', quelle: 'cypher' } }) });
    await warte(800);
    await w(`window.djkProdBild.length = 0`);
    await b.klick('[data-p="play"]');
    const f = await rect('[data-p="flaeche"]');
    for (let i = 0; i < 60; i++) { await rad(f.l + 200, f.t + 20, i % 2 ? 30 : -30, 0); await warte(50); }   // Rad hin und her: jedes Bild zeichnet die Spuren neu
    const bilder = await w(`[...window.djkProdBild]`);
    await b.klick('[data-p="stopp"]'); await warte(300);
    const sort = [...bilder].sort((x, y) => x - y), p99 = sort[Math.floor(sort.length * 0.99)] ?? Infinity;
    notiere('6.4 Zeichenzeit', bilder.length > 60 && p99 < 8, `${bilder.length} Bilder in 3 s mit Scrollen (Spuren je Rad-Schritt neu gezeichnet), p50 ${sort[Math.floor(sort.length / 2)]?.toFixed(2)} ms, p99 ${p99.toFixed(2)} ms (Grenze 8 ms), max ${sort[sort.length - 1]?.toFixed(2)} ms, ${LAST_SPUREN} Spuren × 16 Clips`);
  }
  // 6.4b Zeichnen kostet im Bildtakt keine Messung und keine Textknoten-Schreibung ohne Änderung (Fix 11): 1,5 s spielen, FOLLOW läuft
  if (TEIL >= 6) {
    await w(`(() => { window.__gbcr = 0; window.__txt = 0; const o = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function (...a) { if (this.closest?.('#produktion')) window.__gbcr++; return o.apply(this, a); };   // nur Messungen in der PRODUCTION-Ansicht (die DJ-Wellen messen eigene Flächen)
      window.__mo = new MutationObserver((l) => { window.__txt += l.length; }); window.__mo.observe(document.querySelector('[data-p="position"]'), { childList: true, characterData: true, subtree: true }); window.__bilder0 = window.djkProdBild.length; })()`);
    await w(`window.djkProdBild.length = 0`);
    await b.klick('[data-p="play"]'); await warte(1500);
    const m = await w(`({ gbcr: window.__gbcr, txt: window.__txt, bilder: window.djkProdBild.length })`);
    await b.klick('[data-p="stopp"]'); await warte(300);
    notiere('6.4b Keine Messung, kein Text-Schreiben je Bild', m.bilder > 60 && m.gbcr <= 5 && m.txt <= m.bilder / 3,
      `${m.bilder} Bilder in 1,5 s Spielen: ${m.gbcr} × getBoundingClientRect (vorher je Bild 3: ≈ ${m.bilder * 3}), ${m.txt} Textänderungen an der Position (vorher je Bild eine: ≈ ${m.bilder})`);
  }
  const fk = fehlerKonsole();
  notiere('9 Konsole', fk.length === 0, `Fehler/Exceptions ${fk.length}${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text).join(' | ')}` : ''} (ohne ${erwarteteKonsole()} gewollte Meldungen aus 3.8 und 3.9)`);
  await b.bild(path.join(ORDNER, 'produktion.png'));
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await at.stoppe();
  await s.stoppe();
  fs.rmSync(fix, { recursive: true, force: true });
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe PRODUCTION ${zeit} (Instanz ${opt.instanz}, Teil ${TEIL})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
