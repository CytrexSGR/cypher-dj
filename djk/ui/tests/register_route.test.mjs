// Controller register: GET /register on the real Router with a temp controller folder (never ~/.config). Broken and foreign files must be listed
// with an error, never a 500.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Router } from '../http/router.ts';
import { json } from '../http/transport.ts';
import { registerBereich } from '../areas/controller/register.ts';
import { REGLER } from '../../conductor/src/controls_info.ts';

const kern = (geraet, eintraege, leds = []) => JSON.stringify({ version: 1, geraet, quelle_port: 'x', eintraege, ...(leds.length ? { leds } : {}) });
const cc = (kanal, nr, ziel, kurve) => ({ nachricht: { typ: 'cc', kanal, nr }, ziel, art: 'absolut', ...(kurve ? { kurve } : {}) });

async function stapel(t, opt = {}) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-register-'));
  t.after(() => fs.rmSync(ordner, { recursive: true, force: true }));
  const router = new Router();
  router.melde(registerBereich({ log: () => {}, quelle: () => 'andreas', ...(opt.baukasten ? { baukasten: opt.baukasten } : {}) }, { ordner: opt.ordner ?? ordner, aktiv: () => 'pult', midiPort: () => 'X:Y', host: () => ({}) }));
  const server = http.createServer(async (q, a) => {
    const url = new URL(q.url ?? '/', 'http://127.0.0.1');
    const r = router.finde(q.method ?? '', url.pathname);
    if (!r) return json(a, 404, { fehler: 'keine_route' });
    await r.handler(q, a, url);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, ordner };
}
const hole = async (url, p) => { const r = await fetch(url + p); return { code: r.status, j: await r.json() }; };

test('register: roles, order, edges, LEDs and the broken fixtures of the folder', async (t) => {
  const { url, ordner } = await stapel(t);
  const w = (n, s) => fs.writeFileSync(path.join(ordner, n), s);
  w('pult.json', kern('pult', [cc(1, 7, 'deck/1/fader', { typ: 'fader_db', min: -200, max: 0 }), { nachricht: { typ: 'note', kanal: 1, nr: 49 }, ziel: 'deck/1/pfl', art: 'taste' }],
    [{ name: 'deck1_loop', nachricht: { typ: 'note', kanal: 1, nr: 57 }, werte: { aus: 0, an: 1 } }]));
  w('lernen.json', kern('lernen', [cc(1, 74, 'erz/5/bk/3')]));
  w('apc20.json', kern('apc20', [cc(1, 48, 'deck/1/filter')]));
  w('bruecke.json', JSON.stringify({ version: 1, geraet: 'bruecke', eintraege: [
    { geraet: 's8', quelle: 'left touch strip', ziel: 'deck/1/scrub', art: 'beruehrung', weg: 'seite' },
    { geraet: 'mk2', quelle: 'encoder_1', ziel: '<kanal>/bk/<seite*8+1>', art: 'relativ', weg: 'seite' }] }));
  w('notes.txt', 'not json');
  w('kaputt.json', '{');
  w('foreign.json', '{"version": 2}');
  w('lernen.json.bak', kern('lernen', [cc(1, 1, 'deck/1/trim')]));
  w('host_ziele.json', '{"version":1,"ziele":{}}');
  const r = await hole(url, '/register');
  assert.equal(r.code, 200);
  const j = r.j;
  assert.deepEqual(j.geraete.map((g) => [g.id, g.rolle]), [['pult', 'basis'], ['lernen', 'lernen'], ['bruecke', 'bruecke'], ['apc20', 'inaktiv'], ['foreign', 'inaktiv'], ['kaputt', 'inaktiv']]);
  const g = Object.fromEntries(j.geraete.map((x) => [x.id, x]));
  assert.equal(g.kaputt.fehler, 'json');
  assert.equal(g.foreign.fehler, 'form');
  assert.deepEqual([g.kaputt.eintraege, g.foreign.eintraege, g.pult.fehler, g.pult.eintraege, g.pult.leds, g.pult.datei], [0, 0, null, 2, 1, 'pult.json']);
  assert.equal(j.kanten.length, 6);
  const fader = j.kanten.find((k) => k.ziel === 'deck/1/fader');
  assert.deepEqual([fader.einheit, fader.kurve, fader.weg, fader.geraet, fader.art], ['db', 'fader_db', 'kern', 'pult', 'absolut']);
  assert.deepEqual(fader.quelle, { typ: 'cc', kanal: 1, nr: 7 });
  assert.deepEqual([fader.besitzer, j.kanten.find((k) => k.geraet === 'lernen').besitzer, j.kanten.find((k) => k.geraet === 'apc20').besitzer], ['apc20', 'platz:1', null], 'desk file by channel, learn table by place, an unloaded file has no owner');
  assert.equal(j.kanten.find((k) => k.ziel === 'deck/1/pfl').einheit, 'schalter');
  const platz = j.kanten.find((k) => k.ziel === '<kanal>/bk/<seite*8+1>');
  assert.deepEqual([platz.einheit, platz.weg, platz.quelle, platz.kurve], [null, 'seite', { name: 'encoder_1' }, null]);
  assert.equal(j.kanten.find((k) => k.ziel === 'deck/1/scrub').einheit, null);
  assert.equal(j.leds.length, 1);
  assert.deepEqual(j.leds[0], { geraet: 'pult', name: 'deck1_loop', nachricht: { typ: 'note', kanal: 1, nr: 57 } });
  assert.deepEqual([j.aktiv, j.midi_port, j.host, j.ziele_gesamt], ['pult', 'X:Y', {}, REGLER.size]);
});

