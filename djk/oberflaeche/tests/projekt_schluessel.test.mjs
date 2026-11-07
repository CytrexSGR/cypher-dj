// 1.10 slice 5, unit U3: the structural sidechain key in the project (model, rules, commands, reasons, Duck by Kick, playback, export answer).
// Plan E8, E12, E20. Pure calculation, no server and no core (the export answer uses the S3 stand-in of the render).
// The rules are DATA: every cell and every case of docs/schnittstellen/schluessel_regeln.json is run against `schluesselErlaubt` (the core test
// test_arr_schluessel runs the same file against the loader).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fuehreAus, fuehreListeAus, BefehlFehler, DUCK_DURCH_KICK_WERTE } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeProjekt, kanonisch, wiedergabeSicht, alleInserts, insertVorgabe } from '../projekt/modell.ts';
import { INSERT_ARTEN } from '../projekt/insert_schluessel.ts';
import { SCHLUESSEL_GRUND, SCHLUESSEL_ZELLEN } from '../projekt/schluessel_tabelle.ts';
import { schluesselErlaubt, pruefeSchluessel } from '../projekt/routing_regeln.ts';
import { uebersetze } from '../projekt/wiedergabe.ts';
import { Verlauf, aendere, rueckgaengig } from '../projekt/verlauf.ts';
import { GRUND_TEXT } from '../http/gruende.ts';
import { grundCode } from '../bereiche/proj/abbildung.ts';
import { hatDjSchluessel, alsAntwort } from '../bereiche/proj/ausgabe.ts';
import { aufbau } from './hilfen/ausgabe_aufbau.mjs';
import { szenarioOhneInserts } from './hilfen/inserts_szenario.mjs';
import { ohneAbgeleitetes, tmpOrdner } from './hilfen/projekt.mjs';

const W = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.join(W, '..', '..');
const REGELN = JSON.parse(fs.readFileSync(path.join(REPO, 'docs', 'schnittstellen', 'schluessel_regeln.json'), 'utf8'));

const ok = (p, b) => fuehreAus(p, b);
const lehntAb = (p, b, grund) => assert.throws(() => fuehreAus(p, b), (e) => e instanceof BefehlFehler && e.grund === grund,
  `expected ${grund} for ${JSON.stringify(b).slice(0, 110)}`);
const mit = (n) => {   // n audio tracks s1..sn
  let p = neuesProjekt('T');
  for (let i = 0; i < n; i++) p = ok(p, { befehl: 'spur_neu', art: 'audio', name: `T${i + 1}` }).projekt;
  return p;
};
const mitAllem = () => {   // 4 tracks, group g1 (s3, s4), group g2 (no member), returns r1, r2
  let p = mit(4);
  p = ok(p, { befehl: 'gruppenspur_neu', mitglieder: ['s3', 's4'] }).projekt;
  p = ok(p, { befehl: 'gruppenspur_neu' }).projekt;
  p = ok(p, { befehl: 'return_neu' }).projekt;
  return ok(p, { befehl: 'return_neu' }).projekt;
};
const stufe = (p, strang, key, rest = {}) => ok(p, { befehl: 'insert_setzen', strang_id: strang, pos: 0, art: 'komp', key, ...rest });
const keyVon = (p, id) => alleInserts(p).find((x) => x.insert.id === id)?.insert;

// ---- task 1: model and validation ---------------------------------------------------------------------------------------------------------------------

test('model: a project without keys is byte-equal to the recorded golden (no `key` anywhere), and an sc project is unchanged', () => {
  const s = szenarioOhneInserts();
  const golden = JSON.parse(fs.readFileSync(path.join(W, 'tests', 'hilfen', 'inserts_ohne_golden.json'), 'utf8'));
  assert.equal(s.kanonisch, golden.kanonisch);
  assert.equal(s.wiedergabe, golden.wiedergabe);
  assert.equal(s.sicht, golden.sicht);
  // a 4a stage keyed by the row sc: stays a field `sc`, no `key` in the project, the view or the playback
  const p = stufe(mit(2), 's1', undefined, { sc: 2 }).projekt;
  assert.equal(p.spuren[0].inserts[0].sc, 2);
  assert.ok(!JSON.stringify(p).includes('"key"'));
  assert.ok(!kanonisch(wiedergabeSicht(p)).includes('key'));
  const w = uebersetze(p, { nr: 1, audioOrdner: '/x/audio', frames: () => 96000 });
  assert.ok(!JSON.stringify(w).includes('"key"'), 'the row key never travels in the playback');
  assert.equal(pruefeProjekt(p).fehler, undefined);
});

