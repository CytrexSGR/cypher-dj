// Send automation, task 2: the project target `send.<returnId>` of a track lane. Model and commands (create, refusals, send_setzen, return_loeschen, undo),
// the playback (send.<return number>, same format string, no change without a send lane, parked returns), the override and recording paths (not reached),
// and the model check of a stored project.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fuehreListeAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, pruefeFehler, lanePruefung, kanonisch, istSendZiel, sendZielVon, sendZiele, SEND_BEREICH, MAX_LANES_PRO_SPUR } from '../project/model.ts';
import { Verlauf, aendere, rueckgaengig } from '../project/history.ts';
import { uebersetze } from '../project/playback.ts';
import { mergeWiedergabe } from '../project/merge.ts';
import { GRUND_TEXT } from '../http/reasons.ts';
import { SitzungAuto } from '../areas/proj/session_auto.ts';
import { KERN_AUTO_ZIELE, istKernAutoZiel } from '../areas/proj/core_path.ts';
import { AUFNAHME_ZIELE } from '../areas/proj/recording_auto.ts';
import { tmpOrdner, kopie } from './support/project.mjs';
import { lauf, ohneSendLane, OPT } from './support/send_lanes_setup.mjs';

const lehntAb = (p, b, grund, text) => assert.throws(() => lauf(p, b), (e) => {
  assert.ok(e instanceof BefehlFehler, String(e));
  assert.equal(e.grund, grund, `${grund} expected, got ${e.grund}: ${e.message}`);
  if (text) assert.match(e.message, text);
  return true;
});
const gueltig = (p) => { const u = pruefeProjekt(kopie(p)); assert.ok('projekt' in u, JSON.stringify(u)); return u.projekt; };
const laneAuf = (p, spurId, ziel) => p.spuren.find((s) => s.id === spurId).automation?.find((l) => l.ziel === ziel);
const lanenVon = (w, nr) => (w.spuren.find((s) => s.nr === nr).auto ?? []).filter((l) => l.ziel.startsWith('send.'));

// ---- the target and its helpers ---------------------------------------------------------------------------------------------------------

test('send target helpers: send.<return id>, range of send_setzen, the offer of a track is its sends in order', () => {
  assert.equal(istSendZiel('send.r1'), true);
  for (const x of ['send.', 'send', 'send.1/x', 'sends.r1', 'insert.r1.gain', 'fader', 'send.9x y', 5]) assert.equal(istSendZiel(x), false, String(x));
  assert.equal(sendZielVon('send.r12'), 'r12');
  assert.equal(sendZielVon('fader'), null);
  assert.deepEqual(SEND_BEREICH, { min: -200, max: 6, nurSprung: false });
  const p = ohneSendLane();
  assert.deepEqual(sendZiele(p.spuren[0]), ['send.r1']);
  assert.deepEqual(sendZiele(p.spuren[1]), ['send.r2']);
  assert.deepEqual(sendZiele({ sends: undefined }), []);
});

// ---- auto_neu -----------------------------------------------------------------------------------------------------------------------------

