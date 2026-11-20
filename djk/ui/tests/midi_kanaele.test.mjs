// MIDI export: every part gets its own channel (bend and controller 11 act on a whole channel), drums on channel 10, and a bend beyond the range is not cut silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import { schreibeSmf, bendBereich, bendGeklemmt, SMF_BEND_MAX } from '../project/smf.ts';
import { midiTeile, melodiKanal, kanalGeteilt } from '../project/export_midi.ts';
import { neuesProjekt } from '../project/model.ts';
import { BK, KIT, lauf } from './support/fx_basis.mjs';

// the channel events [{ tick, art, kanal, d1, d2 }] of every track chunk
function ereignisse(roh) {
  const spuren = []; let o = 14;
  while (o < roh.length) {
    const laenge = (roh[o + 4] << 24) | (roh[o + 5] << 16) | (roh[o + 6] << 8) | roh[o + 7];
    const ende = o + 8 + laenge; let i = o + 8, tick = 0, status = 0; const liste = [];
    while (i < ende) {
      let dt = 0; for (;;) { const b = roh[i++]; dt = (dt << 7) | (b & 127); if (!(b & 128)) break; }
      tick += dt;
      if (roh[i] === 0xff) { i += 2; let l = 0; for (;;) { const b = roh[i++]; l = (l << 7) | (b & 127); if (!(b & 128)) break; } i += l; continue; }
      if (roh[i] & 128) status = roh[i++];
      const art = status & 0xf0, d1 = roh[i++], d2 = roh[i++];
      liste.push({ tick, art, kanal: status & 15, d1, d2 });
    }
    spuren.push(liste); o = ende;
  }
  return spuren;
}
const teil = (name, extra = {}) => ({ name, noten: [{ beat: 0, laenge: 1, ton: 60, vel: 100 }], ...extra });
const opt = (teile) => ({ titel: 'T', tempo_bpm: 120, taktart: [4, 4], teile });
const bend14 = (x) => x.d1 | (x.d2 << 7);

test('the writer puts the notes, the range setting, the bend and controller 11 of a part on the channel of the part', () => {
  const sp = ereignisse(schreibeSmf(opt([
    teil('A', { kanal: 0, bend: [{ beat: 1, st: 2 }], pegel: [{ beat: 1, faktor: 0.5 }] }),
    teil('B', { kanal: 3, bend: [{ beat: 1, st: -2 }], pegel: [{ beat: 2, faktor: 0.25 }] }),
    teil('C', { kanal: 9 }), teil('D')])));
  assert.deepEqual([...new Set(sp[1].map((x) => x.kanal))], [0]);
  assert.deepEqual([...new Set(sp[2].map((x) => x.kanal))], [3], 'notes, RPN, bend and controller of part B all on channel 4');
  assert.ok(sp[2].some((x) => x.art === 0xe0) && sp[2].some((x) => x.art === 0xb0 && x.d1 === 11) && sp[2].some((x) => x.art === 0xb0 && x.d1 === 101));
  assert.deepEqual(sp[3].map((x) => [x.art, x.kanal]), [[0x90, 9], [0x80, 9]]);
  assert.deepEqual([...new Set(sp[4].map((x) => x.kanal))], [0], 'no channel given: channel 1 as before');
});

test('a bend beyond 12 semitones widens the range (RPN) instead of being cut; beyond 24 it is cut at the limit and counted', () => {
  assert.equal(bendBereich([{ st: 5 }]), 12);
  assert.equal(bendBereich([{ st: -18.2 }, { st: 3 }]), 19);
  assert.equal(bendBereich([{ st: 40 }]), SMF_BEND_MAX);
  const sp = ereignisse(schreibeSmf(opt([teil('A', { bend: [{ beat: 1, st: 18 }, { beat: 2, st: -9 }] })])));
  assert.deepEqual(sp[1].filter((x) => x.art === 0xb0 && x.d1 === 6).map((x) => x.d2), [18], 'data entry: 18 semitones');
  assert.deepEqual(sp[1].filter((x) => x.art === 0xe0).map(bend14), [16383, 4096], '+18 is full up, -9 is half down');
  const weit = ereignisse(schreibeSmf(opt([teil('A', { bend: [{ beat: 1, st: 30 }] })])));
  assert.equal(weit[1].find((x) => x.art === 0xb0 && x.d1 === 6).d2, 24);
  assert.equal(bend14(weit[1].find((x) => x.art === 0xe0)), 16383);
  assert.equal(bendGeklemmt([{ st: 30 }, { st: -24 }, { st: 24.5 }]), 2);
});

test('midiTeile: melodic parts count up and skip channel 10, a drum kit takes channel 10; more parts than channels wrap and are reported', () => {
  assert.deepEqual([0, 1, 8, 9, 10, 14, 15].map(melodiKanal), [0, 1, 8, 10, 11, 15, 0]);
  let p = neuesProjekt('K');
  const geraete = [BK, KIT, BK, BK];
  geraete.forEach((g, i) => {
    p = lauf(p, { befehl: 'spur_neu', art: 'instrument', name: `T${i}`, geraet: g });
    p = lauf(p, { befehl: 'clip_neu', spur_id: `s${i + 1}`, art: 'midi', start_beat: 0, laenge_beats: 4, name: 'c', noten: [{ beat: 0, laenge: 1, ton: 36, vel: 100 }] });
  });
  const t = midiTeile(p, 0, 4);
  assert.deepEqual(t.map((x) => x.kanal), [0, 9, 1, 2]);
  assert.equal(kanalGeteilt(t), false);
  const eng = [{ kanal: 2, bend: [{ beat: 0, st: 1 }] }, { kanal: 2 }, { kanal: 5 }];
  assert.equal(kanalGeteilt(eng), true);
  assert.equal(kanalGeteilt([{ kanal: 2 }, { kanal: 2 }]), false, 'sharing alone is harmless: nothing bends');
});
