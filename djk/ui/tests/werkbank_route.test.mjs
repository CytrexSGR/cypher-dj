// Workbench stage 1, task 2: POST /proj/neu with werkbank and vorlage, GET /proj/werkbank/vorlagen, the list flag, the refusals.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { stapel } from './support/media_library.mjs';
import { ruf } from './support/proj_stack.mjs';
import { sitzung } from './support/proj_context.mjs';

process.env.CYPHERDJ_BK_ORDNER = path.resolve(import.meta.dirname, '../../instruments/modular_dsp/demos');

test('POST /proj/neu with werkbank and vorlage creates the template module in one history step', async (t) => {
  const { url } = await stapel(t);
  const r = await ruf(url, 'POST', '/proj/neu', { name: 'Techno 130 · Start', werkbank: true, vorlage: 'techno-130-start' });
  assert.equal(r.code, 200);
  const p = r.j.projekt;
  assert.deepEqual([p.werkbank, p.tempo_bpm, p.loop], [{ schema: 1 }, 130, { an: true, von_beat: 0, bis_beat: 16 }]);
  assert.deepEqual(p.spuren.map((s) => [s.name, s.geraet.graph, s.clips[0].loop_beats, s.clips[0].noten.length]),
    [['Drums', 'drums-909', 16, 40], ['Bass', 'bass-banddrive', 16, 48]]);
  const v = await ruf(url, 'GET', '/proj/verlauf');
  assert.ok(v.j.some((e) => e.label === 'Template Techno 130 · Start'));
  assert.equal(v.j.filter((e) => String(e.label).startsWith('Template')).length, 1);
  const l = await ruf(url, 'GET', '/proj/liste');
  assert.equal(l.j.find((e) => e.slug === r.j.slug).werkbank, true);
});

test('an empty module, a plain project, and the refusals', async (t) => {
  const { url } = await stapel(t);
  const leer = await ruf(url, 'POST', '/proj/neu', { name: 'Empty', werkbank: true });
  assert.deepEqual([leer.j.projekt.spuren.length, leer.j.projekt.loop.bis_beat, leer.j.projekt.werkbank], [0, 16, { schema: 1 }]);
  await ruf(url, 'POST', '/proj/neu', { name: 'Plain' });
  const vorher = (await ruf(url, 'GET', '/proj/liste')).j;
  assert.equal('werkbank' in vorher.find((e) => e.name === 'Plain'), false);
  for (const [k, code, grund] of [[{ vorlage: 'techno-130-start' }, 400, 'argument_ungueltig'], [{ werkbank: true, vorlage: 'nope' }, 400, 'vorlage_unbekannt'],
    [{ werkbank: 'ja' }, 400, 'argument_ungueltig'], [{ werkbank: false }, 400, 'argument_ungueltig']]) {
    const x = await ruf(url, 'POST', '/proj/neu', { name: 'X', ...k });
    assert.deepEqual([x.code, x.j.fehler], [code, grund]);
  }
  assert.equal((await ruf(url, 'GET', '/proj/liste')).j.length, vorher.length, 'a refusal creates no folder');
  assert.deepEqual((await ruf(url, 'GET', '/proj/werkbank/vorlagen')).j.vorlagen.map((v) => [v.id, v.name]), [['techno-130-start', 'Techno 130 · Start']]);
});

test('a template while a deck plays is refused before anything is created or opened', async (t) => {
  const { s } = sitzung(t);
  await s.neu('Open', 'andreas');
  const vorher = s.liste().j.length;
  s.ereignis('/zustand/deck', { deck: 2, status: 2 });
  let e = null;
  try { await s.neu('Mod', 'andreas', false, { werkbank: true, vorlage: 'techno-130-start' }); } catch (x) { e = x; }
  assert.deepEqual([e?.code, e?.fehler, e?.extra?.text], [409, 'deck_laeuft', 'Stop the decks first: a module sets its own tempo.']);
  assert.equal(s.liste().j.length, vorher);
  assert.equal(s.aktuell().j.projekt.name, 'Open');
  // an empty module sets no tempo and opens even with a deck playing
  const leer = await s.neu('Empty', 'andreas', false, { werkbank: true });
  assert.equal(leer.j.projekt.werkbank.schema, 1);
});
