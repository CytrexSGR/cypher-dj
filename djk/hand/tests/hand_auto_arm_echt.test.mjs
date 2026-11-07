// 1.12 automation slice 3 task 10, AK15 on the real stack: the REAL hand (stdio) against the REAL page server (stand-in core, instance f to i).
// Part 1, HTTP with the source cypher: arm, mode, disarm-all, gesture and override are 403 nur_andreas and change nothing (arm state, override list, lane points, no
// command to the core); Andreas' arm works (control). Part 2, the real hand through a logging proxy: every call must REACH the server (a request is seen, the answer
// comes back) and the hand has no path to arm, gesture or override: the proxy sees none of those routes, the state stays, the core gets no arm and no override command.
// Mutation: AK15_HAND_TOTER_PORT=1 points the hand at a dead port; this test must go red then (checked in the task report).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const HAND = path.resolve(HIER, '..', 'hand.ts');
const OB = path.resolve(HIER, '..', '..', 'oberflaeche', 'tests', 'hilfen');
process.env.CYPHERDJ_TEST_INSTANZ ??= 'f';
const { stapel } = await import(path.join(OB, 'mediathek.mjs'));
const { ruf, warte, CYPHER, anKern } = await import(path.join(OB, 'proj_stapel.mjs'));

// a proxy in front of the page server that records every request the hand sends (method, path, source header, body, answer code)
function proxy(t, ziel) {
  const gesehen = [];
  const s = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; });
    q.on('end', async () => {
      const r = await fetch(ziel + q.url, { method: q.method, headers: { 'content-type': 'application/json', 'x-djk-quelle': String(q.headers['x-djk-quelle'] ?? '') },
        ...(q.method === 'GET' ? {} : { body: b }) });
      const text = await r.text();
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: b ? JSON.parse(b) : null, code: r.status });
      a.writeHead(r.status, { 'content-type': 'application/json' }); a.end(text);
    });
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => { t.after(() => s.close()); ok({ gesehen, port: s.address().port }); }));
}

