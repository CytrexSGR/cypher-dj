// Abnahmemessung AK-a des Pakets 1.18 (Entscheidung E-a): Stop Cypher hält nur Cyphers Hand an, was klingt, klingt weiter.
// Gegen einen laufenden Seiten-Server mit ECHTEM Kern auf einer Prüfinstanz (nie g, nie der Betrieb):
//   node pruef/abnahme_ea.mjs --url http://127.0.0.1:<53300+...>            (Port der Instanz: 47300 + 1000 · k, k = Buchstabe − 96)
// oder trocken gegen einen eigenen Stapel mit Kern-Attrappe (kein Spur-Pegel, daher kein gültiger Beleg für Teil 1):
//   node pruef/abnahme_ea.mjs --stapel c
// Teil 1 (Produktion): ein Projekt mit einer Spur von Cypher und einer von Andreas (beide RB-338, ein Takt 4/4 Noten), Andreas startet den Transport,
//   /pegel (Fenster 4 s, länger als das Muster) von spur/1 und spur/2 vor und nach dem Stopp, Cyphers Schreiben 409, Andreas schreibt, Freigabe bewegt nichts.
// Teil 2 (DJ): Andreas stellt erz/1/fader auf −30, Cypher fährt eine Rampe auf −6 (4 Takte), Stopp nach 3 s: der Wert hält (±1 dB), ein neuer Regler-Befehl
//   von Cypher wird abgelehnt, Andreas' Hand am selben Regler wirkt sofort (Negativ-Kontrolle). Danach stellt das Skript den Regler zurück.
// Teil 3 (Transport, Task 9a): Cypher startet den Transport selbst, Stop Cypher: er läuft weiter (/proj/aktuell kern.status 2, /pegel von spur/1 bleibt
//   ±1 dB in Spitze und Median), Cyphers Stopp ist 409 (im Stopp ki_gestoppt, nach der Freigabe transport_laeuft), Andreas' Stopp wirkt und der Pegel fällt
//   (Negativ-Kontrolle: das Maß sieht einen Stopp).
// Gegenprobe „Absenkung wieder an“ und „Transport endet wieder“: dieselbe Messung gegen Server und Kern aus einem frisch gebauten main-Baum (Plan Task 9a
//   Step 12): FEHL 1.3, 3.3, 3.4 und 3.6 (gemessen 2026-10-20, Instanz b).
// Rückgabe: 0 alle Punkte OK, 1 mindestens ein Punkt FEHL, 2 Aufruf. Ergebnis: pruef/ergebnisse/<zeit>-abnahme-ea/bericht.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { url: { type: 'string' }, stapel: { type: 'string' }, teil: { type: 'string', default: 'alle' } } });
if ((!opt.url) === (!opt.stapel) || !['1', '2', '3', 'alle'].includes(opt.teil)) { process.stderr.write('Aufruf: --url <http://127.0.0.1:port> | --stapel <a..i>, optional --teil 1|2|3|alle\n'); process.exit(2); }
if (opt.url && /:(47300|47100|47200)\b/.test(opt.url)) { process.stderr.write('abnahme_ea: nie gegen den Betrieb (47300): eine Prüfinstanz wählen\n'); process.exit(2); }
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = path.join(HIER, 'ergebnisse', `${zeit}-abnahme-ea`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (k, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

let aufraeumen = [], URL = opt.url;
if (opt.stapel) {                                       // derselbe Stapel wie die Server-Tests: Seiten-Server und Kern-Attrappe in einem Prozess
  process.env.CYPHERDJ_TEST_INSTANZ = opt.stapel;
  const { stapel } = await import('../tests/hilfen/mediathek.mjs');
  const st = await stapel({ after: (f) => aufraeumen.push(f) });
  URL = st.url;
}
const CYPHER = { 'x-djk-quelle': 'cypher' };
const ruf = async (methode, weg, koerper, kopf = {}) => {
  const r = await fetch(URL + weg, methode === 'GET' ? { headers: kopf } : { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: JSON.stringify(koerper ?? {}) });
  const t = await r.text();
  let j = null; try { j = t ? JSON.parse(t) : null; } catch { j = { text: t }; }
  return { code: r.status, j };
};
const lage = async () => (await ruf('GET', '/lage')).j;
const pegel = async (sek = 4) => (await ruf('GET', `/pegel?sek=${sek}`)).j.kanaele;
const bisWahr = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await warte(100); } return false; };
const noten = (ton) => Array.from({ length: 8 }, (_, i) => ({ beat: i, laenge: 0.5, ton, vel: 110 }));

