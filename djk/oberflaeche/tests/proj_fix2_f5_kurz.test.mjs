// D1 S2-Integration, zweite Fix-Runde F5 (Spec 6.31): Werkzeuge bekommen schmale Antworten. /proj/aendern, /proj/undo und /proj/redo mit
// ?antwort=kurz liefern rev, Kern-Meldungen und die Zahl der Noten je Clip, nicht das ganze Projekt; ohne Abfrage (die Seite, schreiber.js liest
// r.j.projekt) bleibt alles wie bisher. Gemessen über die Route (Seiten-Server mit Kern-Attrappe): Antwortgröße bei 10.000 und 60.000 Noten.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf, CYPHER } from './hilfen/proj_stapel.mjs';

const noten = (n, ab = 0) => Array.from({ length: n }, (_, i) => ({ beat: ((ab + i) % 4000) / 8, laenge: 0.1, ton: 36 + ((ab + i) % 48), vel: 90 }));
const bytes = (j) => Buffer.byteLength(JSON.stringify(j));

test('F5 /proj/aendern, /proj/undo, /proj/redo mit ?antwort=kurz: rev, kern, noten_zahl je Clip, kein Projekt; ohne Abfrage das ganze Projekt', { timeout: 60_000 }, async (t) => {
  const { url } = await stapel(t);
  let rev = (await ruf(url, 'POST', '/proj/neu', { name: 'Kurz' })).j.projekt.rev;
  const a = await ruf(url, 'POST', '/proj/aendern?antwort=kurz', { rev, label: 'Bass', befehle: [{ befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: noten(3) },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 4, laenge_beats: 4 }] }, CYPHER);
  console.log(`F5 kurz ${JSON.stringify(a)}`);
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(Object.keys(a.j).sort(), ['kern', 'noten_zahl', 'rev']);
  assert.deepEqual(a.j.noten_zahl, { c1: 3, c2: 0 });
  assert.equal(typeof a.j.kern.wiedergabe.nr, 'number', 'Kern-Meldungen bleiben');
  rev = a.j.rev;
  const u = await ruf(url, 'POST', '/proj/undo?antwort=kurz', { rev }, CYPHER);
  assert.equal(u.code, 200); assert.equal(u.j.projekt, undefined); assert.deepEqual(u.j.noten_zahl, {});
  const w = await ruf(url, 'POST', '/proj/redo?antwort=kurz', { rev: u.j.rev }, CYPHER);
  assert.equal(w.code, 200); assert.equal(w.j.projekt, undefined); assert.deepEqual(w.j.noten_zahl, { c1: 3, c2: 0 });
  // Fehler bleiben Fehler (409 mit Grund), auch mit ?antwort=kurz
  const alt = await ruf(url, 'POST', '/proj/aendern?antwort=kurz', { rev: 0, label: 'x', befehle: [{ befehl: 'spur_neu', art: 'audio' }] }, CYPHER);
  assert.deepEqual([alt.code, alt.j.fehler], [409, 'rev_veraltet']);
  // Negativ-Kontrolle: die Seite fragt ohne Abfrage und bekommt das ganze Projekt
  const voll = await ruf(url, 'POST', '/proj/aendern', { rev: w.j.rev, label: 'Fader', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }] });
  assert.equal(voll.code, 200);
  assert.equal(voll.j.projekt.spuren[0].clips[0].noten.length, 3);
  assert.equal(voll.j.rev, voll.j.projekt.rev);
});

// Messung (berichtet, Grenze nur für kurz): Antwortgröße einer Notenänderung und eines Faders, voll (vorher, die Seite) und kurz (nachher, Werkzeug)
for (const zahl of [10_000, 60_000]) {
  test(`F5 Antwortgröße bei ${zahl} Noten über die Route: voll gegen kurz`, { timeout: 600_000 }, async (t) => {
    const { url } = await stapel(t);
    let rev = (await ruf(url, 'POST', '/proj/neu', { name: `G${zahl}` })).j.projekt.rev;
    const aendere = async (befehle, abfrage = '') => {
      const r = await ruf(url, 'POST', `/proj/aendern${abfrage}`, { rev, label: 'x', befehle });
      assert.equal(r.code, 200, JSON.stringify(r.j).slice(0, 300)); rev = r.j.rev; return r;
    };
    await aendere([{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'audio' }]);
    for (let ab = 0, c = 0; ab < zahl; ab += 10_000, c++) {
      await aendere([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: c * 512, laenge_beats: 512, noten: noten(Math.min(10_000, zahl - ab), ab) }]);
    }
    const note = (vel) => [{ befehl: 'noten_aendern', clip_id: 'c1', noten: [{ id: 'n1', vel }] }];
    const fader = (db) => [{ befehl: 'spur_aendern', spur_id: 's2', fader_db: db }];
    const m = { noten: zahl,
      note_voll_bytes: bytes((await aendere(note(80))).j), note_kurz_bytes: bytes((await aendere(note(81), '?antwort=kurz')).j),
      fader_voll_bytes: bytes((await aendere(fader(-3))).j), fader_kurz_bytes: bytes((await aendere(fader(-4), '?antwort=kurz')).j) };
    console.log(`F5 GROESSE ${JSON.stringify(m)}`);
    assert.ok(m.note_kurz_bytes < 2000 && m.fader_kurz_bytes < 2000, JSON.stringify(m));
    assert.ok(m.note_voll_bytes > 100 * m.note_kurz_bytes, 'voll trägt die Noten');
  });
}