test('AK15 (real hand, real server): Cypher arm, gesture and override are 403 nur_andreas and change nothing; the hand reaches the server and has no path to them', async (t) => {
  const { url, log } = await stapel(t);
  const neu = await ruf(url, 'POST', '/proj/neu', { name: 'AK15' });
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: neu.j.projekt.rev, label: 'setup', befehle: [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'spur_neu', art: 'audio' },
    { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader', punkte: [{ beat: 0, wert: -6 }, { beat: 64, wert: -6 }] }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const tr = await ruf(url, 'POST', '/proj/transport', { aktion: 'start', beat: 0 });
  assert.equal(tr.code, 200, JSON.stringify(tr.j));
  await warte(600);
  const zustand = async () => {
    const x = (await ruf(url, 'GET', '/proj/aktuell')).j;
    return JSON.stringify({ arm: x.auto_arm ?? null, ueber: x.auto_uebersteuert ?? [], lanes: x.projekt.spuren.map((s) => s.automation ?? []) });
  };
  const kernBefehle = (ad) => anKern(log, ad).length;
  const z0 = await zustand(), arm0 = kernBefehle('/k/arr/arm'), auto0 = kernBefehle('/k/arr/auto');
  const lane0 = (await ruf(url, 'GET', '/proj/auto?lane_id=a1&punkte_max=100')).j.punkte;

  // part 1: Cypher over HTTP, every route, every body form
  const faelle = [['/proj/auto/arm', { spur_id: 's1', an: true, modus: 'touch' }], ['/proj/auto/arm', { modus: 'write' }], ['/proj/auto/arm', { alle: true }],
    ['/proj/auto/geste', { spur_id: 's1', ziel: 'fader', wert: -3 }], ['/proj/auto/geste', { spur_id: 's1', ziel: 'fader', ende: true }], ['/proj/auto/uebersteuern', { spur_id: 's1', ziel: 'fader' }]];
  for (const [pfad, koerper] of faelle) {
    const r = await ruf(url, 'POST', pfad, koerper, CYPHER);
    assert.equal(r.code, 403, `${pfad} ${JSON.stringify(r.j)}`);
    assert.equal(r.j.fehler, 'nur_andreas', `${pfad}`);
    console.log(`# AK15 ${pfad} ${JSON.stringify(koerper)} -> ${r.code} ${JSON.stringify(r.j)}`);
  }
  await warte(300);
  assert.equal(await zustand(), z0, 'arm state, override list and lanes are unchanged after every refused request');
  assert.deepEqual((await ruf(url, 'GET', '/proj/auto?lane_id=a1&punkte_max=100')).j.punkte, lane0, 'the lane points are unchanged');
  // the arm and gesture routes stop at the server; the override route passes the request on and the CORE refuses it (second lock, quittung 6 nur_andreas)
  assert.equal(kernBefehle('/k/arr/arm'), arm0, 'no arm command reached the core');
  const ue = anKern(log, '/k/arr/auto').slice(auto0);
  assert.deepEqual(ue.map((x) => [x.felder.quelle, x.felder.an]).map(([q, an]) => [String(q), Number(an)]), [['cypher', 0]], 'the one override request that reached the core carries the source cypher and an 0, and the core refused it (403 above)');
  // control: Andreas arms (the refusals are not a broken route)
  const ok = await ruf(url, 'POST', '/proj/auto/arm', { spur_id: 's1', an: true, modus: 'touch' });
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  assert.deepEqual((await ruf(url, 'GET', '/proj/aktuell')).j.auto_arm, { modus: 'touch', spuren: ['s1'] });
  assert.ok(kernBefehle('/k/arr/arm') > arm0, 'control: the core command counter does move for Andreas');
  const r2 = await ruf(url, 'POST', '/proj/auto/arm', { spur_id: 's2', an: true, modus: 'write' }, CYPHER);
  assert.deepEqual([r2.code, r2.j.fehler], [403, 'nur_andreas']);
  assert.deepEqual((await ruf(url, 'GET', '/proj/aktuell')).j.auto_arm, { modus: 'touch', spuren: ['s1'] }, 'neither the track nor the mode changed');

  // part 2: the real hand through the proxy
  const z1 = await zustand(), arm1 = kernBefehle('/k/arr/arm'), uebe1 = anKern(log, '/k/arr/auto').filter((x) => Number(x.felder.an) === 0).length;
  const px = await proxy(t, url);
  const seite = process.env.AK15_HAND_TOTER_PORT ? 'http://127.0.0.1:9' : `http://127.0.0.1:${px.port}`;   // the mutation: a dead port
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', seite] }));
  t.after(() => c.close());
  const namen = (await c.listTools()).tools.map((x) => x.name);
  assert.deepEqual(namen.filter((n) => /arm|geste|uebersteuer/.test(n)), []);
  const wirkt = async (name, arguments_, erwartet) => {
    const n = px.gesehen.length;
    const r = await c.callTool({ name, arguments: arguments_ });
    const neue = px.gesehen.slice(n);
    assert.ok(neue.length >= 1, `${name}: the call reached the server (${neue.length} requests seen)`);
    assert.ok(neue.every((x) => x.quelle === 'cypher'), `${name}: source cypher`);
    erwartet(r, neue);
    return neue;
  };
  // re_enable with smuggled arm arguments: reaches /proj/auto/re_enable, answers 200, nothing else goes out
  await wirkt('proj_auto_zustand', { re_enable: true, arm: true, an: false, modus: 'write' }, (r, neue) => {
    assert.ok(!r.isError, r.content[0].text);
    assert.deepEqual(neue.map((x) => [x.pfad, x.koerper, x.code]), [['/proj/auto/re_enable', { alle: true }, 200]]);
  });
  // the only hand path to a track fader is refused: ueber_projekt, no grip, no override
  await wirkt('regler', { pfad: 'spur/1/fader', nach: 0.3 }, (r, neue) => {
    assert.equal(r.isError, true, r.content[0].text); assert.match(r.content[0].text, /ueber_projekt/);
    assert.deepEqual(neue.map((x) => x.pfad), ['/regler']);
  });
  // the audio arm of spur_aendern is not the automation arm
  const rev = (await ruf(url, 'GET', '/proj/aktuell?nur=rev')).j.rev;
  await wirkt('proj_aendern', { rev, label: 'audio arm', befehle: [{ befehl: 'spur_aendern', spur_id: 's2', arm: true }] }, (r, neue) => {
    assert.match(neue[0].pfad, /^\/proj\/aendern/);
    console.log(`# AK15 hand spur_aendern arm (audio arm) -> ${r.isError ? 'error ' : ''}${r.content[0].text.slice(0, 100)}`);
  });
  await warte(400);
  assert.ok(!px.gesehen.some((x) => /\/proj\/auto\/(arm|geste|uebersteuern)/.test(x.pfad)), 'the hand sent nothing to the arm, gesture or override routes');
  assert.equal(await zustand(), z1, 'nothing the hand sent changed the arm state, the override list or a lane');
  assert.equal(kernBefehle('/k/arr/arm'), arm1, 'the hand caused no arm command in the core');
  assert.equal(anKern(log, '/k/arr/auto').filter((x) => Number(x.felder.an) === 0).length, uebe1, 'the hand caused no override command (an 0) in the core; its re-enable (an 1) is expected');
});
