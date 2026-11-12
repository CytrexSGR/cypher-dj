// Host learn: the routes of the Bereich on a small http server with a fake BereichKontext and the real learn Bereich (own folders in tmp).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { GeraeteSpeicher, standard } from '../areas/devices/store.ts';
import { lernenBereich } from '../areas/learn/area.ts';
import { hostlernenBereich } from '../areas/hostlernen/area.ts';

const CUTOFF = { name: 'a_filter1_cutoff', label: 'Cutoff', min: -60, max: 70, log: false, vorgabe: 0.5, punkte: [-60, -20, 10, 40, 70] };
const RES = { name: 'a_filter1_resonance', label: 'Res', min: 0, max: 1, log: false, vorgabe: 0.5 };

async function aufbau(t, { arten = { bass: 'lv2', melodie: 'vst3:rb338' }, geladen = {}, quelle = 'andreas', midi = true } = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-hostlernen-route-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const konfig = path.join(d, 'geraete.json'), ordner = path.join(d, 'controller');
  fs.mkdirSync(ordner);
  if (midi) new GeraeteSpeicher(konfig).schreibe({ ...standard(), midi: { profil: 'midi-controller', port: 'X:Y', frei_fuer_cypher: false } });
  const aus = { sende: [], verteilt: [], ruf: [], regler: [], log: [] };
  const werte = { a_filter1_cutoff: 10, a_filter1_resonance: 0.5 };
  const ctx = { sende: (a, f) => { aus.sende.push({ a, f }); return aus.sende.length; }, warteQuittung: async () => ({ status: 3, grund: '' }), quelle: () => quelle, kiGestoppt: () => false,
    verteile: (e) => aus.verteilt.push(e), log: (z) => aus.log.push(z), baukasten: { geladen: () => geladen },
    host: { art: (g) => arten[g] ?? null, setzeRegler: async (pfad, nach) => { aus.regler.push([pfad, nach]); return true; },
      ruf: async (g, b) => { aus.ruf.push([g, b]); return b.befehl === 'ist' ? { ok: true, werte: { [b.namen[0]]: werte[b.namen[0]] } } : { ok: true, params: { Cutoff: 0.25, Volume: 0.5, 'Knob 3': 0.9 } }; } } };
  const lernen = lernenBereich(ctx, { ordner, geraeteKonfig: konfig });
  const host = hostlernenBereich(ctx, lernen, { ordner, surgeParameter: (n) => ({ a_filter1_cutoff: CUTOFF, a_filter1_resonance: RES })[n] });
  const routen = [...lernen.routen(), ...host.routen()];
  const server = http.createServer((q, a) => {
    const url = new URL(q.url, 'http://x');
    const r = routen.find((x) => x.methode === q.method && x.pfad === url.pathname);
    if (!r) { a.writeHead(404); a.end(); return; }
    Promise.resolve(r.handler(q, a, url));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const ruf = async (methode, p, body) => {
    const r = await fetch(url + p, methode === 'GET' ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    return { code: r.status, j: await r.json() };
  };
  return { ruf, aus, ordner, host, lernen, ctx };
}
const lerneFertig = (x, pfad, nr) => {   // the kern reports a capture for the current arming and the learn table gets the CC
  x.lernen.speicher.zuordne({ pfad, kanal: 1, nr });
};

test('POST /lernen/host: picks slot 1, sets the row to the current value (Surge: display -> travel), arms learning, answers {pfad}', async (t) => {
  const x = await aufbau(t);
  const r = await x.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'a_filter1_cutoff' });
  assert.deepEqual([r.code, r.j.ok, r.j.pfad], [200, true, 'erz/2/bk/1']);
  assert.deepEqual(x.aus.ruf[0], ['bass', { befehl: 'ist', namen: ['a_filter1_cutoff'] }]);
  assert.equal(x.aus.regler.length, 1);
  assert.equal(x.aus.regler[0][0], 'erz/2/bk/1');
  assert.ok(Math.abs(x.aus.regler[0][1] - 0.5) < 1e-9, 'display 10 is travel 0.5 on the punkte curve');
  assert.equal(x.aus.sende.filter((s) => s.a === '/k/lernen' && s.f.an === 1).length, 1, 'the kern is armed once');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(x.ordner, 'host_ziele.json'), 'utf8')).ziele, { 'erz/2/bk/1': { gruppe: 'bass', art: 'surge', name: 'a_filter1_cutoff' } });
  const g = await x.ruf('GET', '/lernen/host');
  assert.deepEqual(g.j.ziele, [{ pfad: 'erz/2/bk/1', kanal: 'erz/2', slot: 1, gruppe: 'bass', art: 'surge', name: 'a_filter1_cutoff', gelernt: false }]);
  assert.equal(g.j.wartet, 'erz/2/bk/1');
  lerneFertig(x, 'erz/2/bk/1', 74);
  assert.equal((await x.ruf('GET', '/lernen/host')).j.ziele[0].gelernt, true);
});