try {
  if (!(await bisWahr(async () => typeof (await lage()).uhr?.bpm === 'number', 8000))) throw new Error('kein Kern: /lage meldet keine Uhr');
  const l0 = await lage();
  const bpm = l0.uhr.bpm;
  if (typeof bpm !== 'number') throw new Error('kein Kern: /lage meldet keine Uhr');
  if (l0.ki.gestoppt) throw new Error('Stop Cypher gilt schon: erst „freigabe“');

  if (opt.teil === '1' || opt.teil === 'alle') {
    const neu = await ruf('POST', '/proj/neu', { name: `abnahme-ea-${zeit}` });
    if (neu.code !== 200) throw new Error(`/proj/neu ${neu.code} ${JSON.stringify(neu.j)}`);
    const a = await ruf('POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'Cypher baut', befehle: [
      { befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'instrument', name: 'Cypher Bass' },
      { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(36) },
      { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, CYPHER);
    if (a.code !== 200) throw new Error(`Aufbau Cypher ${a.code} ${JSON.stringify(a.j)}`);
    const b = await ruf('POST', '/proj/aendern', { rev: a.j.rev, label: 'Andreas baut', befehle: [
      { befehl: 'spur_neu', art: 'instrument', name: 'Andreas Bass' }, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(43) }] });
    if (b.code !== 200) throw new Error(`Aufbau Andreas ${b.code} ${JSON.stringify(b.j)}`);
    notiere('1.0 Aufbau', a.j.projekt?.spuren?.[0]?.von === 'cypher' || b.j.projekt.spuren.find((s) => s.id === 's1')?.von === 'cypher', 'Spur 1 von Cypher, Spur 2 von Andreas');
    await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 });          // Andreas startet: Stop Cypher stoppt ihn nicht
    await warte(5000);
    const vor = await pegel();
    const klingt = (k) => vor[k] && vor[k].max_db > -60 && vor[k].median_db !== null;
    notiere('1.1 beide Spuren klingen vor dem Stopp', klingt('spur/1') && klingt('spur/2'),
      `spur/1 ${JSON.stringify(vor['spur/1'])}, spur/2 ${JSON.stringify(vor['spur/2'])}${vor['spur/1'] ? '' : ' (kein spur/1 im /pegel: Kern-Attrappe? dann kein gültiger Beleg)'}`);
    await ruf('POST', '/taste', { name: 'stopp' });
    notiere('1.2 Stop Cypher gilt', await bisWahr(async () => (await lage()).ki.gestoppt), 'ki.gestoppt in /lage');
    await warte(4600);                                                            // länger als die frühere Ausblende (4 Beats) plus das Pegelfenster
    const nach = await pegel();
    const gleich = (k) => vor[k] && nach[k] && Math.abs(nach[k].max_db - vor[k].max_db) <= 1 && Math.abs((nach[k].median_db ?? -200) - (vor[k].median_db ?? -200)) <= 1;
    notiere('1.3 Pegel von Cyphers Spur bleibt (±1 dB, Spitze und Median)', !!gleich('spur/1'), `vorher ${JSON.stringify(vor['spur/1'])}, nachher ${JSON.stringify(nach['spur/1'])}`);
    notiere('1.4 Negativ-Kontrolle: Andreas\' Spur bleibt ebenso', !!gleich('spur/2'), `vorher ${JSON.stringify(vor['spur/2'])}, nachher ${JSON.stringify(nach['spur/2'])}`);
    const x = await ruf('POST', '/proj/aendern', { rev: (await ruf('GET', '/proj/aktuell?nur=rev')).j.rev, label: 'x', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', pan: 0.1 }] }, CYPHER);
    notiere('1.5 Cyphers proj_aendern: 409 ki_gestoppt', x.code === 409 && x.j.fehler === 'ki_gestoppt', `${x.code} ${x.j?.fehler}`);
    const y = await ruf('POST', '/proj/aendern', { rev: (await ruf('GET', '/proj/aktuell?nur=rev')).j.rev, label: 'Andreas', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', pan: -0.1 }] });
    notiere('1.6 Negativ-Kontrolle: Andreas schreibt weiter', y.code === 200, `${y.code}`);
    await ruf('POST', '/taste', { name: 'freigabe' });
    await bisWahr(async () => !(await lage()).ki.gestoppt);
    await warte(4600);
    const frei = await pegel();
    notiere('1.7 die Freigabe bewegt nichts', !!(frei['spur/1'] && Math.abs(frei['spur/1'].max_db - vor['spur/1'].max_db) <= 1), `nach Release ${JSON.stringify(frei['spur/1'])}`);
    await ruf('POST', '/proj/transport', { aktion: 'stopp' });
  }

  if (opt.teil === '2' || opt.teil === 'alle') {
    const ursprung = (await lage()).regler['erz/1/fader'];
    const setz = (nach, kopf = {}, takte = 0) => ruf('POST', '/regler', { pfad: 'erz/1/fader', nach, takte, ab: 'jetzt' }, kopf);
    await setz(-30);
    await bisWahr(async () => Math.abs((await lage()).regler['erz/1/fader'] + 30) <= 1);
    const rampe = await setz(-6, CYPHER, 4);
    notiere('2.0 Cyphers Rampe angenommen', rampe.code === 200, `${rampe.code} ${JSON.stringify(rampe.j?.quittung ?? rampe.j)}`);
    await warte(3000);
    const w0 = (await lage()).regler['erz/1/fader'];
    notiere('2.1 die Rampe läuft (Wert über −30 gestiegen)', w0 > -29, `erz/1/fader ${w0} dB nach 3 s`);
    await ruf('POST', '/taste', { name: 'stopp' });
    await bisWahr(async () => (await lage()).ki.gestoppt);
    await warte(500);
    const w1 = (await lage()).regler['erz/1/fader'];
    await warte(4000);
    const w2 = (await lage()).regler['erz/1/fader'];
    notiere('2.2 der Regler hält den Wert vom Stoppzeitpunkt (±1 dB), fällt nicht', Math.abs(w2 - w1) <= 1 && w2 > -29 && Math.abs(w1 - w0) <= 6, `bei Stopp ${w0}, +0,5 s ${w1}, +4,5 s ${w2}`);
    const neuCy = await setz(-12, CYPHER, 0);
    const q = neuCy.j?.quittung;
    notiere('2.3 ein neuer Regler-Befehl von Cypher wird abgelehnt', neuCy.code >= 400 || (q && [6, 7].includes(q.status)), `${neuCy.code} ${JSON.stringify(q ?? neuCy.j)}`);
    await setz(-12);                                                              // Andreas, ohne Kopf
    const ok = await bisWahr(async () => Math.abs((await lage()).regler['erz/1/fader'] + 12) <= 1, 3000);
    notiere('2.4 Negativ-Kontrolle: Andreas\' Hand am selben Regler wirkt sofort', ok, `erz/1/fader ${(await lage()).regler['erz/1/fader']} dB`);
    await ruf('POST', '/taste', { name: 'freigabe' });
    await bisWahr(async () => !(await lage()).ki.gestoppt);
    await setz(typeof ursprung === 'number' ? ursprung : -200);                  // zurück auf den Ausgangswert
  }
  if (opt.teil === '3' || opt.teil === 'alle') {
    // Teil 3 (Task 9a, Entscheidung E-a): auch ein Transport, den CYPHER gestartet hat, läuft beim Stop Cypher weiter (vorher Spec 6.37: er stoppte)
    const neu3 = await ruf('POST', '/proj/neu', { name: `abnahme-ea3-${zeit}` });
    if (neu3.code !== 200) throw new Error(`/proj/neu ${neu3.code} ${JSON.stringify(neu3.j)}`);
    const a3 = await ruf('POST', '/proj/aendern', { rev: neu3.j.projekt.rev, label: 'Cypher baut', befehle: [
      { befehl: 'tempo_setzen', bpm }, { befehl: 'spur_neu', art: 'instrument', name: 'Cypher Bass' },
      { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 8, noten: noten(36) },
      { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 8 }] }, CYPHER);
    if (a3.code !== 200) throw new Error(`Aufbau Teil 3 ${a3.code} ${JSON.stringify(a3.j)}`);
    const status = async () => (await ruf('GET', '/proj/aktuell')).j.kern?.status;
    const rev3 = async () => (await ruf('GET', '/proj/aktuell?nur=rev')).j.rev;
    const start = await ruf('POST', '/proj/transport', { aktion: 'start', beat: 0 }, CYPHER);        // CYPHER startet
    notiere('3.0 Cypher startet den Transport', start.code === 200 && start.j.ok === true, `${start.code} ${JSON.stringify(start.j?.quittung)}`);
    await bisWahr(async () => (await status()) === 2, 6000);
    await warte(5000);
    const vor3 = await pegel();
    notiere('3.1 Cyphers Spur klingt vor dem Stopp', !!(vor3['spur/1'] && vor3['spur/1'].max_db > -60 && vor3['spur/1'].median_db !== null),
      `spur/1 ${JSON.stringify(vor3['spur/1'])}${vor3['spur/1'] ? '' : ' (kein spur/1 im /pegel: Kern-Attrappe? dann kein gültiger Beleg)'}`);
    await ruf('POST', '/taste', { name: 'stopp' });
    notiere('3.2 Stop Cypher gilt', await bisWahr(async () => (await lage()).ki.gestoppt), 'ki.gestoppt in /lage');
    await warte(4600);
    const nach3 = await pegel();
    const gleich3 = vor3['spur/1'] && nach3['spur/1'] && Math.abs(nach3['spur/1'].max_db - vor3['spur/1'].max_db) <= 1
      && Math.abs((nach3['spur/1'].median_db ?? -200) - (vor3['spur/1'].median_db ?? -200)) <= 1;
    notiere('3.3 der Transport läuft weiter: Pegel von Cyphers Spur bleibt (±1 dB, Spitze und Median)', !!gleich3, `vorher ${JSON.stringify(vor3['spur/1'])}, nachher ${JSON.stringify(nach3['spur/1'])}`);
    notiere('3.4 der Kern meldet den Transport weiter als spielend (status 2)', (await status()) === 2, `kern.status ${await status()}`);
    const imStopp = await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
    notiere('3.5 Cyphers Stopp im Stop Cypher: 409 ki_gestoppt', imStopp.code === 409 && imStopp.j.fehler === 'ki_gestoppt', `${imStopp.code} ${imStopp.j?.fehler}`);
    await ruf('POST', '/taste', { name: 'freigabe' });
    await bisWahr(async () => !(await lage()).ki.gestoppt);
    const frei3 = await ruf('POST', '/proj/transport', { aktion: 'stopp' }, CYPHER);
    notiere('3.6 nach der Freigabe gehört der Lauf Andreas: Cyphers Stopp 409 transport_laeuft, der Transport läuft', frei3.code === 409 && frei3.j.fehler === 'transport_laeuft'
      && (await status()) === 2, `${frei3.code} ${frei3.j?.fehler}, kern.status ${await status()}`);
    const z = await ruf('POST', '/proj/aendern', { rev: await rev3(), label: 'x', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', pan: 0.1 }] }, CYPHER);
    notiere('3.7 Cyphers Schreiben ist nach der Freigabe wieder möglich (nur der Transport bleibt gesperrt)', z.code === 200, `${z.code} ${z.j?.fehler ?? ''}`);
    const andreas = await ruf('POST', '/proj/transport', { aktion: 'stopp' });
    notiere('3.8 Negativ-Kontrolle: Andreas\' Stopp wirkt (kern.status 0)', andreas.code === 200 && (await bisWahr(async () => (await status()) === 0, 4000)), `Antwort ${andreas.code}, kern.status ${await status()}`);
    await warte(4600);
    const still3 = (await pegel())['spur/1'];
    notiere('3.9 Negativ-Kontrolle: nach Andreas\' Stopp fällt der Pegel (das Maß sieht einen Stopp; nur gültig, wenn 3.1 spur/1 sah)', !!vor3['spur/1'] && (!still3 || still3.max_db < -60),
      `vorher ${JSON.stringify(vor3['spur/1'])}, nachher ${JSON.stringify(still3)}`);
  }
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  for (const f of aufraeumen.reverse()) await f();
}
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Abnahme AK-a ${zeit} (${opt.url ?? `Stapel ${opt.stapel}`}, Teil ${opt.teil})\n\n${zeilen.join('\n')}\n`);
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
