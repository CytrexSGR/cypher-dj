// Controller targets spur/<slot>/bk/<k> (S1 of the controller presets plan): the learn kinds, the names from the open project, GET /register/ziele,
// and POST /regler, which keeps refusing them. The project is a stand-in object; the graph folder is the test's own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json } from '../http/transport.ts';
import { registerBereich } from '../areas/controller/register.ts';
import { beschriftung, knopfName, spurVonSlot } from '../areas/learn/beschriftung.ts';
import { zielArt, eintragsArt } from '../areas/learn/targets.ts';
import { PFAD } from '../hand_operation.ts';
import { ueberProjekt, ueberProjektText } from '../server_kopf.ts';
import { stapel as serverStapel } from './support/media_library.mjs';
import { ruf, anKern } from './support/proj_stack.mjs';

const bkSpur = (id, nr, name, graph) => ({ id, nr, name, art: 'instrument', geraet: { art: 'intern', name: 'bk', graph, parameter: {} } });
// slot 1 = s1 (nr 1), s2 is an audio track, slot 2 = s4 (nr 4), s3 (nr 3) has no graph name list
const PROJEKT = { spuren: [bkSpur('s4', 4, 'Pad', 'testsyn'), { id: 's2', nr: 2, name: 'Drums', art: 'audio' }, bkSpur('s1', 1, 'Lead', 'testsyn'), bkSpur('s3', 3, 'Bass', 'ohnenamen')] };
// by ascending nr the Baukasten tracks are s1 (slot 1), s3 (slot 2), s4 (slot 3)

function graphOrdner(t) {
  const bk = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-spur-bk-'));
  t.after(() => fs.rmSync(bk, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bk, 'testsyn.json'), JSON.stringify({ knoten: [{ art: 'eingang' }], regler_namen: { 4: 'Cutoff' } }));
  fs.writeFileSync(path.join(bk, 'ohnenamen.json'), JSON.stringify({ knoten: [{ art: 'eingang' }], regler_namen: {} }));
  const alt = process.env.CYPHERDJ_BK_ORDNER;
  process.env.CYPHERDJ_BK_ORDNER = bk;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt; });
}

test('spur/<slot>/bk/<k> is a continuous target: capturable, assignable as a CC, never as a note; 17 and 0 and 65 are no target', () => {
  assert.equal(PFAD.test('spur/3/bk/64'), true);
  for (const p of ['spur/1/bk/1', 'spur/16/bk/64', 'spur/5/bk/33']) { assert.equal(zielArt(p), 'regler', p); assert.equal(eintragsArt('regler', 'cc'), 'absolut'); }
  assert.equal(eintragsArt(zielArt('spur/1/bk/1'), 'note'), null);
  for (const p of ['spur/0/bk/1', 'spur/17/bk/1', 'spur/1/bk/0', 'spur/1/bk/65', 'spur/1/bk/01', 'spur/1/bk']) { assert.equal(zielArt(p), null, p); assert.equal(PFAD.test(p), false, p); }
});

test('names: the knob name of the graph on the slot track plus the track name; no project, no slot, no graph name: the plain path', (t) => {
  graphOrdner(t);
  const ctx = { projekt: () => PROJEKT };
  assert.equal(spurVonSlot(ctx, 1).id, 's1');
  assert.equal(spurVonSlot(ctx, 3).id, 's4', 'slots count the Cypher Modular tracks by ascending nr, an audio track does not count');
  assert.equal(spurVonSlot(ctx, 4), null);
  assert.equal(knopfName(ctx, 'spur/1/bk/4'), 'Cutoff (Lead)');
  assert.equal(beschriftung(ctx, 'spur/3/bk/4'), 'Pad Cutoff');
  assert.equal(beschriftung(ctx, 'spur/1/bk/5'), 'spur/1/bk/5', 'a knob without a name');
  assert.equal(beschriftung(ctx, 'spur/2/bk/4'), 'spur/2/bk/4', 'a graph without knob names');
  assert.equal(beschriftung(ctx, 'spur/6/bk/4'), 'spur/6/bk/4', 'no track on that slot');
  assert.equal(beschriftung({ projekt: () => null }, 'spur/1/bk/4'), 'spur/1/bk/4', 'no project open');
  assert.equal(beschriftung({}, 'spur/1/bk/4'), 'spur/1/bk/4', 'a context without a project view');
  assert.equal(beschriftung({ projekt: () => { throw new Error('x'); } }, 'spur/1/bk/4'), 'spur/1/bk/4');
  // channel knobs are unchanged
  assert.equal(beschriftung({ baukasten: { geladen: () => ({ 'erz/5': 'testsyn' }) } }, 'erz/5/bk/4'), 'erz/5 Cutoff');
});