test('POST /lernen/host: the next parameter takes the next slot, the same parameter its own slot again, the other channel starts at 1; RB-338 reads params', async (t) => {
  const x = await aufbau(t);
  for (const [name, nr] of [['a_filter1_cutoff', 1], ['a_filter1_resonance', 2]]) {
    assert.equal((await x.ruf('POST', '/lernen/host', { kanal: 'erz/2', name })).j.pfad, `erz/2/bk/${nr}`);
    lerneFertig(x, `erz/2/bk/${nr}`, 70 + nr);
  }
  assert.equal((await x.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'a_filter1_cutoff' })).j.pfad, 'erz/2/bk/1', 're-learning keeps the slot');
  const rb = await x.ruf('POST', '/lernen/host', { kanal: 'erz/3', name: 'Cutoff' });
  assert.equal(rb.j.pfad, 'erz/3/bk/1');
  assert.deepEqual(x.aus.ruf.at(-1), ['melodie', { befehl: 'params' }]);
  assert.deepEqual(x.aus.regler.at(-1), ['erz/3/bk/1', 0.25]);
});

test('slot allocation: a graph knob learned earlier keeps its slot; 64 used slots refuse; a stale host row (no CC, not armed) is taken again', async (t) => {
  const x = await aufbau(t);
  x.lernen.speicher.zuordne({ pfad: 'erz/2/bk/1', kanal: 1, nr: 1 });   // an earlier graph assignment
  assert.equal((await x.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'a_filter1_cutoff' })).j.pfad, 'erz/2/bk/2');
  // armed again for another parameter: the first host row (armed, never learned) is stale and slot 2 is taken again
  await x.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'a_filter1_resonance' });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(x.ordner, 'host_ziele.json'), 'utf8')).ziele).sort(), ['erz/2/bk/2', 'erz/2/bk/3']);
  const y = await aufbau(t);
  for (let n = 1; n <= 64; n++) y.lernen.speicher.zuordne({ pfad: `erz/3/bk/${n}`, kanal: 1, nr: n });
  const voll = await y.ruf('POST', '/lernen/host', { kanal: 'erz/3', name: 'Cutoff' });
  assert.deepEqual([voll.code, voll.j.fehler], [409, 'keine_slots']);
  assert.equal(y.aus.sende.filter((s) => s.a === '/k/lernen').length, 0);
  assert.equal(y.aus.regler.length, 0);
});

