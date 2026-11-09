// 1.8 S0 T5: the commands for the recording slices 2 to 5: spur_aendern with external and midi inputs and monitor, aufnahme_setzen for count-in, punch and
// overdub. AK1: none of them changes the playback view (no reload of the core), each is one undo step. Plan: PLAN-1.8-slices2-6.md S0.5.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, wiedergabeSicht, AUFNAHME_VORGABE, aufnahmeVon } from '../project/model.ts';
import { wende } from '../project/patch.ts';

const ein = (name) => ({ art: 'intern', name });
const mitSpuren = (n) => {
  let p = neuesProjekt('T');
  for (let i = 0; i < n; i++) p = fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'audio', name: `A${i + 1}` }]).projekt;
  return p;
};
const mitRb = (p) => fuehreListeAus(p, [{ befehl: 'spur_neu', art: 'instrument', name: 'RB', geraet: { art: 'intern', name: 'rb338', parameter: {} } }]).projekt;
const grund = (f) => { try { f(); } catch (e) { return e.grund ?? String(e); } return null; };
const aendere = (p, b) => fuehreListeAus(p, [b]);

// AK1 for one command: playback view unchanged, the flag false, patches non-empty and reversible (undo and redo deep-equal)
function ak1(p, befehl, wo) {
  const e = aendere(p, befehl);
  assert.equal(e.betrifft_wiedergabe, false, `${wo}: betrifft_wiedergabe`);
  assert.deepEqual(wiedergabeSicht(e.projekt), wiedergabeSicht(p), `${wo}: playback view`);
  assert.ok(e.vor.length > 0 && e.zurueck.length > 0, `${wo}: the patch knows the change (history entry and undo)`);
  assert.deepEqual(wende(e.projekt, e.zurueck), p, `${wo}: undo restores the project`);
  assert.deepEqual(wende(p, e.vor), e.projekt, `${wo}: redo reproduces the change`);
  assert.ok('projekt' in pruefeProjekt(JSON.parse(JSON.stringify(e.projekt))), `${wo}: the result is a valid project`);
  return e;
}

test('AK1 spur_aendern: external input with the default mode, a mode, monitor aus and ein, each without a reload and undoable', () => {
  const p = mitSpuren(1);
  const id = p.spuren[0].id;
  const e1 = ak1(p, { befehl: 'spur_aendern', spur_id: id, eingang: { art: 'extern', paar: 2 }, arm: true }, 'extern default mode');
  assert.deepEqual(e1.projekt.spuren[0].aufnahme, { scharf: true, eingang: { art: 'extern', paar: 2, modus: 'stereo' } }, 'modus defaults to stereo');
  const e2 = ak1(e1.projekt, { befehl: 'spur_aendern', spur_id: id, eingang: { art: 'extern', paar: 3, modus: 'summe' } }, 'extern mode summe');
  assert.deepEqual(e2.projekt.spuren[0].aufnahme.eingang, { art: 'extern', paar: 3, modus: 'summe' });
  const e3 = ak1(e2.projekt, { befehl: 'spur_aendern', spur_id: id, monitor: 'aus' }, 'monitor aus');
  assert.equal(e3.projekt.spuren[0].aufnahme.monitor, 'aus');
  const e4 = ak1(e3.projekt, { befehl: 'spur_aendern', spur_id: id, monitor: 'ein' }, 'monitor ein');
  assert.equal(e4.projekt.spuren[0].aufnahme.monitor, 'ein');
  // monitor auto removes the key (canonical form)
  const e5 = ak1(e4.projekt, { befehl: 'spur_aendern', spur_id: id, monitor: 'auto' }, 'monitor auto');
  assert.equal('monitor' in e5.projekt.spuren[0].aufnahme, false, 'auto is no key');
  assert.deepEqual(e5.projekt.spuren[0].aufnahme, e2.projekt.spuren[0].aufnahme);
  // an unknown monitor value is refused
  assert.equal(grund(() => aendere(p, { befehl: 'spur_aendern', spur_id: id, monitor: 'laut' })), 'argument_ungueltig');
  // disarming and dropping the input with a monitor set keeps nothing but the monitor
  const nur = aendere(e4.projekt, { befehl: 'spur_aendern', spur_id: id, arm: false, eingang: null }).projekt;
  assert.deepEqual(nur.spuren[0].aufnahme, { scharf: false, eingang: null, monitor: 'ein' });
  const leer = aendere(nur, { befehl: 'spur_aendern', spur_id: id, monitor: 'auto' }).projekt;
  assert.equal(leer.spuren[0].aufnahme, undefined, 'nothing left: the field is gone');
});