test('model: key validation (closed fields, one key per stage, never {spur, pre}, existing strip, DJ list, komp only)', () => {
  const p0 = mitAllem();
  const p = stufe(p0, 's1', { quelle: 'spur', nr: 2, punkt: 'post' }).projekt;
  assert.equal(pruefeProjekt(p).fehler, undefined, JSON.stringify(pruefeProjekt(p)));
  const mutiere = (f) => { const q = structuredClone(p); f(q.spuren[0].inserts[0]); return pruefeProjekt(q); };
  const kaputt = (f) => assert.notEqual(mutiere(f).fehler, undefined);
  kaputt((i) => { i.sc = 2; });                                                  // sc and key together
  kaputt((i) => { i.key.extra = 1; });                                           // closed fields
  kaputt((i) => { i.key.quelle = 'pm'; });                                       // pm is never stored
  kaputt((i) => { i.key = { quelle: 'spur', nr: 2, punkt: 'pre' }; });           // the pair has one writer, the row
  kaputt((i) => { i.key = { quelle: 'spur', nr: 33, punkt: 'post' }; });         // range
  kaputt((i) => { i.key = { quelle: 'spur', nr: 9, punkt: 'post' }; });          // no track 9
  kaputt((i) => { i.key = { quelle: 'grp', nr: 5, punkt: 'post' }; });           // no group 5
  kaputt((i) => { i.key = { quelle: 'ret', nr: 3, punkt: 'post' }; });           // no return 3
  kaputt((i) => { i.key = { quelle: 'erz', nr: 2, punkt: 'post' }; });           // erz/2 is not on the DJ list
  kaputt((i) => { i.key = { quelle: 'deck', nr: 5, punkt: 'post' }; });
  kaputt((i) => { i.key = { quelle: 'deck', nr: 1, punkt: 'pre' }; });           // a DJ input has the point post only
  kaputt((i) => { i.art = 'eq'; i.werte = insertVorgabe('eq'); });               // only a compressor has a key
  // negative control: the legal forms pass
  for (const key of [{ quelle: 'grp', nr: 1, punkt: 'pre' }, { quelle: 'grp', nr: 2, punkt: 'post' }, { quelle: 'ret', nr: 2, punkt: 'post' },
    { quelle: 'deck', nr: 4, punkt: 'post' }, { quelle: 'erz', nr: 1, punkt: 'post' }, { quelle: 'spur', nr: 4, punkt: 'post' }]) {
    assert.equal(mutiere((i) => { i.key = key; }).fehler, undefined, JSON.stringify(key));
  }
});

// ---- task 2: rules from the data file ------------------------------------------------------------------------------------------------------------------

test('zellen_aus_vertrag_ts: every cell of the table (consumer x source x point) answers as the JSON file says', () => {
  const p = mitAllem();   // tracks 1..4, groups 1 and 2, returns 1 and 2, master; the strips used below are never the same strip and never edge-linked
  const traeger = { spur: 's1', grp: 'g1', ret: 'r1', pm: 'master' };
  const quelleNr = { spur: 2, grp: 2, ret: 2, pm: 0 };   // a track that is not a member of group 2: s2; group 2 is not the group of s1
  let gezaehlt = 0;
  for (const v of REGELN.verbraucher) for (const q of REGELN.quellen) for (const punkt of REGELN.punkte) {
    const soll = REGELN.zellen[v][q][punkt];
    // the generated table is the JSON file
    assert.equal(SCHLUESSEL_ZELLEN[v][q][punkt], soll, `${v}/${q}/${punkt} generated`);
    const urteil = schluesselErlaubt(p, traeger[v], { quelle: q, nr: quelleNr[q], punkt });
    if (soll === 'ja') assert.equal(urteil, null, `${v} keyed by ${q} ${punkt}`);
    else {
      assert.equal(urteil?.grund, SCHLUESSEL_GRUND[soll], `${v} keyed by ${q} ${punkt}: ${JSON.stringify(urteil)}`);
      assert.ok(urteil.text.length > 10);
    }
    gezaehlt++;
  }
  assert.equal(gezaehlt, REGELN.verbraucher.length * REGELN.quellen.length * REGELN.punkte.length);
  assert.equal(gezaehlt, 32, 'positive control: the table has 32 cells and each was run');
  // the DJ list: every entry of the data file
  for (const e of REGELN.dj.erlaubt) for (let n = e.nr[0]; n <= e.nr[1]; n++) assert.equal(schluesselErlaubt(p, 's1', { quelle: e.quelle, nr: n, punkt: 'post' }), null, `${e.quelle}/${n}`);
  for (const [liste, grund] of [[REGELN.dj.zyklus, 'sidechain_zyklus'], [REGELN.dj.quelle, 'sidechain_quelle']]) {
    for (const e of liste) for (let n = e.nr[0]; n <= e.nr[1]; n++) {
      for (const strang of ['s1', 'g1', 'r1', 'master']) assert.equal(schluesselErlaubt(p, strang, { quelle: e.quelle, nr: n, punkt: 'post' })?.grund, grund, `${strang} ${e.quelle}/${n}`);
    }
  }
  // not listed at all: quelle
  assert.equal(schluesselErlaubt(p, 's1', { quelle: 'deck', nr: 5, punkt: 'post' })?.grund, 'sidechain_quelle');
  assert.equal(schluesselErlaubt(p, 's1', { quelle: 'erz', nr: 9, punkt: 'post' })?.grund, 'sidechain_quelle');
});

