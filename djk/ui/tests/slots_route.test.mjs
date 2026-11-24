// Container core M6: POST /plaetze. One place change per call: the still rule (the strip of the container must be closed), the parking exemption,
// the HTTP reasons of the contract (kein_liveprojekt, platz_offen, typ_einmalig, loopdeck_voll, platz_ungueltig) and one undo step per call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { belegeTestInstanz } from './support/instance.mjs';
import { echterServer } from './support/echter_server.mjs';
import { platzStill, kanaeleVonPlatz, OFFEN_DB } from '../hand_operation.ts';

belegeTestInstanz();
const T = { timeout: 60000 };
const typen = (p) => p.plaetze.map((x) => x.typ);

test('kanaeleVonPlatz: one strip per container, in the order of the pult', () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => kanaeleVonPlatz(n)), [['deck/1'], ['deck/2'], ['pad/1'], ['pad/2']]);
});

test('still table: trim + fader > OFFEN_DB opens a strip (unknown fader -200, unknown trim 0); PFL >= 0.5 too', () => {
  assert.equal(OFFEN_DB, -26);
  const zeilen = [
    [{}, true],                                                                       // nothing known: closed
    [{ 'deck/1/fader': -26 }, true],                                                  // exactly on the threshold: closed
    [{ 'deck/1/fader': -25.9 }, false],
    [{ 'deck/1/fader': -10, 'deck/1/trim': -20 }, true],                             // -30 total
    [{ 'deck/1/fader': -10, 'deck/1/trim': -15 }, false],                            // -25 total
    [{ 'deck/1/trim': 6 }, true],                                                     // unknown fader is -200: a trim alone cannot open
    [{ 'deck/1/fader': -200, 'deck/1/pfl': 1 }, false],                              // closed fader but PFL on
    [{ 'deck/1/fader': -200, 'deck/1/pfl': 0.49 }, true],
  ];
  for (const [regler, still] of zeilen) assert.equal(platzStill(1, regler).still, still, JSON.stringify(regler));
  const offen = platzStill(1, { 'deck/1/fader': 0 });
  assert.deepEqual(offen.offen.map((x) => [x.kanal, x.grund]), [['deck/1', 'open']]);
  assert.deepEqual(platzStill(1, { 'deck/1/fader': -200, 'deck/1/pfl': 1 }).offen.map((x) => x.grund), ['pfl']);
  assert.equal(platzStill(2, { 'deck/1/fader': 0 }).still, true, 'another place is not affected');
});

test('400 platz_ungueltig for place 0 and 5 and for an unknown type', T, async (t) => {
  const { post, o } = await echterServer(t, 'pr1');
  await o.proj.sitzung.liveOeffnen('andreas');
  for (const body of [{ platz: 0, typ: 'seq' }, { platz: 5, typ: 'seq' }, { platz: 1.5, typ: 'seq' }, { platz: 1, typ: 'banane' }, { platz: 1 }, {}]) {
    const r = await post('/plaetze', body);
    assert.deepEqual([r.code, r.j.fehler], [400, 'platz_ungueltig'], JSON.stringify(body));
  }
});

