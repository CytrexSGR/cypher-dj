// D1 S3, Slice 2: POST /proj/export als Ablauf (bereiche/proj/ausgabe.ts) gegen die ECHTE S2-Integration (tests/hilfen/ausgabe_aufbau.mjs):
// Wirt-Spuren vorher einfrieren (mit Freeze-Sperre wie /proj/freeze, Spec 6.23, 6.33), Export-Wiedergabe aus dem einen Zähler, Render über das
// Test-Doppel (tests/hilfen/render_attrappe.mjs, nach render_main.cpp), WAV im Projektordner export/, regler_quelle (6.20), Lautheit mit dem
// echten ffmpeg (R9), ausgabe_lauf {art: 'export'} für die ganze Dauer (6.34). Kein Netz, kein Kern, kein Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './hilfen/ausgabe_aufbau.mjs';
import { warteBis } from './hilfen/proj_kontext.mjs';
import { alsAntwort, Ausgabe, exportSicht, exportZiel, fehlendesAudio } from '../bereiche/proj/ausgabe.ts';

async function ruf(f) {
  try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); }
}
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokollDatei = (a) => path.join(a.tmp, 'render.jsonl');
const renderAufrufe = (a) => (fs.existsSync(protokollDatei(a)) ? fs.readFileSync(protokollDatei(a), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
const sauber = { lauf: null, wartend: 0, abbruch: 0 };
const geladen = (a) => warteBis(() => a.zustand.kernNr === a.projekt().wiedergabe_rev && !a.s.ladenGesperrt());

test('Export: friert die Surge-Spur vorher ein (mit Sperre), rendert die Loop-Klammer, WAV in export/, Antwort mit regler_quelle und Lautheit', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const r = await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const o = a.offen();
  const ziel = path.join(o.ordner, 'export', `${o.slug}-20261015-181500.wav`);
  assert.equal(r.body.datei, ziel);
  assert.equal(r.body.frames, 16 * 0.5 * 48000, 'Loop-Klammer 0..16 bei 120 BPM');
  assert.equal(r.body.spitze_db, -6.021);
  assert.equal(r.body.regler_quelle, 'kern');
  assert.ok(r.body.lufs_i > -8 && r.body.lufs_i < -4, `LUFS-I ${r.body.lufs_i}`);
  assert.equal(r.body.lra, 0);
  assert.ok(r.body.true_peak_dbtp > -6.5 && r.body.true_peak_dbtp < -5.5);
  assert.equal(r.body.loudness_fehler, undefined);
  assert.deepEqual(Object.keys(r.body).sort(), ['datei', 'frames', 'lra', 'lufs_i', 'regler_quelle', 'spitze_db', 'true_peak_dbtp'], 'schmale Antwort, kein Projekt');
  assert.ok(fs.statSync(ziel).size > 44);
  assert.deepEqual(fs.readdirSync(path.join(o.ordner, 'export')), [path.basename(ziel)], 'keine .teil- oder Regler-Datei bleibt liegen');
  // vorher eingefroren: ein /k/arr/freeze unter der Sperre (vor tempoAnMaster), ein Verlaufseintrag, danach eine Export-Wiedergabe mit der Spur als Audio
  assert.deepEqual(a.freezes().map((g) => g.felder.spur), [3]);
  assert.deepEqual(a.protokoll.reihenfolge, ['sperre', 'tempo', 'uebernimm', 'frei']);
  assert.equal(a.s.verlaufListe().j.at(-1).label, 'Freeze Lead');
  assert.ok(a.lead().freeze);
  const [aufruf] = renderAufrufe(a);
  const nr = Number(aufruf.argv[aufruf.argv.indexOf('--nr') + 1]);
  assert.equal(nr, a.protokoll.wiedergaben.at(-1).nr, 'der Render bekommt die Export-Wiedergabe');
  await geladen(a);
  assert.notEqual(nr, a.projekt().wiedergabe_rev, 'eine eigene Nummer, die dem Kern nicht gemeldet wird');
  assert.ok(!a.protokoll.gesendet.some((g) => g.adresse === '/k/arr/laden' && g.felder.nr === nr), 'die Export-Wiedergabe wird nie geladen');
  assert.deepEqual(aufruf.wiedergabe.spuren.map((s) => [s.nr, s.art]), [[1, 'audio'], [2, 'intern'], [3, 'audio']]);
  assert.deepEqual(aufruf.argv.slice(aufruf.argv.indexOf('--von-beat'), aufruf.argv.indexOf('--bpm') + 2), ['--von-beat', '0', '--bis-beat', '16', '--bpm', '120']);
  assert.equal(aufruf.argv[aufruf.argv.indexOf('--arr-ordner') + 1], a.arbeitsordner);
  assert.ok(aufruf.argv.includes('--spur-regler'), 'Spec 6.20: die Spur-Regler gehen IMMER als Datei mit');
  assert.equal(aufruf.instanz, 'c');
  assert.deepEqual(aufruf.regler, { 'spur/1/fader': 0, 'spur/1/pan': 0, 'spur/1/mute': 0, 'spur/1/solo': 0, 'spur/2/fader': 0, 'spur/2/pan': 0,
    'spur/2/mute': 0, 'spur/2/solo': 0, 'spur/3/fader': 0, 'spur/3/pan': 0, 'spur/3/mute': 0, 'spur/3/solo': 0 });
  assert.equal(a.protokoll.log.at(-1).typ, 'proj_export');
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  // zweiter Export in derselben Sekunde: eigener Name, eingefrorene Spur wird nicht noch einmal eingefroren
  const r2 = await ruf(() => a.ausgabe.exportiere({ von_beat: 4, bis_beat: 8 }));
  assert.equal(r2.body.datei, path.join(o.ordner, 'export', `${o.slug}-20261015-181500-2.wav`));
  assert.equal(r2.body.frames, 4 * 0.5 * 48000);
  assert.equal(a.freezes().length, 1);
});

test('Export ohne Neustart-Zustand (Spec 6.20): regler_quelle projekt, der Render bekommt die Spur-Regler aus project.json', async (t) => {
  const a = await aufbau(t);
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', fader_db: -7.5, pan: 0.25, mute: true }]);
  const r = await mitUmgebung({ RENDER_ATTRAPPE_ZUSTAND: 'fehlt', RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.regler_quelle, 'projekt');
  const [aufruf] = renderAufrufe(a);
  assert.deepEqual([aufruf.regler['spur/2/fader'], aufruf.regler['spur/2/pan'], aufruf.regler['spur/2/mute']], [-7.5, 0.25, 1]);
});

test('Export: stumme Wirt-Spur fehlt in der Export-Wiedergabe (sonst lehnt der Render ab); Lautheit ohne ffmpeg null mit Grund; ohne Kern-Stand geht es (6.20)', async (t) => {
  const a = await aufbau(t, { opt: { ffmpeg: ['/gibt/es/nicht/ffmpeg'] } });
  await a.aendern([{ befehl: 'noten_loeschen', clip_id: 'c3', ids: [a.lead().clips[0].noten[0].id] }]);
  const r = await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(a.freezes().length, 0, 'nichts einzufrieren');
  assert.deepEqual(a.protokoll.reihenfolge, [], 'ohne Freeze keine Sperre');
  assert.deepEqual(renderAufrufe(a)[0].wiedergabe.spuren.map((s) => s.nr), [1, 2]);
  assert.deepEqual([r.body.lufs_i, r.body.lra, r.body.true_peak_dbtp, r.body.loudness_fehler], [null, null, null, 'ffmpeg_fehlt: /gibt/es/nicht/ffmpeg']);
  assert.ok(fs.existsSync(r.body.datei), 'die WAV gilt trotzdem');
  // Spec 6.20: ein Server, der noch keine Meldung des Kerns gesehen hat (kein Kern seit dem Boot), exportiert trotzdem, wenn nichts einzufrieren ist
  const ohneKern = new Ausgabe(a.ctx, a.zugang, { ...a.optionen, ffmpeg: ['/gibt/es/nicht/ffmpeg'] });
  const r2 = await mitUmgebung({ RENDER_ATTRAPPE_ZUSTAND: 'fehlt' }, () => ruf(() => ohneKern.exportiere({ von_beat: 0, bis_beat: 4 })));
  assert.deepEqual([r2.code, r2.body.regler_quelle], [200, 'projekt'], JSON.stringify(r2.body));
  // mit einer Spur, die eingefroren werden müsste, braucht es den Kern: kein_kernstand, nichts gesendet
  await a.aendern([{ befehl: 'noten_neu', clip_id: 'c3', noten: [{ beat: 0, laenge: 1, ton: 60, vel: 90 }] }]);
  const r3 = await ruf(() => ohneKern.exportiere({}));
  assert.deepEqual([r3.code, r3.body.fehler], [409, 'kein_kernstand']);
  assert.equal(a.freezes().length, 0);
});

test('Export: Gründe (Argumente, Bereich, KI-Stopp, Transport, Audio nicht dekodiert, Render scheitert, Freeze scheitert), nichts bleibt liegen, ausgabe_lauf wieder null', async (t) => {
  const a = await aufbau(t);
  const o = a.offen();
  const grund = async (d, umgebung = {}) => {
    const r = await mitUmgebung(umgebung, () => ruf(() => a.ausgabe.exportiere(d)));
    if (r.code !== 200) assert.match(r.body.text ?? '', /^[\x20-\x7e×–]+$/, `${r.body.fehler}: englischer text (Spec 6.34)`);
    assert.equal(a.s.aktuell().j.ausgabe_lauf, null, `${r.body.fehler}: ausgabe_lauf nach dem Ausgang wieder null (6.34)`);
    return [r.code, r.body.fehler];
  };
  assert.deepEqual(await grund({ von_beat: '0' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ bis: 4 }), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ von_beat: 4, bis_beat: 4.5 }), [400, 'export_bereich']);
  assert.deepEqual(await grund({ von_beat: -1, bis_beat: 4 }), [400, 'export_bereich']);
  assert.deepEqual(await grund({ von_beat: 0, bis_beat: 1025 }), [400, 'export_bereich']);
  a.zustand.quelle = 'cypher'; a.zustand.ki = true;
  assert.deepEqual(await grund({}), [409, 'ki_gestoppt']);
  a.zustand.quelle = 'andreas'; a.zustand.ki = false;
  a.zustand.kernStatus = 2; a.arrMeldung();
  assert.deepEqual(await grund({}), [409, 'transport_laeuft']);
  a.zustand.kernStatus = 0; a.arrMeldung();
  o.projekt.spuren[0].clips[0].dekodiert = 'laeuft';
  assert.deepEqual(await grund({}), [409, 'audio_fehlt']);
  assert.deepEqual(fehlendesAudio(o.projekt, 1, 8), [], 'Negativ-Kontrolle: Kick liegt 0..1, außerhalb [1, 8)');
  o.projekt.spuren[0].clips[0].dekodiert = 'fertig';
  assert.equal(a.freezes().length, 0, 'bis hier kein Kern-Befehl');
  a.zustand.kern = { art: 'ablehnen', grund: 'ausserhalb_bereich' };
  assert.deepEqual(await grund({}), [502, 'freeze_fehler']);
  assert.equal(a.s.ladenGesperrt(), false, 'Sperre nach dem gescheiterten Freeze frei');
  a.zustand.kern = { art: 'ok' };
  assert.deepEqual(await grund({}, { RENDER_ATTRAPPE_RC: '4' }), [502, 'render_fehler']);
  await geladen(a);
  assert.deepEqual(await grund({}, { RENDER_ATTRAPPE_AUSGABE: 'kaputt' }), [502, 'render_fehler']);
  const r7 = await mitUmgebung({ RENDER_ATTRAPPE_RC: '7' }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.deepEqual([r7.code, r7.body.fehler, r7.body.text], [502, 'render_fehler', 'the export render failed: the render ran out of memory']);
  assert.match(r7.body.detail, /Rückgabe 7 \(Speicher\)/, 'die Meldung des Renders geht als detail mit');
  assert.deepEqual(fs.readdirSync(path.join(o.ordner, 'export')), [], 'keine WAV, keine .teil-, keine Regler-Datei');
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  // Negativ-Kontrolle: danach geht es (der Freeze aus dem gescheiterten Render bleibt gültig)
  assert.deepEqual((await grund({}))[0], 200);
  assert.equal(a.freezes().length, 2, 'ein abgelehnter und ein gelungener Freeze, kein dritter');
});

test('Export: die Export-Wiedergabe wird danach gelöscht, die geladene Wiedergabe überlebt sechs Exporte (wiedergabe.ts BEHALTE 5)', async (t) => {
  const a = await aufbau(t);
  await a.ausgabe.freeze({ spur_id: 's3', an: true });
  await geladen(a);
  const geladenDatei = path.join(a.arbeitsordner, `wiedergabe-${a.projekt().wiedergabe_rev}.json`);
  for (let n = 0; n < 6; n++) assert.equal((await ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 1 }))).code, 200);
  assert.ok(fs.existsSync(geladenDatei), 'die Datei, die der Kern geladen hat, liegt noch da (Neustart lädt sie neu, Spec 2.12)');
  const exportNr = a.protokoll.wiedergaben.at(-1).nr;
  assert.ok(exportNr > a.projekt().wiedergabe_rev);
  assert.equal(fs.existsSync(path.join(a.arbeitsordner, `wiedergabe-${exportNr}.json`)), false);
});