// a project of a case of the data file: tracks by number (optional group), groups and returns by number (numbers as given), the stages attached directly
function ausFall(f) {
  let p = neuesProjekt('T');
  for (const s of f.spuren) p = ok(p, { befehl: 'spur_neu', art: 'audio', name: `T${s.nr}` }).projekt;
  const gruppen = f.gruppen ?? [], returns = f.returns ?? [];
  for (const nr of gruppen) {
    p = ok(p, { befehl: 'gruppenspur_neu' }).projekt;
    p.gruppen[p.gruppen.length - 1].nr = nr;
  }
  for (const nr of returns) {
    p = ok(p, { befehl: 'return_neu' }).projekt;
    p.returns[p.returns.length - 1].nr = nr;
  }
  f.spuren.forEach((s, i) => { p.spuren[i].nr = s.nr; if (s.gruppe) p.spuren[i].ausgang = { art: 'gruppe', id: p.gruppen.find((g) => g.nr === s.gruppe).id }; });
  const id = (auf) => {
    const [art, nr] = auf.split('/');
    return art === 'spur' ? p.spuren.find((s) => s.nr === +nr).id : art === 'grp' ? p.gruppen.find((g) => g.nr === +nr).id : art === 'ret' ? p.returns.find((r) => r.nr === +nr).id : 'master';
  };
  const stufen = [];
  f.stufen.forEach((st, k) => {
    const traeger = auf2(p, id(st.auf));
    const insert = { id: `i${k + 1}`, art: 'komp', slot: k + 1, an: true, werte: insertVorgabe('komp'), key: { quelle: st.key.q, nr: st.key.nr, punkt: st.key.punkt } };
    traeger.inserts = [...(traeger.inserts ?? []), insert];
    stufen.push({ traeger: id(st.auf), insert, key: insert.key });
  });
  return { p, stufen, idVon: id };
}
const auf2 = (p, id) => (id === 'master' ? p.master : p.spuren.find((s) => s.id === id) ?? p.gruppen.find((g) => g.id === id) ?? p.returns.find((r) => r.id === id));

