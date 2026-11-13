// MIDI import planner (project/midi_import.ts): the plan runs through the real command path; fixtures are built from bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { leseSmf } from '../project/smf.ts';
import { planeImport, MidiImportFehler, polyphonie, graphFuerProgramm, GRAPH_FADER_DB } from '../project/midi_import.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { smf, spur, nameMeta, tempoMeta, taktMeta, programm, an, aus, note } from './helpers/smf_build.mjs';

const GM = { name: 'gm', noten: new Set([36, 38, 40, 42, 46]) };
const ctx = { gmKit: GM, kitDa: (n) => n === 'gm', graphArt: (n) => (['juno-pad-hall', 'saite-klavier', 'wavetable-chor'].includes(n) ? 'instrument' : null) };
const lauf = (p, plan) => fuehreListeAus(p, plan.befehle, { kitDa: ctx.kitDa, graphArt: ctx.graphArt }).projekt;

// 3 tracks: conductor (tempo 90, 3/4), a flute on channel 1 (notes off the beat), drums on channel 10
const datei = () => smf([
  spur([nameMeta('conductor'), tempoMeta(90), taktMeta(3, 2)]),
  spur([nameMeta('Flute'), programm(0, 73), ...note(0, 72, 100, 96, 192 * 2 + 48), ...note(0, 74, 80, 144, 0)]),
  spur([...note(9, 38, 110, 48, 192 * 4), ...note(9, 42, 60, 24, 144), ...note(9, 99, 60, 24, 0)]),
]);

test('thin slice: notes land on exact beats (tick / 192), tempo and clip start follow the file', () => {
  const d = leseSmf(datei());
  const plan = planeImport(d, neuesProjekt('t'), {}, ctx);
  assert.equal(plan.bericht.anlegbar, true);
  const p = lauf(neuesProjekt('t'), plan);
  assert.equal(p.tempo_bpm, 90);
  assert.equal(p.spuren.length, 2);                                          // the conductor chunk has no notes
  const fl = p.spuren[0], c = fl.clips[0];
  assert.equal(fl.name, 'Flute'); assert.equal(fl.art, 'instrument');
  assert.equal(c.art, 'midi'); assert.equal(c.start_beat, 2);               // first note at tick 432 = beat 2.25 -> clip starts on beat 2
  assert.deepEqual(c.noten.map((n) => [c.start_beat + n.beat, n.laenge, n.ton, n.vel]), [[2.25, 0.5, 72, 100], [2.75, 0.75, 74, 80]]);
  assert.ok(c.start_beat + c.laenge_beats >= 4);                            // the clip covers its last note
});

test('report: tempo, source time signature as a hint, parts, counts', () => {
  const b = planeImport(leseSmf(datei()), neuesProjekt('t'), {}, ctx).bericht;
  assert.equal(b.tempo.quelle_bpm, 90); assert.equal(b.tempo.gesetzt_bpm, 90);
  assert.deepEqual(b.taktart.quelle, [3, 4]); assert.equal(b.taktart.abweichend, true);
  assert.ok(b.hinweise.some((h) => h.code === 'midi_taktart' && /3\/4/.test(h.text)));
  assert.equal(b.datei.midi_spuren, 3); assert.equal(b.datei.spuren_mit_noten, 2); assert.equal(b.datei.noten, 5);
  assert.deepEqual(b.spuren.map((s) => [s.schluessel, s.noten, s.schlagzeug]), [['1.1', 2, false], ['2.10', 3, true]]);
  assert.ok(b.hinweise.some((h) => h.code === 'midi_leere_spuren'));
});

test('drums go to the GM kit; notes the kit has no sound for are counted', () => {
  const p = lauf(neuesProjekt('t'), planeImport(leseSmf(datei()), neuesProjekt('t'), {}, ctx));
  const dr = p.spuren[1];
  assert.deepEqual(dr.geraet, { art: 'intern', name: 'kit', kit: 'gm' });
  assert.equal(dr.mute, false);
  assert.equal(dr.name, 'Drums');
  const b = planeImport(leseSmf(datei()), neuesProjekt('t'), {}, ctx).bericht;
  assert.ok(b.spuren[1].hinweise.some((h) => h.code === 'midi_schlagzeug_ohne_klang' && /99/.test(h.text)));
});

