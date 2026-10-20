// D1 S2-Integration, zweite Fix-Runde F7 (Spec 6.32, Wortlaut von 6.31 berichtigt): Eine ausdrücklich mitgegebene Noten-ID n<k> muss unter 2^31
// liegen, sonst argument_ungueltig; sie kann den Projekt-Zähler damit nie unbrauchbar machen. Unter dem Zähler bleibt es bei id_belegt (Spec 6.30).
// Belege: Re-Review rr_b1_grenze (n<MAX_SAFE-1> angenommen, danach scheitert jede automatische Note an projekt_ungueltig),
// Quality-Probe p5 (n<20 Ziffern> → projekt_ungueltig statt argument_ungueltig).
import test from 'node:test';
import assert from 'node:assert/strict';
import { sitzung } from './hilfen/proj_kontext.mjs';

const ergebnis = async (p) => { try { const r = await p; return { code: r.code }; } catch (e) { return { code: e.code, fehler: e.fehler ?? e.grund, text: e.detail ?? e.extra?.text }; } };
async function aufbau(t) {
  const { s } = sitzung(t);
  await s.neu('G', 'andreas');
  await s.aendern({ rev: 0, label: 'Bass', befehle: [{ befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4 },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 4, laenge_beats: 4 }] }, 'andreas');
  const neu = (clip, note) => s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'n', befehle: [{ befehl: 'noten_neu', clip_id: clip, noten: [note] }] }, 'andreas');
  return { s, neu };
}
const N = (beat, extra = {}) => ({ beat, laenge: 1, ton: 36, vel: 90, ...extra });

for (const [name, id] of [['knapp unter MAX_SAFE', `n${Number.MAX_SAFE_INTEGER - 1}`], ['20 Ziffern', 'n99999999999999999999'], ['genau 2^31', `n${2 ** 31}`]]) {
  test(`F7 ausdrückliche ID ${name} → argument_ungueltig, Zähler unverändert, automatische Noten gehen weiter`, async (t) => {
    const { s, neu } = await aufbau(t);
    const vorher = s.aktuell().j.projekt;
    const a = await ergebnis(neu('c1', N(0, { id })));
    const nachher = s.aktuell().j.projekt;
    const b = await ergebnis(neu('c2', N(1)));
    const p = s.aktuell().j.projekt;
    console.log(`F7 ${JSON.stringify({ name, explizit: a, zaehler: [vorher.naechste_noten_id ?? null, nachher.naechste_noten_id ?? null], auto: b, c2: p.spuren[0].clips[1].noten.map((n) => n.id) })}`);
    assert.equal(a.fehler, 'argument_ungueltig');
    assert.match(a.text, /2\^31|2147483648/);
    assert.equal(nachher.rev, vorher.rev, 'nichts gespeichert');
    assert.equal(nachher.naechste_noten_id, vorher.naechste_noten_id, 'Zähler unverändert');
    assert.equal(b.code, 200, 'die nächste automatische Note geht durch');
  });
}

test('F7 Negativ-Kontrolle: 2^31 - 1 und eine kleine ID über dem Zähler gehen durch und heben den Zähler; unter dem Zähler bleibt id_belegt', async (t) => {
  const { s, neu } = await aufbau(t);
  assert.equal((await ergebnis(neu('c1', N(0, { id: 'n50' })))).code, 200);
  assert.equal(s.aktuell().j.projekt.naechste_noten_id, 51);
  assert.deepEqual((await ergebnis(neu('c2', N(0, { id: 'n50' })))).fehler, 'id_belegt', 'unter dem Zähler: id_belegt (Spec 6.30)');
  assert.equal((await ergebnis(neu('c2', N(0, { id: `n${2 ** 31 - 1}` })))).code, 200);
  assert.equal(s.aktuell().j.projekt.naechste_noten_id, 2 ** 31);
  assert.equal((await ergebnis(neu('c2', N(1)))).code, 200);
  assert.deepEqual(s.aktuell().j.projekt.spuren[0].clips[1].noten.map((n) => n.id), [`n${2 ** 31 - 1}`, `n${2 ** 31}`]);
  assert.equal((await ergebnis(neu('c1', N(2, { id: 'kick' })))).code, 200, 'eigene IDs ohne Nummer zählen nicht');
});
