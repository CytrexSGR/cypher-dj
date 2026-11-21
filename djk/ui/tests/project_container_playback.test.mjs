// Container core M4: the translator writes cypherdj-arr/4 for a live project: outputs by place, strom tracks, parked groups left out, return owners,
// and the loader invariants checked before the core could refuse them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { uebersetze, WiedergabeFehler, containerNr, pruefeLiveWiedergabe, WIEDERGABE_FORMAT_4 } from '../project/playback.ts';
import { neuesProjekt, pruefeProjekt, strudelGruppe, stromSpur, loopDeckGruppe, MAX_RETURNS } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { kopie } from './support/project.mjs';

const AUDIO = '/arbeit/arr/audio';
const opt = () => ({ nr: 1, audioOrdner: AUDIO, frames: () => null });
const leer4 = () => [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }];
const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = leer4(); return p; };
const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const setze = (p, platz, typ, extra = {}) => lauf(p, { befehl: 'platz_setzen', platz, typ, ...extra });
const gueltig = (p) => { const u = pruefeProjekt(kopie(p)); assert.ok('projekt' in u, JSON.stringify(u)); return u.projekt; };
const fehler = (f) => { try { f(); } catch (e) { assert.ok(e instanceof WiedergabeFehler, String(e)); return e.grund; } return assert.fail('not refused'); };
const bkGeraet = { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} };
const mitSeq = (p, platz) => {
  const q = lauf(p, { befehl: 'seq_anlegen', platz });
  const g = q.gruppen.at(-1);
  return lauf(q, { befehl: 'seq_folge_neu', gruppe_id: g.id, name: 'Drums', geraet: bkGeraet });
};
const herkunft = () => ({ quelle_sha256: 'c'.repeat(64), titel: 'Song', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 120, datum: '2026-11-12' });
const mitModul = (p, platz) => {
  const q = lauf(p, { befehl: 'gruppenspur_neu', name: 'M' });
  const id = q.gruppen.at(-1).id;
  return setze(lauf(q, { befehl: 'modul_setzen', gruppe_id: id, modul: herkunft() }), platz, 'stems', { gruppe_id: id });
};
const mitStrom = (p, ...stroeme) => lauf(p, ...stroeme.map((strom) => ({ befehl: 'strom_spur_neu', strom })));
const djVon = (w) => w.gruppen.map((g) => g.ausgang.art === 'dj' ? g.ausgang.nr : null);

test('format and head: a live project is cypherdj-arr/4 with live: true, also when it holds nothing', () => {
  assert.equal(WIEDERGABE_FORMAT_4, 'cypherdj-arr/4');
  const w = uebersetze(live(), opt());
  assert.equal(w.format, 'cypherdj-arr/4');
  assert.equal(w.live, true);
  assert.deepEqual(w.spuren, []);
  assert.deepEqual(w.gruppen, []);
  assert.ok(!('returns' in w));
});

test('a seq group in place 2 plays into dj 2; a loop deck in place 4 into dj 4; a module in place 3 into dj 3', () => {
  const s = gueltig(mitSeq(live(), 2));
  assert.deepEqual(uebersetze(s, opt()).gruppen.map((g) => g.ausgang), [{ art: 'dj', nr: 2 }]);
  const l = gueltig(setze(live(), 4, 'loops'));
  assert.deepEqual(uebersetze(l, opt()).gruppen.map((g) => g.ausgang), [{ art: 'dj', nr: 4 }]);
  const m = gueltig(mitModul(live(), 3));
  assert.deepEqual(uebersetze(m, opt()).gruppen.map((g) => g.ausgang), [{ art: 'dj', nr: 3 }]);
});

test('strudel group in each of A, B, C and D gets dj N', () => {
  for (const n of [1, 2, 3, 4]) {
    const p = gueltig(mitStrom(setze(live(), n, 'strudel'), 5));
    const w = uebersetze(p, opt());
    assert.deepEqual(w.gruppen.map((g) => g.ausgang), [{ art: 'dj', nr: n }]);
    assert.equal(containerNr(p, strudelGruppe(p)), n);
  }
});