test('register: an empty folder and a missing folder answer 200 with empty lists', async (t) => {
  const { url } = await stapel(t);
  const leer = await hole(url, '/register');
  assert.equal(leer.code, 200);
  assert.deepEqual([leer.j.geraete, leer.j.kanten, leer.j.leds], [[], [], []]);
  const s2 = await stapel(t, { ordner: path.join(os.tmpdir(), 'djk-register-gibt-es-nicht') });
  const weg = await hole(s2.url, '/register');
  assert.equal(weg.code, 200);
  assert.deepEqual([weg.j.geraete, weg.j.kanten], [[], []]);
});

test('register/ziele: continuous knobs whose path contains q; switches never; limit is capped', async (t) => {
  const { url } = await stapel(t);
  const r = await hole(url, '/register/ziele?q=deck/1/fil');
  assert.equal(r.code, 200);
  assert.deepEqual(r.j.ziele.map((z) => z.pfad), ['deck/1/filter']);
  assert.equal(r.j.ziele[0].einheit, 'linear');
  assert.deepEqual(Object.keys(r.j.ziele[0]).sort(), ['einheit', 'max', 'min', 'pfad']);
  assert.ok(r.j.gesamt >= 1);
  assert.deepEqual((await hole(url, '/register/ziele?q=kill')).j.ziele, []);
  assert.equal((await hole(url, '/register/ziele?q=deck&limit=3')).j.ziele.length, 3);
  assert.equal((await hole(url, '/register/ziele?limit=100000')).j.ziele.length, 200);
  assert.equal((await hole(url, '/register/ziele')).j.ziele.length, 50);
  assert.ok(!(await hole(url, '/register/ziele?limit=500')).j.ziele.some((z) => z.einheit === 'schalter'));
});

test('register/ziele prefix: every continuous target of a module without a cap, graph knobs with the knob name of the loaded graph', async (t) => {
  const bk = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-register-bk-'));
  t.after(() => fs.rmSync(bk, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bk, 'testfx.json'), JSON.stringify({ knoten: [{ art: 'eingang' }], regler_namen: { 4: 'Sub 1' } }));
  const alt = process.env.CYPHERDJ_BK_ORDNER;
  process.env.CYPHERDJ_BK_ORDNER = bk;
  t.after(() => { if (alt === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt; });
  const { url } = await stapel(t, { baukasten: { geladen: () => ({ 'fx/3': 'testfx' }) } });
  const d1 = (await hole(url, '/register/ziele?prefix=deck/1')).j;
  assert.ok(d1.ziele.length > 50 && d1.ziele.some((z) => z.pfad === 'deck/1/bk/64'), 'more than the default limit of 50');
  assert.ok(d1.ziele.every((z) => z.pfad.startsWith('deck/1/') && z.einheit !== 'schalter'));
  assert.equal(d1.gesamt, d1.ziele.length);
  assert.deepEqual((await hole(url, '/register/ziele?prefix=xfader')).j.ziele.map((z) => z.pfad), ['xfader'], 'a single control is its own prefix');
  assert.ok(!(await hole(url, '/register/ziele?prefix=deck/1')).j.ziele.some((z) => z.pfad.startsWith('deck/10')), 'the prefix ends at a path segment');
  const alle = (await hole(url, '/register/ziele?prefix=')).j;
  assert.ok(alle.ziele.length > 200 && alle.ziele.length === alle.gesamt, 'an empty prefix is everything, no cap of 200');
  const fx = (await hole(url, '/register/ziele?prefix=fx/3')).j.ziele;
  assert.equal(fx.find((z) => z.pfad === 'fx/3/bk/4').name, 'Sub 1');
  assert.equal(fx.find((z) => z.pfad === 'fx/3/bk/5').name, undefined, 'no name: no field');
  assert.equal(d1.ziele.find((z) => z.pfad === 'deck/1/filter').name, undefined);
});

test('register: the learnable devices carry their control layout', async (t) => {
  const { url } = await stapel(t);
  const kat = (await hole(url, '/register')).j.katalog;
  const lc3 = kat.find((k) => k.id === 'lc3').regler, lpd8 = kat.find((k) => k.id === 'lpd8').regler;
  assert.deepEqual([lc3.filter((r) => r.art === 'knob').length, lc3.filter((r) => r.art === 'button').length], [16, 8]);
  assert.deepEqual(lc3.filter((r) => r.art === 'knob').map((r) => r.nr), Array.from({ length: 16 }, (_, i) => 13 + i));
  assert.deepEqual(lc3.filter((r) => r.art === 'button').map((r) => [r.nr, r.kanal, r.kanal_daw]), Array.from({ length: 8 }, (_, i) => [37 + i, 16, 1]));
  assert.deepEqual(lpd8.filter((r) => r.art === 'knob').map((r) => [r.typ, r.kanal, r.nr]), Array.from({ length: 8 }, (_, i) => ['cc', 1, 1 + i]));
  assert.ok(lpd8.filter((r) => r.art === 'pad').every((r) => r.typ === 'note'));
  for (const g of [lc3, lpd8]) assert.equal(new Set(g.map((r) => `${r.zeile}/${r.spalte}`)).size, g.length, 'no two controls share a grid cell');
  assert.equal(kat.find((k) => k.id === 's8').regler, undefined, 'a desk device has no layout');
});
