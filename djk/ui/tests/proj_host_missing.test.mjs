// Paket 1.18 (Erhebung 2026-10-20): ohne den Produktions-Wirt arr1 (Status-Datei wirt-arr1.json, geschrieben von djk-instrumente --arr1) lehnt jeder
// Weg, der einfrieren müsste, mit 409 wirt_fehlt ab, bevor Sperre, Tempo-Angleichung oder Kern-Befehl geschehen. Vorher entstand eine leere Freeze-Datei.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { stapel, hole, post } from './support/media_library.mjs';
import { alsAntwort } from '../areas/proj/output.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { starteWirtProzess, schreibeWirtStatus, totePid } from './support/host_process.mjs';

async function ruf(f) {
  try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); }
}

test('wirt_fehlt: /proj/freeze ohne Wirt arr1 → 409 mit Text, nichts gesendet, keine Sperre, kein Lauf; mit Wirt wie bisher', async (t) => {
  const a = await aufbau(t, { tempo: 120, mitWirt: false });
  const r = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([r.code, r.body.fehler], [409, 'wirt_fehlt']);
  assert.match(r.body.text, /production slot 1 is not running; start it with djk-instrumente --arr1$/);
  assert.ok(GRUND_TEXT.wirt_fehlt.includes('arr1') && GRUND_TEXT.wirt_fehlt.includes('arr2'), 'auch der Rückfalltext in http/reasons.ts steht (1.9: beide Slots)');
  assert.ok(GRUND_TEXT.wirt_fehler.includes('arr1') && GRUND_TEXT.wirt_fehler.includes('arr2'), '1.9: the text of wirt_fehler');
  assert.equal(a.freezes().length, 0, 'kein /k/arr/freeze');
  assert.deepEqual(a.protokoll.reihenfolge, [], 'weder Sperre noch Tempo-Angleichung');
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  assert.equal(a.lead().freeze, null, 'nichts gespeichert');
  // der Wirt startet: dieselbe Anfrage geht durch
  schreibeWirtStatus(a.wirtDir, { pid: (await starteWirtProzess(t)).pid });
  const ok = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.ok(a.lead().freeze);
});

test('wirt_fehlt: Export und Lautheit mit Surge-Spur ohne Freeze lehnen ab; ohne Surge-Spur und beim Verwerfen eines Freeze braucht es den Wirt nicht', async (t) => {
  const a = await aufbau(t, { tempo: 120, mitWirt: false });
  assert.equal((await ruf(() => a.ausgabe.exportiere({}))).body.fehler, 'wirt_fehlt');
  assert.equal((await ruf(() => a.ausgabe.lautheit({}))).body.fehler, 'wirt_fehlt');
  assert.equal(a.freezes().length, 0);
  assert.equal(a.ausgabe.zustand().lauf, null);
  // Negativ-Kontrolle: ohne Surge-Spur gibt es nichts einzufrieren, der Export geht ohne Wirt
  await a.aendern([{ befehl: 'spur_loeschen', spur_id: 's3' }], 'Lead weg');
  const ex = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(ex.code, 200, JSON.stringify(ex.body));
  // Negativ-Kontrolle: ein Freeze verwerfen ist kein Echtzeit-Durchlauf
  const b = await aufbau(t, { tempo: 120 });
  assert.equal((await ruf(() => b.ausgabe.freeze({ spur_id: 's3', an: true }))).code, 200);
  fs.rmSync(path.join(b.wirtDir, 'wirt-arr1.json'));
  assert.equal((await ruf(() => b.ausgabe.freeze({ spur_id: 's3', an: false }))).code, 200, 'Unfreeze ohne Wirt');
});