test('zellen_aus_vertrag_ts: every case (`faelle`) of the data file gives its expected answer', () => {
  assert.ok(REGELN.faelle.length >= 16, `the file has ${REGELN.faelle.length} cases`);
  const gesehen = new Set();
  for (const f of REGELN.faelle) {
    const { p, stufen } = ausFall(f);
    // the first stage that is not allowed decides (the cases have one deciding stage; the cycle cases name both edges)
    let urteil = null;
    for (const st of stufen) {
      urteil = schluesselErlaubt(p, st.traeger, st.key, st.insert);
      if (urteil) break;
    }
    if (f.erwartet === 'ja') assert.equal(urteil, null, `${f.name}: ${JSON.stringify(urteil)}`);
    else if (f.erwartet === 'nur_zeile') {
      // the row-only pair: the server does not refuse it, it normalises it to the row sc (the core loader refuses the structural form)
      assert.equal(urteil, null, f.name);
      const st = f.stufen[0];
      const q = mit(2);
      const r = ok(q, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'spur', nr: st.key.nr, punkt: 'pre' } });
      assert.equal(r.projekt.spuren[0].inserts[0].sc, st.key.nr, `${f.name}: normalised to sc`);
      assert.equal(r.projekt.spuren[0].inserts[0].key, undefined);
    } else {
      assert.equal(urteil?.grund, SCHLUESSEL_GRUND[f.erwartet], `${f.name}: ${JSON.stringify(urteil)}`);
    }
    // the command gives the same answer for the last stage of the case, set up without it (a key naming a strip that is not in the project is the command's own reason)
    if (f.erwartet !== 'nur_zeile') {
      const ohne = ausFall({ ...f, stufen: f.stufen.slice(0, -1) });
      const letzte = f.stufen[f.stufen.length - 1];
      const key = { quelle: letzte.key.q, nr: letzte.key.nr, punkt: letzte.key.punkt };
      const b = { befehl: 'insert_setzen', strang_id: ohne.idVon(letzte.auf), pos: (auf2(ohne.p, ohne.idVon(letzte.auf)).inserts ?? []).length, art: 'komp', key };
      const fehlt = (key.quelle === 'ret' && !ohne.p.returns?.some((r) => r.nr === key.nr)) || (key.quelle === 'grp' && !ohne.p.gruppen?.some((g) => g.nr === key.nr));
      if (fehlt) lehntAb(ohne.p, b, key.quelle === 'ret' ? 'return_unbekannt' : 'gruppe_unbekannt');
      else if (f.erwartet === 'ja') assert.equal(pruefeProjekt(ok(ohne.p, b).projekt).fehler, undefined, `${f.name}: the command accepts it`);
      else lehntAb(ohne.p, b, SCHLUESSEL_GRUND[f.erwartet]);
    }
    gesehen.add(f.erwartet);
  }
  assert.deepEqual([...gesehen].sort(), ['ja', 'nur_zeile', 'spaet', 'zyklus'], 'positive control: every kind of answer occurs in the cases');
});

test('the reason literals thrown by the rules equal the generated SCHLUESSEL_GRUND, and the text of each reason exists', () => {
  const p = mitAllem();
  const grund = (q, strang = 's1') => { try { pruefeSchluessel(p, strang, q); } catch (e) { return e.grund; } return null; };
  assert.equal(grund({ quelle: 'grp', nr: 1, punkt: 'post' }), SCHLUESSEL_GRUND.spaet);
  assert.equal(grund({ quelle: 'pm', nr: 0, punkt: 'post' }), SCHLUESSEL_GRUND.zyklus);
  assert.equal(grund({ quelle: 'pad', nr: 1, punkt: 'post' }), SCHLUESSEL_GRUND.quelle);
  assert.equal(grund({ quelle: 'spur', nr: 2, punkt: 'post' }), null, 'negative control: an allowed key does not throw');
  for (const g of Object.values(SCHLUESSEL_GRUND)) {
    assert.equal(typeof GRUND_TEXT[g], 'string', `${g} has a text`);
    assert.equal(grundCode(g), 400, `${g} answers 400`);
  }
});

// ---- task 3: commands ----------------------------------------------------------------------------------------------------------------------------------

