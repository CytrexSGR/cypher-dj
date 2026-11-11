// MIDI import over HTTP (POST /proj/midi_import) on the page-server stack with the core stand-in: preview writes nothing, import is ONE undo step,
// a path or base64 body, the GM kit is built from `techno` into the kit folder of the instance, refusals change nothing. Fixtures from bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf, CYPHER } from './support/proj_stack.mjs';
import { tmpOrdner } from './support/project.mjs';
import { GM_BELEGUNG } from '../areas/proj/gm_kit.ts';
import { smf, spur, nameMeta, tempoMeta, taktMeta, programm, note } from './helpers/smf_build.mjs';

// a `techno` kit with every family the GM layout needs (sounds are a few frames of silence: the server only reads kit.json)
function technoKit(wurzel) {
  const ordner = path.join(wurzel, 'techno'); fs.mkdirSync(ordner, { recursive: true });
  const namen = [...new Set(Object.values(GM_BELEGUNG))];
  const klaenge = namen.map((n, i) => ({ note: i, name: n, datei: `${n.replace(':', '_')}.f32`, frames: 100 }));
  for (const k of klaenge) fs.writeFileSync(path.join(ordner, k.datei), Buffer.alloc(800));
  fs.writeFileSync(path.join(ordner, 'kit.json'), JSON.stringify({ schema: 1, name: 'techno', klaenge }));
}
async function mitKitOrdner(t) {
  const wurzel = tmpOrdner(t, 'djk-midikit-');
  technoKit(wurzel);
  const alt = process.env.CYPHERDJ_KIT_ORDNER;
  process.env.CYPHERDJ_KIT_ORDNER = wurzel;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_KIT_ORDNER; else process.env.CYPHERDJ_KIT_ORDNER = alt; });
  return wurzel;
}
const datei = () => smf([
  spur([nameMeta('conductor'), tempoMeta(72), taktMeta(3, 2)]),
  spur([nameMeta('Flute'), programm(0, 73), ...note(0, 72, 100, 96, 192 * 2 + 48), ...note(0, 74, 80, 144, 0)]),
  spur([...note(9, 38, 110, 48, 192 * 4), ...note(9, 42, 60, 24, 144)]),
]);
const b64 = (u8) => Buffer.from(u8).toString('base64');

test('preview: report without a project change; the kit folder stays as it is', async (t) => {
  const wurzel = await mitKitOrdner(t);
  const { url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Vorschau' });
  const r = await ruf(url, 'POST', '/proj/midi_import', { daten_b64: b64(datei()), name: 'test.mid', vorschau: true });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.vorschau, true);
  const b = r.j.bericht;
  assert.deepEqual([b.datei.midi_spuren, b.datei.spuren_mit_noten, b.datei.noten], [3, 2, 4]);
  assert.equal(b.tempo.quelle_bpm, 72); assert.deepEqual(b.taktart.quelle, [3, 4]);
  assert.deepEqual(b.spuren.map((s) => [s.schluessel, s.name, s.geraet_text]), [['1.1', 'Flute', 'RB-338'], ['2.10', 'Drums', 'kit gm']]);
  assert.equal(b.datei_name, 'test');
  const akt = await ruf(url, 'GET', '/proj/aktuell');
  assert.equal(akt.j.projekt.rev, 0); assert.equal(akt.j.projekt.spuren.length, 0);
  assert.equal(fs.existsSync(path.join(wurzel, 'gm')), false, 'the preview builds no kit');
});

test('import: one history step, tracks with clips, tempo, GM kit built from techno; one undo takes everything back', async (t) => {
  const wurzel = await mitKitOrdner(t);
  const { url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Import' });
  const r = await ruf(url, 'POST', '/proj/midi_import', { daten_b64: b64(datei()), name: 'test.mid' }, CYPHER);
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.bericht.gm_kit_gebaut, 'gm');
  assert.deepEqual(r.j.angelegt.map((x) => [x.schluessel, x.spur_id]), [['1.1', 's1'], ['2.10', 's2']]);
  assert.equal(r.j.kern.wiedergabe.quittung.status, 3);
  const kit = JSON.parse(fs.readFileSync(path.join(wurzel, 'gm', 'kit.json'), 'utf8'));
  assert.equal(kit.klaenge.length, 47); assert.deepEqual(kit.klaenge.slice(0, 2).map((k) => [k.note, k.name]), [[35, 'bd:1'], [36, 'bd:0']]);
  const akt = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal(akt.tempo_bpm, 72); assert.equal(akt.spuren.length, 2);
  assert.deepEqual(akt.spuren.map((s) => [s.name, s.von, s.clips[0].noten.length]), [['Flute', 'cypher', 2], ['Drums', 'cypher', 2]]);
  assert.deepEqual(akt.spuren[1].geraet, { art: 'intern', name: 'kit', kit: 'gm' });
  const v = (await ruf(url, 'GET', '/proj/verlauf')).j;
  assert.equal(v.length, 1); assert.match(v[0].label, /^MIDI import: test$/); assert.equal(v[0].quelle, 'cypher');
  const u = await ruf(url, 'POST', '/proj/undo', { rev: akt.rev });
  assert.equal(u.code, 200);
  assert.deepEqual([u.j.projekt.spuren.length, u.j.projekt.tempo_bpm], [0, 120]);
  const re = await ruf(url, 'POST', '/proj/redo', { rev: u.j.rev });
  assert.deepEqual([re.code, re.j.projekt.spuren.length, re.j.projekt.tempo_bpm], [200, 2, 72]);
});

