// Package 1.16 rest U3b T3b.2: the plan consumer of the acceptance (check/b116_send.mjs) against a fake server that counts requests per path.
// U5's hand tool and U7's page use the same rules (one /proj/aendern for a proj plan; one /regler per request, stop at the first refusal;
// a refusal sends nothing) and are tested against this consumer.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sendePlan } from '../check/b116_send.mjs';

async function fake(t, antwort = () => ({ code: 200, j: { ok: true } })) {
  const zaehler = {}, gesehen = [];
  const server = http.createServer(async (q, a) => {
    let roh = ''; for await (const c of q) roh += c;
    const body = roh ? JSON.parse(roh) : null;
    zaehler[q.url] = (zaehler[q.url] ?? 0) + 1;
    gesehen.push({ pfad: q.url, body, kopf: q.headers['x-djk-quelle'] });
    const r = antwort(q.url, body, gesehen.length);
    a.writeHead(r.code, { 'content-type': 'application/json' }); a.end(JSON.stringify(r.j));
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, zaehler, gesehen };
}
const PROJ = { weg: 'proj', befehle: [{ befehl: 'insert_werte_setzen', insert_id: 'i1', werte: { schwelle: -18 }, preset: 'werk:komp/drum-bus' }], label: 'Preset Drum Bus', uebersprungen: ['extsc'] };
const REGLER = { weg: 'regler', anfragen: [{ pfad: 'deck/1/komp/schwelle', nach: -10 }, { pfad: 'deck/1/komp/ratio', nach: 2 }, { pfad: 'deck/1/komp/mix', nach: 0.5 }], uebersprungen: [] };

test('sendePlan: a proj plan is one POST /proj/aendern with rev, label and commands', async (t) => {
  const s = await fake(t);
  const r = await sendePlan(s.url, PROJ, 7, { kopf: { 'x-djk-quelle': 'cypher' } });
  assert.deepEqual(s.zaehler, { '/proj/aendern': 1 });
  assert.deepEqual(s.gesehen[0].body, { rev: 7, label: 'Preset Drum Bus', befehle: PROJ.befehle });
  assert.equal(s.gesehen[0].kopf, 'cypher');
  assert.equal(r.ok, true); assert.equal(r.gesendet, 1);
});

test('sendePlan: a regler plan is one POST /regler per request, in order, with ab jetzt', async (t) => {
  const s = await fake(t);
  const r = await sendePlan(s.url, REGLER, 1);
  assert.deepEqual(s.zaehler, { '/regler': 3 });
  assert.deepEqual(s.gesehen.map((g) => g.body), REGLER.anfragen.map((a) => ({ ...a, ab: 'jetzt' })));
  assert.equal(r.ok, true); assert.equal(r.gesendet, 3);
});

test('sendePlan: stops at the first refusal of a regler plan (4xx and kern quittung status 6)', async (t) => {
  const s = await fake(t, (_p, body) => (body.pfad.endsWith('ratio') ? { code: 409, j: { fehler: 'abgelehnt' } } : { code: 200, j: {} }));
  const r = await sendePlan(s.url, REGLER, 1);
  assert.deepEqual(s.zaehler, { '/regler': 2 }, 'the third request is never sent');
  assert.equal(r.ok, false); assert.equal(r.gesendet, 2); assert.match(r.grund, /abgelehnt/);
  const s2 = await fake(t, (_p, body) => (body.pfad.endsWith('schwelle') ? { code: 200, j: { quittung: { status: 6, grund: 'bereich' } } } : { code: 200, j: {} }));
  const r2 = await sendePlan(s2.url, REGLER, 1);
  assert.deepEqual(s2.zaehler, { '/regler': 1 }); assert.equal(r2.ok, false); assert.match(r2.grund, /bereich/);
});

test('sendePlan: a refusal answer (4xx {fehler}) sends nothing', async (t) => {
  const s = await fake(t);
  for (const antwort of [{ code: 409, j: { fehler: 'kein_ziel', text: 'no instance' } }, { fehler: 'art_nicht_aktiv' }]) {
    const r = await sendePlan(s.url, antwort, 1);
    assert.equal(r.ok, false); assert.equal(r.gesendet, 0); assert.match(r.grund, /kein_ziel|art_nicht_aktiv/);
  }
  assert.deepEqual(s.zaehler, {}, 'no request of any path');
});

test('sendePlan: negative control, a plan without requests is ok and sends nothing; a refused proj plan is reported', async (t) => {
  const s = await fake(t, () => ({ code: 409, j: { fehler: 'rev_veraltet' } }));
  const leer = await sendePlan(s.url, { weg: 'regler', anfragen: [], uebersprungen: [] }, 1);
  assert.equal(leer.ok, true); assert.equal(leer.gesendet, 0); assert.deepEqual(s.zaehler, {});
  const nein = await sendePlan(s.url, PROJ, 1);
  assert.equal(nein.ok, false); assert.equal(nein.gesendet, 1); assert.match(nein.grund, /rev_veraltet/);
});
