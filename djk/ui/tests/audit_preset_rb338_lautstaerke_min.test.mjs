// Audit U17: saving a preset from an RB-338 track whose volume is at the minimum (norm 0) was refused as wert_ungueltig, because rbPlain gives
// 10**(-48*0.05) and the preset device range starts at 10**(-48/20), 4e-18 higher. Every value werteVonZiel gives for a norm 0..1 must pass the preset check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt, RB_PARAMETER } from '../project/model.ts';
import { werteVonZiel } from '../presets/apply.ts';
import { geraetVon } from '../presets/devices.ts';
import { pruefeWerte } from '../presets/model.ts';

const mitWert = (parameter) => fuehreListeAus(neuesProjekt('P'),
  [{ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'rb338', parameter } }]).projekt;

for (const norm of [0, 0.25, 0.5, 1]) {
  test(`rb338 track with every parameter at norm ${norm}: werteVonZiel passes the strict preset check`, () => {
    const parameter = Object.fromEntries(RB_PARAMETER.map((k) => [k, norm]));
    const w = werteVonZiel({ art: 'spur', spur_id: 's1' }, mitWert(parameter));
    assert.doesNotThrow(() => pruefeWerte(geraetVon('rb338'), w.werte, true), `norm ${norm}: ${JSON.stringify(w.werte)}`);
  });
}

test('the volume at norm 0 stays the quietest value of the range (not raised above the device minimum)', () => {
  const w = werteVonZiel({ art: 'spur', spur_id: 's1' }, mitWert({ lautstaerke: 0 }));
  assert.ok(Math.abs(w.werte.lautstaerke - 10 ** (-48 / 20)) < 1e-15);
});