test('commands: every kind of refusal has a case with the named reason; allowed keys are stored as `key`', () => {
  const p = mitAllem();
  // sidechain_spaet: a track keyed by a group or a return, a group keyed by a group post or a return
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'grp', nr: 1, punkt: 'post' } }, 'sidechain_spaet');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp', key: { quelle: 'ret', nr: 1, punkt: 'pre' } }, 'sidechain_spaet');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 'g1', pos: 0, art: 'komp', key: { quelle: 'grp', nr: 2, punkt: 'post' } }, 'sidechain_spaet');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'komp', key: { quelle: 'ret', nr: 2, punkt: 'post' } }, 'sidechain_spaet');
  // sidechain_zyklus: own strip, member keyed by its own group, the master, erz/4
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 1, punkt: 'post' } }, 'sidechain_zyklus');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's3', pos: 0, art: 'komp', key: { quelle: 'grp', nr: 1, punkt: 'post' } }, 'sidechain_zyklus');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 'g1', pos: 0, art: 'komp', key: { quelle: 'grp', nr: 1, punkt: 'pre' } }, 'sidechain_zyklus');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'komp', key: { quelle: 'pm', punkt: 'post' } }, 'sidechain_zyklus');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'erz', nr: 4 } }, 'sidechain_zyklus');
  // sidechain_quelle: the DJ inputs computed after the production mixer
  for (const [quelle, nr] of [['erz', 2], ['erz', 3], ['erz', 5], ['erz', 8], ['pad', 1], ['pad', 2], ['erz', 9], ['deck', 5]]) {
    lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle, nr } }, 'sidechain_quelle');
  }
  // the refusal leaves nothing behind
  assert.equal(alleInserts(p).length, 0);
  // allowed: stored as `key`, rows: the row sc stays 0
  const erlaubt = [['s1', { quelle: 'spur', nr: 2, punkt: 'post' }], ['s2', { quelle: 'deck', nr: 1 }], ['s2', { quelle: 'erz', nr: 1 }], ['g1', { quelle: 'spur', nr: 1, punkt: 'post' }],
    ['g1', { quelle: 'grp', nr: 2, punkt: 'pre' }], ['r1', { quelle: 'grp', nr: 2, punkt: 'post' }], ['r1', { quelle: 'grp', nr: 1, punkt: 'pre' }], ['master', { quelle: 'ret', nr: 2, punkt: 'post' }]];
  for (const [strang, key] of erlaubt) {
    const r = stufe(p, strang, key);
    const i = alleInserts(r.projekt)[0].insert;
    assert.deepEqual(i.key, { quelle: key.quelle, nr: key.nr, punkt: key.punkt ?? 'post' }, strang);
    assert.equal(i.sc, undefined);
    assert.equal(r.betrifft_wiedergabe, true, 'a structural key is a structure change');
    assert.equal(pruefeProjekt(r.projekt).fehler, undefined);
  }
  // unknown strips and bad arguments
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'grp', nr: 7, punkt: 'post' } }, 'gruppe_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'ret', nr: 4, punkt: 'post' } }, 'return_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 9, punkt: 'post' } }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 2 } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'bass', nr: 2, punkt: 'post' } }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 2, punkt: 'post', x: 1 } }, 'argument_unbekannt');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'eq', key: { quelle: 'spur', nr: 2, punkt: 'post' } }, 'argument_unbekannt');
});

test('commands: two tracks keying each other through their post is refused on the second edge, a chain of edges is not (cycle by command)', () => {
  let p = mit(3);
  p = stufe(p, 's1', { quelle: 'spur', nr: 2, punkt: 'post' }).projekt;   // 1 listens to 2
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 1, punkt: 'post' } }, 'sidechain_zyklus');
  p = stufe(p, 's2', { quelle: 'spur', nr: 3, punkt: 'post' }).projekt;   // 2 listens to 3: a chain
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's3', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 1, punkt: 'post' } }, 'sidechain_zyklus');   // a cycle of three
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's3', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 2, punkt: 'post' } }, 'sidechain_zyklus');
  // negative control: the same tracks keyed by pre (the row) form no edge; 3 listening to deck/1 is fine
  p = ok(p, { befehl: 'insert_setzen', strang_id: 's3', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 1, punkt: 'pre' } }).projekt;
  assert.equal(p.spuren[2].inserts[0].sc, 1);
  assert.equal(pruefeProjekt(p).fehler, undefined);
});