test('no GM kit available: the drum track exists, muted and without a sound, with a hint', () => {
  const plan = planeImport(leseSmf(datei()), neuesProjekt('t'), {}, { ...ctx, gmKit: null });
  const p = lauf(neuesProjekt('t'), plan);
  assert.equal(p.spuren.length, 2); assert.equal(p.spuren[1].mute, true); assert.equal(p.spuren[1].clips[0].noten.length, 3);
  assert.equal(plan.bericht.summe.ohne_klang, 1);
  assert.ok(plan.bericht.spuren[1].hinweise.some((h) => h.code === 'midi_kein_gm_kit'));
});

test('tempo: kept when the project already has tracks unless asked; outside 60..200 it stays and says so', () => {
  const voll = lauf(neuesProjekt('t'), planeImport(leseSmf(datei()), neuesProjekt('t'), { auswahl: ['1.1'] }, ctx));
  voll.tempo_bpm = 120;
  const a = planeImport(leseSmf(datei()), voll, { auswahl: ['2.10'] }, ctx);
  assert.equal(a.bericht.tempo.gesetzt_bpm, null);
  assert.ok(a.bericht.hinweise.some((h) => h.code === 'midi_tempo_nicht_uebernommen'));
  const b = planeImport(leseSmf(datei()), voll, { auswahl: ['2.10'], tempo: 'uebernehmen' }, ctx);
  assert.equal(b.bericht.tempo.gesetzt_bpm, 90);
  assert.equal(lauf(voll, b).tempo_bpm, 90);
  const c = planeImport(leseSmf(datei()), voll, { auswahl: ['2.10'], tempo: 'behalten' }, ctx);
  assert.equal(c.bericht.tempo.gesetzt_bpm, null);
  const lahm = smf([spur([tempoMeta(40), ...note(0, 60, 80, 48)])]);
  const e = planeImport(leseSmf(lahm), neuesProjekt('t'), {}, ctx);
  assert.equal(e.bericht.tempo.gesetzt_bpm, null);
  assert.ok(e.bericht.hinweise.some((h) => h.code === 'midi_tempo_ausserhalb'));
});

test('tempo changes are counted and reported, not mapped', () => {
  const f = smf([spur([tempoMeta(100), ...note(0, 60, 80, 48), tempoMeta(140, 400), ...note(0, 62, 80, 48)])]);
  const b = planeImport(leseSmf(f), neuesProjekt('t'), {}, ctx).bericht;
  assert.equal(b.tempo.aenderungen, 1); assert.equal(b.tempo.gesetzt_bpm, 100);
  assert.ok(b.hinweise.some((h) => h.code === 'midi_tempowechsel' && /^1 tempo change/.test(h.text)));
});

test('selection and assignment: by key; unknown keys are refused; null leaves the track muted', () => {
  const d = leseSmf(datei());
  const plan = planeImport(d, neuesProjekt('t'), { auswahl: ['1.1'], zuordnung: { '1.1': 'bk:juno-pad-hall' } }, ctx);
  const p = lauf(neuesProjekt('t'), plan);
  assert.equal(p.spuren.length, 1);
  assert.deepEqual(p.spuren[0].geraet, { art: 'intern', name: 'bk', graph: 'juno-pad-hall', parameter: {} });
  assert.equal(plan.bericht.nicht_angelegt.length, 1);
  assert.throws(() => planeImport(d, null, { auswahl: ['9.9'] }, ctx), (e) => e instanceof MidiImportFehler && e.grund === 'midi_schluessel_unbekannt');
  assert.throws(() => planeImport(d, null, { zuordnung: { '7.1': 'rb338' } }, ctx), (e) => e.grund === 'midi_schluessel_unbekannt');
  assert.throws(() => planeImport(d, null, { zuordnung: { '1.1': 'tuba' } }, ctx), (e) => e.grund === 'argument_ungueltig');
  const keins = planeImport(d, neuesProjekt('t'), { zuordnung: { '1.1': null } }, ctx);
  assert.equal(lauf(neuesProjekt('t'), keins).spuren[0].mute, true);
  assert.equal(keins.bericht.summe.ohne_klang, 1);
});

