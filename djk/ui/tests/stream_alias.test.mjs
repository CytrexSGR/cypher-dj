// Container core M7: the pure alias resolver erz/<n>/<suffix> onto the strom track of stream n (table D1 of the M plan, F10 R3/R4/R9).
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuesProjekt, stromSpur, strudelGruppe } from '../project/model.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { loeseAlias, rueckAlias, istStromZeile, ALIAS_SUFFIXE, ALIAS_ZEILEN_K, STROM_LIVE_ZEILEN } from '../stream_alias.ts';
import { PFAD } from '../hand_operation.ts';
import { PULT_ALIAS_SUFFIXE } from '../../contract/pult.ts';

const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
const leer4 = () => [{ typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }, { typ: 'leer' }];
const live = () => { const p = neuesProjekt('x'); p.live = true; p.plaetze = leer4(); return p; };
const keinGraph = () => null;
// strudel group at place 3, strom tracks 2 and 5, hall and delay returns (stream 2 sends into both), a komp insert on stream 2, a bk insert on stream 5
function fixture() {
  let p = lauf(live(), { befehl: 'platz_setzen', platz: 3, typ: 'strudel' }, { befehl: 'strom_spur_neu', strom: 2 }, { befehl: 'strom_spur_neu', strom: 5 });
  const s2 = stromSpur(p, 2), s5 = stromSpur(p, 5);
  p = lauf(p, { befehl: 'strom_send', spur_id: s2.id, ziel: 'hall', db: -6 }, { befehl: 'strom_send', spur_id: s2.id, ziel: 'delay', db: -9 },
    { befehl: 'insert_setzen', strang_id: s2.id, pos: 0, art: 'komp' },
    { befehl: 'insert_setzen', strang_id: s5.id, pos: 0, art: 'bk', graph: 'inst' });
  return p;
}
const nr = (p, n) => stromSpur(p, n).nr;
const id = (p, n) => stromSpur(p, n).id;
const gib = (p, pfad, gk = keinGraph) => loeseAlias(p, pfad, gk);

test('the suffix table is the generated one (pult.json alias_suffixe)', () => {
  assert.deepEqual([...ALIAS_SUFFIXE], [...PULT_ALIAS_SUFFIXE]);
});

test('row exists: fader, pan, mute, solo, filter, eq/<band> resolve to spur/<nr>/<suffix>', () => {
  const p = fixture();
  for (const s of ['fader', 'pan', 'mute', 'solo', 'filter', 'eq/tief', 'eq/mitte', 'eq/hoch']) {
    assert.deepEqual(gib(p, `erz/2/${s}`), { art: 'zeile', pfad: `spur/${nr(p, 2)}/${s}`, strom: 2, spur_id: id(p, 2) }, s);
    assert.deepEqual(gib(p, `erz/5/${s}`), { art: 'zeile', pfad: `spur/${nr(p, 5)}/${s}`, strom: 5, spur_id: id(p, 5) }, s);
  }
});

test('kill/<band> resolves to the kill row of the band (K7), not to an emulation on the eq row', () => {
  const p = fixture();
  for (const b of ['tief', 'mitte', 'hoch']) {
    assert.deepEqual(gib(p, `erz/2/kill/${b}`), { art: 'zeile', pfad: `spur/${nr(p, 2)}/kill/${b}`, strom: 2, spur_id: id(p, 2) });
  }
});

test('send/1 resolves to the row index of the strudel hall return, send/2 to the delay return', () => {
  const p = fixture();
  const hall = p.returns.find((r) => r.strudel?.art === 'hall'), delay = p.returns.find((r) => r.strudel?.art === 'delay');
  assert.deepEqual(gib(p, 'erz/2/send/1'), { art: 'zeile', pfad: `spur/${nr(p, 2)}/send/${hall.nr}`, strom: 2, spur_id: id(p, 2) });
  assert.deepEqual(gib(p, 'erz/5/send/2'), { art: 'zeile', pfad: `spur/${nr(p, 5)}/send/${delay.nr}`, strom: 5, spur_id: id(p, 5) });
});

test('send/3 and send/4 reach no module return: kein_modul_send (F10 R3); a send without its strudel return yet is kein_alias_ziel', () => {
  const p = fixture();
  for (const s of [3, 4]) assert.equal(gib(p, `erz/2/send/${s}`).code, 'kein_modul_send');
  const ohne = lauf(live(), { befehl: 'platz_setzen', platz: 3, typ: 'strudel' }, { befehl: 'strom_spur_neu', strom: 2 });
  const r = gib(ohne, 'erz/2/send/1');
  assert.deepEqual([r.art, r.code], ['fehler', 'kein_alias_ziel']);
});

