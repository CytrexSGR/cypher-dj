// Characterisation (no behaviour change): the project transport is one switch for the whole live container. Starting it (proj_transport start,
// POST /proj/transport, one /k/arr/start without a group argument, see proj_transport.test.mjs) plays EVERY group of the open live project: the SEQ
// decks and the loop modules of slot A (Loop 1) and slot B (Loop 2) alike. Live-modules spec section 6.2 states it ("its transport starts on the
// next phrase boundary of the core clock, so a module enters on the set's phrase"); the SEQ deck spec does not carve SEQ out of it.
// What keeps a module quiet is its channel (pad/1, pad/2 closed) or the mute of its group, not the transport.
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { uebersetze } from '../project/playback.ts';
import { baueModul, modulAmPlatz } from '../project/live.ts';
import { seqGruppe } from '../project/seq.ts';

const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const LOOP = { sha256: 'e'.repeat(64), pfad: '/x/e.wav', beats: 16, frames: 16 * 24000 };
const herkunft = () => ({ quelle_sha256: 'c'.repeat(64), titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 120,
  tonart: '8A', datum: '2026-11-12' });
const opt = () => ({ nr: 1, audioOrdner: '/arbeit/arr/audio', frames: () => null });

function container() {
  const p0 = neuesProjekt('x'); p0.live = true; p0.plaetze = [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }];
  let p = baueModul(p0, 'B', LOOP, {}, herkunft());   // a loop module on Loop 2
  p = lauf(p, { befehl: 'seq_anlegen', platz: 1 });   // a SEQ deck on place 1
  const g = seqGruppe(p, 1);
  p = lauf(p, { befehl: 'seq_folge_neu', gruppe_id: g.id, name: 'Bass', geraet: { art: 'intern', name: 'bk', graph: 'synth-mono', parameter: {} },
    noten: [{ beat: 0, ton: 36, laenge: 0.5, vel: 100 }] });
  const u = pruefeProjekt(JSON.parse(JSON.stringify(p)));
  assert.ok('projekt' in u, JSON.stringify(u));
  return p;
}

test('one playback holds the SEQ deck and the module of Loop 2: both lead into their strips and neither has a start of its own', () => {
  const p = container();
  const w = uebersetze(p, opt());
  const slotB = modulAmPlatz(p, 'B'), seq = seqGruppe(p, 1);
  assert.ok(slotB && seq);
  const nrB = p.gruppen.find((g) => g.id === slotB).nr, nrSeq = seq.nr;
  // container core: the DJ output number is the place (container A..D = 1..4): the module of slot B (place 2) leaves through output 2, the SEQ deck of place 1 through output 1
  assert.deepEqual(w.gruppen.find((g) => g.nr === nrB).ausgang, { art: 'dj', nr: 2 });
  assert.deepEqual(w.gruppen.find((g) => g.nr === nrSeq).ausgang, { art: 'dj', nr: 1 });
  // the tracks of both sit in the same playback ...
  assert.ok(w.spuren.length >= 2, `tracks in the playback: ${w.spuren.length}`);
  // ... and no group, track or clip of it carries a start condition: the core plays what the snapshot holds from the one /k/arr/start
  const verboten = ['start', 'start_beat', 'aktiv', 'an', 'quant', 'bereit', 'armed'];
  for (const g of w.gruppen) for (const k of verboten) assert.equal(k in g, false, `group field ${k}`);
  for (const s of w.spuren) for (const k of verboten) assert.equal(k in s, false, `track field ${k}`);
});

test('the smallest switch is the mute of the module group: it is a mixer row (grp/N/mute), the group stays in the playback', () => {
  const p = container();
  const slotB = modulAmPlatz(p, 'B');
  const stumm = lauf(p, { befehl: 'gruppenspur_aendern', gruppe_id: slotB, mute: true });
  assert.equal(stumm.gruppen.find((g) => g.id === slotB).mute, true);
  // the mute is a mixer row of the group (mapping.ts), not a field of the playback: the group stays in it, so unmuting needs no reload and no new start
  const w = uebersetze(stumm, opt());
  assert.equal(w.gruppen.length, p.gruppen.length);
});