test('auto_neu send.<id> on a track with that send creates the lane at the send level (between the loop marks); it is valid and shown like any lane', () => {
  const p0 = ohneSendLane();
  const p = lauf(p0, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' });
  const l = laneAuf(p, 's1', 'send.r1');
  assert.ok(l, 'lane exists');
  assert.deepEqual(l.punkte.map((q) => q.wert), [-6, -6]);
  assert.equal(l.punkte[0].beat, p.loop.von_beat);
  gueltig(p);
  assert.equal(lanePruefung(l, { sends: p.spuren[0].sends }), null);
  assert.equal(lanePruefung(l, { sends: [] })?.grund, 'ziel_unbekannt');
  assert.equal(lanePruefung(l)?.grund, 'ziel_unbekannt', 'without a strip nothing is known about the send');
  const mitPunkten = lauf(p0, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1', punkte: [{ beat: 0, wert: -60 }, { beat: 4, wert: 0 }, { beat: 8, wert: -200 }] });
  assert.deepEqual(laneAuf(mitPunkten, 's1', 'send.r1').punkte.map((q) => q.wert), [-60, 0, -200], '-200 is a legal point (silence)');
  const editiert = lauf(mitPunkten, { befehl: 'auto_punkte', lane_id: laneAuf(mitPunkten, 's1', 'send.r1').id, setze: [{ beat: 2, wert: -30 }] });
  assert.deepEqual(laneAuf(editiert, 's1', 'send.r1').punkte.map((q) => q.wert), [-60, -30, 0, -200]);
});

test('auto_neu send.<id> is refused with a literal text: no such send, unknown return, group, return or master as strip, range, second lane', () => {
  const p = ohneSendLane();
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r2' }, 'ziel_unbekannt', /no send into the return r2/);
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r9' }, 'return_unbekannt', /r9/);
  const g = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1'] }, { befehl: 'send_setzen', strang_id: 'g1', return_id: 'r1', db: -3 }]);
  lehntAb(g, { befehl: 'auto_neu', strang_id: 'g1', ziel: 'send.r1' }, 'ziel_unbekannt', /send lane belongs to a track/);
  lehntAb(g, { befehl: 'auto_neu', strang_id: 'r1', ziel: 'send.r1' }, 'ziel_unbekannt', /send lane belongs to a track/);
  lehntAb(g, { befehl: 'auto_neu', strang_id: 'master', ziel: 'send.r1' }, 'ziel_unbekannt', /send lane belongs to a track/);
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1', punkte: [{ beat: 0, wert: 7 }] }, 'argument_ungueltig', /-200\.\.6/);
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1', punkte: [{ beat: 0, wert: -201 }] }, 'argument_ungueltig', /-200\.\.6/);
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.' }, 'ziel_unbekannt');
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'sendr1' }, 'ziel_unbekannt');
  const mit = lauf(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' });
  lehntAb(mit, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' }, 'lane_doppelt');
  // a clip envelope cannot name a send: a send lane can never become a relative (summed) lane
  assert.throws(() => lauf(mit, { befehl: 'huellkurve_setzen', clip_id: 'c1', ziel: 'send.r1', punkte: [{ beat: 0, wert: -6 }] }), BefehlFehler);
});

test('the lane limit counts send lanes; eight sends and four mixer lanes fit the 12', () => {
  let p = neuesProjekt('Acht');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'audio' }, ...Array.from({ length: 8 }, () => ({ befehl: 'return_neu' }))]);
  for (const r of p.returns) p = lauf(p, [{ befehl: 'send_setzen', strang_id: 's1', return_id: r.id, db: -10 }, { befehl: 'auto_neu', spur_id: 's1', ziel: `send.${r.id}` }]);
  for (const z of ['fader', 'pan', 'mute', 'solo']) p = lauf(p, { befehl: 'auto_neu', spur_id: 's1', ziel: z });
  assert.equal(p.spuren[0].automation.length, MAX_LANES_PRO_SPUR);
  gueltig(p);
  lehntAb(p, { befehl: 'auto_neu', spur_id: 's1', ziel: 'geraet.cutoff' }, 'ziel_unbekannt');   // the 13th is refused whatever it is
  const w = uebersetze(p, OPT);
  assert.deepEqual(w.spuren[0].auto.filter((l) => l.ziel.startsWith('send.')).map((l) => l.ziel), Array.from({ length: 8 }, (_, i) => `send.${i + 1}`));
});

// ---- send_setzen, return_loeschen, track delete, undo -------------------------------------------------------------------------------------

