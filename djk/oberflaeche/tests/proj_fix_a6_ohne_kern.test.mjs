// D1 S2-Integration, Fix-Runde A6 (Spec 6.30, Quality-Review R5): ohne Kern (Quittung null) nimmt das Projekt Mixer-Änderungen an wie
// Noten-Änderungen (200, kern.regler meldet kein_kern); nur eine echte Ablehnung des Kerns dreht zurück (409 regler_abgelehnt). Vorher
// lehnte die Sitzung jede Mixer-Änderung ohne Kern mit 409 regler_abgelehnt ab (review-qual/probe_r5.test.mjs), Noten gingen durch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung } from './hilfen/proj_kontext.mjs';

const fehlerVon = async (p) => { try { return { r: await p }; } catch (e) { return { e }; } };
async function aufbau(t) {
  const e = sitzung(t);
  await e.s.neu('F', 'andreas');
  await e.s.aendern({ rev: 0, label: 'Bass', befehle: [{ befehl: 'spur_neu', art: 'instrument' }] }, 'andreas');
  e.k.leere();
  return e;
}
const fader = (rev, felder = { fader_db: -6 }) => ({ rev, label: 'F', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', ...felder }] });

test('A6 ohne Kern (Quittung null): Mixer-Änderung 200, kern.regler kein_kern, gespeichert und im Verlauf', async (t) => {
  const { s, k } = await aufbau(t);
  k.regel = () => null;
  const { r, e } = await fehlerVon(s.aendern(fader(1), 'andreas'));
  assert.equal(e, undefined, `erwartet 200, bekommen ${e?.code} ${e?.fehler}`);
  assert.equal(r.code, 200); assert.equal(r.j.kern.regler, 'kein_kern');
  assert.equal(s.aktuell().j.projekt.rev, 2); assert.equal(s.aktuell().j.projekt.spuren[0].fader_db, -6);
  assert.equal(s.verlaufListe().j.at(-1).label, 'F');
  assert.equal(k.teile(/^spur\/1\/fader$/).length, 1, 'kein Rückdrehen');
  // Noten wie bisher
  const n = await s.aendern({ rev: 2, label: 'C', befehle: [{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }] }] }, 'andreas');
  assert.equal(n.code, 200);
});

test('A6 echte Ablehnung (Status 6) → 409 regler_abgelehnt, angenommene Regler zurückgedreht, nichts gespeichert', async (t) => {
  const { s, k } = await aufbau(t);
  k.regel = (adr, f) => (adr === '/k/teil' && f.pfad === 'spur/1/fader' ? { status: 6, grund: 'nur_hand' } : { status: 3, grund: '' });
  const { r, e } = await fehlerVon(s.aendern(fader(1, { fader_db: -6, pan: 0.5 }), 'andreas'));
  assert.equal(r, undefined);
  assert.deepEqual([e.code, e.fehler], [409, 'regler_abgelehnt']);
  assert.deepEqual(k.teile(/^spur\/1\/pan$/).map((x) => x.felder.nach), [0.5, 0], 'pan zurückgedreht');
  assert.equal(s.aktuell().j.projekt.rev, 1);
});

test('A6 gemischt: eine Quittung null, eine echte Ablehnung → 409 regler_abgelehnt (die Ablehnung zählt)', async (t) => {
  const { s, k } = await aufbau(t);
  k.regel = (adr, f) => (adr === '/k/teil' && f.pfad === 'spur/1/fader' ? { status: 6, grund: 'nur_hand' } : null);
  const { e } = await fehlerVon(s.aendern(fader(1, { fader_db: -6, pan: 0.5 }), 'andreas'));
  assert.deepEqual([e?.code, e?.fehler], [409, 'regler_abgelehnt']);
  assert.equal(s.aktuell().j.projekt.rev, 1);
});

test('A6 Negativ-Kontrolle: mit Kern (Quittung 3) 200 und kern.regler ok', async (t) => {
  const { s } = await aufbau(t);
  const r = await s.aendern(fader(1), 'andreas');
  assert.equal(r.code, 200); assert.equal(r.j.kern.regler, 'ok');
});
