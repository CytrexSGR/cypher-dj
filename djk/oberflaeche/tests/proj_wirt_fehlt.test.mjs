// Paket 1.18 (Erhebung 2026-10-20): ohne den Produktions-Wirt arr1 (Status-Datei wirt-arr1.json, geschrieben von djk-instrumente --arr1) lehnt jeder
// Weg, der einfrieren müsste, mit 409 wirt_fehlt ab, bevor Sperre, Tempo-Angleichung oder Kern-Befehl geschehen. Vorher entstand eine leere Freeze-Datei.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './hilfen/ausgabe_aufbau.mjs';
import { alsAntwort } from '../bereiche/proj/ausgabe.ts';
import { GRUND_TEXT } from '../http/gruende.ts';
import { starteWirtProzess, schreibeWirtStatus, totePid } from './hilfen/wirt_prozess.mjs';

async function ruf(f) {
  try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); }
}

test('wirt_fehlt: /proj/freeze ohne Wirt arr1 → 409 mit Text, nichts gesendet, keine Sperre, kein Lauf; mit Wirt wie bisher', async (t) => {
  const a = await aufbau(t, { tempo: 120, mitWirt: false });
  const r = await ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.deepEqual([r.code, r.body.fehler], [409, 'wirt_fehlt']);
  assert.match(r.body.text, /djk-instrumente --arr1/);
  assert.ok(GRUND_TEXT.wirt_fehlt.includes('arr1'), 'auch der Rückfalltext in http/gruende.ts steht');
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

// S3-Fix W2 (Review 2026-10-20): wirt.py löscht seine Status-Datei nie, djk-stop auch nicht. Nach einem Stopp liegt sie mit bereit:true und toter pid
// da; beim Start steht bereit:false. Nur eine Datei mit bereit:true, deren pid lebt und wirt.py heißt, gilt als Wirt.
test('wirt_fehlt: Datei fehlt, bereit false, tote pid, fremder Prozess → 409; nur bereit true mit lebender wirt.py-pid geht durch', async (t) => {
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
  assert.ok(a.lead().freeze, 'Negativ-Kontrolle: bereit true und lebende wirt.py-pid → der Freeze läuft');
});