test('commands: key and sc exclude each other; {spur, pre} is normalised to sc; the row key keeps its 4a behaviour', () => {
  let p = mitAllem();
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', sc: 2, key: { quelle: 'spur', nr: 2, punkt: 'post' } }, 'argument_ungueltig');
  // negative control: key null next to sc is no key
  const n = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', sc: 2, key: null });
  assert.equal(n.projekt.spuren[0].inserts[0].sc, 2);
  // {spur, nr, pre} arrives as sc (the page picker sends one shape); the 4a checks apply (a track that exists)
  const a = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 2, punkt: 'pre' } });
  assert.equal(a.projekt.spuren[0].inserts[0].sc, 2);
  assert.equal(a.projekt.spuren[0].inserts[0].key, undefined);
  assert.equal(a.betrifft_wiedergabe, true, 'a new stage is a structure change');
  lehntAb(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 9, punkt: 'pre' } }, 'spur_unbekannt');
  p = a.projekt;
  // sc change without a key stays a control (not a structure change), exactly as 4a
  const sc3 = ok(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'sc', wert: 3 });
  assert.equal(sc3.betrifft_wiedergabe, false);
  assert.deepEqual(sc3.regler_aenderungen, [{ pfad: 'ins/komp/1/sc', wert: 3 }]);
  // key via insert_param_setzen: sets `key`, removes sc, the row sc goes to 0 in the same step
  const k = ok(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: { quelle: 'deck', nr: 2 } });
  assert.deepEqual(k.projekt.spuren[0].inserts[0].key, { quelle: 'deck', nr: 2, punkt: 'post' });
  assert.equal(k.projekt.spuren[0].inserts[0].sc, undefined);
  assert.equal(k.betrifft_wiedergabe, true);
  assert.deepEqual(k.regler_aenderungen, [{ pfad: 'ins/komp/1/sc', wert: 0 }], 'the row sc is written 0 in the same step');
  // sc > 0 with a key present removes the key (structure), sc 0 too
  const zurueck = ok(k.projekt, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'sc', wert: 4 });
  assert.equal(zurueck.projekt.spuren[0].inserts[0].key, undefined);
  assert.equal(zurueck.projekt.spuren[0].inserts[0].sc, 4);
  assert.equal(zurueck.betrifft_wiedergabe, true, 'a key was present: structure change');
  const null0 = ok(k.projekt, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'sc', wert: 0 });
  assert.equal(null0.projekt.spuren[0].inserts[0].key, undefined);
  assert.equal(null0.projekt.spuren[0].inserts[0].sc, undefined);
  // key null removes it; the light path never takes a key change (the fast path and the full path agree)
  const weg = ok(k.projekt, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: null });
  assert.equal(weg.projekt.spuren[0].inserts[0].key, undefined);
  assert.equal(weg.betrifft_wiedergabe, true);
  const v = fuehreListeAus(p, [{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: { quelle: 'erz', nr: 1 } }], { voll: true });
  const l = fuehreListeAus(p, [{ befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: { quelle: 'erz', nr: 1 } }]);
  assert.equal(kanonisch(l.projekt), kanonisch(v.projekt)); assert.equal(l.betrifft_wiedergabe, true);
  // rules apply to a rewrite too
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: { quelle: 'grp', nr: 1, punkt: 'post' } }, 'sidechain_spaet');
  lehntAb(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: { quelle: 'erz', nr: 2 } }, 'sidechain_quelle');
  // only a compressor has a key
  const q = ok(p, { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'eq' }).projekt;
  lehntAb(q, { befehl: 'insert_param_setzen', insert_id: 'i2', param: 'key', wert: { quelle: 'deck', nr: 1 } }, 'argument_unbekannt');
});

test('commands: deleting a track, a group or a return drops the keys that point at it (like sc), nothing dangles', () => {
  let p = mitAllem();
  p = stufe(p, 's1', { quelle: 'spur', nr: 2, punkt: 'post' }).projekt;
  p = stufe(p, 'g1', { quelle: 'grp', nr: 2, punkt: 'pre' }).projekt;
  p = stufe(p, 'master', { quelle: 'ret', nr: 2, punkt: 'post' }).projekt;
  p = stufe(p, 's3', { quelle: 'deck', nr: 1 }).projekt;
  const keys = (q) => alleInserts(q).map((x) => x.insert.key?.quelle ?? '-').join(',');   // order: tracks, groups, returns, master
  assert.equal(keys(p), 'spur,deck,grp,ret');
  assert.equal(keys(ok(p, { befehl: 'spur_loeschen', spur_id: 's2' }).projekt), '-,deck,grp,ret');
  assert.equal(keys(ok(p, { befehl: 'gruppenspur_loeschen', gruppe_id: 'g2' }).projekt), 'spur,deck,-,ret');
  assert.equal(keys(ok(p, { befehl: 'return_loeschen', return_id: 'r2' }).projekt), 'spur,deck,grp,-');
  // negative control: deleting something no key points at changes no key
  assert.equal(keys(ok(p, { befehl: 'spur_loeschen', spur_id: 's4' }).projekt), 'spur,deck,grp,ret');
  assert.equal(keys(ok(p, { befehl: 'return_loeschen', return_id: 'r1' }).projekt), 'spur,deck,grp,ret');
  for (const b of [{ befehl: 'spur_loeschen', spur_id: 's2' }, { befehl: 'gruppenspur_loeschen', gruppe_id: 'g2' }, { befehl: 'return_loeschen', return_id: 'r2' }]) {
    assert.equal(pruefeProjekt(ok(p, b).projekt).fehler, undefined, `${b.befehl} leaves a valid project`);
  }
});