async function stapel(t, ctxFelder) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-register-spur-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const router = new Router();
  router.melde(registerBereich({ log: () => {}, quelle: () => 'andreas', ...ctxFelder }, { ordner, aktiv: () => 'pult', midiPort: () => null, host: () => ({}), usb: () => [] }));
  const server = http.createServer(async (q, a) => {
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
const hole = async (url, p) => { const r = await fetch(url + p); return { code: r.status, j: await r.json() }; };

test('GET /register/ziele?prefix=spur/1: the 64 knobs with the knob name and track name; a slot without a track lists them unnamed', async (t) => {
  graphOrdner(t);
  const url = await stapel(t, { projekt: () => PROJEKT });
  const z = (await hole(url, '/register/ziele?prefix=spur/1/bk')).j;
  assert.equal(z.ziele.length, 64);
  assert.ok(z.ziele.every((x) => x.art === 'regler' && x.einheit === 'linear' && x.min === 0 && x.max === 1));
  assert.equal(z.ziele.find((x) => x.pfad === 'spur/1/bk/4').name, 'Cutoff (Lead)');
  assert.equal(z.ziele.find((x) => x.pfad === 'spur/1/bk/5').name, undefined);
  const leer = (await hole(url, '/register/ziele?prefix=spur/7/bk')).j.ziele;
  assert.equal(leer.length, 64);
  assert.ok(leer.every((x) => x.name === undefined));
  assert.equal((await hole(url, '/register/ziele?prefix=spur/17/bk')).j.ziele.length, 0);
  assert.equal((await hole(url, '/register/ziele?prefix=spur/1')).j.ziele.filter((x) => x.pfad.includes('/bk/')).length, 64, 'under spur/1 the 64 knobs sit with fader, pan and the rest');
});

test('POST /regler keeps refusing spur/<slot>/bk/<k> (the project owns these values), with a text that names the project command', () => {
  assert.equal(ueberProjekt('spur/1/bk/3'), true);
  assert.match(ueberProjektText('spur/1/bk/3'), /geraet_param_setzen/);
  assert.match(ueberProjektText('spur/1/fader'), /track faders/);
});

test('POST /regler on the real server: spur/<slot>/bk/<k> is 409 ueber_projekt and nothing reaches the core', async (t) => {
  const { url, log } = await serverStapel(t);
  const r = await ruf(url, 'POST', '/regler', { pfad: 'spur/1/bk/3', nach: 0.3, ab: 'jetzt' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'ueber_projekt']);
  assert.equal(anKern(log, '/k/teil').length, 0);
});

test('ins/saett/<n>/kurve and decke are controller paths for slots 1..32 (strand 5 slice 3); unknown rows and slot 33 are not', () => {
  for (const p of ['ins/saett/1/kurve', 'ins/saett/4/decke', 'ins/saett/2/drive', 'ins/saett/5/kurve', 'ins/saett/32/decke']) assert.equal(PFAD.test(p), true, p);
  for (const p of ['ins/saett/1/foo', 'ins/saett/33/kurve', 'ins/saett/0/decke', 'ins/saett/05/an']) assert.equal(PFAD.test(p), false, p);
});

test('ins/trans/<n>/* (1..32) and ins/bild/<n>/* (1..16) are controller paths; unknown rows and the next slot are not', () => {
  for (const p of ['ins/trans/1/an', 'ins/trans/32/angriff', 'ins/trans/7/halten', 'ins/trans/1/tempo', 'ins/trans/20/out', 'ins/trans/1/mix',
    'ins/bild/1/an', 'ins/bild/16/grenze_tief', 'ins/bild/3/grenze_hoch', 'ins/bild/1/breite_tief', 'ins/bild/1/breite_mitte', 'ins/bild/16/breite_hoch', 'ins/bild/1/mono_unter']) assert.equal(PFAD.test(p), true, p);
  for (const p of ['ins/trans/33/an', 'ins/trans/0/an', 'ins/trans/1/drive', 'ins/trans/1/b1/an', 'ins/bild/17/an', 'ins/bild/0/an', 'ins/bild/1/breite', 'ins/bild/1/b1/breite', 'ins/bild/1/sc']) assert.equal(PFAD.test(p), false, p);
});

test('ins/eq/<n>/d<m>/{dyn,schwelle,bereich}, dyn_attack and dyn_release are controller paths; band 0 and 9, unknown names and slot 161 are not', () => {
  for (const p of ['ins/eq/1/d1/dyn', 'ins/eq/160/d8/bereich', 'ins/eq/42/d3/schwelle', 'ins/eq/1/dyn_attack', 'ins/eq/160/dyn_release', 'ins/eq/1/b8/platz']) assert.equal(PFAD.test(p), true, p);
  for (const p of ['ins/eq/1/d0/dyn', 'ins/eq/1/d9/bereich', 'ins/eq/1/d1/an', 'ins/eq/1/b1/dyn', 'ins/eq/1/d1/dyn_attack', 'ins/eq/161/dyn_release', 'ins/eq/1/dyn']) assert.equal(PFAD.test(p), false, p);
});