test('import by path (the hand), selection and assignment', async (t) => {
  await mitKitOrdner(t);
  const { url } = await stapel(t);
  const d = tmpOrdner(t, 'djk-midipfad-');
  const f = path.join(d, 'a.mid'); fs.writeFileSync(f, datei());
  await ruf(url, 'POST', '/proj/neu', { name: 'Pfad' });
  const r = await ruf(url, 'POST', '/proj/midi_import', { pfad: f, auswahl: ['1.1'], zuordnung: { '1.1': 'rb338' }, label: 'Flute only' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  const akt = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.deepEqual(akt.spuren.map((s) => s.name), ['Flute']);
  assert.equal((await ruf(url, 'GET', '/proj/verlauf')).j[0].label, 'Flute only');
});

test('refusals name their cause and change nothing', async (t) => {
  await mitKitOrdner(t);
  const { url } = await stapel(t);
  const post = (k) => ruf(url, 'POST', '/proj/midi_import', k);
  assert.equal((await post({ daten_b64: b64(datei()) })).j.fehler, 'kein_projekt');
  await ruf(url, 'POST', '/proj/neu', { name: 'Fehler' });
  const f = async (k) => { const r = await post(k); return [r.code, r.j.fehler]; };
  assert.deepEqual(await f({}), [400, 'argument_ungueltig']);
  assert.deepEqual(await f({ pfad: '/nonexistent/x.mid' }), [404, 'midi_datei_fehlt']);
  assert.deepEqual(await f({ pfad: 'relativ.mid' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await f({ pfad: '/etc/passwd' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await f({ daten_b64: b64(new Uint8Array([1, 2, 3, 4])) }), [400, 'smf_kein_smf']);
  assert.deepEqual(await f({ daten_b64: b64(smf([spur([])], { format: 2 })) }), [400, 'smf_format2']);
  assert.deepEqual(await f({ daten_b64: b64(smf([spur([])], { division: 0xe728 })) }), [400, 'smf_smpte']);
  assert.deepEqual(await f({ daten_b64: b64(smf([spur([nameMeta('leer')])])) }), [409, 'midi_keine_noten']);
  assert.deepEqual(await f({ daten_b64: b64(datei()), auswahl: ['5.5'] }), [400, 'midi_schluessel_unbekannt']);
  assert.deepEqual(await f({ daten_b64: b64(datei()), zuordnung: { '1.1': 'tuba' } }), [400, 'argument_ungueltig']);
  assert.deepEqual(await f({ daten_b64: b64(datei()), zuordnung: { '1.1': { art: 'wirt', name: 'surge', slot: 3 } } }), [400, 'argument_ungueltig']);
  assert.deepEqual(await f({ daten_b64: b64(datei()), rev: 7 }), [409, 'rev_veraltet']);
  const viele = smf(Array.from({ length: 33 }, (_, i) => spur([...note(i % 9, 60, 80, 48)])));
  const z = await post({ daten_b64: b64(viele) });
  assert.deepEqual([z.code, z.j.fehler], [409, 'midi_zu_viele_spuren']); assert.match(z.j.detail, /33 tracks needed but only 32/);
  assert.equal(typeof z.j.text, 'string'); assert.ok(z.j.bericht.spuren.length === 0 || z.j.bericht.spuren.length === 33);
  const akt = await ruf(url, 'GET', '/proj/aktuell');
  assert.deepEqual([akt.j.projekt.rev, akt.j.projekt.spuren.length, akt.j.projekt.tempo_bpm], [0, 0, 120]);
});

test('without techno and without gm: drum track is created muted, report says why', async (t) => {
  const wurzel = tmpOrdner(t, 'djk-midileer-');
  const alt = process.env.CYPHERDJ_KIT_ORDNER; process.env.CYPHERDJ_KIT_ORDNER = wurzel;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_KIT_ORDNER; else process.env.CYPHERDJ_KIT_ORDNER = alt; });
  const { url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'OhneKit' });
  const r = await ruf(url, 'POST', '/proj/midi_import', { daten_b64: b64(datei()) });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.bericht.summe.ohne_klang, 1);
  assert.ok(r.j.bericht.spuren[1].hinweise.some((h) => h.code === 'midi_kein_gm_kit'));
  const akt = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal(akt.spuren[1].mute, true); assert.equal(akt.spuren[1].clips[0].noten.length, 2);
});

test('a body over the file limit is 413 with a text that names the real limit', async (t) => {
  await mitKitOrdner(t);
  const { url } = await stapel(t);
  const r = await ruf(url, 'POST', '/proj/midi_import', `{"daten_b64":"${'A'.repeat(11 * 1024 * 1024)}"}`);
  assert.deepEqual([r.code, r.j.fehler], [413, 'koerper_zu_gross']);
  assert.match(r.j.text, /larger than 10\.7 MiB/);
});

test('a refused import builds no GM kit folder: too many tracks, stale rev, refusal in the middle of the command list', async (t) => {
  const wurzel = await mitKitOrdner(t);
  const { url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Kit bleibt weg' });
  const post = (k) => ruf(url, 'POST', '/proj/midi_import', k);
  const gm = () => fs.existsSync(path.join(wurzel, 'gm'));
  const viele = smf(Array.from({ length: 33 }, (_, i) => spur([...note(i === 0 ? 9 : 0, 60, 80, 48)])));
  assert.equal((await post({ daten_b64: b64(viele) })).j.fehler, 'midi_zu_viele_spuren');
  assert.equal(gm(), false, 'after midi_zu_viele_spuren');
  assert.equal((await post({ daten_b64: b64(datei()), rev: 99 })).j.fehler, 'rev_veraltet');
  assert.equal(gm(), false, 'after rev_veraltet');
  // the drums come second: the kit exists when the first track command is refused, and must be taken back with the refusal
  const mitte = await post({ daten_b64: b64(datei()), zuordnung: { '1.1': { art: 'intern', name: 'rb338', bogus: 1 } } });
  assert.notEqual(mitte.code, 200, JSON.stringify(mitte.j));
  assert.equal(gm(), false, `after a refusal in the middle (${mitte.j.fehler})`);
  const akt = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.deepEqual([akt.rev, akt.spuren.length, akt.tempo_bpm], [0, 0, 120]);
  assert.equal((await ruf(url, 'GET', '/proj/verlauf')).j.length, 0);
  // negative control: the accepted import still builds it, and a kit that was there before is never removed by a later refusal
  assert.equal((await post({ daten_b64: b64(datei()) })).code, 200);
  assert.equal(gm(), true, 'after an accepted import');
  const nochmal = await post({ daten_b64: b64(datei()), rev: 99 });
  assert.equal(nochmal.j.fehler, 'rev_veraltet');
  assert.equal(gm(), true, 'an existing kit stays');
});

test('invalid assignments and an unreadable file are reasons, never a 500', async (t) => {
  await mitKitOrdner(t);
  const { url } = await stapel(t);
  await ruf(url, 'POST', '/proj/neu', { name: 'Eingaben' });
  const post = (k) => ruf(url, 'POST', '/proj/midi_import', k);
  for (const falsch of [true, 5, ['rb338']]) {
    const r = await post({ daten_b64: b64(datei()), zuordnung: { '1.1': falsch } });
    assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig'], JSON.stringify(falsch));
    assert.match(r.j.detail, /zuordnung\[1\.1\]/);
  }
  const d = tmpOrdner(t, 'djk-midirecht-');
  const f = path.join(d, 'zu.mid'); fs.writeFileSync(f, datei()); fs.chmodSync(f, 0o000);
  t.after(() => { try { fs.chmodSync(f, 0o600); } catch { /* weg */ } });
  if (process.getuid?.() !== 0) {
    const r = await post({ pfad: f });
    assert.deepEqual([r.code, r.j.fehler], [404, 'midi_datei_fehlt']);
    assert.match(r.j.text, /cannot read .*EACCES/);
  }
  const akt = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.equal(akt.spuren.length, 0);
});
