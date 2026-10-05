// Abnahme Scheibe 60m (Plan Task 4). Stapel: Kern-Attrappe + Zähl-Relais + Leitstand + Seiten-Server + Anzeige-Sonde;
// Browser kopflos über CDP, echte Maus-Ereignisse. Kein Ton (Attrappe schreibt keinen, Chrome --mute-audio).
// Aufruf: node pruef/abnahme.mjs [--instanz g] [--bild <png>]   → pruef/ergebnisse/<zeit>/bericht.md, ergebnis.json
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';
import { GRIFF, art, wertAusMidi, ZIELE } from '../oeffentlich/kurven.js';
import { baueBestand } from '../tests/hilfen/bestand.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HIER, '..', '..', '..');
const inhalt = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: 'g' }, bild: { type: 'string' } } });
const d0 = new Date();
const zeit = `${d0.getFullYear()}${String(d0.getMonth() + 1).padStart(2, '0')}${String(d0.getDate()).padStart(2, '0')}T${String(d0.getHours()).padStart(2, '0')}${String(d0.getMinutes()).padStart(2, '0')}`;
const ORDNER = path.join(HIER, 'ergebnisse', zeit);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const last = () => os.loadavg().map((x) => x.toFixed(2)).join(' ');
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)) : []);
const ergebnis = { zeit, instanz: opt.instanz, last_vor: last(), punkte: {} };
const zeilen = [];
const notiere = (k, ok, text) => { ergebnis.punkte[k] = { ok, text }; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const s = await starteStapel(ORDNER, opt.instanz);
const ABO = s.ports.abo; // Absender-Port des Seiten-Servers am Relais
const relais = () => jsonl(path.join(ORDNER, 'relais.jsonl'));
const sondeAb = (t) => s.sonde.nachrichten.filter((m) => m.t >= t);
const journal = () => jsonl(s.journal);
const b = await starteBrowser();
try {
  // ---------- A1 Negativ-Kontrolle: Öffnen erzeugt 0 Befehle an den Kern ----------
  // Vorher-Fenster 10 s ohne Seite, dann Seite öffnen und 10 s Nachher-Fenster. Der Leitstand schickt periodisch
  // /k/led, /k/ki/* (seine Sache); gezählt wird je Absender und Adresse, verglichen vorher gegen nachher.
  await warte(500);
  const tv = Date.now();
  await warte(10000);
  const t0 = Date.now();
  await b.oeffne(s.url);
  await warte(10000);
  const t1 = Date.now();
  const zaehle = (a, e) => {
    const c = {};
    for (const z of relais().filter((x) => x.t >= a && x.t < e)) { const k = `${z.von_port === ABO ? 'seite' : z.von_port === s.ports.ls_abo ? 'leitstand' : z.von_port} ${z.adresse}`; c[k] = (c[k] ?? 0) + 1; }
    return c;
  };
  const vor = zaehle(tv, t0);
  const nach = zaehle(t0, t1);
  const vonSeite = Object.entries(nach).filter(([k]) => k.startsWith('seite ') && k !== 'seite /k/hallo');
  const schluessel = [...new Set([...Object.keys(vor), ...Object.keys(nach)])].sort();
  const abweichung = schluessel.filter((k) => Math.abs((vor[k] ?? 0) - (nach[k] ?? 0)) > 1);
  const seiteGesendet = await b.werte('window.djkGesendet.length');
  const audio = await b.werte('document.querySelectorAll("audio,video").length');
  const abNachOeffnen = inhalt(s.ab);
  fs.writeFileSync(path.join(ORDNER, 'a1_fenster.json'), JSON.stringify({ vor, nach }, null, 2));
  notiere('A1 Öffnen', vonSeite.length === 0 && abweichung.length === 0 && seiteGesendet === 0 && audio === 0 && abNachOeffnen.length === 0,
    `Befehle des Seiten-Servers an den Kern nach dem Öffnen (ohne /k/hallo): ${vonSeite.reduce((x, [, n]) => x + n, 0)}; ` +
    `je Absender und Adresse vorher/nachher (10 s/10 s): ${schluessel.map((k) => `${k} ${vor[k] ?? 0}/${nach[k] ?? 0}`).join(', ')}; ` +
    `Abweichung > 1: ${abweichung.length}; Griffe der Seite ${seiteGesendet}; audio/video-Elemente ${audio}; Einträge im Arbeitsbestand ${abNachOeffnen.length}`);
  const verbunden = await b.werte('[document.querySelector("#v-kern").classList.contains("an"), document.querySelector("#v-leitstand").classList.contains("an")]');
  const layout = await b.werte('({sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth})');
  notiere('A0 Seite', verbunden[0] && verbunden[1] && layout.sh <= layout.ih && layout.sw <= layout.iw && b.konsole.length === 0,
    `Kern ${verbunden[0] ? 'an' : 'aus'}, Leitstand ${verbunden[1] ? 'an' : 'aus'}, 1920×1080: scrollHeight ${layout.sh} ≤ ${layout.ih}, scrollWidth ${layout.sw} ≤ ${layout.iw}, Konsole ${b.konsole.length} Meldungen`);

  // ---------- A3 Laden per Klick ----------
  const ladeFaelle = [[1, 'nightshift'], [2, 'every-morning-new']];
  const ladeText = [];
  let ladenOk = true;
  for (const [deck, titel] of ladeFaelle) {
    const t = Date.now();
    const mid = await b.werte(`[...document.querySelectorAll('#liste tr')].find((tr)=>tr.firstChild.textContent===${JSON.stringify(titel)}).dataset.material`);
    const idx = await b.werte(`[...document.querySelectorAll('#liste tr')].findIndex((tr)=>tr.firstChild.textContent===${JSON.stringify(titel)}) + 1`);
    await b.klick(`#liste tr:nth-child(${idx}) button.laden[data-deck="${deck}"]`);
    await warte(700);
    const r = relais().filter((z) => z.t >= t && z.adresse === '/k/deck/laden');
    const g = sondeAb(t).filter((m) => m.n.typ === 'ereignis' && m.n.daten.art === 'geladen' && m.n.daten.deck === deck);
    const titelSeite = await b.werte(`document.querySelector('.deck[data-deck="${deck}"] [data-titel]').textContent`);
    // Kopie am Ziel: fassung.json bytegleich, basis.f32 gleich groß, kein .kopie-Rest; Server-Log mit Dauer
    const q = path.join(REPO, 'bestand', mid, 'fassungen', '128000_r1');
    const z = path.join(s.ab, mid, 'fassungen', '128000_r1');
    const jsonGleich = fs.existsSync(path.join(z, 'fassung.json')) && fs.readFileSync(path.join(z, 'fassung.json')).equals(fs.readFileSync(path.join(q, 'fassung.json')));
    const groesse = fs.existsSync(path.join(z, 'basis.f32')) ? fs.statSync(path.join(z, 'basis.f32')).size : -1;
    const reste = inhalt(s.ab).filter((n) => n.startsWith('.kopie-')).length;
    const k = jsonl(path.join(ORDNER, 'server.jsonl')).filter((x) => x.typ === 'kopie' && x.material_id === mid).at(-1);
    const ok = r.length === 1 && r[0].felder.quelle === 'andreas' && r[0].felder.deck === deck && r[0].felder.material_id === mid
      && g.length === 1 && g[0].n.daten.material_id === mid && titelSeite === titel
      && jsonGleich && groesse === fs.statSync(path.join(q, 'basis.f32')).size && reste === 0 && k?.kopiert === true;
    ladenOk &&= ok;
    ladeText.push(`Deck ${deck} „${titel}“: /k/deck/laden ${r.length}× (quelle ${r[0]?.felder.quelle}, material ${r[0]?.felder.material_id}), ` +
      `Leitstand-WS ereignis geladen ${g.length}×, Titel auf der Seite „${titelSeite}“; Kopie im Arbeitsbestand: fassung.json bytegleich ${jsonGleich}, ` +
      `basis.f32 ${groesse} Bytes, ${k?.dauer_ms} ms, .kopie-Reste ${reste}`);
  }
  notiere('A3 Laden', ladenOk, ladeText.join('; '));

  // ---------- A2 je Regler: echter Griff → Relais → Kern → Leitstand ----------
  const faelle = [];
  for (const n of [1, 2]) {
    // je Regler ein anderer Zugweg: gleiche Zahlen bei verschiedenen Reglern hießen dann ein träges Instrument
    ['trim', 'eq/hoch', 'eq/mitte', 'eq/tief', 'filter'].forEach((teil, i) => faelle.push({ pfad: `deck/${n}/${teil}`,
      sel: `.knopf[data-pfad="deck/${n}/${teil}"]`, dx: 0, dy: (teil === 'filter' ? -1 : 1) * (16 + 5 * i + 3 * n) }));
    faelle.push({ pfad: `deck/${n}/fader`, sel: `.regler.senkrecht[data-pfad="deck/${n}/fader"] .kappe`, dx: 0, dy: -150 - 20 * n });
    for (const k of ['hoch', 'mitte', 'tief']) faelle.push({ pfad: `deck/${n}/kill/${k}`, sel: `.kill[data-pfad="deck/${n}/kill/${k}"]`, klick: true });
    for (const tt of ['cue', 'play']) faelle.push({ pfad: `deck/${n}/${tt}`, sel: `.taste[data-pfad="deck/${n}/${tt}"]`, klick: true, taste: true });
    faelle.push({ pfad: `deck/${n}/pfl`, sel: `.pfl[data-pfad="deck/${n}/pfl"]`, klick: true });
  }
  faelle.push({ pfad: 'xfader', sel: '.regler.waagrecht[data-pfad="xfader"] .kappe', dx: -120, dy: 0 });
  // 60m-Nachtrag: Master-Pegel nach unten (steht auf 0 dB), Kopfhörer-Mix und -Pegel nach oben
  faelle.push({ pfad: 'master/pegel', sel: '.knopf[data-pfad="master/pegel"]', dx: 0, dy: 40 });
  faelle.push({ pfad: 'cue/mix', sel: '.knopf[data-pfad="cue/mix"]', dx: 0, dy: -57 });
  faelle.push({ pfad: 'cue/pegel', sel: '.knopf[data-pfad="cue/pegel"]', dx: 0, dy: -33 });
  const zeilenA2 = [];
  let gruen = 0;
  for (const f of faelle) {
    // Absicht der Hand, unabhängig von der Ziel-Kurve: Stellung vor dem Zug plus Zugweg in Pixeln durch den Regelweg
    const vorher = f.klick ? null : await b.werte(`(() => { const r = window.djkRegler.get(${JSON.stringify(f.pfad)}); const el = r.el;
      const weg = el.classList.contains('knopf') ? 220 : el.classList.contains('waagrecht') ? el.querySelector('.bahn').clientWidth : el.querySelector('.bahn').clientHeight;
      return { x: r.x, weg }; })()`);
    const t = Date.now();
    if (f.klick) await b.klick(f.sel); else await b.ziehe(f.sel, f.dx, f.dy);
    await warte(400);
    const r = relais().filter((z) => z.t >= t && z.adresse === '/test/hand' && z.felder.pfad === f.pfad && z.von_port === ABO);
    const fremd = relais().filter((z) => z.t >= t && z.adresse === '/test/hand' && z.felder.pfad !== f.pfad);
    const hand = sondeAb(t).filter((m) => m.n.typ === 'ereignis' && m.n.daten.art === 'hand' && m.n.daten.pfad === f.pfad);
    let ok; let text;
    if (f.taste) {
      const us = r.map((z) => z.felder.midi_roh);
      ok = us.length === 2 && us[0] === 1 && us[1] === 0 && hand.length >= 1;
      text = `midi_roh ${JSON.stringify(us)}, ereignis hand ${hand.length}`;
    } else if (art(f.pfad) === 'kill' || art(f.pfad) === 'pfl') {
      const us = r.map((z) => z.felder.midi_roh);
      const j = journal().filter((z) => z.typ === '/e/regler' && z.daten.pfad === f.pfad).at(-1);
      const seite = await b.werte(`window.djk.regler[${JSON.stringify(f.pfad)}]`);
      ok = us.length === 2 && us[1] === 1 - us[0] && hand.length >= 1 && j && j.daten.wert === us[1] && seite === j.daten.wert;
      text = `/test/hand ${JSON.stringify(us)} (Stellung, dann umgeschaltet), Leitstand: ereignis hand ${hand.length}×, Journal /e/regler ${j?.daten.wert} (halter ${j?.daten.halter}), Seite ${seite}`;
    } else {
      const a = art(f.pfad);
      const letzte = r.at(-1)?.felder.midi_roh;
      const d = f.dx !== 0 ? f.dx : -f.dy;
      const xEnde = Math.max(0, Math.min(1, vorher.x + d / vorher.weg));
      const erwartetWert = GRIFF[a].wert(xEnde);
      const ausMidi = wertAusMidi(f.pfad, letzte ?? NaN, 'attrappe_linear');
      const j = journal().filter((z) => z.typ === '/e/regler' && z.daten.pfad === f.pfad && z.mono_ns !== undefined).at(-1);
      const seite = await b.werte(`window.djk.regler[${JSON.stringify(f.pfad)}]`);
      const tol = a === 'fader' || a === 'pegel' ? 0.1 : a === 'filter' || a === 'xfader' || a === 'mix' ? 0.005 : 0.05; // halbes Pixel Zugweg
      ok = r.length >= 2 && hand.length >= 1 && j && Math.abs(j.daten.wert - erwartetWert) <= tol && Math.abs(seite - j.daten.wert) <= 1e-4;
      text = `/test/hand ${r.length}× (erste = Stellung ${r[0]?.felder.midi_roh?.toFixed(4)}), Zug ${d} px von Stellung ${vorher.x.toFixed(4)} → Absicht ${erwartetWert.toFixed(3)}, letzte midi_roh ${letzte?.toFixed(4)} (Ziel-Kurve → ${ausMidi.toFixed(3)}), ` +
        `Leitstand: ereignis hand ${hand.length}×, Journal /e/regler ${j ? j.daten.wert.toFixed(3) : 'fehlt'} (halter ${j?.daten.halter}), Seite zeigt ${typeof seite === 'number' ? seite.toFixed(3) : seite}`;
    }
    if (fremd.length) { ok = false; text += `, fremde Pfade ${fremd.length}`; }
    if (ok) gruen++;
    zeilenA2.push(`${ok ? 'OK  ' : 'FEHL'} ${f.pfad}: ${text}`);
  }
  const abgedeckt = new Set(faelle.map((f) => f.pfad));
  notiere('A2 Regler', gruen === faelle.length && abgedeckt.size === ZIELE.size,
    `${gruen} von ${faelle.length} Griffen kamen richtig an (Ziel-Liste ${ZIELE.size}, abgedeckt ${[...ZIELE].filter((p) => abgedeckt.has(p)).length})`);
  fs.writeFileSync(path.join(ORDNER, 'a2_regler.txt'), zeilenA2.join('\n') + '\n');
  const status1 = await b.werte('window.djk.decks[1]?.status');
  notiere('A2b Play wirkt', status1 === 2 || status1 === 1, `Deck 1 Status nach Cue und Play laut /zustand/deck: ${status1} (2 = läuft)`);

  // Bild für die Stand-Datei (Deck A läuft, Regler bewegt)
  await warte(1500);
  await b.bild(path.join(ORDNER, 'bildschirm.png'));
  if (opt.bild) fs.copyFileSync(path.join(ORDNER, 'bildschirm.png'), opt.bild);
  const konsoleVorA4 = b.konsole.length;

  // ---------- A4 Fehlerfall: falsches Ziel ----------
  const t4 = Date.now();
  const falsch = ['deck/3/fader', 'deck/3/pfl', 'deck/1/bogus', 'cue/split', 'master/fader'];
  const antworten = await b.werte(`Promise.all(${JSON.stringify(falsch)}.map((pfad) => fetch('/griff', {method:'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({pfad, u: 0.5})}).then(async (r) => [pfad, r.status, (await r.json()).fehler])))`);
  await warte(400);
  const durch = relais().filter((z) => z.t >= t4 && z.adresse === '/test/hand');
  notiere('A4 Fehlerfall Riegel', antworten.every(([, c, f]) => c === 400 && f === 'unbekanntes_ziel') && durch.length === 0,
    `${antworten.map(([p, c, f]) => `${p} → ${c} ${f}`).join(', ')}; /test/hand am Relais danach ${durch.length}`);
  notiere('A0b Konsole', konsoleVorA4 === 0, `Konsolen-Meldungen bis vor A4: ${konsoleVorA4}`);
} finally {
  await b.zu();
  await s.stoppe();
}

// ---------- A4b Mutation: Riegel aus → der Kern lehnt selbst ab, Leitstand-Journal sieht es ----------
{
  const o2 = path.join(ORDNER, 'mutation_riegel_aus');
  const s2 = await starteStapel(o2, opt.instanz, { OBERFLAECHE_MUTATION: 'riegel_aus' });
  try {
    const r = await fetch(`${s2.url}griff`, { method: 'POST', body: JSON.stringify({ pfad: 'deck/1/bogus', u: 0.5 }) });
    const r2 = await fetch(`${s2.url}griff`, { method: 'POST', body: JSON.stringify({ pfad: 'deck/3/fader', u: 0.5 }) });
    await fetch(`${s2.url}griff`, { method: 'POST', body: JSON.stringify({ pfad: 'deck/3/fader', u: 0.8 }) }); // nach der Stellung
    await warte(500);
    const rel = jsonl(path.join(o2, 'relais.jsonl')).filter((z) => z.adresse === '/test/hand');
    const pf = jsonl(s2.journal).filter((z) => z.typ === '/e/protokollfehler');
    const hand3 = jsonl(s2.journal).filter((z) => z.typ === '/e/regler' && z.daten.pfad === 'deck/3/fader');
    notiere('A4b Mutation riegel_aus', r.status === 200 && rel.length === 3 && pf.length === 1 && pf[0].daten.grund === 'unbekannter_regler',
      `deck/1/bogus → Server ${r.status}, am Relais /test/hand ${rel.length}; Leitstand-Journal /e/protokollfehler ${pf.length}× (${pf[0]?.daten.adresse} ${pf[0]?.daten.grund}); ` +
      `deck/3/fader → Server ${r2.status}, vom Kern angenommen (Journal /e/regler deck/3/fader ${hand3.length}×, Wert ${hand3.at(-1)?.daten.wert}): der Riegel der Seite ist nötig`);
  } finally { await s2.stoppe(); }
}

// ---------- A6 Fehlerfall Kopie (60m-Nachtrag): kaputte und fehlende Fassung per Klick abgewiesen ----------
// Eigener kleiner Bestand (tests/hilfen/bestand.mjs), dazu ein Rest einer toten Kopie vor dem Start. Positiv-Kontrolle
// im selben Stapel: die gute Fassung lädt.
{
  const o3 = path.join(ORDNER, 'kopie_fehlerfall');
  const bst = baueBestand(fs.mkdtempSync(path.join(os.tmpdir(), 'djk60n-bestand-')), [
    { material_id: 'f0000000000000a1', titel: 'Alpha' },
    { material_id: 'f0000000000000b1', titel: 'Bad checksum', kaputt: 'sha' },
    { material_id: 'f0000000000000b2', titel: 'Short file', kaputt: 'kurz' },
    { material_id: 'f0000000000000b3', titel: 'Missing audio', kaputt: 'ohne_audio' },
  ]);
  const s3 = await starteStapel(o3, opt.instanz, {}, { bestand: bst, vorher: (ab) => fs.mkdirSync(path.join(ab, '.kopie-999999999-7', 'x'), { recursive: true }) });
  const b3 = await starteBrowser();
  try {
    const aufger = jsonl(path.join(o3, 'server.jsonl')).find((z) => z.typ === 'aufgeraeumt');
    await b3.oeffne(s3.url);
    await warte(1500);
    const rel = () => jsonl(path.join(o3, 'relais.jsonl')).filter((z) => z.adresse === '/k/deck/laden');
    const texte = [];
    let ok = aufger?.anzahl === 1 && inhalt(s3.ab).length === 0;
    for (const [titel, fehler] of [['Bad checksum', 'pruefung'], ['Short file', 'pruefung'], ['Missing audio', 'material_fehlt']]) {
      const idx = await b3.werte(`[...document.querySelectorAll('#liste tr')].findIndex((tr)=>tr.firstChild.textContent===${JSON.stringify(titel)}) + 1`);
      await b3.klick(`#liste tr:nth-child(${idx}) button.laden[data-deck="1"]`);
      await warte(500);
      const antwort = await b3.werte('window.djkGesendet.at(-1)');
      const meldung = await b3.werte('document.querySelector("#meldung").textContent');
      const f = antwort?.code === 400 && antwort?.antwort.fehler === fehler && /^Load rejected/.test(meldung);
      ok &&= f;
      texte.push(`„${titel}“ → ${antwort?.code} ${antwort?.antwort.fehler} („${meldung}“)`);
    }
    const nachFehlern = { laden: rel().length, ab: inhalt(s3.ab) };
    ok &&= nachFehlern.laden === 0 && nachFehlern.ab.length === 0;
    const idx = await b3.werte(`[...document.querySelectorAll('#liste tr')].findIndex((tr)=>tr.firstChild.textContent==='Alpha') + 1`);
    await b3.klick(`#liste tr:nth-child(${idx}) button.laden[data-deck="1"]`);
    await warte(700);
    const titelSeite = await b3.werte(`document.querySelector('.deck[data-deck="1"] [data-titel]').textContent`);
    const positiv = rel().length === 1 && titelSeite === 'Alpha' && inhalt(s3.ab).join() === 'f0000000000000a1';
    // Chrome meldet jede 400-Antwort als „Failed to load resource“; das ist hier gewollt, alles andere zählt
    const konsole = b3.konsole.filter((k) => !/Failed to load resource: .* 400/.test(k.text));
    notiere('A6 Fehlerfall Kopie', ok && positiv && konsole.length === 0,
      `Rest toter Kopie beim Start weggeräumt: ${aufger?.anzahl ?? 0}; ${texte.join(', ')}; danach /k/deck/laden am Relais ${nachFehlern.laden}, ` +
      `Einträge im Arbeitsbestand ${nachFehlern.ab.length} (keine halbe Kopie); Positiv-Kontrolle „Alpha“: /k/deck/laden ${rel().length}×, Titel „${titelSeite}“, ` +
      `Arbeitsbestand ${inhalt(s3.ab).join(',')}; Konsole ohne die 400er ${konsole.length} (mit ${b3.konsole.length})`);
  } finally { await b3.zu(); await s3.stoppe(); fs.rmSync(bst, { recursive: true, force: true }); }
}

// ---------- A5 Leitstand unverändert grün ----------
try {
  const aus = execSync('npm test 2>&1 | grep -E "^# (pass|fail)"', { cwd: path.resolve(HIER, '../../leitstand'), encoding: 'utf8', timeout: 600000 });
  const pass = Number(/# pass (\d+)/.exec(aus)?.[1]);
  const fail = Number(/# fail (\d+)/.exec(aus)?.[1]);
  notiere('A5 Leitstand', pass === 139 && fail === 0, `npm test: pass ${pass}, fail ${fail}`);
} catch (e) { notiere('A5 Leitstand', false, `npm test lief nicht: ${e.message.slice(0, 200)}`); }

ergebnis.last_nach = last();
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
const alle = Object.values(ergebnis.punkte).every((p) => p.ok);
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Abnahme 60m ${zeit} (Instanz ${opt.instanz})\n\nLast vor ${ergebnis.last_vor}, nach ${ergebnis.last_nach}\n\n` +
  '```\n' + zeilen.join('\n') + '\n```\n\nJe Regler: `a2_regler.txt`. Draht: `relais.jsonl`, Leitstand: `sets/*/journal.jsonl`, `sonde.jsonl`.\n' +
  `\nUrteil: ${alle ? 'alle Punkte erfüllt' : 'NICHT alle Punkte erfüllt'}\n`);
process.stdout.write(`\nBericht: ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(alle ? 0 : 1);