test('a nested group keeps its group output; only the top group takes the dj output', () => {
  const p = mitModul(live(), 1);
  const q = lauf(p, { befehl: 'gruppenspur_neu', name: 'Kind' });
  const kind = q.gruppen.at(-1);
  q.gruppen.find((g) => g.id === kind.id).ausgang = { art: 'gruppe', id: p.gruppen[0].id };
  const w = uebersetze(q, opt());
  assert.deepEqual(w.gruppen.map((g) => g.ausgang), [{ art: 'dj', nr: 1 }, { art: 'gruppe', nr: p.gruppen[0].nr }]);
});

test('a strom track is written with its source and without clips; nr values are the stored ones', () => {
  const p = gueltig(mitStrom(setze(live(), 3, 'strudel'), 7, 2));
  const w = uebersetze(p, opt());
  const g = strudelGruppe(p);
  assert.equal(w.spuren.length, 2);
  for (const sp of w.spuren) {
    assert.equal(sp.art, 'intern');
    assert.ok(!('clips' in sp));
    assert.ok(!('geraet' in sp));
    assert.deepEqual(sp.ausgang, { art: 'gruppe', nr: g.nr });
  }
  const s7 = stromSpur(p, 7), s2 = stromSpur(p, 2);
  assert.deepEqual(w.spuren.find((x) => x.nr === s7.nr).quelle, { art: 'strom', strom: 7 });
  assert.deepEqual(w.spuren.find((x) => x.nr === s2.nr).quelle, { art: 'strom', strom: 2 });
});

test('a parked group and its tracks, sends and returns are absent from the playback; the others keep their nr', () => {
  let p = mitSeq(live(), 1);
  p = mitStrom(setze(p, 2, 'strudel'), 5);
  p = lauf(p, { befehl: 'strom_send', spur_id: stromSpur(p, 5).id, ziel: 'hall', db: -6 });
  p = gueltig(p);
  const voll = uebersetze(p, opt());
  assert.equal(voll.gruppen.length, 2);
  assert.equal(voll.returns.length, 1);
  const seqG = p.gruppen.find((g) => g.seq);
  const strG = strudelGruppe(p);
  const geparkt = setze(p, 2, 'track');                 // the strudel group is parked: tracks and return stay in the project
  assert.equal(geparkt.spuren.some((s) => s.art === 'strom'), true);
  const w = uebersetze(geparkt, opt());
  assert.deepEqual(w.gruppen.map((g) => g.nr), [seqG.nr]);
  assert.ok(!w.spuren.some((s) => s.quelle));
  assert.ok(!('returns' in w), 'the return of the parked module is not written');
  assert.deepEqual(w.spuren.map((s) => s.nr), voll.spuren.filter((s) => !s.quelle).map((s) => s.nr));
  assert.ok(strG.nr !== seqG.nr);
});

test('a group no place holds is not written even without a marker, and does not trigger live_ohne_container', () => {
  const p = lauf(live(), { befehl: 'gruppenspur_neu', name: 'frei' });
  const w = uebersetze(p, opt());
  assert.deepEqual(w.gruppen, []);
});

test('return ownership: loop deck, strudel and generic returns get the dj of their owner', () => {
  let p = setze(live(), 4, 'loops');
  p = mitStrom(setze(p, 2, 'strudel'), 1);
  p = lauf(p, { befehl: 'strom_send', spur_id: stromSpur(p, 1).id, ziel: 'delay', db: -3 });
  const deck = loopDeckGruppe(p, 1);
  p = lauf(p, { befehl: 'return_neu', name: 'frei', gruppe_id: deck.id });
  p = lauf(p, { befehl: 'loopdeck_send', spur_id: p.spuren.find((s) => s.ausgang?.id === deck.id).id, ziel: 'hall', db: -6 });
  p = gueltig(p);
  const w = uebersetze(p, opt());
  const durch = (pred) => w.returns.find((r) => r.nr === p.returns.find(pred).nr).ausgang;
  assert.deepEqual(durch((r) => r.strudel), { art: 'dj', nr: 2 });
  assert.deepEqual(durch((r) => r.loopdeck), { art: 'dj', nr: 4 });
  assert.deepEqual(durch((r) => !r.strudel && !r.loopdeck), { art: 'dj', nr: 4 });
});

