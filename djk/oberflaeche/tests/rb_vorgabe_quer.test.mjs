// Cross binding of the RB-338 defaults: the normalised defaults of the lane parameters live twice, as RB_VORGABE_NORM in projekt/modell.ts (start values of
// auto_neu) and as the table of the core sink (kern/src/arr_rb_senke.cpp, the base value when a lane falls away). The core test checks the sink table against the
// FFI itself; this test checks that both tables agree, so a changed default cannot sit in one place only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RB_VORGABE_NORM } from '../projekt/modell.ts';

const kern = (p) => fs.readFileSync(new URL(`../../kern/${p}`, import.meta.url), 'utf8');

test('RB_VORGABE_NORM in modell.ts equals the default table of the core sink (1e-5)', () => {
  const namen = /ARR_GERAET_PARAM_NAME\[[^\]]*\]\s*=\s*\{([^}]*)\}/.exec(kern('include/cypherdj/arr_wiedergabe.h'));
  assert.ok(namen, 'ARR_GERAET_PARAM_NAME not found in arr_wiedergabe.h');
  const ids = [...namen[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const tabelle = /RB_VORGABE_NORM\[[^\]]*\]\s*=\s*\{([^}]*)\}/.exec(kern('src/arr_rb_senke.cpp'));
  assert.ok(tabelle, 'RB_VORGABE_NORM not found in arr_rb_senke.cpp');
  const werte = tabelle[1].split(',').map((x) => parseFloat(x));
  assert.equal(ids.length, 4);
  assert.equal(werte.length, ids.length);
  assert.ok(werte.every((w) => Number.isFinite(w)));
  ids.forEach((id, i) => {
    assert.ok(id in RB_VORGABE_NORM, `${id} missing in modell.ts`);
    assert.ok(Math.abs(RB_VORGABE_NORM[id] - werte[i]) <= 1e-5, `${id}: modell.ts ${RB_VORGABE_NORM[id]} vs core ${werte[i]}`);
  });
});