test('more parts than free tracks: nothing is planned, the reason names the numbers; with a selection it fits', () => {
  const spuren = Array.from({ length: 33 }, (_, i) => spur([...note(i % 9, 60, 80, 48)]));
  const d = leseSmf(smf(spuren));
  const plan = planeImport(d, neuesProjekt('t'), {}, ctx);
  assert.equal(plan.bericht.anlegbar, false);
  assert.equal(plan.bericht.grund, 'midi_zu_viele_spuren'); assert.match(plan.bericht.grund_text, /33 tracks needed but only 32/);
  assert.deepEqual(plan.befehle, []);
  const ok = planeImport(d, neuesProjekt('t'), { auswahl: d.teile.slice(0, 32).map((t) => `${t.spur}.${t.kanal + 1}`) }, ctx);
  assert.equal(ok.bericht.anlegbar, true);
  assert.equal(lauf(neuesProjekt('t'), ok).spuren.length, 32);
});

test('track ids are predicted right on a project that already has tracks and clips', () => {
  const start = lauf(neuesProjekt('t'), planeImport(leseSmf(datei()), neuesProjekt('t'), {}, ctx));
  const zwei = planeImport(leseSmf(datei()), start, {}, ctx);
  const p = lauf(start, zwei);
  assert.equal(p.spuren.length, 4);
  assert.deepEqual(p.spuren.slice(2).map((s) => s.clips.length), [1, 1]);
  assert.deepEqual(p.spuren.slice(2).map((s) => s.clips[0].noten.length), [2, 3]);
});

test('duplicate names get a counter, several channels of one MIDI track get the channel', () => {
  const f = smf([
    spur([nameMeta('Strings'), ...note(0, 60, 80, 48), ...note(1, 62, 80, 48)]),
    spur([nameMeta('Strings'), ...note(0, 64, 80, 48)]),
    spur([programm(0, 40), ...note(0, 67, 80, 48)]),
  ]);
  const b = planeImport(leseSmf(f), null, {}, ctx).bericht;
  assert.deepEqual(b.spuren.map((s) => s.name), ['Strings ch1', 'Strings ch2', 'Strings', 'Violin']);
});

test('poly profile: chord parts get a Baukasten graph by GM family (only graphs that exist), mono parts stay on the RB-338', () => {
  const akkord = [an(0, 60, 80), an(0, 64, 80), an(0, 67, 80), aus(0, 60, 96), aus(0, 64, 0), aus(0, 67, 0)];
  const f = smf([spur([programm(0, 0), ...akkord]), spur([programm(1, 73), ...note(1, 72, 80, 48)])]);
  const d = leseSmf(f);
  assert.equal(polyphonie(d.teile[0]), 3);
  const p = planeImport(d, neuesProjekt('t'), { profil: 'poly' }, ctx);
  assert.deepEqual(p.bericht.spuren.map((s) => s.geraet_text), ['graph saite-klavier', 'RB-338']);
  const einfach = planeImport(d, neuesProjekt('t'), {}, ctx).bericht;
  assert.deepEqual(einfach.spuren.map((s) => s.geraet_text), ['RB-338', 'RB-338']);
  assert.ok(einfach.spuren[0].hinweise.some((h) => h.code === 'midi_mono'));
  assert.equal(graphFuerProgramm(46), 'saite-harfe'); assert.equal(graphFuerProgramm(null), 'juno-pad');
});

test('poly profile: a track on a Baukasten graph starts 6 dB down, an RB-338 track stays at 0 dB (the sum reached +1 dBTP at 0 dB)', () => {
  const akkord = [an(0, 60, 80), an(0, 64, 80), an(0, 67, 80), aus(0, 60, 96), aus(0, 64, 0), aus(0, 67, 0)];
  const d = leseSmf(smf([spur([programm(0, 0), ...akkord]), spur([programm(1, 73), ...note(1, 72, 80, 48)])]));
  const fader = (plan) => plan.befehle.filter((b) => b.befehl === 'spur_aendern' && b.fader_db !== undefined);
  const poly = fader(planeImport(d, neuesProjekt('t'), { profil: 'poly' }, ctx));
  assert.equal(GRAPH_FADER_DB, -6);
  assert.deepEqual(poly.map((b) => [b.spur_id, b.fader_db]), [['s1', -6]], 'only the graph track (s1), not the RB-338 track');
  assert.deepEqual(fader(planeImport(d, neuesProjekt('t'), {}, ctx)), [], 'profile einfach: no fader change');
  const p2 = planeImport(d, neuesProjekt('t'), { profil: 'poly' }, ctx);
  assert.equal(fuehreListeAus(neuesProjekt('t'), p2.befehle).projekt.spuren[0].fader_db, -6);
});