test('send_ausser_modul: a track that sends into the return of another module is refused', () => {
  let p = mitSeq(live(), 1);
  p = mitStrom(setze(p, 2, 'strudel'), 5);
  p = lauf(p, { befehl: 'strom_send', spur_id: stromSpur(p, 5).id, ziel: 'hall', db: -6 });
  const seqSpur = p.spuren.find((s) => s.art === 'instrument');
  seqSpur.sends = [{ id: p.returns[0].id, db: -6 }];
  assert.equal(fehler(() => uebersetze(p, opt())), 'send_ausser_modul');
  seqSpur.sends = [];
  assert.doesNotThrow(() => uebersetze(p, opt()));
});

test('send_ausser_modul: a nested group that sends into the return of another module is refused; inside its own module it is fine', () => {
  let p = mitSeq(live(), 1);
  p = mitStrom(setze(p, 2, 'strudel'), 5);
  p = lauf(p, { befehl: 'strom_send', spur_id: stromSpur(p, 5).id, ziel: 'hall', db: -6 });
  const seqG = p.gruppen.find((g) => g.seq);
  p = lauf(p, { befehl: 'gruppenspur_neu', name: 'sub' });
  const sub = p.gruppen.at(-1);
  sub.ausgang = { art: 'gruppe', id: seqG.id };
  sub.sends = [{ id: p.returns[0].id, db: -6 }];
  assert.equal(fehler(() => uebersetze(p, opt())), 'send_ausser_modul', 'a group send outside its module');
  sub.sends = [];
  assert.doesNotThrow(() => uebersetze(p, opt()));
  // a top group sending into a foreign return is refused as well
  p.gruppen.find((g) => g.seq).sends = [{ id: p.returns[0].id, db: -6 }];
  assert.equal(fehler(() => uebersetze(p, opt())), 'send_ausser_modul', 'the top group itself');
});

test('send_ausser_modul: a send into the return of a parked module is refused from a placed one; a parked sender is not checked', () => {
  let p = mitSeq(live(), 1);
  p = mitStrom(setze(p, 2, 'strudel'), 5);
  p = lauf(p, { befehl: 'strom_send', spur_id: stromSpur(p, 5).id, ziel: 'hall', db: -6 });
  const geparkt = setze(p, 2, 'track');                  // the strudel group and its return are parked, the owner is still known
  const seqSpur = geparkt.spuren.find((s) => s.art === 'instrument');
  seqSpur.sends = [{ id: geparkt.returns[0].id, db: -6 }];
  assert.equal(fehler(() => uebersetze(geparkt, opt())), 'send_ausser_modul');
  delete seqSpur.sends;
  const strom = stromSpur(geparkt, 5);
  strom.sends = [{ id: geparkt.returns[0].id, db: -6 }];   // the parked track sends into its own return
  assert.doesNotThrow(() => uebersetze(geparkt, opt()));
  // the parked sender sends into a FOREIGN return (owned by the placed sequencer group): not checked, so no throw
  const seqG = geparkt.gruppen.find((g) => g.seq);
  const q = lauf(geparkt, { befehl: 'return_neu', name: 'SEQ R', gruppe_id: seqG.id });
  const fremd = q.returns.find((r) => r.name === 'SEQ R');
  const qs = stromSpur(q, 5);
  qs.sends = [{ id: fremd.id, db: -6 }];
  assert.doesNotThrow(() => uebersetze(q, opt()), 'a parked sender is not checked');
  // control: the same send from a placed track into that foreign-to-it module is refused
  delete qs.sends;
  const nachbar = q.spuren.find((s) => s.art === 'instrument');
  nachbar.sends = [{ id: q.returns.find((r) => r.strudel).id, db: -6 }];
  assert.equal(fehler(() => uebersetze(q, opt())), 'send_ausser_modul');
});

