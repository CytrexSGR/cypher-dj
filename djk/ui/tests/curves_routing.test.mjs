// 1.10 Slice 3 Task 3 (plan F6): the 236 send, return and hall controls are grabbable on the page (ZIELE), have a control kind, a default,
// a range and a display text, and the curve round trip holds. The source of truth for range and default is the contract table of the
// mock core (djk/contract/mock_core/contract.mjs), which is checked against the real stellwerk by check_name_lists.py.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ZIELE, art, GRIFF, griffZuMidi, midiRoh, wertAusMidi, formatiere, vorgabe } from '../public/curves.js';
import { REGLER } from '../../contract/mock_core/contract.mjs';

const RETS = [1, 2, 3, 4];
const HALL = ['an', 'pre', 'decay', 'groesse', 'tief', 'highcut', 'fahne'];
const alle = [
  ...RETS.flatMap((r) => Array.from({ length: 32 }, (_, i) => `spur/${i + 1}/send/${r}`)),
  ...RETS.flatMap((r) => Array.from({ length: 16 }, (_, i) => `grp/${i + 1}/send/${r}`)),
  ...RETS.flatMap((r) => ['fader', 'pan', 'mute', 'solo'].map((f) => `ret/${r}/${f}`)),
  ...RETS.flatMap((r) => HALL.map((f) => `ret/${r}/reverb/${f}`)),
];

test('236 Pfade: alle in ZIELE, mit Art, Vorgabe und Bereich gleich der Vertragstabelle', () => {
  assert.equal(alle.length, 236);
  assert.equal(new Set(alle).size, 236);
  for (const p of alle) {
    assert.ok(ZIELE.has(p), `${p} fehlt in ZIELE`);
    assert.notEqual(art(p), null, `${p}: keine Art`);
    const v = REGLER.get(p);
    assert.ok(v, `${p} fehlt in der Vertragstabelle`);
    assert.ok(Math.abs(vorgabe(p) - v.vorgabe) < 1e-6, `${p}: Vorgabe ${vorgabe(p)} statt ${v.vorgabe}`);
    // range: the full grip travel reaches both ends of the contract range (switches only 0 and 1)
    const lo = wertAusMidi(p, 0);
    const hi = wertAusMidi(p, 1);
    assert.ok(Math.abs(hi - v.max) < 1e-4, `${p}: oben ${hi} statt ${v.max}`);
    if (v.einheit === 'db') assert.equal(lo, -200, `${p}: unten muss stumm sein`);
    else assert.ok(Math.abs(lo - v.min) < 1e-4, `${p}: unten ${lo} statt ${v.min}`);
    const text = formatiere(p, vorgabe(p));
    assert.equal(typeof text, 'string', p);
    assert.ok(!text.includes('NaN') && !text.includes('undefined'), `${p}: "${text}"`);
  }
});

test('Arten: Send wie Fader mit Vorgabe aus, Return wie Gruppe, Hall-Werte eigene Art, hall/an ein Schalter', () => {
  assert.equal(art('spur/2/send/1'), 'send');
  assert.equal(art('grp/8/send/4'), 'send');
  assert.equal(art('ret/1/fader'), 'spur_fader');
  assert.equal(art('ret/2/pan'), 'pan');
  assert.equal(art('ret/3/mute'), 'schalter');
  assert.equal(art('ret/4/solo'), 'schalter');
  assert.equal(art('ret/1/hall/an'), 'schalter');
  for (const f of HALL.slice(1)) assert.equal(art(`ret/1/hall/${f}`), 'hall');
  assert.equal(vorgabe('spur/1/send/1'), -200);   // a send starts off
  assert.equal(vorgabe('ret/1/fader'), 0);        // a return fader starts at 0 dB
  assert.equal(vorgabe('ret/1/hall/an'), 1);
});

test('Negativ-Kontrolle: Pfade ausserhalb sind weder Ziel noch Art', () => {
  for (const p of ['spur/33/send/1', 'spur/1/send/5', 'spur/1/send/0', 'grp/17/send/1', 'ret/5/fader', 'ret/0/fader', 'ret/1/hall/mix', 'ret/1/send/1',
    'ret/1/hall', 'ret/1/hall/an/x', 'spur/1/send/01']) {
    assert.ok(!ZIELE.has(p), p);
    assert.equal(art(p), null, p);
  }
});

test('Umlauf Griff → midi_roh → Wert an fünf Stützstellen je Art', () => {
  for (const p of ['spur/3/send/2', 'grp/2/send/1', 'ret/1/fader', 'ret/2/pan', 'ret/3/hall/decay', 'ret/4/hall/highcut']) {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const w = GRIFF[art(p)].wert(x);
      const u = griffZuMidi(p, x);
      assert.ok(Math.abs(wertAusMidi(p, u) - w) <= 1e-4 * Math.max(1, Math.abs(w)), `${p} x=${x}: Griff ${w}, Kern ${wertAusMidi(p, u)}`);
      assert.ok(Math.abs(GRIFF[art(p)].stellung(w) - x) < 1e-4, `${p} x=${x}: Rückweg ${GRIFF[art(p)].stellung(w)}`);
    }
  }
  assert.ok(Math.abs(midiRoh('ret/1/hall/decay', 0.5) - 0.5) < 1e-6);   // linear 0..1, normalised
});

test('Anzeige: Send in dB, aus als −∞, Hall-Werte vorläufig in Prozent', () => {
  assert.equal(formatiere('spur/1/send/1', -200), '−∞ dB');
  assert.equal(formatiere('spur/1/send/1', -6), '−6.0 dB');
  assert.equal(formatiere('ret/1/fader', 3), '+3.0 dB');
  assert.equal(formatiere('ret/1/hall/decay', 0.5), '50%');
  assert.equal(formatiere('ret/1/hall/an', 1), 'ON');
  assert.equal(formatiere('ret/1/hall/an', 0), '');
  assert.equal(formatiere('ret/1/mute', 1), 'MUTE');
});