test('a note-heavy file stays under the project limits: over 65536 notes is refused in the plan', () => {
  const ev = [];
  for (let i = 0; i < 70000; i++) ev.push(...note(0, 60 + (i % 12), 80, 1, i === 0 ? 0 : 1));
  const plan = planeImport(leseSmf(smf([spur(ev)])), neuesProjekt('t'), {}, ctx);
  assert.equal(plan.bericht.anlegbar, false); assert.equal(plan.bericht.grund, 'zu_gross');
});

test('the import is one command list: one history entry, all or nothing (a refused list changes nothing)', () => {
  const p0 = neuesProjekt('t');
  const plan = planeImport(leseSmf(datei()), p0, {}, ctx);
  assert.throws(() => fuehreListeAus(p0, [...plan.befehle, { befehl: 'spur_aendern', spur_id: 's999', mute: true }]));
  assert.equal(p0.spuren.length, 0);
});

test('names: a counter skips names that exist, a channel suffix is never cut off by the length limit', () => {
  const d = leseSmf(smf([
    spur([nameMeta('Piano'), ...note(0, 60, 80, 48)]), spur([nameMeta('Piano'), ...note(0, 62, 80, 48)]), spur([nameMeta('Piano (2)'), ...note(0, 64, 80, 48)]),
    spur([nameMeta('Piano'), ...note(0, 65, 80, 48)]),
  ]));
  const namen = planeImport(d, neuesProjekt('t'), {}, ctx).bericht.spuren.map((s) => s.name);
  assert.deepEqual(namen, ['Piano', 'Piano (2)', 'Piano (2) (2)', 'Piano (3)']);
  assert.equal(new Set(namen).size, namen.length);
  const lang = 'L'.repeat(90);
  const zwei = leseSmf(smf([spur([nameMeta(lang), ...note(0, 60, 80, 48), ...note(1, 62, 80, 48)])]));
  const n2 = planeImport(zwei, neuesProjekt('t'), {}, ctx).bericht.spuren.map((s) => s.name);
  assert.ok(n2.every((x) => x.length <= 80), n2.join());
  assert.deepEqual(n2.map((x) => x.slice(-4)), [' ch1', ' ch2']);
});

test('a first tempo that comes after tick 0 is reported (the first 120 bpm stretch has no tempo in the project)', () => {
  const spaet = leseSmf(smf([spur([tempoMeta(60, 300), ...note(0, 60, 80, 48)])]));
  const b = planeImport(spaet, neuesProjekt('t'), {}, ctx).bericht;
  const h = b.hinweise.find((x) => x.code === 'midi_tempo_spaet');
  assert.ok(h, JSON.stringify(b.hinweise.map((x) => x.code)));
  assert.match(h.text, /beat 1\.563/);
  const gleich = leseSmf(smf([spur([tempoMeta(60), ...note(0, 60, 80, 48)])]));
  assert.equal(planeImport(gleich, neuesProjekt('t'), {}, ctx).bericht.hinweise.some((x) => x.code === 'midi_tempo_spaet'), false, 'a tempo at tick 0 needs no hint');
});

test('the length comes from the notes: a far marker in a track without notes does not refuse the file', () => {
  const d = leseSmf(smf([spur([nameMeta('m'), { dt: 192 * 200000, bytes: [0xff, 0x06, 1, 0x41] }]), spur([...note(0, 60, 80, 48)])]));
  const b = planeImport(d, neuesProjekt('t'), {}, ctx).bericht;
  assert.equal(b.anlegbar, true);
  assert.ok(b.datei.laenge_beats < 2, `length ${b.datei.laenge_beats}`);
  const zuLang = leseSmf(smf([spur([{ dt: 192 * 200000, bytes: [0x90, 60, 80] }, { dt: 48, bytes: [0x80, 60, 0] }])]));
  assert.equal(planeImport(zuLang, neuesProjekt('t'), {}, ctx).bericht.grund, 'midi_zu_lang', 'negative control: a far NOTE still refuses');
});

test('zuordnung values other than a word, null or a device object are refused with the part key', () => {
  for (const falsch of [true, 5, ['rb338']]) {
    assert.throws(() => planeImport(leseSmf(datei()), neuesProjekt('t'), { zuordnung: { '1.1': falsch } }, ctx),
      (e) => e instanceof MidiImportFehler && e.grund === 'argument_ungueltig' && /zuordnung\[1\.1\]/.test(e.message), JSON.stringify(falsch));
  }
});
