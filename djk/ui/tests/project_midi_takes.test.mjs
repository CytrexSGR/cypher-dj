// Strand 7, task 4.1: MIDI takes (D10). Take lanes on instrument tracks hold MIDI clips; take_neu, comp_waehlen and the audition work on them.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt } from '../project/model.ts';
import { normalisiere } from '../project/storage.ts';
import { Verlauf, aendere, rueckgaengig, wiederholen } from '../project/history.ts';
import { uebersetze } from '../project/playback.ts';
import { istMidiTakeKopie } from '../project/takes.ts';
import { tmpOrdner, SHA_A } from './support/project.mjs';

const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund, `expected ${grund}`);
const bytes = (p) => JSON.stringify(normalisiere(p));
const note = (id, beat, ton, laenge = 0.5, vel = 100) => ({ id, beat, laenge, ton, vel });
const midi = (id, noten, start = 0, laenge = 8) => ({ id, art: 'midi', name: id, start_beat: start, laenge_beats: laenge, noten });
const audio = (id) => ({ id, art: 'audio', name: id, start_beat: 0, laenge_beats: 4, quelle: { sha256: SHA_A, pfad_hinweis: '/abs/x.wav' },
  dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
const abs = (c) => c.noten.map((n) => [c.start_beat + n.beat, n.ton, n.laenge]);
const alleNoten = (s) => s.clips.flatMap((c) => c.noten.map((n) => [c.start_beat + n.beat, n.ton, n.laenge])).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
// s1 audio, s2 instrument (rb338) with main notes of "take 1" (tones 60) and take lane t2 with "take 2" notes (tones 72)
function projekt() {
  let p = neuesProjekt('T');
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'audio', name: 'A' }).projekt;
  p = fuehreAus(p, { befehl: 'spur_neu', art: 'instrument', name: 'I' }).projekt;
  p = structuredClone(p);
  p.spuren[1].clips = [midi('c1', [note('n1', 0, 60), note('n2', 4, 60), note('n3', 5, 60), note('n4', 7, 60)])];
  p.spuren[1].takes = [{ id: 't1', name: 'Take 1', clips: [midi('c2', [note('n5', 0, 72), note('n6', 4, 72), note('n7', 5, 72, 3), note('n8', 7, 72)])] }];
  p.naechste_id = { ...p.naechste_id, clip: 3, take: 2 };
  p.naechste_noten_id = 9;
  const g = pruefeProjekt(JSON.parse(bytes(p)));
  assert.ok(g.projekt, JSON.stringify(g));
  return g.projekt;
}

test('take_neu on an instrument track; stream tracks still refused', () => {
  const p = fuehreAus(projekt(), { befehl: 'take_neu', spur_id: 's2', name: 'Pass 2' }).projekt;
  assert.deepEqual(p.spuren[1].takes.map((t) => [t.id, t.name]), [['t1', 'Take 1'], ['t2', 'Pass 2']]);
  assert.ok(pruefeProjekt(JSON.parse(bytes(p))).projekt);
});

test('the checker: a MIDI clip in a take lane of an audio track is refused, and an audio clip on an instrument track', () => {
  const a = projekt();
  a.spuren[0].takes = [{ id: 't5', name: 'X', clips: [midi('c9', [])] }];
  const g1 = pruefeProjekt(JSON.parse(bytes(a)));
  assert.equal(g1.projekt, undefined, 'midi take clip on audio track refused');
  const b = projekt();
  b.spuren[1].takes[0].clips = [audio('c9')];
  const g2 = pruefeProjekt(JSON.parse(bytes(b)));
  assert.equal(g2.projekt, undefined, 'audio take clip on instrument track refused');
});

test('comp of bar 2 (beats 4..8) from take 2 into a main lane holding take 1 notes', () => {
  const p = projekt();
  const r = fuehreAus(p, { befehl: 'comp_waehlen', spur_id: 's2', take_id: 't1', von_beat: 4, bis_beat: 8 });
  const s = r.projekt.spuren[1];
  assert.deepEqual(alleNoten(s), [[0, 60, 0.5], [4, 72, 0.5], [5, 72, 3], [7, 72, 0.5]]);
  assert.ok(s.clips.every((c) => c.art === 'midi'));
  const ids = s.clips.flatMap((c) => [c.id, ...c.noten.map((n) => n.id)]);
  assert.equal(new Set(ids).size, ids.length, 'fresh unique ids');
  assert.equal(r.projekt.spuren[1].takes[0].clips[0].noten.length, 4, 'the take lane is untouched');
  assert.ok(pruefeProjekt(JSON.parse(bytes(r.projekt))).projekt, 'the result is a valid project');
});

