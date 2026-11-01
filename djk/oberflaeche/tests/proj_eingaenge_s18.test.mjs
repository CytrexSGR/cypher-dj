// S18 task 6: a project audio track can record erz/5..7 and pad/1..2 (and still erz/1..3). The input list comes from
// vertrag/stroeme.ts (INTERNE_EINGAENGE, REC_EINGANG); the track-head select on the page is a literal list that is bound to it here.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fuehreListeAus } from '../projekt/befehle.ts';
import { neuesProjekt, pruefeProjekt, INTERNE_EINGAENGE } from '../projekt/modell.ts';
import { eingangsCode } from '../projekt/aufnahme.ts';
import { REC_EINGANG, INTERNE_EINGAENGE as TABELLE } from '../../vertrag/stroeme.ts';
import { projBereich } from '../bereiche/proj/bereich.ts';
import { aufnahmeBereich } from '../bereiche/proj/aufnahme.ts';
import { pruefKontext } from './hilfen/proj_kontext.mjs';
import { tmpOrdner } from './hilfen/projekt.mjs';

const ein = (name) => ({ art: 'intern', name });
const grund = (f) => { try { f(); } catch (e) { return e.grund ?? String(e); } return null; };
const mitSpur = () => fuehreListeAus(neuesProjekt('T'), [{ befehl: 'spur_neu', art: 'audio', name: 'A' }]).projekt;

test('S18 eingangsCode: the eight inputs map to the kern tap codes, erz/4, erz/8 and master are refused', () => {
  assert.deepEqual(INTERNE_EINGAENGE.map(eingangsCode), [11, 12, 13, 15, 16, 17, 21, 22]);
  for (const n of ['erz/4', 'erz/8', 'master', 'pad/3', '']) assert.throws(() => eingangsCode(n), /eingang_fehlt/, n);
});

test('S18 the model list is the table of vertrag/stroeme.ts and every entry has a code', () => {
  assert.deepEqual([...INTERNE_EINGAENGE], [...TABELLE]);
  assert.deepEqual([...INTERNE_EINGAENGE], Object.keys(REC_EINGANG));
});

test('S18 spur_aendern accepts erz/5..7, pad/1, pad/2 and arms them; refuses erz/4, erz/8, master (negative control: erz/2 still goes)', () => {
  const p = mitSpur();
  const id = p.spuren[0].id;
  for (const n of ['erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2', 'erz/2']) {
    const e = fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: id, eingang: ein(n), arm: true }]).projekt;
    assert.deepEqual(e.spuren[0].aufnahme, { scharf: true, eingang: ein(n) }, n);
  }
  for (const n of ['erz/4', 'erz/8', 'master', 'pad/3']) {
    assert.equal(grund(() => fuehreListeAus(p, [{ befehl: 'spur_aendern', spur_id: id, eingang: ein(n) }])), 'eingang_fehlt', n);
  }
});

test('S18 a stored project with the new inputs loads; a stored erz/4 does not; an old erz/2 project loads unchanged', () => {
  const p = mitSpur();
  const lade = (n) => { const k = JSON.parse(JSON.stringify(p)); k.spuren[0].aufnahme = { scharf: true, eingang: ein(n) }; return pruefeProjekt(k); };
  for (const n of ['pad/2', 'erz/6', 'erz/2']) assert.ok(!('fehler' in lade(n)), n);
  assert.ok('fehler' in lade('erz/4'));
});

test('S18 page: the select options of the track head are exactly the model inputs (a literal list bound to the table)', async () => {
  const { EINGANG_OPTIONEN } = await import('../oeffentlich/produktion/spurkoepfe.js');
  assert.deepEqual(EINGANG_OPTIONEN.map((o) => o.wert), [...INTERNE_EINGAENGE]);
  assert.ok(EINGANG_OPTIONEN.every((o) => typeof o.text === 'string' && o.text.startsWith(o.wert)));
  assert.equal(EINGANG_OPTIONEN.find((o) => o.wert === 'erz/6').text, 'erz/6 (bk)');
  assert.equal(EINGANG_OPTIONEN.find((o) => o.wert === 'pad/1').text, 'pad/1 (L1)');
});

test('S18 arming a track on pad/1 and erz/6 sends /k/rec/spur with the codes 21 and 16 to the kern (negative control: unarmed tracks get 0)', async (t) => {
  const k = pruefKontext();
  const d = tmpOrdner(t, 'djk-s18rec-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const br = aufnahmeBereich(k, b.zugang, { fristMs: 60 });
  t.after(() => br.aufnahme.schliesse());
  const s = b.sitzung;
  await s.neu('R', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 120 });
  await s.aendern({ rev: 0, label: 'Spuren', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'G' }, { befehl: 'spur_neu', art: 'audio', name: 'H' }] }, 'andreas');
  const pr = s.aktuell().j.projekt;
  await s.aendern({ rev: pr.rev, label: 'Arm', befehle: [
    { befehl: 'spur_aendern', spur_id: pr.spuren[0].id, eingang: ein('pad/1'), arm: true },
    { befehl: 'spur_aendern', spur_id: pr.spuren[1].id, eingang: ein('erz/6'), arm: true }] }, 'andreas');
  k.leere();
  try { await br.aufnahme.start({ von_beat: 0 }, 'andreas'); } catch { /* the stub kern may refuse the start itself; only the arming messages count */ }
  const spur = k.an('/k/rec/spur').filter((x) => x.felder.scharf === 1).map((x) => [x.felder.spur, x.felder.eingang]);
  assert.deepEqual(spur, [[1, 21], [2, 16]]);
  assert.ok(k.an('/k/rec/spur').filter((x) => x.felder.scharf === 0).every((x) => x.felder.eingang === 0), 'unarmed tracks are cleared with 0');
});
