// A restart of the page server reopens the project that was open last. The server writes the slug of the open project to offenes_projekt.json in the
// hotcue folder (next to neustart_stand.json, same atomic write) whenever a project is opened and clears it when a project is closed on purpose
// (POST /proj/schliessen). On start it opens that slug through the same code path as POST /proj/oeffnen, once, and never starts a transport.
// Stack of the neighbours (tests/support/media_library.mjs): page server plus kern stand-in on the ports of the test instance, a second server on the same folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { TEST_INSTANZ } from './support/instance.mjs';
import { stapel } from './support/media_library.mjs';
import { bis, ruf as rufRoh, anKern } from './support/proj_stack.mjs';
// a kept-alive socket to the stopped server would fail the next request: close every connection
const ruf = (url, m, p, k, kopf = {}) => rufRoh(url, m, p, k, { connection: 'close', ...kopf });

const DATEI = 'offenes_projekt.json';

// The second life of the page server: same folders, same kern stand-in. Stops the one before (idempotent), starts the next and waits for its reopen.
async function neuerLauf(t, st, vor, { vorStart } = {}) {
  await vor.o.stoppe();
  vorStart?.();
  const log = [];
  // the server of this second life must never be the live studio: stapel(t) set the test instance for this test, keep it so (pin: stack_instance.test.mjs)
  if (process.env.CYPHERDJ_INSTANZ !== TEST_INSTANZ) process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  const o = new Oberflaeche({ ...st.optionen, log: (z) => log.push(z) });
  await o.starte();
  t.after(() => o.stoppe());
  await o.projektWieder;
  return { o, log };
}
const lies = (st) => ruf(st.url, 'GET', '/proj/aktuell');
const datei = (st) => path.join(st.optionen.hotcueOrdner, DATEI);
const starts = (log) => anKern(log, '/k/arr/start');

test('open a project, restart the server: the project is open again and the transport stays stopped', async (t) => {
  const st = await stapel(t);
  const n = await ruf(st.url, 'POST', '/proj/neu', { name: 'Remember Me' });
  assert.equal(n.code, 200, JSON.stringify(n.j));
  assert.equal(JSON.parse(fs.readFileSync(datei(st), 'utf8')).slug, 'remember-me', 'written at the open');
  assert.deepEqual(fs.readdirSync(st.optionen.hotcueOrdner).filter((f) => f.endsWith('.neu')), [], 'atomic write leaves no temp file');
  const l2 = await neuerLauf(t, st, st);
  assert.equal((await lies(st)).j.slug, 'remember-me', 'reopened by the second server');
  assert.equal(l2.log.filter((z) => z.typ === 'proj_offen').length, 1, 'exactly one open');
  assert.equal(starts(l2.log).length, 0, 'no transport start was sent');
  assert.ok(l2.log.some((z) => z.typ === 'projekt_wieder_geoeffnet' && z.slug === 'remember-me'));
  const a = l2.o.proj.sitzung.lage.arr;
  assert.ok(!a || (a.status !== 1 && a.status !== 2), 'the transport is not running');
  assert.equal((await ruf(st.url, 'GET', '/ansage')).j.ansage, null, 'no notice');
});

test('close the project on purpose, restart: nothing is open and nothing is remembered', async (t) => {
  const st = await stapel(t);
  await ruf(st.url, 'POST', '/proj/neu', { name: 'Gone' });
  assert.ok(fs.existsSync(datei(st)));
  const c = await ruf(st.url, 'POST', '/proj/schliessen', {});
  assert.deepEqual([c.code, c.j.slug], [200, 'gone']);
  assert.equal((await lies(st)).j.slug, null);
  assert.equal(fs.existsSync(datei(st)), false, 'the memory is cleared');
  const l2 = await neuerLauf(t, st, st);
  assert.equal((await lies(st)).j.slug, null);
  assert.equal(l2.log.filter((z) => z.typ === 'proj_offen').length, 0);
  assert.equal((await ruf(st.url, 'POST', '/proj/schliessen', {})).j.slug, null, 'closing with nothing open is a no-op');
});