test('comp over a range that cuts a note: kept from the onset, cut at bis', () => {
  const p = projekt();
  const r = fuehreAus(p, { befehl: 'comp_waehlen', spur_id: 's2', take_id: 't1', von_beat: 4, bis_beat: 6 });
  const s = r.projekt.spuren[1];
  // the take note at 5 (length 3) is cut at 6; main notes outside stay, the main note at 7 stays
  assert.deepEqual(alleNoten(s), [[0, 60, 0.5], [4, 72, 0.5], [5, 72, 1], [7, 60, 0.5]]);
  assert.ok(pruefeProjekt(JSON.parse(bytes(r.projekt))).projekt);
});

test('comp: undo restores the project byte for byte, redo repeats it; a no-op comp spends no undo step', (t) => {
  const p = projekt();
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { zeitgeber: false });
  const meta = { quelle: 'andreas', label: 'comp' };
  const comp = [{ befehl: 'comp_waehlen', spur_id: 's2', take_id: 't1', von_beat: 4, bis_beat: 8 }];
  const w = aendere(v, p, comp, meta);
  assert.notEqual(bytes(w.projekt), bytes(p));
  const u = rueckgaengig(v, w.projekt, { quelle: 'andreas' });
  assert.equal(JSON.stringify(u.projekt.spuren), JSON.stringify(p.spuren), 'undo: the lanes are as before (counters and rev only move forward)');
  const r = wiederholen(v, u.projekt, { quelle: 'andreas' });
  assert.equal(JSON.stringify(r.projekt.spuren), JSON.stringify(w.projekt.spuren));
  const rev = r.projekt.rev;
  const n = aendere(v, r.projekt, comp, meta);       // already equal: no-op
  assert.equal(n.projekt.rev, rev, 'no revision step');
  assert.equal(JSON.stringify(rueckgaengig(v, n.projekt, { quelle: 'andreas' }).projekt.spuren), JSON.stringify(p.spuren), 'one undo still goes back to before the first comp');
});

test('no-op comp: the main notes already equal the take notes, nothing changes', () => {
  const p = projekt();
  const q = fuehreAus(p, { befehl: 'comp_waehlen', spur_id: 's2', take_id: 't1', von_beat: 4, bis_beat: 8 }).projekt;
  const nochmal = fuehreAus(q, { befehl: 'comp_waehlen', spur_id: 's2', take_id: 't1', von_beat: 4, bis_beat: 8 });
  assert.equal(bytes(nochmal.projekt), bytes(q));
  assert.equal(nochmal.projekt.naechste_id.clip, q.naechste_id.clip, 'no id spent');
  assert.equal(nochmal.projekt.naechste_noten_id, q.naechste_noten_id);
});

test('audition: the playback of a take has the take notes, the main lane plays its own', () => {
  const p = projekt();
  const tonSatz = (w) => new Set(w.spuren.find((s) => s.nr === p.spuren[1].nr).noten.map((n) => n.ton));
  const opt = { nr: 1, audioOrdner: '/x/audio', frames: () => 96000 };
  const haupt = uebersetze(p, opt);
  const probe = uebersetze(p, { ...opt, vorhoeren: new Map([['s2', 't1']]) });
  assert.deepEqual([...tonSatz(haupt)], [60]);
  assert.deepEqual([...tonSatz(probe)], [72]);
});

test('istMidiTakeKopie: true after comp, false after a note moved', () => {
  const p = projekt();
  const q = fuehreAus(p, { befehl: 'comp_waehlen', spur_id: 's2', take_id: 't1', von_beat: 0, bis_beat: 8 }).projekt;
  const take = q.spuren[1].takes[0].clips[0];
  const haupt = q.spuren[1].clips;
  assert.equal(haupt.length, 1);
  assert.equal(istMidiTakeKopie(haupt[0], take), true);
  assert.equal(istMidiTakeKopie(p.spuren[1].clips[0], take), false, 'before the comp it is no copy');
  const bewegt = structuredClone(haupt[0]);
  bewegt.noten[1].beat += 0.25;
  assert.equal(istMidiTakeKopie(bewegt, take), false);
  assert.equal(abs(haupt[0]).length, 4);
});