test('409 kein_liveprojekt without a project and with a production project', T, async (t) => {
  const { post, o } = await echterServer(t, 'pr2');
  let r = await post('/plaetze', { platz: 1, typ: 'seq' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_liveprojekt']);
  const n = await o.proj.sitzung.neu('prod', 'andreas');
  assert.equal(n.code, 200, JSON.stringify(n.j));
  r = await post('/plaetze', { platz: 1, typ: 'seq' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_liveprojekt']);
});

test('200: a closed strip lets the place change; answer carries plaetze and rev; the project follows', T, async (t) => {
  const { post, o, projekt, lage } = await echterServer(t, 'pr3');
  await o.proj.sitzung.liveOeffnen('andreas');
  const rev0 = projekt().rev;
  const r = await post('/plaetze', { platz: 1, typ: 'seq' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.ok, true);
  assert.deepEqual(typen(r.j), ['seq', 'track', 'strudel', 'track']);
  assert.ok(r.j.rev > rev0);
  assert.equal(r.j.parken, undefined);
  assert.deepEqual(typen(projekt()), ['seq', 'track', 'strudel', 'track']);
  assert.deepEqual((await lage()).plaetze.map((x) => x.typ), ['seq', 'track', 'strudel', 'track']);
});

test('409 platz_offen grund open when trim + fader > -26 dB; the project is untouched', T, async (t) => {
  const { post, o, projekt } = await echterServer(t, 'pr4');
  await o.proj.sitzung.liveOeffnen('andreas');
  o.stand.regler['deck/1/fader'] = -10; o.stand.regler['deck/1/trim'] = 0;
  const rev = projekt().rev;
  const r = await post('/plaetze', { platz: 1, typ: 'seq' });
  assert.deepEqual([r.code, r.j.fehler, r.j.grund, r.j.kanal], [409, 'platz_offen', 'open', 'deck/1']);
  assert.equal(projekt().rev, rev);
  o.stand.regler['deck/1/fader'] = -40;                                               // closed again: goes
  assert.equal((await post('/plaetze', { platz: 1, typ: 'seq' })).code, 200);
});

test('409 platz_offen grund pfl when only PFL is on', T, async (t) => {
  const { post, o } = await echterServer(t, 'pr5');
  await o.proj.sitzung.liveOeffnen('andreas');
  o.stand.regler['deck/2/fader'] = -200; o.stand.regler['deck/2/pfl'] = 1;
  const r = await post('/plaetze', { platz: 2, typ: 'seq' });
  assert.deepEqual([r.code, r.j.fehler, r.j.grund, r.j.kanal], [409, 'platz_offen', 'pfl', 'deck/2']);
});

test('a place that holds a SEQ deck or a loop deck is parked without the still rule and answers parken: true', T, async (t) => {
  const { post, o, projekt } = await echterServer(t, 'pr6');
  await o.proj.sitzung.liveOeffnen('andreas');
  assert.equal((await post('/plaetze', { platz: 1, typ: 'seq' })).code, 200);
  assert.equal((await post('/plaetze', { platz: 2, typ: 'loops' })).code, 200);
  o.stand.regler['deck/1/fader'] = 0; o.stand.regler['deck/2/fader'] = 0;              // both strips open: the decks play
  const g1 = projekt().plaetze[0].gruppe, g2 = projekt().plaetze[1].gruppe;
  let r = await post('/plaetze', { platz: 1, typ: 'track' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(r.j.parken, true);
  r = await post('/plaetze', { platz: 2, typ: 'leer' });
  assert.deepEqual([r.code, r.j.parken], [200, true], JSON.stringify(r.j));
  assert.ok(projekt().gruppen.some((g) => g.id === g1) && projekt().gruppen.some((g) => g.id === g2), 'parked, not deleted');
  // and the very same group comes back
  o.stand.regler['deck/1/fader'] = -200;
  r = await post('/plaetze', { platz: 1, typ: 'seq', gruppe_id: g1 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(projekt().plaetze[0].gruppe, g1);
});

test('409 typ_einmalig for a second strudel place; the first one stays', T, async (t) => {
  const { post, o, projekt } = await echterServer(t, 'pr7');
  await o.proj.sitzung.liveOeffnen('andreas');
  const r = await post('/plaetze', { platz: 1, typ: 'strudel' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'typ_einmalig'], JSON.stringify(r.j));
  assert.deepEqual(typen(projekt()), ['track', 'track', 'strudel', 'track']);
});

test('409 loopdeck_voll when both loop decks exist', T, async (t) => {
  const { post, o } = await echterServer(t, 'pr8');
  await o.proj.sitzung.liveOeffnen('andreas');
  assert.equal((await post('/plaetze', { platz: 1, typ: 'loops' })).code, 200);
  assert.equal((await post('/plaetze', { platz: 2, typ: 'loops' })).code, 200);
  const r = await post('/plaetze', { platz: 4, typ: 'loops' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'loopdeck_voll'], JSON.stringify(r.j));
});

test('a parked loop deck comes back on the next LOOPS click: no new deck, never loopdeck_voll (the page sends no gruppe_id)', { timeout: 240000 }, async (t) => {
  const { post, o, projekt } = await echterServer(t, 'pr8b');
  await o.proj.sitzung.liveOeffnen('andreas');
  assert.equal((await post('/plaetze', { platz: 1, typ: 'loops' })).code, 200);
  const deckA = projekt().plaetze[0].gruppe;
  const decks = () => projekt().gruppen.filter((g) => g.loopdeck).length;
  for (let i = 0; i < 2; i++) {                                                       // park, show again: the same deck every time
    assert.equal((await post('/plaetze', { platz: 1, typ: 'track' })).code, 200);
    const r = await post('/plaetze', { platz: 1, typ: 'loops' });
    assert.equal(r.code, 200, `round ${i}: ${JSON.stringify(r.j)}`);
    assert.equal(projekt().plaetze[0].gruppe, deckA, `round ${i}: the parked deck, not a new one`);
  }
  assert.equal(decks(), 1, 'no second deck was created');
  // deck A parked, deck B placed: a click on place 3 shows the parked deck A, and a third deck never appears
  assert.equal((await post('/plaetze', { platz: 2, typ: 'loops' })).code, 200);
  assert.equal((await post('/plaetze', { platz: 1, typ: 'track' })).code, 200);
  const r = await post('/plaetze', { platz: 4, typ: 'loops' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(projekt().plaetze[3].gruppe, deckA);
  assert.equal(decks(), 2);
});

test('a parked SEQ deck comes back on the next SEQ click: same group, its pattern intact, no orphan', { timeout: 240000 }, async (t) => {
  const { post, o, projekt } = await echterServer(t, 'pr8c');
  await o.proj.sitzung.liveOeffnen('andreas');
  assert.equal((await post('/plaetze', { platz: 1, typ: 'seq' })).code, 200);
  const deck = projekt().plaetze[0].gruppe;
  const n = await o.proj.sitzung.aendern({ rev: projekt().rev, label: 'pattern', befehle: [{ befehl: 'seq_folge_neu', gruppe_id: deck, name: 'Bass', geraet: { art: 'intern', name: 'rb338' } }] }, 'andreas');
  assert.equal(n.code, 200, JSON.stringify(n.j));
  const seqGruppen = () => projekt().gruppen.filter((g) => g.seq);
  const muster = () => projekt().spuren.filter((s) => s.ausgang?.id === deck).map((s) => s.name);
  assert.deepEqual(muster(), ['Bass']);
  for (let i = 0; i < 2; i++) {
    assert.equal((await post('/plaetze', { platz: 1, typ: 'track' })).code, 200);
    const r = await post('/plaetze', { platz: 1, typ: 'seq' });
    assert.equal(r.code, 200, `round ${i}: ${JSON.stringify(r.j)}`);
    assert.equal(projekt().plaetze[0].gruppe, deck, `round ${i}: the parked SEQ deck, not a new one`);
    assert.deepEqual(muster(), ['Bass'], `round ${i}: pattern intact`);
  }
  assert.equal(seqGruppen().length, 1, 'no orphan group was created');
});

test('a project with several orphaned SEQ groups still works: the first one comes back on SEQ, nothing new is created', { timeout: 240000 }, async (t) => {
  const { post, o, projekt } = await echterServer(t, 'pr8d');
  await o.proj.sitzung.liveOeffnen('andreas');
  const ids = [];
  for (let i = 0; i < 3; i++) {                                                       // the old way: seq_anlegen on a place, then park it
    const a = await o.proj.sitzung.aendern({ rev: projekt().rev, label: 'seq', befehle: [{ befehl: 'seq_anlegen', platz: 1 }] }, 'andreas');
    assert.equal(a.code, 200, JSON.stringify(a.j));
    ids.push(projekt().plaetze[0].gruppe);
    assert.equal((await post('/plaetze', { platz: 1, typ: 'track' })).code, 200);
  }
  assert.equal(new Set(ids).size, 3);
  assert.equal(projekt().gruppen.filter((g) => g.seq).length, 3);
  const r = await post('/plaetze', { platz: 2, typ: 'seq' });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(projekt().plaetze[1].gruppe, ids[0], 'the first orphan is reachable');
  assert.equal(projekt().gruppen.filter((g) => g.seq).length, 3, 'still three, none added');
});

test('the same type again changes nothing and answers ok', T, async (t) => {
  const { post, o, projekt } = await echterServer(t, 'pr9');
  await o.proj.sitzung.liveOeffnen('andreas');
  const rev = projekt().rev;
  o.stand.regler['deck/1/fader'] = 0;                                                 // open strip: the rule is skipped for the same type
  const r = await post('/plaetze', { platz: 1, typ: 'track' });
  assert.deepEqual([r.code, r.j.ok, r.j.rev], [200, true, rev]);
});

test('one call is one undo step', T, async (t) => {
  const { post, o, projekt } = await echterServer(t, 'pr10');
  await o.proj.sitzung.liveOeffnen('andreas');
  const vorher = typen(projekt());
  assert.equal((await post('/plaetze', { platz: 4, typ: 'seq' })).code, 200);
  assert.deepEqual(typen(projekt()), ['track', 'track', 'strudel', 'seq']);
  const u = await post('/proj/undo', { rev: projekt().rev });
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.deepEqual(typen(projekt()), vorher);
});