test('commands: replacing a stage (ersetzen) takes the new key; an existing track-post edge of the replaced stage does not block it', () => {
  let p = mit(3);
  p = stufe(p, 's1', { quelle: 'spur', nr: 2, punkt: 'post' }).projekt;
  const r = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', ersetzen: true, key: { quelle: 'spur', nr: 3, punkt: 'post' } });
  assert.deepEqual(r.projekt.spuren[0].inserts[0].key, { quelle: 'spur', nr: 3, punkt: 'post' });
  const o = ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', ersetzen: true, sc: 2 });
  assert.equal(o.projekt.spuren[0].inserts[0].key, undefined);
  assert.equal(o.projekt.spuren[0].inserts[0].sc, 2);
});

test('Duck by Kick: one command, one undo step, a komp stage with the preset values and sc = the kick track', () => {
  const p = mit(3);
  const r = ok(p, { befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's1' });
  const i = r.projekt.spuren[1].inserts[0];
  assert.deepEqual({ art: i.art, an: i.an, sc: i.sc }, { art: 'komp', an: true, sc: 1 });
  assert.deepEqual(i.werte, { ...insertVorgabe('komp'), ...DUCK_DURCH_KICK_WERTE });
  assert.equal(r.betrifft_wiedergabe, true);
  assert.ok(r.regler_aenderungen.some((c) => c.pfad === 'ins/komp/1/schwelle' && c.wert === -30));
  assert.ok(r.regler_aenderungen.some((c) => c.pfad === 'ins/komp/1/sc' && c.wert === 1));
  assert.equal(pruefeProjekt(r.projekt).fehler, undefined);
  // pos: the end of the chain by default, or where asked
  const r2 = ok(r.projekt, { befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's3' });
  assert.equal(r2.projekt.spuren[1].inserts.length, 2);
  assert.equal(r2.projekt.spuren[1].inserts[1].sc, 3);
  const r3 = ok(r.projekt, { befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's3', pos: 0 });
  assert.equal(r3.projekt.spuren[1].inserts[0].sc, 3);
  // refusals
  lehntAb(p, { befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's2' }, 'argument_ungueltig');
  lehntAb(p, { befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's9' }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'duck_durch_kick', spur_id: 's9', kick_id: 's1' }, 'spur_unbekannt');
  lehntAb(p, { befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's1', extra: 1 }, 'argument_unbekannt');
  let voll = p;
  for (let k = 0; k < 4; k++) voll = ok(voll, { befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's1' }).projekt;
  lehntAb(voll, { befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's1' }, 'kette_voll');
});

test('Duck by Kick is one undo step in the history (one undo gives the project back)', (t) => {
  const p0 = mit(2);
  const w = new Verlauf(path.join(tmpOrdner(t), 'undo.jsonl'), { jetzt: () => 1000, zeitgeber: false });
  const q = aendere(w, p0, [{ befehl: 'duck_durch_kick', spur_id: 's2', kick_id: 's1' }], { quelle: 'andreas', label: 'Duck by Kick' }).projekt;
  assert.equal(q.spuren[1].inserts.length, 1);
  const u = rueckgaengig(w, q, { quelle: 'andreas' });
  assert.equal(u.projekt.spuren[1].inserts, undefined, 'one undo removes the stage again');
  const ohneRev = (x) => ohneAbgeleitetes({ ...x, rev: 0, wiedergabe_rev: 0 });
  assert.equal(ohneRev(u.projekt), ohneRev(p0));
  assert.ok(u.regler_aenderungen.every((c) => c.wert === 0 || c.pfad.startsWith('ins/komp/1/')), 'the pool rows go back to their defaults');
});

test('parity: DUCK_DURCH_KICK_WERTE equals presets/werk/komp/kick-sidechain.preset.json through INSERT_ARTEN.komp[*].geraet', () => {
  const preset = JSON.parse(fs.readFileSync(path.join(W, 'presets', 'werk', 'komp', 'kick-sidechain.preset.json'), 'utf8'));
  const nachGeraet = new Map(INSERT_ARTEN.komp.parameter.filter((q) => q.geraet).map((q) => [q.geraet, q.name]));
  const aus = {};
  for (const [k, v] of Object.entries(preset.werte)) {
    if (k === 'extsc') { assert.equal(v, true, 'the preset keys from the external input'); continue; }   // the key is the stage field `sc`, not a value
    assert.ok(nachGeraet.has(k), `preset value ${k} maps to a row`);
    aus[nachGeraet.get(k)] = v;
  }
  assert.deepEqual({ ...DUCK_DURCH_KICK_WERTE }, aus);
  assert.equal(Object.keys(aus).length, 8, 'positive control: eight values compared');
});