test('pfl and trim resolve to their track rows (K7, flag ALIAS_ZEILEN_K on)', () => {
  assert.equal(ALIAS_ZEILEN_K, true);
  const p = fixture();
  for (const s of ['pfl', 'trim']) assert.deepEqual(gib(p, `erz/2/${s}`), { art: 'zeile', pfad: `spur/${nr(p, 2)}/${s}`, strom: 2, spur_id: id(p, 2) }, s);
});

test('xseite, ziel, stem/*, transport and unknown suffixes are kein_alias_ziel', () => {
  const p = fixture();
  for (const s of ['xseite', 'ziel', 'stem/drums', 'transport', 'gate/an', 'nonsense']) assert.equal(gib(p, `erz/2/${s}`).code, 'kein_alias_ziel', s);
});

test('komp/<param> is a project insert of the track; without a komp insert it is keine_komp_stufe', () => {
  const p = fixture();
  for (const k of ['an', 'schwelle', 'ratio', 'attack', 'release', 'makeup', 'mix', 'sc']) {
    assert.deepEqual(gib(p, `erz/2/komp/${k}`), { art: 'insert', strom: 2, spur_id: id(p, 2), insert: 'komp', param: k }, k);
  }
  assert.equal(gib(p, 'erz/5/komp/an').code, 'keine_komp_stufe');
});

test('bk/<k> with an instrument graph is strom/<n>/bk/<k>, with an effect graph the bk insert of the track, neither is kein_graph', () => {
  const p = fixture();
  assert.deepEqual(gib(p, 'erz/2/bk/7', () => 'instrument'), { art: 'zeile', pfad: 'strom/2/bk/7', strom: 2, spur_id: id(p, 2) });
  assert.deepEqual(gib(p, 'erz/5/bk/7', () => 'effekt'), { art: 'insert', strom: 5, spur_id: id(p, 5), insert: 'bk', param: 'k7' });
  assert.equal(gib(p, 'erz/5/bk/7').code, 'kein_graph');
  assert.equal(gib(p, 'erz/2/bk/7', () => 'effekt').code, 'kein_graph', 'an effect graph needs the bk insert of the track');
  const gesehen = [];
  gib(p, 'erz/5/bk/1', (k) => { gesehen.push(k); return 'instrument'; });
  assert.deepEqual(gesehen, ['erz/5']);
  assert.equal(gib(p, 'erz/2/bk/65', () => 'instrument').code, 'kein_alias_ziel');
  assert.equal(gib(p, 'erz/2/bk/0', () => 'instrument').code, 'kein_alias_ziel');
});

test('refusal order: no project, no live project, no strudel group, no strom track', () => {
  assert.equal(gib(null, 'erz/2/fader').code, 'kein_liveprojekt');
  assert.equal(gib(neuesProjekt('prod'), 'erz/2/fader').code, 'kein_liveprojekt');
  assert.equal(gib(neuesProjekt('prod'), 'erz/2/xseite').code, 'kein_liveprojekt', 'common to every suffix');
  assert.equal(gib(live(), 'erz/2/fader').code, 'kein_strudel_modul');
  const ohneTrack = lauf(live(), { befehl: 'platz_setzen', platz: 3, typ: 'strudel' });
  assert.equal(gib(ohneTrack, 'erz/2/fader').code, 'keine_strom_spur');
  assert.equal(gib(fixture(), 'erz/6/fader').code, 'keine_strom_spur');
});

test('a parked strudel group is not a module: kein_strudel_modul', () => {
  const p = lauf(fixture(), { befehl: 'platz_setzen', platz: 3, typ: 'track' });
  assert.ok(strudelGruppe(p), 'parked, not removed');
  assert.equal(gib(p, 'erz/2/fader').code, 'kein_strudel_modul');
});

test('erz/17/fader, erz/0/fader and paths that are no alias are keiner', () => {
  const p = fixture();
  for (const x of ['erz/17/fader', 'erz/0/fader', 'erz/02/fader', 'erz/2', 'erz/2/', 'deck/1/fader', 'spur/1/fader', 'erz/a/fader']) assert.deepEqual(gib(p, x), { art: 'keiner' }, x);
  assert.deepEqual(gib(null, 'erz/17/fader'), { art: 'keiner' });
});

