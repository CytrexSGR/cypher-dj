// Container core U-W2: the sidechain keys of the page stay inside the contract range komp/sc, gate/sc 0..4 (0 own signal, 1..4 the containers A..D).
// "Kick Sidechain" keys on the container that plays the Kick (the strudel module's place), resolved when the preset is applied.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KOMP_PRESETS, SC_KICK, kickSchluessel, kompPresetFelder, KOMP_SCHLUESSEL } from '../public/effects.js';
import { REGLER } from '../../conductor/src/controls_info.ts';
import { fuehreAus, BefehlFehler } from '../project/commands.ts';
import { neuesProjekt, pruefeProjekt, kanonisch, insertZeilen } from '../project/model.ts';
import { chipMenuePunkte } from '../public/dock/parts.js';
import { schluesselBefehl } from '../public/production/key_choice.js';
import { eqDynHinweisSichtbar, hatSchluessel } from '../public/production/inserts.js';

const T = (typ) => ({ typ });
const LEER = T('leer'), STRUDEL = T('strudel'), TRACK = T('track');

test('the contract range of komp/sc and gate/sc is 0..4', () => {
  assert.deepEqual([REGLER.get('deck/1/komp/sc').min, REGLER.get('deck/1/komp/sc').max], [0, 4]);
  assert.deepEqual([REGLER.get('deck/1/gate/sc').min, REGLER.get('deck/1/gate/sc').max], [0, 4]);
});