test('Export und Freeze: ein Lauf zur Zeit in beide Richtungen (beschaeftigt); ausgabe_lauf {art: export} während des Renders', async (t) => {
  const a = await aufbau(t, { kern: { art: 'ok', ms: 150 } });
  const freeze = ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  await new Promise((r) => setTimeout(r, 30));
  const e1 = await ruf(() => a.ausgabe.exportiere({}));
  assert.deepEqual([e1.code, e1.body.fehler, e1.body.text], [409, 'beschaeftigt', 'a freeze is running']);
  assert.equal((await freeze).code, 200);
  await a.ausgabe.freeze({ spur_id: 's3', an: false });
  await geladen(a);
  const exp = mitUmgebung({ RENDER_ATTRAPPE_SCHLAF_MS: '400' }, () => ruf(() => a.ausgabe.exportiere({})));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(a.s.aktuell().j.ausgabe_lauf, { art: 'export' }, 'Spec 6.34: GET /proj/aktuell zeigt den Export');
  const f2 = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: false }));
  assert.deepEqual([f2.code, f2.body.fehler], [200, undefined], 'Negativ-Kontrolle: schon so (eingefroren wird erst noch) ist kein Lauf');
  const e2 = await ruf(() => a.ausgabe.exportiere({}));
  assert.deepEqual([e2.code, e2.body.fehler, e2.body.text], [409, 'beschaeftigt', 'an export is running']);
  assert.ok(await warteBis(() => a.protokoll.wiedergaben.length > 0, 5000), 'der Export ist beim Render');
  assert.deepEqual(a.s.aktuell().j.ausgabe_lauf, { art: 'export' }, 'auch während des Renders');
  assert.equal((await exp).code, 200);
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
});