test('AK1 spur_aendern: midi arm on an instrument track with an RB-338 works, not on audio; extern not on an instrument track', () => {
  const p = mitRb(mitSpuren(1));
  const rb = p.spuren.find((s) => s.art === 'instrument').id;
  const au = p.spuren.find((s) => s.art === 'audio').id;
  const e = ak1(p, { befehl: 'spur_aendern', spur_id: rb, eingang: { art: 'midi' }, arm: true }, 'midi arm');
  assert.deepEqual(e.projekt.spuren.find((s) => s.id === rb).aufnahme, { scharf: true, eingang: { art: 'midi' } });
  assert.equal(grund(() => aendere(p, { befehl: 'spur_aendern', spur_id: rb, eingang: { art: 'extern', paar: 1 } })), 'eingang_fehlt');
  assert.equal(grund(() => aendere(p, { befehl: 'spur_aendern', spur_id: rb, eingang: ein('erz/1') })), 'eingang_fehlt');
  assert.equal(grund(() => aendere(p, { befehl: 'spur_aendern', spur_id: au, eingang: { art: 'midi' } })), 'eingang_fehlt');
  // arm without an input on an instrument track still needs one
  assert.equal(grund(() => aendere(p, { befehl: 'spur_aendern', spur_id: rb, arm: true })), 'kein_eingang');
  // bad external fields
  for (const bad of [{ art: 'extern', paar: 5 }, { art: 'extern', paar: 0 }, { art: 'extern', paar: 1, modus: 'mono' }, { art: 'extern' }, { art: 'wurst' }]) {
    assert.equal(grund(() => aendere(p, { befehl: 'spur_aendern', spur_id: au, eingang: bad })), 'eingang_fehlt', JSON.stringify(bad));
  }
});

test('AK2 zu_viele_scharf counts audio tracks only: a ninth armed audio track is refused, an armed instrument track does not count', () => {
  const p = mitRb(mitSpuren(9));
  const audio = p.spuren.filter((s) => s.art === 'audio');
  const rb = p.spuren.find((s) => s.art === 'instrument').id;
  let q = aendere(p, { befehl: 'spur_aendern', spur_id: rb, eingang: { art: 'midi' }, arm: true }).projekt;
  for (let i = 0; i < 8; i++) q = aendere(q, { befehl: 'spur_aendern', spur_id: audio[i].id, eingang: { art: 'extern', paar: 1 }, arm: true }).projekt;
  assert.equal(q.spuren.filter((s) => s.aufnahme?.scharf).length, 9, 'eight audio plus the armed instrument track');
  assert.equal(grund(() => aendere(q, { befehl: 'spur_aendern', spur_id: audio[8].id, eingang: ein('erz/1'), arm: true })), 'zu_viele_scharf');
  // negative control: with only seven audio tracks armed the eighth is accepted
  const sieben = aendere(p, { befehl: 'spur_aendern', spur_id: rb, eingang: { art: 'midi' }, arm: true }).projekt;
  let r = sieben;
  for (let i = 0; i < 7; i++) r = aendere(r, { befehl: 'spur_aendern', spur_id: audio[i].id, eingang: ein('erz/1'), arm: true }).projekt;
  assert.equal(aendere(r, { befehl: 'spur_aendern', spur_id: audio[7].id, eingang: ein('erz/1'), arm: true }).projekt.spuren.filter((s) => s.aufnahme?.scharf).length, 9);
});

