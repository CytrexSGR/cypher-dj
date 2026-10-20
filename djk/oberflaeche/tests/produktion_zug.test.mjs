// PRODUCTION V2: Tastatur-Schritte zusammenfassen (zug.js), ohne Browser
import test from 'node:test';
import assert from 'node:assert/strict';
import { neuerSammler } from '../oeffentlich/produktion/zug.js';

test('V2 Sammler: während einer Änderung unterwegs werden Schritte addiert und danach einmal geschickt', async () => {
  const gesendet = [];
  let frei;
  const s = neuerSammler((d) => { gesendet.push(d); return new Promise((r) => { frei = r; }); });
  s.schritt({ dBeat: 0.25 });
  for (let i = 0; i < 4; i++) s.schritt({ dBeat: 0.25, dTon: 1 });
  assert.deepEqual(gesendet, [{ dBeat: 0.25 }], 'der erste geht sofort');
  assert.equal(s.unterwegs, true);
  frei(); await new Promise((r) => setImmediate(r));
  assert.deepEqual(gesendet[1], { dBeat: 1, dTon: 4 }, 'vier gestaute Schritte als einer');
  frei(); await new Promise((r) => setImmediate(r));
  assert.equal(gesendet.length, 2); assert.equal(s.unterwegs, false);
});

test('V2 Sammler: ein Fehler beim Schicken hält die Schlange nicht an (Negativ-Kontrolle)', async () => {
  const gesendet = [];
  const s = neuerSammler(async (d) => { gesendet.push(d); if (gesendet.length === 1) throw new Error('409'); });
  s.schritt({ dTon: 1 }); s.schritt({ dTon: 1 });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(gesendet, [{ dTon: 1 }, { dTon: 1 }]);
  assert.equal(s.unterwegs, false);
});

// D1 S3 Auftrag 16 c: was zum Tastendruck gehört (mit, etwa die gewählten Noten), reist mit dem Schritt; verschiedenes mit wird nie zusammengezählt
test('V2 Sammler: mit gehört zum Schritt; gleiche mit werden addiert, verschiedene nacheinander geschickt', async () => {
  const gesendet = [];
  let frei;
  const s = neuerSammler((d, mit) => { gesendet.push([d, mit]); return new Promise((r) => { frei = r; }); });
  s.schritt({ dBeat: 0.25 }, { ids: ['n1'] });
  s.schritt({ dBeat: 0.25 }, { ids: ['n1'] });
  s.schritt({ dBeat: 0.25 }, { ids: ['n1'] });
  s.schritt({ dBeat: 0.25 }, { ids: ['n3'] });
  assert.deepEqual(gesendet, [[{ dBeat: 0.25 }, { ids: ['n1'] }]]);
  frei(); await new Promise((r) => setImmediate(r));
  assert.deepEqual(gesendet[1], [{ dBeat: 0.5 }, { ids: ['n1'] }], 'die zwei gestauten mit n1 als einer');
  frei(); await new Promise((r) => setImmediate(r));
  assert.deepEqual(gesendet[2], [{ dBeat: 0.25 }, { ids: ['n3'] }], 'der Schritt mit n3 eigens, mit seiner Auswahl');
  frei(); await new Promise((r) => setImmediate(r));
  assert.equal(gesendet.length, 3); assert.equal(s.unterwegs, false);
});