// ---- playback and export answer ------------------------------------------------------------------------------------------------------------------------

test('playback: a structural key travels as chain[j].key {q, nr, punkt} on every kind of strip; a project without keys has none', () => {
  let p = mitAllem();
  p = stufe(p, 's1', { quelle: 'spur', nr: 2, punkt: 'post' }).projekt;
  p = stufe(p, 's2', { quelle: 'deck', nr: 3 }).projekt;
  p = stufe(p, 'g1', { quelle: 'grp', nr: 2, punkt: 'pre' }).projekt;
  p = stufe(p, 'r1', { quelle: 'grp', nr: 2, punkt: 'post' }).projekt;
  p = stufe(p, 'master', { quelle: 'ret', nr: 2, punkt: 'post' }).projekt;
  p = ok(p, { befehl: 'insert_setzen', strang_id: 's4', pos: 0, art: 'komp', sc: 1 }).projekt;
  const w = uebersetze(p, { nr: 1, audioOrdner: '/x/audio', frames: () => 96000 });
  assert.deepEqual(w.spuren[0].chain[0], { art: 'komp', slot: 1, an: true, key: { q: 'spur', nr: 2, punkt: 'post' } });
  assert.deepEqual(w.spuren[1].chain[0].key, { q: 'deck', nr: 3, punkt: 'post' });
  assert.deepEqual(w.gruppen[0].chain[0].key, { q: 'grp', nr: 2, punkt: 'pre' });
  assert.deepEqual(w.returns[0].chain[0].key, { q: 'grp', nr: 2, punkt: 'post' });
  assert.deepEqual(w.pm.chain[0].key, { q: 'ret', nr: 2, punkt: 'post' });
  const q2 = stufe(mit(1), 's1', { quelle: 'erz', nr: 1 }).projekt;
  assert.deepEqual(uebersetze(q2, { nr: 1, audioOrdner: '/x/audio', frames: () => 96000 }).spuren[0].chain[0].key, { q: 'erz', nr: 1, punkt: 'post' });
  assert.equal(w.spuren[3].chain[0].key, undefined, 'the row key sc is a control, not a playback field');
  assert.equal(w.spuren[2].chain, undefined);
  // the view: a key change is playback structure
  const p2 = ok(p, { befehl: 'insert_param_setzen', insert_id: 'i1', param: 'key', wert: { quelle: 'spur', nr: 3, punkt: 'post' } }).projekt;
  assert.notEqual(kanonisch(wiedergabeSicht(p)), kanonisch(wiedergabeSicht(p2)));
});

test('hatDjSchluessel: true only for deck/erz keys (a track, group or return key does not count)', () => {
  const p = mitAllem();
  assert.equal(hatDjSchluessel(p), false);
  assert.equal(hatDjSchluessel(stufe(p, 's1', { quelle: 'spur', nr: 2, punkt: 'post' }).projekt), false);
  assert.equal(hatDjSchluessel(ok(p, { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', sc: 2 }).projekt), false);
  assert.equal(hatDjSchluessel(stufe(p, 's1', { quelle: 'deck', nr: 1 }).projekt), true);
  assert.equal(hatDjSchluessel(stufe(p, 'g1', { quelle: 'erz', nr: 1 }).projekt), true);
});

test('export answer: dj_schluessel true when a stage has a DJ key, absent otherwise (the other fields are unchanged)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const ruf = async (f) => { try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); } };
  const ohne = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(ohne.code, 200, JSON.stringify(ohne.body));
  assert.equal('dj_schluessel' in ohne.body, false, 'negative control: no DJ key, no field');
  await a.aendern([{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp', key: { quelle: 'spur', nr: 2, punkt: 'post' } }]);
  const spur = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(spur.code, 200, JSON.stringify(spur.body));
  assert.equal('dj_schluessel' in spur.body, false, 'a track key is in the render: no field');
  await a.aendern([{ befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'komp', key: { quelle: 'deck', nr: 1 } }]);
  const dj = await ruf(() => a.ausgabe.exportiere({}));
  assert.equal(dj.code, 200, JSON.stringify(dj.body));
  assert.equal(dj.body.dj_schluessel, true);
  assert.deepEqual(Object.keys(dj.body).sort(), [...Object.keys(ohne.body), 'dj_schluessel'].sort());
});