// S3-Fix W2 (Review 2026-10-20): host.py löscht seine Status-Datei nie, djk-stop auch nicht. Nach einem Stopp liegt sie mit bereit:true und toter pid
// da; beim Start steht bereit:false. Nur eine Datei mit bereit:true, deren pid lebt und host.py heißt, gilt als Wirt.
test('wirt_fehlt: Datei fehlt, bereit false, tote pid, fremder Prozess → 409; nur bereit true mit lebender host.py-pid geht durch', async (t) => {
  const a = await aufbau(t, { tempo: 120, mitWirt: false });
  const frage = () => ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  const grund = async () => (await frage()).body.fehler;
  assert.equal(await grund(), 'wirt_fehlt', 'Datei fehlt');
  const lebt = await starteWirtProzess(t);
  schreibeWirtStatus(a.wirtDir, { pid: lebt.pid, bereit: false });
  assert.equal(await grund(), 'wirt_fehlt', 'bereit false, pid lebt');
  schreibeWirtStatus(a.wirtDir, { pid: await totePid(t), bereit: true });
  assert.equal(await grund(), 'wirt_fehlt', 'bereit true, pid tot (Zustand nach djk-stop)');
  const fremd = await starteWirtProzess(t, { programm: 'anderes.py' });
  schreibeWirtStatus(a.wirtDir, { pid: fremd.pid, bereit: true });
  assert.equal(await grund(), 'wirt_fehlt', 'bereit true, pid lebt, aber ein anderes Programm (wiederverwendete pid)');
  fs.writeFileSync(path.join(a.wirtDir, 'wirt-arr1.json'), '{kaputt');
  assert.equal(await grund(), 'wirt_fehlt', 'Datei kein JSON');
  fs.writeFileSync(path.join(a.wirtDir, 'wirt-arr1.json'), JSON.stringify({ bereit: true, pid: 'x' }));
  assert.equal(await grund(), 'wirt_fehlt', 'pid keine Zahl');
  assert.equal(a.freezes().length, 0, 'in keinem Fall ein Kern-Befehl');
  schreibeWirtStatus(a.wirtDir, { pid: lebt.pid, bereit: true });
  const ok = await frage();
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.ok(a.lead().freeze, 'Negativ-Kontrolle: bereit true und lebende host.py-pid → der Freeze läuft');
});

// 1.9 T3.2 (AK-W4): the host check per slot. Helper: a second Surge track s4 (slot 2) with a note, the core has loaded the playback of it.
async function mitZweiterSurge(t, opt = {}) {
  const a = await aufbau(t, { tempo: 120, mitWirt: false, ...opt });
  await a.aendern([
    { befehl: 'spur_neu', art: 'instrument', name: 'Lead 2', geraet: { art: 'wirt' } },
    { befehl: 'clip_neu', spur_id: 's4', art: 'midi', start_beat: 8, laenge_beats: 8, noten: [{ beat: 0, laenge: 1, ton: 72, vel: 90 }] },
  ], 'Surge two');
  assert.equal(a.projekt().spuren.find((x) => x.id === 's4').geraet.slot, 2);
  assert.ok(await warteBis(() => a.zustand.kernNr === a.projekt().wiedergabe_rev, 5000), 'the core loaded the playback');
  a.protokoll.gesendet.length = 0; a.protokoll.reihenfolge.length = 0;
  return a;
}
const frage = (a, id) => ruf(() => a.ausgabe.freeze({ spur_id: id, an: true }));

test('AK-W4 wirt_fehlt per slot: only arr1 running -> the slot-1 track freezes, the slot-2 track is refused naming --arr2 (and not the other way round)', async (t) => {
  const a = await mitZweiterSurge(t);
  schreibeWirtStatus(a.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid });
  const z = await frage(a, 's4');
  assert.deepEqual([z.code, z.body.fehler], [409, 'wirt_fehlt']);
  assert.match(z.body.text, /production slot 2 is not running; start it with djk-instrumente --arr2$/);
  assert.equal(a.freezes().length, 0, 'the refusal came before any core command');
  assert.equal((await frage(a, 's3')).code, 200, 'slot 1 is alive: its track freezes');
  assert.equal(a.freezes().length, 1);
  // only arr2 running: the other way round
  const b = await mitZweiterSurge(t);
  schreibeWirtStatus(b.wirtDir, { slot: 2, pid: (await starteWirtProzess(t)).pid });
  const e1 = await frage(b, 's3');
  assert.deepEqual([e1.code, e1.body.fehler], [409, 'wirt_fehlt']);
  assert.match(e1.body.text, /--arr1$/);
  assert.equal((await frage(b, 's4')).code, 200, 'slot 2 alive: its track freezes');
});