test('exportSicht, exportZiel: Wirt-Spur ohne Freeze fällt weg, eingefrorene bleibt; Zeitstempel Ortszeit, Zählsuffix bei Gleichstand', (t) => {
  const p = { spuren: [{ id: 's1', art: 'audio' }, { id: 's3', art: 'instrument', geraet: { art: 'wirt' }, freeze: null },
    { id: 's4', art: 'instrument', geraet: { art: 'wirt' }, freeze: { kennung: 1 } }, { id: 's2', art: 'instrument', geraet: { art: 'intern' } }] };
  assert.deepEqual(exportSicht(p).spuren.map((s) => s.id), ['s1', 's4', 's2']);
  assert.equal(p.spuren.length, 4, 'Eingabe unberührt');
  const d = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'djk-s3-ziel-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const jetzt = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(exportZiel(d, 'erster-track', jetzt), path.join(d, 'erster-track-20260102-030405.wav'));
  fs.writeFileSync(path.join(d, 'erster-track-20260102-030405.wav'), '');
  fs.writeFileSync(path.join(d, 'erster-track-20260102-030405-2.wav'), '');
  assert.equal(exportZiel(d, 'erster-track', jetzt), path.join(d, 'erster-track-20260102-030405-3.wav'));
});

// Fix-Runde S3, R1 (Quality-Review P1): ein unerwarteter Fehler NACH dem Freeze im Export (hier: export/ ist eine Datei, mkdir scheitert) darf nicht
// „nothing was changed“ sagen, denn der Freeze steht schon als eigener Undo-Schritt. Antwort und text nennen den Schritt, der Fehler geht ins Log
// wie in proj (typ proj_fehler). Negativ-Kontrollen: derselbe Fehler ohne Freeze im Lauf und ein Fehler VOR dem Freeze sagen „nothing was changed“.
test('R1: unerwarteter Fehler nach dem Freeze im Export: text nennt den Freeze als eigenen Undo-Schritt, Fehler im Log; vorher-Fehler: nothing was changed', async (t) => {
  const englisch = (x) => typeof x === 'string' && /^[\x20-\x7e×–−]+$/.test(x);
  const a = await aufbau(t);
  const o = a.offen();
  fs.writeFileSync(path.join(o.ordner, 'export'), 'keine Mappe');             // mkdir export/ scheitert (EEXIST), nach dem Freeze
  const rev0 = a.projekt().rev;
  const r = await ruf(() => a.ausgabe.exportiere({}));
  assert.deepEqual([r.code, r.body.fehler], [500, 'intern'], JSON.stringify(r.body));
  assert.equal(a.projekt().rev, rev0 + 1, 'der Freeze steht im Projekt');
  assert.ok(a.lead().freeze, 'Lead eingefroren');
  assert.doesNotMatch(r.body.text, /nothing was changed/, `text lügt nicht: ${r.body.text}`);
  assert.match(r.body.text, /Freeze Lead/, r.body.text);
  assert.match(r.body.text, /own undo step/, r.body.text);
  assert.match(r.body.text, /no export file was written/, r.body.text);
  assert.ok(englisch(r.body.text), r.body.text);
  assert.deepEqual(r.body.schritte, [{ rev: rev0 + 1, label: 'Freeze Lead' }], 'die Antwort nennt den Schritt maschinenlesbar');
  assert.match(r.body.detail, /EEXIST/);
  const log = a.protokoll.log.filter((z) => z.typ === 'proj_fehler');
  assert.equal(log.length, 1, `Fehler im Log: ${JSON.stringify(a.protokoll.log)}`);
  assert.match(log[0].fehler, /EEXIST/);
  assert.deepEqual([log[0].bereich, log[0].lauf, log[0].schritte], ['proj-ausgabe', 'export', [{ rev: rev0 + 1, label: 'Freeze Lead' }]]);
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  assert.equal(a.s.ladenGesperrt(), false);
  // Negativ-Kontrolle 1: derselbe Fehler, Lead schon eingefroren (kein Schritt in diesem Lauf): nothing was changed stimmt
  await geladen(a);
  const rev1 = a.projekt().rev;
  const n = await ruf(() => a.ausgabe.exportiere({}));
  assert.deepEqual([n.code, n.body.fehler, n.body.text], [500, 'intern', 'internal server error; nothing was changed'], JSON.stringify(n.body));
  assert.equal(n.body.schritte, undefined);
  assert.equal(a.projekt().rev, rev1);
  assert.equal(a.protokoll.log.filter((z) => z.typ === 'proj_fehler').length, 2, 'auch dieser Fehler im Log');
  // Negativ-Kontrolle 2: unerwarteter Fehler VOR dem Freeze (tempoAnMaster wirft), nichts gespeichert
  const b = await aufbau(t);
  b.zugang.tempoAnMaster = async () => { throw new Error('Probe: vor dem Freeze'); };
  const revb = b.projekt().rev;
  const v = await ruf(() => b.ausgabe.exportiere({}));
  assert.deepEqual([v.code, v.body.fehler, v.body.text], [500, 'intern', 'internal server error; nothing was changed'], JSON.stringify(v.body));
  assert.equal(b.projekt().rev, revb);
  assert.equal(b.lead().freeze, null);
  assert.equal(b.freezes().length, 0);
  assert.equal(b.protokoll.log.filter((z) => z.typ === 'proj_fehler').length, 1);
  assert.equal(b.s.ladenGesperrt(), false);
});