test('the remembered project no longer exists: the server starts empty, logs one line and exposes a short notice', async (t) => {
  const st = await stapel(t);
  await ruf(st.url, 'POST', '/proj/neu', { name: 'Vanishing' });
  const l2 = await neuerLauf(t, st, st, { vorStart: () => fs.rmSync(path.join(st.optionen.proj.wurzel, 'vanishing'), { recursive: true, force: true }) });
  assert.equal((await lies(st)).j.slug, null);
  const z = l2.log.filter((x) => x.typ === 'projekt_wieder_oeffnen_fehlgeschlagen');
  assert.equal(z.length, 1);
  assert.equal(z[0].slug, 'vanishing');
  assert.equal(typeof z[0].grund, 'string');
  const ansage = (await ruf(st.url, 'GET', '/ansage')).j.ansage;
  assert.equal(ansage.text, 'Could not reopen project vanishing');
  assert.equal(starts(l2.log).length, 0);
});

test('a garbage file means nothing is remembered: the server starts empty without a crash and without a notice', async (t) => {
  const st = await stapel(t);
  await ruf(st.url, 'POST', '/proj/neu', { name: 'Fine' });
  const falsch = ['{kaputt', '[1]', '"x"', JSON.stringify({ v: 2, slug: 'fine' }), JSON.stringify({ v: 1 }), JSON.stringify({ v: 1, slug: 7 }),
    JSON.stringify({ v: 1, slug: '../fine' }), JSON.stringify({ v: 1, slug: 'a/b' }), JSON.stringify({ v: 1, slug: '' }), ''];
  let vor = st;
  for (const inhalt of falsch) {
    const l = await neuerLauf(t, st, vor, { vorStart: () => fs.writeFileSync(datei(st), inhalt) });
    assert.equal((await lies(st)).j.slug, null, `garbage ${inhalt}`);
    assert.equal(l.log.filter((z) => z.typ === 'proj_offen' || z.typ === 'projekt_wieder_oeffnen_fehlgeschlagen').length, 0, `garbage ${inhalt}`);
    assert.equal((await ruf(st.url, 'GET', '/ansage')).j.ansage, null);
    vor = l;
  }
});

test('project B opened after A: after a restart B is open (the last one wins)', async (t) => {
  const st = await stapel(t);
  await ruf(st.url, 'POST', '/proj/neu', { name: 'Alpha' });
  await ruf(st.url, 'POST', '/proj/neu', { name: 'Beta' });
  await ruf(st.url, 'POST', '/proj/oeffnen', { slug: 'alpha' });
  assert.equal(JSON.parse(fs.readFileSync(datei(st), 'utf8')).slug, 'alpha');
  await ruf(st.url, 'POST', '/proj/oeffnen', { slug: 'beta' });
  const l2 = await neuerLauf(t, st, st);
  assert.equal((await lies(st)).j.slug, 'beta');
  assert.equal(l2.log.filter((z) => z.typ === 'proj_offen').length, 1);
});

test('a refused open (unknown slug) does not overwrite the memory', async (t) => {
  const st = await stapel(t);
  await ruf(st.url, 'POST', '/proj/neu', { name: 'Keep' });
  assert.equal((await ruf(st.url, 'POST', '/proj/oeffnen', { slug: 'gibt-es-nicht' })).code, 404);
  assert.equal(JSON.parse(fs.readFileSync(datei(st), 'utf8')).slug, 'keep');
});

test('no kern within the wait: the server starts empty, logs the failure and shows the notice', async (t) => {
  const st = await stapel(t);
  await ruf(st.url, 'POST', '/proj/neu', { name: 'Waiting' });
  await st.o.stoppe();
  const log = [];
  // the server of this second life must never be the live studio: stapel(t) set the test instance for this test, keep it so (pin: stack_instance.test.mjs)
  if (process.env.CYPHERDJ_INSTANZ !== TEST_INSTANZ) process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  // a kern port nobody listens on; the wait for the kern is cut to 300 ms
  const o = new Oberflaeche({ ...st.optionen, kernPort: st.optionen.kernPort + 60, aboPort: st.optionen.aboPort + 60, wiederOeffnenFristMs: 300, log: (z) => log.push(z) });
  await o.starte();
  t.after(() => o.stoppe());
  await o.projektWieder;
  assert.equal(o.proj.sitzung.offen, null);
  assert.equal(log.filter((z) => z.typ === 'projekt_wieder_oeffnen_fehlgeschlagen' && z.grund === 'kein_kern').length, 1);
  assert.equal(o.ansageZeile.text, 'Could not reopen project waiting');
  assert.ok(await bis(() => true));
});
