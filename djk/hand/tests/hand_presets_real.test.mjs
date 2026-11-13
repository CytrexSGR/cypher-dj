// Package 1.16 rest U5, T5.6 end to end: the REAL hand (stdio) against the REAL page server (Oberflaeche in process, core stand-in, test
// instance from CYPHERDJ_TEST_INSTANZ, e for this package: port 52300). The presets and collections live in private temp folders.
// Run it inside both instance locks of the stream (see the stream's rules).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const HAND = path.resolve(HIER, '..', 'hand.ts');
const OB = path.resolve(HIER, '..', '..', 'ui', 'tests', 'support');
process.env.CYPHERDJ_TEST_INSTANZ ??= 'e';
const { stapel } = await import(path.join(OB, 'media_library.mjs'));
const { ruf, CYPHER } = await import(path.join(OB, 'proj_stack.mjs'));

async function aufbau(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-hand-presets-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const { url, log } = await stapel(t, { presets: { nutzer: path.join(d, 'nutzer') }, kollektionen: { ordner: path.join(d, 'koll') } });
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', url] }));
  t.after(() => c.close());
  const aufruf = async (name, arguments_) => { const r = await c.callTool({ name, arguments: arguments_ }); let j; try { j = JSON.parse(r.content[0].text); } catch { j = r.content[0].text; } return { r, j }; };
  return { url, c, aufruf, log };
}

test('T5.6 echt: tools/list of the live hand has 90 tools = the grep count; presets_suchen {familie: instrument} returns the 10 rb338 factory presets, {art: [bass]} the 7 bass ones', async (t) => {
  const { c, aufruf } = await aufbau(t);
  const n = (await c.listTools()).tools.length;
  const imCode = fs.readFileSync(HAND, 'utf8').split('\n').filter((z) => z.startsWith("  { name: '")).length;
  assert.deepEqual([n, imCode], [90, 90]);
  const alle = await aufruf('presets_suchen', { familie: 'instrument', geraet: ['rb338'] });
  assert.ok(!alle.r.isError, JSON.stringify(alle.j));
  assert.equal(alle.j.gesamt, 10);
  assert.ok(alle.j.treffer.every((x) => x.geraet === 'rb338' && x.herkunft === 'werk'));
  const bass = await aufruf('presets_suchen', { art: ['bass'], geraet: ['rb338'] });
  assert.equal(bass.j.gesamt, 7);
  // negative control: a word outside the vocabulary is refused with the allowed words
  const falsch = await aufruf('presets_suchen', { art: ['erfunden'] });
  assert.equal(falsch.r.isError, true);
  assert.ok(falsch.j.details.some((x) => Array.isArray(x.erlaubt) && x.erlaubt.includes('bass')), JSON.stringify(falsch.j).slice(0, 300));
});

