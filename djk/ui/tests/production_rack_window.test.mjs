// Task 11: the rack panel as a floating window opened by the Rack entry of the card menu (Chrome, project stub).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite } from '../check/page_mock.mjs';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
function projekt() {
  let p = neuesProjekt('Rack window');
  p = lauf(p, [{ befehl: 'spur_neu', art: 'instrument', name: 'Kick', geraet: { art: 'intern', name: 'rb338' } }]);
  p = lauf(p, [{ befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'komp' }]);
  p = lauf(p, [{ befehl: 'rack_setzen', strang_id: 's1', makros: [{ name: 'Duck', ziel: [{ insert: 'i1', param: 'schwelle', von: -60, bis: 0 }] }] }]);
  p.rev = 1; p.wiedergabe_rev = 1;
  return JSON.parse(JSON.stringify(p));
}

test('Rack in the card menu opens the rack panel in a window that follows the project', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const s = await starteSeite();
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(projekt());
  const FENSTER = '[data-fenster-id="rack:s1"]';
  assert.equal(await s.w(`document.querySelectorAll(${JSON.stringify(FENSTER)}).length`), 0);
  await s.w(`document.querySelector('[data-w="karte-spur"][data-spur-id="s1"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))`);
  assert.ok(await s.bis(async () => (await s.w(`!![...document.querySelectorAll('.p-menue button')].find((b) => b.textContent === 'Rack' && !b.disabled)`)) === true), 'the Rack entry is enabled');
  await s.w(`[...document.querySelectorAll('.p-menue button')].find((b) => b.textContent === 'Rack').click()`);
  assert.ok(await s.bis(async () => (await s.w(`!!document.querySelector(${JSON.stringify(FENSTER + ' .p-makro[data-makro="4"]')})`)) === true), 'the window shows four macros');
  assert.match(await s.w(`document.querySelector(${JSON.stringify(FENSTER + ' [data-w="fenster-titel"]')}).textContent`), /^Rack · Kick$/);
  // a macro move reaches the project
  await s.w(`(() => { const e = document.querySelector(${JSON.stringify(FENSTER + ' .p-makro[data-makro="1"] .p-makro-regler')}); e.value = '0.5'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  assert.ok(await s.bis(async () => { const p = await s.projekt(); return p.spuren[0].rack?.werte?.[0] === 0.5; }), 'the macro value reached the project');
  // the stage goes: the window closes with it
  const p = await s.projekt();
  await s.saat({ ...JSON.parse(JSON.stringify(p)), spuren: p.spuren.map((x) => ({ ...x, inserts: [], rack: undefined })), rev: p.rev + 1 });
  assert.ok(await s.bis(async () => (await s.w(`document.querySelectorAll(${JSON.stringify(FENSTER)}).length`)) === 0), 'the window closes when the strip has no stage');
});