test('AK-W4 wirt_fehler: a dead host whose status file holds a fatal entry is refused wirt_fehler quoting it; non-fatal entries never refuse (negative control)', async (t) => {
  const a = await mitZweiterSurge(t);
  const tot = await totePid(t);
  schreibeWirtStatus(a.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid });
  schreibeWirtStatus(a.wirtDir, { slot: 2, pid: tot, fehler: ['add_plugin: x'] });
  const r = await frage(a, 's4');
  assert.deepEqual([r.code, r.body.fehler], [409, 'wirt_fehler']);
  assert.match(r.body.text, /add_plugin: x/); assert.match(r.body.text, /djk-instrumente --arr2/);
  for (const f of ['engine_init: e', 'vst3: p fehlt', 'sfz: 2 Mängel', 'steuerung: KeyError: k']) {
    schreibeWirtStatus(a.wirtDir, { slot: 2, pid: tot, fehler: ['wache: w', f] });
    const g = await frage(a, 's4');
    assert.equal(g.body.fehler, 'wirt_fehler', f); assert.ok(g.body.text.includes(f), `quotes ${f}`);
  }
  // non-fatal entries of a dead host: still wirt_fehlt (the generic refusal)
  schreibeWirtStatus(a.wirtDir, { slot: 2, pid: tot, fehler: ['aktiv-klang: x', 'wache: y', 'bereiche: z'] });
  assert.equal((await frage(a, 's4')).body.fehler, 'wirt_fehlt', 'a dead host with only non-fatal entries');
  // negative control: a LIVE host passes whatever its fehler holds
  schreibeWirtStatus(a.wirtDir, { slot: 2, pid: (await starteWirtProzess(t)).pid, fehler: ['aktiv-klang: x'] });
  const ok = await frage(a, 's4');
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(a.freezes().length, 1);
  // negative control: even a live host with a fatal-looking entry is not refused (the entry is shown in proj_lage only)
  schreibeWirtStatus(a.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid, fehler: ['add_plugin: stale'] });
  assert.equal((await frage(a, 's3')).code, 200);
});

test('AK-W4 export and loudness check the slots of the tracks they must freeze, before the first freeze', async (t) => {
  const a = await mitZweiterSurge(t);
  schreibeWirtStatus(a.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid });
  for (const was of ['exportiere', 'lautheit']) {
    const r = await ruf(() => a.ausgabe[was]({}));
    assert.deepEqual([r.code, r.body.fehler], [409, 'wirt_fehlt'], was);
    assert.match(r.body.text, /--arr2$/);
    assert.equal(a.freezes().length, 0, `${was}: the slot-1 track was NOT frozen before the slot-2 host was found missing`);
    assert.equal(a.projekt().spuren.find((x) => x.id === 's3').freeze, null, 'nothing stored');
  }
  // both hosts alive: the export freezes both tracks (negative control)
  schreibeWirtStatus(a.wirtDir, { slot: 2, pid: (await starteWirtProzess(t)).pid });
  const ex = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(ex.code, 200, JSON.stringify(ex.body));
  assert.equal(a.freezes().length, 2, 'both Surge tracks frozen');
});

test('proj_lage shows wirte per slot: laeuft and the fehler entries (also the non-fatal ones)', async (t) => {
  const a = await mitZweiterSurge(t);
  const { wirtLage } = await import('../areas/proj/host.ts');
  schreibeWirtStatus(a.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid, fehler: ['aktiv-klang: x'] });
  schreibeWirtStatus(a.wirtDir, { slot: 2, pid: await totePid(t), fehler: ['add_plugin: y'] });
  assert.deepEqual(wirtLage(a.wirtDir), { 1: { laeuft: true, fehler: ['aktiv-klang: x'] }, 2: { laeuft: false, fehler: ['add_plugin: y'] } });
  fs.rmSync(path.join(a.wirtDir, 'wirt-arr2.json'));
  assert.deepEqual(wirtLage(a.wirtDir)[2], { laeuft: false, fehler: [] }, 'no file: not running, no entries');
});

test('GET /proj/aktuell?noten=zahl (proj_lage) carries wirte from the status files of the server; the page view and ?nur=rev do not', async (t) => {
  const { o, url } = await stapel(t);
  const ordner = o.wirtBasis();
  assert.equal((await post(url, '/proj/neu', { name: 'Wirte' })).code, 200);
  const lage = async (q) => (await hole(url, `/proj/aktuell${q}`)).j;
  assert.deepEqual((await lage('?noten=zahl')).wirte, { 1: { laeuft: false, fehler: [] }, 2: { laeuft: false, fehler: [] } }, 'no status files');
  schreibeWirtStatus(ordner, { slot: 1, pid: (await starteWirtProzess(t)).pid, fehler: ['wache: w'] });
  schreibeWirtStatus(ordner, { slot: 2, pid: await totePid(t), fehler: ['add_plugin: x'] });
  assert.deepEqual((await lage('?noten=zahl')).wirte, { 1: { laeuft: true, fehler: ['wache: w'] }, 2: { laeuft: false, fehler: ['add_plugin: x'] } });
  assert.equal('wirte' in (await lage('')), false, 'the page view stays as it was');
  assert.equal('wirte' in (await lage('?nur=rev')), false);
});