test('64 slots: with 63 used the next parameter takes slot 64 on erz/2; host parameter Knob 64 is accepted on a plug-in host, Knob 65 refused', async (t) => {
  const x = await aufbau(t);
  for (let n = 1; n <= 63; n++) x.lernen.speicher.zuordne({ pfad: `erz/2/bk/${n}`, kanal: 1, nr: n });
  const r = await x.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'a_filter1_cutoff' });
  assert.deepEqual([r.code, r.j.pfad], [200, 'erz/2/bk/64']);
  assert.equal(x.aus.regler.at(-1)[0], 'erz/2/bk/64');
  const y = await aufbau(t, { arten: { bass: 'lv2', melodie: 'vst3:baukasten' } });
  const ok = await y.ruf('POST', '/lernen/host', { kanal: 'erz/3', name: 'Knob 64' });
  assert.deepEqual([ok.code, ok.j.fehler], [409, 'wirt'], 'the name passes the check; the fake host does not report Knob 64, which is the next refusal');
  const zu = await y.ruf('POST', '/lernen/host', { kanal: 'erz/3', name: 'Knob 65' });
  assert.deepEqual([zu.code, zu.j.fehler], [400, 'argument_ungueltig']);
});

test('refusals: Cypher 403, bad arguments 400, no host / grand piano / graph loaded / no MIDI input 409, nothing written or armed', async (t) => {
  const x = await aufbau(t, { quelle: 'cypher' });
  assert.deepEqual([(await x.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'a_filter1_cutoff' })).j.fehler], ['nur_andreas']);
  assert.equal((await x.ruf('POST', '/lernen/host/loeschen', { kanal: 'erz/2', name: 'a_filter1_cutoff' })).code, 403);
  const y = await aufbau(t, { arten: { bass: 'lv2', melodie: 'sfz:grand' } });
  const fehler = async (body) => { const r = await y.ruf('POST', '/lernen/host', body); return [r.code, r.j.fehler]; };
  assert.deepEqual(await fehler({ kanal: 'erz/4', name: 'x' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler({ kanal: 'erz/2' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler({ kanal: 'erz/2', name: 'nicht_da' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await fehler({ kanal: 'erz/3', name: 'Cutoff' }), [409, 'kein_wirt']);
  const z = await aufbau(t, { arten: { bass: 'vst3:rb338' } });
  assert.deepEqual([(await z.ruf('POST', '/lernen/host', { kanal: 'erz/3', name: 'Cutoff' })).j.fehler, (await z.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'Knob 1' })).code], ['kein_wirt', 400]);
  const g = await aufbau(t, { geladen: { 'erz/2': 'bass-sub' } });
  assert.equal((await g.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'a_filter1_cutoff' })).j.fehler, 'graph_geladen');
  const m = await aufbau(t, { midi: false });
  assert.equal((await m.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'a_filter1_cutoff' })).j.fehler, 'kein_midi_eingang');
  for (const s of [x, y, z, g, m]) { assert.equal(s.aus.sende.filter((e) => e.a === '/k/lernen').length, 0); assert.equal(s.aus.regler.length, 0); assert.equal(fs.existsSync(path.join(s.ordner, 'host_ziele.json')), false); }
});

test('POST /lernen/host/loeschen: removes the host mapping and the learn assignment of the slot; an armed but unlearned slot is disarmed; unknown is 404', async (t) => {
  const x = await aufbau(t);
  await x.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'a_filter1_cutoff' });
  lerneFertig(x, 'erz/2/bk/1', 74);
  const r = await x.ruf('POST', '/lernen/host/loeschen', { kanal: 'erz/2', name: 'a_filter1_cutoff' });
  assert.deepEqual([r.code, r.j.pfad], [200, 'erz/2/bk/1']);
  assert.deepEqual(x.lernen.speicher.lies().zuordnungen, []);
  assert.deepEqual((await x.ruf('GET', '/lernen/host')).j.ziele, []);
  assert.deepEqual([(await x.ruf('POST', '/lernen/host/loeschen', { kanal: 'erz/2', name: 'a_filter1_cutoff' })).code], [404]);
  await x.ruf('POST', '/lernen/host', { kanal: 'erz/2', name: 'a_filter1_resonance' });   // armed, never learned
  assert.equal(x.lernen.wartet(), 'erz/2/bk/1');
  const w = await x.ruf('POST', '/lernen/host/loeschen', { kanal: 'erz/2', name: 'a_filter1_resonance' });
  assert.equal(w.code, 200);
  assert.equal(x.lernen.wartet(), null);
});