test('no preset key and no key menu entry leaves 0..4, and the gate key regler of the page takes 0..4', () => {
  for (const [n, p] of Object.entries(KOMP_PRESETS)) assert.ok(p.sc === SC_KICK || (Number.isInteger(p.sc) && p.sc >= 0 && p.sc <= 4), `${n}: sc ${p.sc}`);
  for (const [w] of KOMP_SCHLUESSEL) assert.ok(w >= 0 && w <= 4, `menu key ${w}`);
  const q = fs.readFileSync(new URL('../public/effects.js', import.meta.url), 'utf8');
  assert.match(q, /'gate\/sc': \{ min: 0, max: 4,/);
  assert.doesNotMatch(q, /sc: 5|max: 14/);
});

test('Kick Sidechain keys on the container of the strudel place: place N is key N, none placed is 0', () => {
  assert.equal(KOMP_PRESETS['Kick Sidechain'].sc, SC_KICK);
  assert.equal(kickSchluessel([STRUDEL, LEER, LEER, LEER]), 1);
  assert.equal(kickSchluessel([TRACK, LEER, STRUDEL, LEER]), 3);
  assert.equal(kickSchluessel([LEER, LEER, LEER, STRUDEL]), 4);
  assert.equal(kickSchluessel([TRACK, TRACK, LEER, LEER]), 0, 'no strudel module: own signal');
  assert.equal(kickSchluessel(null), 0);
});

test('applying the preset writes a key that is valid for the channel: never above 4, never the channel itself', () => {
  const felder = (name, plaetze, kanal) => Object.fromEntries(kompPresetFelder(name, plaetze, kanal));
  const f = felder('Kick Sidechain', [TRACK, LEER, STRUDEL, LEER], 'deck/1');
  assert.equal(f.sc, 3);
  assert.equal(f.schwelle, -30); assert.equal(f.ratio, 8);
  assert.equal(felder('Kick Sidechain', [TRACK, LEER, STRUDEL, LEER], 'pad/1').sc, 0, 'the strip of the Kick container would key on itself: own signal');
  assert.equal(felder('Kick Sidechain', null, 'deck/2').sc, 0);
  assert.equal(felder('Drum Bus', [STRUDEL, LEER, LEER, LEER], 'deck/2').sc, 0, 'the other presets still reset the key');
  for (const k of ['deck/1', 'deck/2', 'pad/1', 'pad/2']) for (let i = 0; i < 4; i++) {
    const p = [LEER, LEER, LEER, LEER]; p[i] = STRUDEL;
    const sc = felder('Kick Sidechain', p, k).sc;
    assert.ok(Number.isInteger(sc) && sc >= 0 && sc <= 4, `${k} with strudel at ${i + 1}: ${sc}`);
  }
});

// strand 5 slice 4 (task 4.2): the EQ stage takes the key like the compressor: same fields, same menu, the key note falls away once a key is set
const eqProjekt = () => {
  let p = neuesProjekt('T');
  for (let i = 0; i < 2; i++) p = fuehreAus(p, { befehl: 'spur_neu', art: 'audio', name: `T${i + 1}` }).projekt;
  return fuehreAus(p, { befehl: 'insert_setzen', strang_id: 's2', pos: 0, art: 'eq' }).projekt;
};
const eqStufe = (p) => p.spuren[1].inserts[0];

test('an eq stage takes sc and key through insert_param_setzen and the same commands the key menu sends; the row is ins/eq/<slot>/sc', () => {
  let p = eqProjekt();
  const id = eqStufe(p).id;
  const e = fuehreAus(p, schluesselBefehl(id, 'spur:1:pre'));
  assert.equal(eqStufe(e.projekt).sc, 1);
  assert.deepEqual(e.regler_aenderungen.filter((r) => r.pfad.endsWith('/sc')), [{ pfad: 'ins/eq/1/sc', wert: 1 }]);
  assert.equal(insertZeilen(eqStufe(e.projekt))['ins/eq/1/sc'], 1);
  pruefeProjekt(JSON.parse(JSON.stringify(kanonisch(e.projekt))));
  const k = fuehreAus(e.projekt, schluesselBefehl(id, 'spur:1:post'));   // a structural key replaces the row key
  assert.deepEqual(eqStufe(k.projekt).key, { quelle: 'spur', nr: 1, punkt: 'post' });
  assert.equal(eqStufe(k.projekt).sc, undefined);
  pruefeProjekt(JSON.parse(JSON.stringify(kanonisch(k.projekt))));
  const o = fuehreAus(k.projekt, schluesselBefehl(id, 'own'));
  assert.equal(eqStufe(o.projekt).key, undefined); assert.equal(eqStufe(o.projekt).sc, undefined);
  const neu = fuehreAus(p, { befehl: 'insert_setzen', strang_id: 's2', pos: 1, art: 'eq', key: { quelle: 'spur', nr: 1, punkt: 'post' } }).projekt;
  assert.deepEqual(neu.spuren[1].inserts[1].key, { quelle: 'spur', nr: 1, punkt: 'post' });
});

test('an eq stage refuses its own track as a key like the compressor, and a saturator still has no key', () => {
  const p = eqProjekt();
  assert.throws(() => fuehreAus(p, schluesselBefehl(eqStufe(p).id, 'spur:2:post')), (e) => e instanceof BefehlFehler && /sidechain_/.test(e.grund));
  const q = fuehreAus(p, { befehl: 'insert_setzen', strang_id: 's2', pos: 1, art: 'saett' }).projekt;
  assert.throws(() => fuehreAus(q, schluesselBefehl(q.spuren[1].inserts[1].id, 'spur:1:pre')), (e) => e instanceof BefehlFehler && e.grund === 'argument_unbekannt');
});

test('the chip menu offers Key source for an eq stage (production view only) and the key note falls away with a key', () => {
  const s = { inserts: [{ id: 'i1', art: 'eq' }] };
  assert.ok(chipMenuePunkte(s, s.inserts[0], { schluessel: true }).some((x) => x.aktion === 'schluessel'));
  assert.ok(!chipMenuePunkte(s, s.inserts[0], { schluessel: false }).some((x) => x.aktion === 'schluessel'));
  assert.ok(!chipMenuePunkte({ inserts: [{ id: 'i2', art: 'saett' }] }, { id: 'i2', art: 'saett' }, { schluessel: true }).some((x) => x.aktion === 'schluessel'));
  assert.equal(eqDynHinweisSichtbar(3, hatSchluessel({})), true);
  assert.equal(eqDynHinweisSichtbar(4, hatSchluessel({ sc: 2 })), false);
  assert.equal(eqDynHinweisSichtbar(3, hatSchluessel({ key: { quelle: 'ret', nr: 1, punkt: 'post' } })), false);
  assert.equal(eqDynHinweisSichtbar(1, false), false, 'modes 1 and 2 never show the note');
});