// 1.9 U3, acceptance run u3-abnahme-2 (W2c): an export that has to freeze TWO tracks started the second freeze right after the first one was stored, while
// the last report of the core still said "freeze running" (the report "stopped" follows the /e/freeze event by a moment), and refused with transport_laeuft
// after the first track was already frozen. With one Surge track there is no second freeze, so the race never showed.
test('two freezes in a row: the second waits for the core to report stopped again (export and loudness), a real transport is still refused', async (t) => {
  for (const was of ['exportiere', 'lautheit']) {
    const a = await mitZweiterSurge(t, { kern: { art: 'ok', spaetMs: 250 } });
    schreibeWirtStatus(a.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid });
    schreibeWirtStatus(a.wirtDir, { slot: 2, pid: (await starteWirtProzess(t)).pid });
    const r = await ruf(() => a.ausgabe[was]({}));
    assert.equal(r.code, 200, `${was}: ${JSON.stringify(r.body)}`);
    assert.equal(a.freezes().length, 2, `${was}: both Surge tracks frozen`);
    assert.ok(a.projekt().spuren.filter((x) => x.geraet?.art === 'wirt').every((x) => x.freeze), `${was}: both carry a freeze`);
  }
  // negative control: a transport that really runs (status 2, never going back) is still refused with transport_laeuft, after the bounded wait
  const b = await mitZweiterSurge(t, { kern: { art: 'ok' } });
  schreibeWirtStatus(b.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid });
  schreibeWirtStatus(b.wirtDir, { slot: 2, pid: (await starteWirtProzess(t)).pid });
  b.zustand.kernStatus = 2; b.arrMeldung();
  const z = await ruf(() => b.ausgabe.exportiere({}));
  assert.deepEqual([z.code, z.body.fehler], [409, 'transport_laeuft']);
  assert.equal(b.freezes().length, 0);
});

// 1.9 T12 (acceptance wirte, W1a, W4a, W4i): proj_freeze for a second track right after the first one answered 409 transport_laeuft, because the
// report "stopped" of the core follows the answer by a moment. Only proj_export waited between its own freezes. A freeze (and export, bounce) now waits
// for the stop report when a freeze of this server ended a moment ago; a transport that is running without our freeze gives 409 at once.
test('two proj_freeze calls in a row: the second waits for the stop report; a running transport is still refused at once', async (t) => {
  const a = await mitZweiterSurge(t, { kern: { art: 'ok', spaetMs: 250 } });
  schreibeWirtStatus(a.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid });
  schreibeWirtStatus(a.wirtDir, { slot: 2, pid: (await starteWirtProzess(t)).pid });
  const f1 = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  const f2 = await ruf(() => a.ausgabe.freeze({ spur_id: 's4', an: true }));
  assert.deepEqual([f1.code, f2.code], [200, 200], JSON.stringify(f2.body));
  assert.equal(a.freezes().length, 2);
  // error case: a transport nobody froze for (status 2) is refused without any wait, for freeze, export and bounce
  const b = await mitZweiterSurge(t, { kern: { art: 'ok' } });
  schreibeWirtStatus(b.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid });
  schreibeWirtStatus(b.wirtDir, { slot: 2, pid: (await starteWirtProzess(t)).pid });
  b.zustand.kernStatus = 2; b.arrMeldung();
  const t0 = Date.now();
  const z = await ruf(() => b.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([z.code, z.body.fehler], [409, 'transport_laeuft']);
  assert.ok(Date.now() - t0 < 500, `refused at once, not after a wait (${Date.now() - t0} ms)`);
  // control: a transport that really runs right after OUR freeze is refused after the bounded wait
  const c = await mitZweiterSurge(t, { kern: { art: 'ok' } });
  schreibeWirtStatus(c.wirtDir, { slot: 1, pid: (await starteWirtProzess(t)).pid });
  schreibeWirtStatus(c.wirtDir, { slot: 2, pid: (await starteWirtProzess(t)).pid });
  assert.equal((await ruf(() => c.ausgabe.freeze({ spur_id: 's3', an: true }))).code, 200);
  c.zustand.kernStatus = 2; c.arrMeldung();
  const y = await ruf(() => c.ausgabe.freeze({ spur_id: 's4', an: true }));
  assert.deepEqual([y.code, y.body.fehler], [409, 'transport_laeuft']);
});
