// 1.12 automation slice 4 (plan docs/b1-plaene/PLAN-1.12-slices4-5-7.md, unit U4, T4.1 and T4.7): the page copy of the lane tools
// (oeffentlich/produktion/lanen_werkzeuge.js) gives the same points as the server (projekt/lane_werkzeuge.ts), and the draft of a gesture
// (entwurf.js) equals what the server stores for the same command.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as server from '../projekt/lane_werkzeuge.ts';
import * as seite from '../oeffentlich/produktion/lanen_werkzeuge.js';
import { laneWert } from '../projekt/lane.ts';
import { fuehreAus } from '../projekt/befehle.ts';
import { neuesProjekt } from '../projekt/modell.ts';
import { entwurf } from '../oeffentlich/produktion/entwurf.js';

const LANEN = {
  fader: [{ beat: 0, wert: -30 }, { beat: 4, wert: -30 }, { beat: 8, wert: 0 }, { beat: 10, wert: -6, form: 's' }, { beat: 40, wert: -20, form: 'sprung' }],
  pan: [{ beat: 0, wert: 0 }, { beat: 4, wert: 1 }, { beat: 4, wert: -0.5, form: 'sprung' }, { beat: 6, wert: 0.2 }, { beat: 12, wert: 0.4 }],
  'geraet.cutoff': [{ beat: 1, wert: 0.5 }, { beat: 3, wert: 0.9, form: 's' }, { beat: 9, wert: 0.1 }],
  mute: [{ beat: 0, wert: 0, form: 'sprung' }, { beat: 5, wert: 1, form: 'sprung' }],
};
const BEREICHE = [[2, 8], [0, 4], [3.5, 9.25], [10, 20]];

test('U4 T4.1 mirror: dehne, neige, formPunkte, setzeForm, formBereich and the shape list are equal on page and server', () => {
  assert.deepEqual([...seite.FORMEN_EINFUEGEN], [...server.FORMEN_EINFUEGEN]);
  let n = 0;
  for (const [ziel, p] of Object.entries(LANEN)) {
    assert.deepEqual(seite.formBereich(ziel), server.formBereich(ziel), ziel);
    for (const [von, bis] of BEREICHE) {
      for (const neuBis of [von + 0.5, bis / 2 + von / 2, bis, bis * 1.5, bis + 13]) {
        if (neuBis <= von) continue;
        assert.deepEqual(seite.dehne(p, von, bis, neuBis, ziel), server.dehne(p, von, bis, neuBis, ziel), `dehne ${ziel} ${von} ${bis} ${neuBis}`); n++;
      }
      for (const f of [-1, -0.37, 0, 0.5, 1]) {
        assert.deepEqual(seite.neige(p, von, bis, f, ziel), server.neige(p, von, bis, f, ziel), `neige ${ziel} ${f}`); n++;
      }
      for (const form of server.FORMEN_EINFUEGEN) {
        for (const per of [1, 3, 64]) {
          const { unten, oben } = server.formBereich(ziel);
          const a = server.formPunkte(form, von, bis, per, unten, oben), b = seite.formPunkte(form, von, bis, per, unten, oben);
          assert.deepEqual(b, a, `formPunkte ${form} ${per}`);
          assert.deepEqual(seite.setzeForm(p, von, bis, b, ziel), server.setzeForm(p, von, bis, a, ziel), `setzeForm ${ziel} ${form}`); n += 2;
        }
      }
    }
  }
  assert.ok(n > 500, `${n} comparisons`);
  assert.deepEqual(seite.dehne(LANEN.pan, 0, 4, 4, 'pan'), LANEN.pan, 'identity (negative control)');
});

test('U4 T4.1 mirror, review fix: setzeForm with a point at von keeps the segment into it, equal on page and server', () => {
  const alt = [{ beat: 0, wert: -60 }, { beat: 4, wert: -20, form: 'linear' }, { beat: 8, wert: -10, form: 's' }];
  const jump = [{ beat: 0, wert: -60 }, { beat: 4, wert: -20, form: 's' }, { beat: 4, wert: -60, form: 'sprung' }, { beat: 8, wert: -10 }];
  for (const lane of [alt, jump]) {
    for (const form of server.FORMEN_EINFUEGEN) {
      const f = server.formPunkte(form, 4, 6, 1, -60, 0);
      const a = server.setzeForm(lane, 4, 6, f, 'fader'), b = seite.setzeForm(lane, 4, 6, f, 'fader');
      assert.deepEqual(b, a, `mirror ${form}`);
      for (const beat of [1, 2, 3, 3.9]) assert.ok(Math.abs(laneWert(b, beat, 'fader') - laneWert(lane, beat, 'fader')) < 1e-9, `${form} page at ${beat}`);
    }
  }
});

// --- T4.7: the draft equals the server result ------------------------------------------------------------------------------
function projektMit(ziel, punkte) {
  let p = fuehreAus(neuesProjekt('T'), { befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter: {} } }).projekt;
  p = fuehreAus(p, { befehl: 'auto_neu', spur_id: 's1', ziel }).projekt;
  return fuehreAus(p, { befehl: 'auto_punkte', lane_id: 'a1', setze: punkte, loesche_von: 0, loesche_bis: 1e5 }).projekt;
}
test('U4 T4.7 entwurf: auto_dehnen, auto_neigen and auto_form drafts equal what the server stores', () => {
  const faelle = [
    { befehl: 'auto_dehnen', lane_id: 'a1', von_beat: 2, bis_beat: 8, neu_bis_beat: 14 },
    { befehl: 'auto_dehnen', lane_id: 'a1', von_beat: 2, bis_beat: 8, neu_bis_beat: 5 },
    { befehl: 'auto_neigen', lane_id: 'a1', von_beat: 4, bis_beat: 12, faktor: 1 },
    { befehl: 'auto_neigen', lane_id: 'a1', von_beat: 3, bis_beat: 9, faktor: -0.25 },
    { befehl: 'auto_form', lane_id: 'a1', von_beat: 4, bis_beat: 12, form: 'sinus' },
    { befehl: 'auto_form', lane_id: 'a1', von_beat: 4, bis_beat: 12, form: 'rampe_ab', perioden: 4, unten: -40, oben: -10 },
    { befehl: 'auto_form', lane_id: 'a1', von_beat: 0, bis_beat: 3, form: 'rechteck', perioden: 2 },
  ];
  for (const [ziel, punkte] of [['fader', LANEN.fader], ['pan', LANEN.pan], ['geraet.cutoff', LANEN['geraet.cutoff']]]) {
    const p = projektMit(ziel, punkte);
    for (const b of faelle) {
      const fall = ziel === 'fader' ? b : { ...b, ...(b.unten !== undefined ? { unten: 0.1, oben: 0.6 } : {}) };
      const beimServer = fuehreAus(p, fall).projekt.spuren[0].automation[0].punkte;
      const imEntwurf = entwurf(p, [fall]).spuren[0].automation[0].punkte;
      assert.deepEqual(imEntwurf, beimServer, `${ziel} ${JSON.stringify(fall)}`);
    }
  }
  const leer = projektMit('fader', LANEN.fader);
  assert.deepEqual(entwurf(leer, [{ befehl: 'auto_dehnen', lane_id: 'a9', von_beat: 2, bis_beat: 8, neu_bis_beat: 14 }]).spuren[0].automation[0].punkte,
    leer.spuren[0].automation[0].punkte, 'an unknown lane changes nothing');
});