test('rueckAlias is the inverse of loeseAlias for every row class', () => {
  const p = fixture();
  const zeilen = ['fader', 'pan', 'mute', 'solo', 'filter', 'eq/tief', 'eq/mitte', 'eq/hoch', 'send/1', 'send/2'];
  for (const n of [2, 5]) {
    for (const s of zeilen) {
      const r = gib(p, `erz/${n}/${s}`);
      assert.equal(r.art, 'zeile');
      assert.equal(rueckAlias(p, r.pfad), `erz/${n}/${s}`, s);
    }
  }
  assert.equal(rueckAlias(p, gib(p, 'erz/2/bk/3', () => 'instrument').pfad), 'erz/2/bk/3');
  // insert rows: komp of stream 2 and bk of stream 5
  const komp = p.spuren.find((s) => s.strom === 2).inserts.find((i) => i.art === 'komp');
  assert.equal(rueckAlias(p, `ins/komp/${komp.slot}/schwelle`), 'erz/2/komp/schwelle');
  const bk = p.spuren.find((s) => s.strom === 5).inserts.find((i) => i.art === 'bk');
  assert.equal(rueckAlias(p, `ins/bk/${bk.slot}/k4`), 'erz/5/bk/4');
  // kill, pfl and trim have their own rows now and map back to themselves
  for (const z of ['kill/tief', 'pfl', 'trim']) assert.equal(rueckAlias(p, gib(p, `erz/2/${z}`).pfad), `erz/2/${z}`, z);
});

test('rueckAlias is null for everything that is no row of a strom track', () => {
  const p = fixture();
  for (const x of ['spur/9/fader', 'grp/1/fader', 'deck/1/fader', 'ret/1/fader', 'erz/2/fader', 'spur/x/fader', 'ins/komp/9/an']) assert.equal(rueckAlias(p, x), null, x);
  assert.equal(rueckAlias(null, `spur/1/fader`), null);
  const ohneSend = lauf(live(), { befehl: 'platz_setzen', platz: 3, typ: 'strudel' }, { befehl: 'strom_spur_neu', strom: 2 });
  assert.equal(rueckAlias(ohneSend, `spur/${nr(ohneSend, 2)}/send/1`), null, 'send/1 of the track is no hall or delay return');
});

test('istStromZeile is true only for rows of strom tracks, false for the rows of any other track', () => {
  let p = fixture();
  p = lauf(p, { befehl: 'spur_neu', art: 'audio', name: 'Plain' });
  const normal = p.spuren.find((s) => s.art !== 'strom');
  for (const s of ['fader', 'pan', 'mute', 'solo', 'filter', 'eq/tief', 'send/1']) {
    assert.equal(istStromZeile(p, `spur/${nr(p, 2)}/${s}`), true, s);
    assert.equal(istStromZeile(p, `spur/${normal.nr}/${s}`), false, s);
  }
  assert.equal(istStromZeile(p, `spur/${nr(p, 2)}/bk/1`), true);
  assert.equal(istStromZeile(p, 'grp/1/fader'), false);
  assert.equal(istStromZeile(p, 'ret/1/fader'), false);
  assert.equal(istStromZeile(p, `spur/${nr(p, 2)}/clip`), false);
  assert.equal(istStromZeile(null, 'spur/1/fader'), false);
  assert.ok(STROM_LIVE_ZEILEN.test(`spur/3/fader`));
});

test('istStromZeile is false for the row of a seq pattern track', () => {
  let p = lauf(live(), { befehl: 'platz_setzen', platz: 2, typ: 'seq' }, { befehl: 'platz_setzen', platz: 3, typ: 'strudel' }, { befehl: 'strom_spur_neu', strom: 2 });
  const seqSpur = p.spuren.find((s) => s.art !== 'strom');
  if (seqSpur) assert.equal(istStromZeile(p, `spur/${seqSpur.nr}/fader`), false);
  assert.equal(istStromZeile(p, `spur/${nr(p, 2)}/fader`), true);
});

test('the hand vocabulary PFAD accepts erz/<n> for n 1..16 and the alias suffixes, and nothing outside', () => {
  for (const p of ['erz/1/fader', 'erz/16/fader', 'erz/9/send/2', 'erz/2/pan', 'erz/2/mute', 'erz/10/solo', 'erz/12/komp/mix', 'erz/2/kill/tief', 'erz/2/xseite', 'erz/2/bk/64']) assert.ok(PFAD.test(p), p);
  for (const p of ['erz/0/fader', 'erz/17/fader', 'erz/01/fader', 'erz/2/pan/x', 'erz/17/pan', 'erz/4/bk/9', 'erz/2/nonsense']) assert.ok(!PFAD.test(p), p);
  for (const s of ALIAS_SUFFIXE) if (s !== 'bk/<k>') assert.ok(PFAD.test(`erz/2/${s}`), s);
});