test('R1: /proj/freeze, unerwarteter Fehler nach dem Speichern des Freeze (uebernimm wirft): text nennt den Schritt, Fehler im Log', async (t) => {
  const a = await aufbau(t);
  const echt = a.zugang.uebernimm;
  a.zugang.uebernimm = async (w, m) => { await echt(w, m); throw new Error('Probe: nach dem Speichern'); };
  const rev0 = a.projekt().rev;
  const r = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  a.zugang.uebernimm = echt;
  assert.deepEqual([r.code, r.body.fehler], [500, 'intern'], JSON.stringify(r.body));
  assert.equal(a.s.verlaufListe().j.at(-1).label, 'Freeze Lead', 'der Schritt steht im Verlauf');
  assert.match(r.body.text, /Freeze Lead was saved as its own undo step \(rev \d+\)/, r.body.text);
  assert.doesNotMatch(r.body.text, /nothing was changed|export file/, r.body.text);
  assert.deepEqual(r.body.schritte, [{ rev: rev0 + 1, label: 'Freeze Lead' }]);
  assert.deepEqual(a.protokoll.log.filter((z) => z.typ === 'proj_fehler').map((z) => [z.lauf, z.fehler]), [['freeze', 'Probe: nach dem Speichern']]);
  assert.equal(a.s.ladenGesperrt(), false);
});