test('AK1 aufnahme_setzen: count-in, punch and overdub; each field alone, partial punch merges, one undo step, no reload', () => {
  const p = mitSpuren(1);
  assert.equal('aufnahme' in p, false);
  const e1 = ak1(p, { befehl: 'aufnahme_setzen', vorzaehler_takte: 2 }, 'count-in');
  assert.deepEqual(e1.projekt.aufnahme, { ...AUFNAHME_VORGABE, vorzaehler_takte: 2 }, 'unset fields take the default');
  const e2 = ak1(e1.projekt, { befehl: 'aufnahme_setzen', punch: { ein: true, von_beat: 8, bis_beat: 16 } }, 'punch');
  assert.deepEqual(e2.projekt.aufnahme, { vorzaehler_takte: 2, punch: { ein: true, aus: false, von_beat: 8, bis_beat: 16 }, overdub: false });
  const e3 = ak1(e2.projekt, { befehl: 'aufnahme_setzen', punch: { aus: true } }, 'punch aus merges');
  assert.deepEqual(e3.projekt.aufnahme.punch, { ein: true, aus: true, von_beat: 8, bis_beat: 16 });
  const e4 = ak1(e3.projekt, { befehl: 'aufnahme_setzen', overdub: true }, 'overdub');
  assert.equal(aufnahmeVon(e4.projekt).overdub, true);
  for (const n of [0, 1, 2, 4]) assert.equal(aendere(p, { befehl: 'aufnahme_setzen', vorzaehler_takte: n }).projekt.aufnahme.vorzaehler_takte, n);
  // several commands in one list are still one undo step
  const liste = fuehreListeAus(p, [{ befehl: 'aufnahme_setzen', vorzaehler_takte: 1 }, { befehl: 'aufnahme_setzen', overdub: true }]);
  assert.deepEqual(wende(liste.projekt, liste.zurueck), p);
  assert.equal(liste.projekt.aufnahme.vorzaehler_takte, 1);
});

test('AK2 aufnahme_setzen refusals: 3 or 5 bars, an empty command, bad punch, unknown keys', () => {
  const p = mitSpuren(1);
  const g = (b) => grund(() => aendere(p, { befehl: 'aufnahme_setzen', ...b }));
  assert.equal(g({ vorzaehler_takte: 3 }), 'argument_ungueltig');
  assert.equal(g({ vorzaehler_takte: 5 }), 'argument_ungueltig');
  assert.equal(g({ vorzaehler_takte: 1.5 }), 'argument_ungueltig');
  assert.equal(g({}), 'argument_ungueltig', 'an empty command');
  assert.equal(g({ punch: {} }), 'argument_ungueltig', 'an empty punch');
  assert.equal(g({ punch: { von_beat: 8, bis_beat: 8 } }), 'argument_ungueltig');
  assert.equal(g({ punch: { von_beat: 8, bis_beat: 4 } }), 'argument_ungueltig');
  assert.equal(g({ punch: { von_beat: -1, bis_beat: 4 } }), 'argument_ungueltig');
  assert.equal(g({ punch: { ein: 'ja' } }), 'argument_ungueltig');
  assert.equal(g({ overdub: 1 }), 'argument_ungueltig');
  assert.equal(g({ wurst: 1 }), 'argument_unbekannt');
  assert.equal(g({ punch: { ein: true, x: 1 } }), 'argument_unbekannt');
  // a partial punch is judged against the stored values: raising von_beat above the stored bis_beat is refused, the full pair is fine
  const gesetzt = aendere(p, { befehl: 'aufnahme_setzen', punch: { von_beat: 8, bis_beat: 12 } }).projekt;
  assert.equal(grund(() => aendere(gesetzt, { befehl: 'aufnahme_setzen', punch: { von_beat: 12 } })), 'argument_ungueltig');
  assert.deepEqual(aendere(gesetzt, { befehl: 'aufnahme_setzen', punch: { von_beat: 10 } }).projekt.aufnahme.punch, { ein: false, aus: false, von_beat: 10, bis_beat: 12 });
  // negative control: the harmless command is accepted and changes nothing else
  const ok = aendere(p, { befehl: 'aufnahme_setzen', overdub: false });
  assert.deepEqual(ok.projekt.spuren, p.spuren);
});
