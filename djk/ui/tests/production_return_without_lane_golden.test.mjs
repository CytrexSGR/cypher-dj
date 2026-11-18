// Pin: a project WITHOUT a return fader lane renders the same mixer return strips, strip heads and "+ Lane" target lists as before the return fader
// lane reached the page (golden captured on 11431bc8c, before any page change of this slice). Without google-chrome the test is skipped.
// Set CYPHERDJ_GOLDEN_SCHREIBEN=1 to rewrite the golden (only ever on code that is known to be right).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite } from '../check/page_mock.mjs';
import { freieZiele, freieZieleGruppe, freieZieleStrang } from '../public/production/lanes.js';

const CHROME = fs.existsSync('/usr/bin/google-chrome');
const GOLDEN = new URL('./golden/ret_seite_ohne_lane.json', import.meta.url);
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;
const fertig = (p) => { p.rev = 1; p.wiedergabe_rev = 1; return JSON.parse(JSON.stringify(p)); };
// 1 track with a fader lane, 2 returns (EQ insert on r1, no lane on any return), the master
const projekt = () => fertig(lauf(neuesProjekt('Golden'), [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }, { befehl: 'return_neu' }, { befehl: 'return_neu' },
  { befehl: 'insert_setzen', strang_id: 'r1', pos: 0, art: 'eq' }, { befehl: 'auto_neu', spur_id: 's1', ziel: 'fader' }]));
const html = (s, sel) => s.w(`document.querySelector(${JSON.stringify(sel)}).innerHTML`);
const klick = (s, sel) => s.w(`document.querySelector(${JSON.stringify(sel)}).click()`);

async function erfasse(t) {
  const p = projekt();
  const s = await starteSeite();
  t.after(() => s.stoppe());
  await s.oeffne();
  await s.saat(p);
  const out = { mixer_returns: await html(s, '[data-p="mixer-returns"]'), koepfe_zu: await html(s, '[data-p="koepfe"]') };
  await klick(s, '.p-arr-strang[data-strang="r1"] .p-lane');
  out.koepfe_r1_offen = await html(s, '[data-p="koepfe"]');
  await klick(s, '.p-arr-strang[data-strang="r1"] .p-lane');
  await klick(s, '.p-kopf[data-spur="s1"] .p-lane');
  out.koepfe_s1_offen = await html(s, '[data-p="koepfe"]');
  const pr = p.returns, m = p.master, s1 = p.spuren[0];
  out.ziele = { strang_r1: freieZieleStrang(pr[0]), gruppe_r1: freieZieleGruppe(pr[0]), strang_master: freieZieleStrang(m), gruppe_master: freieZieleGruppe(m),
    spur_s1: freieZiele(s1) };
  return out;
}

test('ret_ohne_lane_seite_gleich_wie_vorher: mixer returns, strip heads and target lists equal the golden', { skip: !CHROME && 'no google-chrome' }, async (t) => {
  const jetzt = await erfasse(t);
  if (process.env.CYPHERDJ_GOLDEN_SCHREIBEN === '1') { fs.writeFileSync(GOLDEN, JSON.stringify(jetzt, null, 1) + '\n'); return; }
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  // The one deliberate change since the golden: the open "+ Lane" menu of a return now starts with Volume (a return without a fader lane is offered one).
  // Everything else in that head is still the golden; the expected string is the golden with exactly that one entry added (menu and its data-optionen key).
  golden.koepfe_r1_offen = golden.koepfe_r1_offen
    .replace('[&quot;&quot;,&quot;+ Lane&quot;],', '[&quot;&quot;,&quot;+ Lane&quot;],[&quot;fader&quot;,&quot;Volume&quot;],')
    .replace('<option value="">+ Lane</option>', '<option value="">+ Lane</option><option value="fader">Volume</option>');
  assert.ok(golden.koepfe_r1_offen.includes('value="fader">Volume</option>') && golden.koepfe_r1_offen.includes('[&quot;fader&quot;,&quot;Volume&quot;]'), 'the golden edit applied');
  for (const k of Object.keys(golden)) assert.deepEqual(jetzt[k], golden[k], `part ${k} differs from the golden`);
  assert.deepEqual(Object.keys(jetzt), Object.keys(golden));
  // negative control: the comparison can fail (an `auto` class on the return strip would turn the golden red)
  const falsch = golden.mixer_returns.replace('p-returnkopf"', 'p-returnkopf auto"');
  assert.notEqual(falsch, golden.mixer_returns, 'the control string differs');
  assert.notDeepEqual(falsch, jetzt.mixer_returns);
});