// Fix-Runde S3, R4 (Export-Seite): eine halb geschriebene Regler-Datei (Platte voll beim Schreiben) bleibt nicht in export/ liegen; der Freeze des
// Laufs (eigener Undo-Schritt) und seine Datei bleiben.
test('R4: Export scheitert beim Schreiben der Regler-Datei (ENOSPC, halb geschrieben): export/ bleibt leer, die Freeze-Datei des Undo-Schritts bleibt', async (t) => {
  const a = await aufbau(t);
  const o = a.offen();
  const echt = fs.writeFileSync;
  fs.writeFileSync = (datei, inhalt, ...rest) => {
    if (typeof datei === 'string' && path.basename(datei).startsWith('.regler-')) {
      echt(datei, String(inhalt).slice(0, 7), ...rest);
      throw Object.assign(new Error(`ENOSPC: no space left on device, write '${datei}'`), { code: 'ENOSPC' });
    }
    return echt(datei, inhalt, ...rest);
  };
  let r;
  try { r = await ruf(() => a.ausgabe.exportiere({})); } finally { fs.writeFileSync = echt; }
  assert.deepEqual([r.code, r.body.fehler], [500, 'intern'], JSON.stringify(r.body));
  assert.match(r.body.text, /Freeze Lead was saved as its own undo step/);
  assert.deepEqual(fs.readdirSync(path.join(o.ordner, 'export')), [], 'keine halbe Regler-Datei, keine .teil');
  assert.ok(fs.existsSync(path.join(a.arbeitsordner, a.lead().freeze.datei)), 'die Freeze-Datei des Undo-Schritts bleibt');
  // Negativ-Kontrolle: ohne Störung geht derselbe Export durch, nur die WAV liegt in export/
  await geladen(a);
  const g = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(g.code, 200, JSON.stringify(g.body));
  assert.deepEqual(fs.readdirSync(path.join(o.ordner, 'export')), [path.basename(g.body.datei)]);
});