test('send_setzen to -200 on a send with a lane is refused (send_hat_lane); every other level and a send without a lane are free', () => {
  const p = lauf(ohneSendLane(), { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' });
  lehntAb(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -200 }, 'send_hat_lane', /remove the send lane first/);
  assert.equal(p.spuren[0].sends[0].db, -6, 'nothing changed');
  const lauter = lauf(p, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -20 });
  assert.equal(lauter.spuren[0].sends[0].db, -20, 'the knob keeps being stored');
  assert.equal(lauf(p, { befehl: 'send_setzen', strang_id: 's2', return_id: 'r2', db: -200 }).spuren[1].sends, undefined, 'a send without a lane goes as before');
  const weg = lauf(p, [{ befehl: 'auto_loeschen', lane_id: laneAuf(p, 's1', 'send.r1').id }, { befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -200 }]);
  assert.equal(weg.spuren[0].sends, undefined, 'after the lane is gone the send can go');
  const mitGruppe = lauf(p, [{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s2'] }, { befehl: 'send_setzen', strang_id: 'g1', return_id: 'r1', db: -3 }]);
  assert.equal(lauf(mitGruppe, { befehl: 'send_setzen', strang_id: 'g1', return_id: 'r1', db: -200 }).gruppen[0].sends, undefined, 'a group send never has a lane');
  assert.ok(GRUND_TEXT.send_hat_lane && /[a-z]/.test(GRUND_TEXT.send_hat_lane));
});

test('return_loeschen removes the lanes of that return on every track in one step; undo restores return, sends and lanes together', (t) => {
  let p = ohneSendLane();
  p = lauf(p, [{ befehl: 'send_setzen', strang_id: 's2', return_id: 'r1', db: -9 }, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' },
    { befehl: 'auto_neu', spur_id: 's2', ziel: 'send.r1' }, { befehl: 'auto_neu', spur_id: 's2', ziel: 'send.r2' }]);
  const v = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 1_000_000, zeitgeber: false });
  const n = aendere(v, p, [{ befehl: 'return_loeschen', return_id: 'r1' }], { quelle: 'andreas', label: 'Delete return' }).projekt;
  assert.equal(laneAuf(n, 's1', 'send.r1'), undefined);
  assert.equal(laneAuf(n, 's2', 'send.r1'), undefined);
  assert.ok(laneAuf(n, 's2', 'send.r2'), 'the lane of the other return stays');
  assert.equal(n.spuren[0].automation?.some((l) => l.ziel === 'fader'), true, 'other lanes stay');
  assert.deepEqual(n.spuren[1].sends.map((s) => s.id), ['r2']);
  assert.equal(JSON.stringify(n).includes('send.r1'), false, 'nothing dangling');
  gueltig(n);
  const zurueck = rueckgaengig(v, n, { quelle: 'andreas' }).projekt;
  assert.equal(kanonisch({ ...zurueck, rev: 0 }), kanonisch({ ...p, rev: 0 }), 'undo restores returns, sends and lanes in one step');
  // a track that has the only lane: its list loses the key, not an empty list
  const q = lauf(lauf(neuesProjekt('x'), [{ befehl: 'spur_neu', art: 'audio' }, { befehl: 'return_neu' }]),
    [{ befehl: 'send_setzen', strang_id: 's1', return_id: 'r1', db: -5 }, { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' }, { befehl: 'return_loeschen', return_id: 'r1' }]);
  assert.equal('automation' in q.spuren[0], false);
});

test('deleting the track removes its lanes with it; the stored project stays valid', () => {
  const p = lauf(ohneSendLane(), [{ befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' }, { befehl: 'spur_loeschen', spur_id: 's1' }]);
  assert.equal(JSON.stringify(p).includes('send.r1'), false);
  gueltig(p);
});

// ---- the model check of a stored project ----------------------------------------------------------------------------------------------------

test('model check: a send lane needs the send on its track, sits on tracks only, no target twice', () => {
  const p = lauf(ohneSendLane(), { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' });
  gueltig(p);
  const f = (mut) => { const q = kopie(p); mut(q); return pruefeFehler(q) ?? 'valid'; };
  assert.match(f((q) => { delete q.spuren[0].sends; }), /send/);
  assert.match(f((q) => { q.spuren[0].sends[0].id = 'r2'; }), /send\.r1/);
  assert.match(f((q) => { q.spuren[1].automation = [{ id: 'a9', ziel: 'send.r1', punkte: [{ beat: 0, wert: -6 }] }]; }), /send\.r1/, 's2 has no send into r1');
  assert.match(f((q) => { q.returns[0].automation = [{ id: 'a9', ziel: 'send.r1', punkte: [{ beat: 0, wert: -6 }] }]; }), /automation/, 'not on a return');
  assert.match(f((q) => { q.gruppen = [{ id: 'g1', nr: 1, name: 'G', farbe: '#112233', fader_db: 0, pan: 0, mute: false, solo: false, gefaltet: false,
    sends: [{ id: 'r1', db: -3 }], automation: [{ id: 'a9', ziel: 'send.r1', punkte: [{ beat: 0, wert: -6 }] }] }]; }), /automation/, 'not on a group');
  assert.match(f((q) => { q.spuren[0].automation.push({ id: 'a9', ziel: 'send.r1', punkte: [{ beat: 0, wert: -6 }] }); }), /doppelt/);
  assert.match(f((q) => { q.spuren[0].automation[0].punkte[0].wert = 9; }), /-200\.\.6/);
  assert.match(f((q) => { q.spuren[0].automation[0].ziel = 'send.r1 '; }), /ziel/);
});

// ---- the playback --------------------------------------------------------------------------------------------------------------------------

test('a project without send lanes writes the playback text of the base commit (golden recorded before this task)', () => {
  const golden = fs.readFileSync(new URL('./golden/send_ohne_lane_wiedergabe.json', import.meta.url), 'utf8');
  assert.equal(JSON.stringify(uebersetze(ohneSendLane(), OPT)) + '\n', golden);
});

test('the playback carries send.<r> with r = the number of the return (Return.nr, not the list position) and the format string of the project without the lane', () => {
  const p = lauf(ohneSendLane(), { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1', punkte: [{ beat: 0, wert: -60 }, { beat: 4, wert: 0, form: 's' }] });
  const w = uebersetze(p, OPT);
  assert.deepEqual(lanenVon(w, 1), [{ ziel: 'send.1', punkte: [[0, -60, 0], [4, 0, 1]] }]);
  assert.equal(w.format, uebersetze(ohneSendLane(), OPT).format);
  assert.equal(w.format, 'cypherdj-arr/2');
  assert.deepEqual(w.spuren[0].auto.map((l) => l.ziel), ['fader', 'send.1'], 'in the order of the project lanes');
  // return 1 deleted: return 2 keeps its number, the lane of the bass track names send.2
  let q = lauf(ohneSendLane(), [{ befehl: 'auto_neu', spur_id: 's2', ziel: 'send.r2' }, { befehl: 'return_loeschen', return_id: 'r1' }]);
  q = gueltig(q);
  const wq = uebersetze(q, OPT);
  assert.deepEqual(wq.returns.map((r) => r.nr), [2]);
  assert.deepEqual(lanenVon(wq, 2).map((l) => l.ziel), ['send.2']);
  // a new return takes the lowest free number: 1 again, a different id
  const r = lauf(q, { befehl: 'return_neu' });
  assert.deepEqual(r.returns.map((x) => [x.id, x.nr]).sort(), [['r2', 2], ['r3', 1]]);
});

test('the point count of send lanes counts with the other lanes; a send lane sits next to a relative lane and fx lanes untouched', () => {
  const p = lauf(ohneSendLane(), [{ befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' }, { befehl: 'auto_neu', spur_id: 's1', ziel: 'pan' }]);
  const w = uebersetze(p, OPT);
  assert.deepEqual(w.spuren[0].auto.map((l) => l.ziel), ['fader', 'send.1', 'pan']);
  assert.ok(!w.spuren[0].auto.some((l) => l.relativ));
});

test('live project: a send lane of a placed track plays; a parked module, its track, its return and its lane are all absent and nothing throws', () => {
  const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }]; return p; };
  const bk = { art: 'intern', name: 'bk', graph: 'drums-909', parameter: {} };
  let p = lauf(live(), { befehl: 'seq_anlegen', platz: 1 });
  const g = p.gruppen.at(-1);
  p = lauf(p, [{ befehl: 'seq_folge_neu', gruppe_id: g.id, name: 'Drums', geraet: bk }, { befehl: 'return_neu', name: 'R', gruppe_id: g.id }]);
  const sp = p.spuren.find((s) => s.art === 'instrument');
  p = lauf(p, [{ befehl: 'send_setzen', strang_id: sp.id, return_id: p.returns[0].id, db: -6 }, { befehl: 'auto_neu', spur_id: sp.id, ziel: `send.${p.returns[0].id}` }]);
  const w = uebersetze(p, OPT);
  assert.equal(w.format, 'cypherdj-arr/4');
  assert.deepEqual(w.returns.map((r) => r.nr), [1]);
  assert.deepEqual(lanenVon(w, sp.nr).map((l) => l.ziel), ['send.1']);
  const geparkt = lauf(p, { befehl: 'platz_setzen', platz: 1, typ: 'leer' });
  const wg = uebersetze(geparkt, OPT);
  assert.ok(!('returns' in wg));
  assert.equal(JSON.stringify(wg).includes('send.'), false, 'no send lane without its return');
});

// ---- merge, override and recording ----------------------------------------------------------------------------------------------------------

test('the merge snapshot drops send lanes of its sources (the merge renders dry: a lane would beat the explicit send -200 row)', () => {
  const p = lauf(ohneSendLane(), [{ befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' }, { befehl: 'auto_neu', spur_id: 's2', ziel: 'send.r2' }]);
  const q = mergeWiedergabe(p, ['s1', 's2']);
  assert.deepEqual(q.spuren.map((s) => (s.automation ?? []).map((l) => l.ziel)), [['fader'], []]);
  assert.equal('automation' in q.spuren[1], false);
  assert.equal(JSON.stringify(uebersetze(q, OPT)).includes('send.'), false);
  assert.equal(p.spuren[0].automation.length, 2, 'the project itself is untouched');
});

test('override and recording know only the four core fields: a send lane is no override target and does not throw in any of these paths', async () => {
  const p = lauf(ohneSendLane(), { befehl: 'auto_neu', spur_id: 's1', ziel: 'send.r1' });
  assert.deepEqual([...KERN_AUTO_ZIELE], ['fader', 'pan', 'mute', 'solo']);
  assert.deepEqual([...AUFNAHME_ZIELE], [...KERN_AUTO_ZIELE]);
  assert.equal(istKernAutoZiel('send.r1'), false);
  assert.equal(istKernAutoZiel('send.1'), false);
  const h = { riegel: () => {}, brauchOffen: () => ({ projekt: p }), uebersteuert: new Map(), offen: { projekt: p }, aufAuto: {}, ctx: {}, kern: {}, aendern: async () => ({ code: 200, j: {} }) };
  const a = new SitzungAuto(h);
  assert.deepEqual(a.uebersteuertListe(p), []);
  a.nimmAuto({ spur: 1, ziel: 'send.1', zustand: 1 });
  assert.equal(h.uebersteuert.size, 0, 'an event of a send field is ignored');
  assert.throws(() => a.autoGeste({ spur_id: 's1', ziel: 'send.r1', wert: -6 }, 'andreas'), (e) => e.grund === 'auto_ziel_unbekannt' || /auto_ziel_unbekannt/.test(String(e.message)) || e.code === 400);
  assert.equal(istSendZiel('send.r1') && p.spuren[0].automation.some((l) => l.ziel === 'send.r1'), true);
});