test('T5.6 echt: apply a factory preset to an rb338 track and to a compressor stage = one history entry each, source cypher; a hall preset sends nothing', async (t) => {
  const { url, aufruf } = await aufbau(t);
  assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Hand Presets' })).code, 200);
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Aufbau', befehle: [
    { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: { cutoff: 0.2 } } },
    { befehl: 'spur_neu', art: 'audio' },
    { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp', werte: { schwelle: -40, ratio: 2 } }] }, CYPHER);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const vor = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  const iid = vor.spuren[1].inserts[0].id;
  const histVor = (await ruf(url, 'GET', '/proj/verlauf')).j;
  const laenge = (h) => (Array.isArray(h) ? h : h.eintraege ?? h.verlauf ?? []).length;

  const s = await aufruf('presets_anwenden', { id: 'werk:rb338/classic-acid', ziel: { art: 'spur', spur_id: 's1' } });
  assert.ok(!s.r.isError, JSON.stringify(s.j));
  assert.equal(s.j.weg, 'proj');
  const k = await aufruf('presets_anwenden', { id: 'werk:komp/drum-bus', ziel: { art: 'insert', insert_id: iid } });
  assert.ok(!k.r.isError, JSON.stringify(k.j));
  assert.deepEqual(k.j.uebersprungen, ['extsc']);
  const nach = (await ruf(url, 'GET', '/proj/aktuell')).j.projekt;
  assert.notDeepEqual(nach.spuren[0].geraet.parameter, vor.spuren[0].geraet.parameter, 'the rb338 values changed');
  assert.equal(nach.spuren[0].geraet.preset, 'werk:rb338/classic-acid');
  assert.equal(nach.spuren[1].inserts[0].preset, 'werk:komp/drum-bus');
  assert.equal(nach.spuren[1].inserts[0].werte.schwelle, -18);
  const histNach = (await ruf(url, 'GET', '/proj/verlauf')).j;
  assert.equal(laenge(histNach) - laenge(histVor), 2, 'one history entry per apply');

  // the real refusal: a hall preset has no running instance; nothing is sent, the project is unchanged
  const revVor = (await ruf(url, 'GET', '/proj/aktuell?nur=rev')).j.rev;
  const hall = await aufruf('presets_anwenden', { id: 'werk:hall/dark-dub', ziel: { art: 'spur', spur_id: 's1' } });
  assert.equal(hall.r.isError, true);
  assert.equal(hall.j.fehler, 'kein_ziel');
  assert.equal((await ruf(url, 'GET', '/proj/aktuell?nur=rev')).j.rev, revVor, 'a refused plan changed nothing');
});

test('T5.6 echt: save by the hand carries autor cypher, read back, collect it; deleting a collection of Andreas is refused (nur_andreas_kollektion)', async (t) => {
  const { url, aufruf } = await aufbau(t);
  const beschr = { art: 'compressor', unterart: 'peak', charakter: ['clean'], genre: [], einsatz: ['mixdown'], energie: 2, text: 'Peak control from the real hand test.' };
  const s = await aufruf('presets_speichern', { name: 'Echt Test', geraet: 'komp', beschreibung: beschr, werte: { thresh: -20, ratio: 3 } });
  assert.ok(!s.r.isError, JSON.stringify(s.j));
  const l = await aufruf('presets_lesen', { id: 'nutzer:komp/echt-test' });
  assert.equal(l.j.autor, 'cypher');
  const nochmal = await aufruf('presets_speichern', { name: 'Echt Test', geraet: 'komp', beschreibung: beschr, werte: { thresh: -20 } });
  assert.equal(nochmal.r.isError, true);
  assert.equal(nochmal.j.fehler, 'name_vergeben');
  const k = await aufruf('kollektion_aendern', { aktion: 'neu', name: 'Echt Sammlung' });
  assert.ok(!k.r.isError, JSON.stringify(k.j));
  const h = await aufruf('kollektion_aendern', { aktion: 'posten', slug: 'echt-sammlung', hinzu: [{ art: 'preset', id: 'nutzer:komp/echt-test' }, { art: 'geraet', geraet: 'rb338' }] });
  assert.equal(h.j.anzahl, 2);
  assert.deepEqual((await aufruf('kollektionen', { slug: 'echt-sammlung' })).j.posten.length, 2);
  // a collection of Andreas (no x-djk-quelle header)
  const andreas = await ruf(url, 'POST', '/kollektionen', { name: 'Andreas Sammlung' });
  assert.equal(andreas.code, 201);
  const weg = await aufruf('kollektion_aendern', { aktion: 'loeschen', slug: 'andreas-sammlung' });
  assert.equal(weg.r.isError, true);
  assert.equal(weg.j.fehler, 'nur_andreas_kollektion');
  assert.equal((await ruf(url, 'GET', '/kollektionen/andreas-sammlung')).code, 200, 'still there');
  // negative control: her own collection can be deleted
  const eigene = await aufruf('kollektion_aendern', { aktion: 'loeschen', slug: 'echt-sammlung' });
  assert.ok(!eigene.r.isError, JSON.stringify(eigene.j));
});