// Fix-Runde S3, R5 (Lücken der Testabdeckung im Export): (1) scheitert der Freeze im Export, wird nichts gerendert und keine Export-Wiedergabe
// geschrieben; (2) scheitert der Render NACH dem Freeze desselben Laufs, nennt die Antwort den Freeze als eigenen Undo-Schritt (R1), die
// Freeze-Datei bleibt, export/ bleibt leer, und ein zweiter Export friert nicht noch einmal ein.
test('R5: Freeze scheitert im Export → kein Render, keine Export-Wiedergabe; Render scheitert nach dem Freeze → Antwort nennt den Schritt', async (t) => {
  const a = await aufbau(t, { kern: { art: 'abbruch', grund: 'abbruch' } });
  const r = await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.deepEqual([r.code, r.body.fehler], [502, 'freeze_fehler'], JSON.stringify(r.body));
  assert.equal(r.body.schritte, undefined, 'nichts gespeichert');
  assert.deepEqual(renderAufrufe(a), [], 'kein Render');
  assert.deepEqual(a.protokoll.wiedergaben, [], 'keine Export-Wiedergabe');
  assert.equal(a.lead().freeze, null);
  // (2) Freeze gelingt, der Render scheitert (Rückgabe 6)
  a.zustand.kern = { art: 'ok' };
  await geladen(a);
  const rev0 = a.projekt().rev;
  const f = await mitUmgebung({ RENDER_ATTRAPPE_RC: '6', RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.deepEqual([f.code, f.body.fehler], [502, 'render_fehler'], JSON.stringify(f.body));
  assert.equal(f.body.text, `the export render failed: the render could not write the WAV file; Freeze Lead was saved as its own undo step (rev ${rev0 + 1}); `
    + 'no export file was written');
  assert.deepEqual(f.body.schritte, [{ rev: rev0 + 1, label: 'Freeze Lead' }]);
  assert.match(f.body.detail, /Rückgabe 6 \(Schreiben\)/);
  assert.ok(fs.existsSync(path.join(a.arbeitsordner, a.lead().freeze.datei)), 'die Freeze-Datei des Schritts bleibt');
  assert.deepEqual(fs.readdirSync(path.join(a.offen().ordner, 'export')), []);
  assert.equal(renderAufrufe(a).length, 1);
  // Negativ-Kontrolle: der nächste Export friert nicht noch einmal ein und gelingt; seine Antwort trägt keine schritte
  await geladen(a);
  const g = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(g.code, 200, JSON.stringify(g.body));
  assert.equal(a.freezes().length, 2, 'ein abgebrochener und ein gelungener Freeze, kein dritter');
  assert.equal(g.body.schritte, undefined);
});

// Fix-Runde 2 S3, F4: der Server endet (server.ts stoppe → Ausgabe.schliesse) mitten im Export-Render. Der Render wird über seine Gruppe beendet,
// der Export antwortet sofort mit render_fehler (text: der Server endet), .teil und .regler bleiben nicht liegen, die Sperre ist frei.
// Negativ-Kontrolle: schliesse ohne laufenden Export wirft nicht.
test('F4: schliesse() mitten im Export-Render beendet den Render, Antwort render_fehler, keine .teil- und .regler-Reste, Lauf frei', async (t) => {
  const a = await aufbau(t);
  const exp = mitUmgebung({ RENDER_ATTRAPPE_SCHLAF_MS: '30000' }, () => ruf(() => a.ausgabe.exportiere({})));
  assert.ok(await warteBis(() => renderAufrufe(a).length > 0 || a.protokoll.wiedergaben.length > 0, 10_000), 'der Export ist beim Render');
  assert.ok(await warteBis(() => a.ausgabe.zustand().lauf?.art === 'export', 5000));
  await new Promise((r) => setTimeout(r, 300));                         // das Doppel schläft jetzt
  const t0 = Date.now();
  a.ausgabe.schliesse();
  const r = await exp;
  const dauer = Date.now() - t0;
  t.diagnostic(`Antwort ${dauer} ms nach schliesse`);
  assert.ok(dauer < 2000, `nicht bis zum Ende des Renders gewartet (${dauer} ms)`);
  assert.deepEqual([r.code, r.body.fehler], [502, 'render_fehler'], JSON.stringify(r.body));
  assert.match(r.body.text, /server is shutting down/, r.body.text);
  const ordner = path.join(a.offen().ordner, 'export');
  const reste = fs.existsSync(ordner) ? fs.readdirSync(ordner) : [];
  assert.deepEqual(reste, [], `keine Reste in export/: ${reste.join(', ')}`);
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  assert.equal(a.s.ladenGesperrt(), false);
  a.ausgabe.schliesse();                                                 // Negativ-Kontrolle: nichts läuft, wirft nicht
});

// Re-Review Fix-Runde 2 S3, RR1: Server-Stopp (ausgabe.schliesse, dann sitzung.schliesse wie server.ts stoppe) NACH dem Speichern des Freeze
// (aendereStand: project.json zeigt auf die Datei) und vor dem Ende von setze(). Die Datei gehört ab dem Speichern dem Projekt und bleibt; die
// Antwort nennt den Schritt. Negativ-Kontrolle: derselbe Ablauf ohne Stopp, die Datei bleibt ebenso, Antwort 200.
test('RR1: Server-Stopp nach dem Speichern des Freeze löscht die Freeze-Datei nicht, auf die project.json zeigt', async (t) => {
  for (const stopp of [true, false]) {
    const a = await aufbau(t);
    const ordner = a.offen().ordner;
    const orig = a.zugang.uebernimm;
    a.zugang.uebernimm = (w, meta) => {
      const p = orig(w, meta);
      if (stopp) { a.ausgabe.schliesse(); a.b.sitzung.schliesse(); }
      return p;
    };
    const r = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
    const platte = JSON.parse(fs.readFileSync(path.join(ordner, 'project.json'), 'utf8'));
    const datei = platte.spuren.find((x) => x.id === 's3').freeze?.datei;
    assert.ok(datei, `project.json zeigt auf eine Freeze-Datei (stopp ${stopp})`);
    assert.ok(fs.existsSync(path.join(a.arbeitsordner, datei)), `${datei} bleibt (stopp ${stopp}): ${JSON.stringify(r.body)}`);
    if (stopp) assert.match(r.body.text, /Freeze Lead was saved as its own undo step/, r.body.text);
    else assert.equal(r.code, 200);
  }
});

// Re-Review Fix-Runde 2 S3, RR3: schliesse() während des vorgeschalteten Freeze eines Exports (hier mitten in uebernimm, ohne sitzung.schliesse):
// danach startet kein Render mehr, der Export antwortet render_fehler „the server is shutting down“. Negativ-Kontrolle: ohne schliesse läuft er.
test('RR3: nach schliesse() zwischen Freeze und Render startet der Export keinen Render mehr', async (t) => {
  for (const zu of [true, false]) {
    const a = await aufbau(t);
    const orig = a.zugang.uebernimm;
    a.zugang.uebernimm = (w, meta) => { const p = orig(w, meta); if (zu) a.ausgabe.schliesse(); return p; };
    const r = await mitUmgebung({ RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) }, () => ruf(() => a.ausgabe.exportiere({})));
    if (zu) {
      assert.deepEqual([r.code, r.body.fehler], [502, 'render_fehler'], JSON.stringify(r.body));
      assert.match(r.body.text, /server is shutting down/);
      assert.equal(renderAufrufe(a).length, 0, 'kein Render gestartet');
    } else {
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(renderAufrufe(a).length, 1);
    }
  }
});

// Re-Review Fix-Runde 2 S3, RR2: der unlesbare Körper einer /proj-Route antwortet mit englischem text (vorher „(kein Objekt)“, „(zu groß)“).
test('RR2: POST /proj/export und /proj/freeze mit unlesbarem Körper: 400 argument_ungueltig, text englisch', async (t) => {
  const { Readable } = await import('node:stream');
  const a = await aufbau(t);
  const routen = a.bereich ? a.bereich.routen() : null;
  const { ausgabeBereich } = await import('../bereiche/proj/ausgabe.ts');
  const ber = routen ? null : ausgabeBereich(a.ctx, a.zugang, {});
  const liste = routen ?? ber.routen();
  for (const pfad of ['/proj/export', '/proj/freeze']) {
    const route = liste.find((x) => (Array.isArray(x.pfad) ? x.pfad.includes(pfad) : x.pfad === pfad));
    assert.ok(route, `Route ${pfad}`);
    for (const [koerper, erwartet] of [['[]', /not a JSON object/], ['x'.repeat(40_000), /larger than 32 KiB/], ['{kaputt', /no valid JSON/]]) {
      const q = Readable.from([koerper]); q.url = pfad; q.method = 'POST'; q.headers = {};
      let code = 0, body = '';
      const r = { writeHead: (c) => { code = c; return r; }, setHeader() {}, end: (b) => { body = String(b ?? ''); }, statusCode: 0 };
      Object.defineProperty(r, 'statusCode', { set: (c) => { code = c; }, get: () => code });
      await route.handler(q, r, new URL(`http://seite${pfad}`));
      const j = JSON.parse(body);
      assert.deepEqual([code, j.fehler], [400, 'argument_ungueltig'], body);
      assert.match(j.text, erwartet, j.text);
      assert.ok(/^[\x20-\x7e]+$/.test(j.text), j.text);
    }
  }
});