test('live_ohne_container: a track that plays into the master in a live project is refused; so is a return without an owner', () => {
  const p = lauf(live(), { befehl: 'spur_neu', art: 'audio', name: 'lose' });
  assert.equal(fehler(() => uebersetze(p, opt())), 'live_ohne_container');
  const q = lauf(setze(live(), 1, 'strudel'), { befehl: 'return_neu', name: 'r' });
  delete q.returns[0].gruppe;
  assert.equal(fehler(() => uebersetze(q, opt())), 'live_ohne_container');
});

test('the checker on a crafted playback: dj_doppelt, live_ohne_container and a clean one', () => {
  const gut = { format: 'cypherdj-arr/4', nr: 1, live: true, spuren: [{ nr: 1, art: 'intern', quelle: { art: 'strom', strom: 1 }, ausgang: { art: 'gruppe', nr: 1 } }],
    gruppen: [{ nr: 1, ausgang: { art: 'dj', nr: 1 } }], returns: [{ nr: 1, ausgang: { art: 'dj', nr: 1 } }] };
  assert.doesNotThrow(() => pruefeLiveWiedergabe(gut));
  const doppelt = { ...gut, gruppen: [...gut.gruppen, { nr: 2, ausgang: { art: 'dj', nr: 1 } }] };
  assert.equal(fehler(() => pruefeLiveWiedergabe(doppelt)), 'dj_doppelt');
  const master = { ...gut, spuren: [{ nr: 1, art: 'audio', clips: [] }] };
  assert.equal(fehler(() => pruefeLiveWiedergabe(master)), 'live_ohne_container');
  const pm = { ...gut, gruppen: [{ nr: 1, ausgang: { art: 'master' } }] };
  assert.equal(fehler(() => pruefeLiveWiedergabe(pm)), 'live_ohne_container');
  const ret = { ...gut, returns: [{ nr: 1, ausgang: { art: 'master' } }] };
  assert.equal(fehler(() => pruefeLiveWiedergabe(ret)), 'live_ohne_container');
});

test('dj_doppelt cannot arise from valid places', () => {
  let p = mitSeq(live(), 1);
  p = setze(p, 2, 'strudel');
  p = setze(p, 3, 'loops');
  p = setze(p, 4, 'loops');
  const w = uebersetze(gueltig(p), opt());
  assert.deepEqual(djVon(w).slice().sort(), [1, 2, 3, 4]);
});

test('MAX_RETURNS 8 is accepted, 9 is refused', () => {
  assert.equal(MAX_RETURNS, 8);
  let p = setze(live(), 1, 'strudel');
  const gid = strudelGruppe(p).id;
  for (let i = 0; i < 8; i++) p = lauf(p, { befehl: 'return_neu', name: `R${i}`, gruppe_id: gid });
  assert.equal(uebersetze(gueltig(p), opt()).returns.length, 8);
  const neun = kopie(p);
  neun.returns.push({ ...kopie(neun.returns[0]), id: 'r99', nr: 9 });
  assert.equal(fehler(() => uebersetze(neun, opt())), 'zu_gross');
});

test('a production project keeps its format selection and writes no dj output', () => {
  const p = neuesProjekt('prod');
  assert.equal(uebersetze(p, opt()).format, 'cypherdj-arr/1');
  const q = lauf(p, { befehl: 'gruppenspur_neu', name: 'G' });
  const w = uebersetze(q, opt());
  assert.equal(w.format, 'cypherdj-arr/2');
  assert.ok(!('live' in w));
  assert.deepEqual(w.gruppen.map((g) => g.ausgang), [{ art: 'master' }]);
});
