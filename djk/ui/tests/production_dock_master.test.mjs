// The MASTER card stands in a column of its own at the right edge of the PRODUCTION dock: inside the dock and the viewport, also with the EFFECTS row folded (Chrome, project stub).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
function projekt() {
  let p = neuesProjekt('Master column');
  p = fuehreListeAus(p, [
    { befehl: 'spur_neu', art: 'instrument', name: 'Kick', geraet: { art: 'intern', name: 'rb338' } },
    { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' },
  ], { quelle: 'andreas' }).projekt;
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}
const LAGE = `(() => {
  const k = document.querySelector('[data-w="karte-master"]'), d = document.querySelector('[data-p="dock-wurzel"]');
  if (!k || !d) return null;
  const a = k.getBoundingClientRect(), b = d.getBoundingClientRect();
  return { x: a.left, y: a.top, r: a.right, u: a.bottom, b: a.width, h: a.height, dr: b.right, du: b.bottom, dl: b.left, dt: b.top, vw: innerWidth, vh: innerHeight,
    meter: !!k.querySelector('.meter.senkrecht'), level: !!k.querySelector('[data-w="karte-level"]') };
})()`;

for (const breite of [1920, 2560]) {
  test(`MASTER card lies inside the dock and the viewport at ${breite} px, also with EFFECTS folded`, { skip: !CHROME && 'no google-chrome' }, async (t) => {
    const s = await starteSeite({ breite, hoehe: 1080 });
    t.after(() => s.stoppe());
    await s.oeffne();
    await s.saat(projekt());
    assert.ok(await s.bis(async () => (await s.w(LAGE)) !== null), 'the MASTER card is drawn');
    const innen = (l) => l.x >= l.dl - 0.5 && l.r <= l.dr + 0.5 && l.y >= l.dt - 0.5 && l.u <= l.du + 0.5 && l.x >= 0 && l.r <= l.vw && l.u <= l.vh;
    const offen = await s.w(LAGE);
    console.log(`master ${breite}: x ${offen.x}..${offen.r}, y ${offen.y}..${offen.u}, dock right ${offen.dr}, viewport ${offen.vw}x${offen.vh}`);
    assert.ok(innen(offen), `card inside dock and viewport: ${JSON.stringify(offen)}`);
    assert.ok(offen.b > 0 && offen.h > 0 && offen.meter && offen.level);
    // fold the EFFECTS row through its title
    await s.w(`[...document.querySelectorAll('.w-dock-etikett')].find((e) => e.textContent.trim() === 'EFFECTS').click()`);
    assert.ok(await s.bis(async () => (await s.w(`!!document.querySelector('.w-dock-zeile.p-zu [data-w="dock-fx"]')`)) === true), 'the EFFECTS row is folded');
    const zu = await s.w(LAGE);
    assert.ok(zu.b > 0 && zu.h > 0 && zu.meter && zu.level, `still there when folded: ${JSON.stringify(zu)}`);
    assert.ok(innen(zu), `still inside when folded: ${JSON.stringify(zu)}`);
  });
}
