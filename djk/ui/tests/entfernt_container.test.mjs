// Container core M10: what the core refactor removed from the page server stays removed. The source scan lists every hit; the route and command
// tables are read from the running code; a full open/close cycle of the live project never sends the old place channel address to the kern.
// Kept on purpose (not asserted away): /loop with the actions rec and kit (take capture and kit, not loop boxes).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BEFEHL_NAMEN, PRO_BEFEHL } from '../project/commands.ts';
import { sitzung } from './support/proj_context.mjs';
import { stapel } from './support/media_library.mjs';
const UI = path.resolve(import.meta.dirname, '..');
const ENTFERNT = /platzKanal|platz\/kanal|LOOP_DJ_NR|loopDjNr|loopAusgangPlatz|liveSlots|eigenePad|boxNurGraph/;

function quellen(dir, aus = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'public' || e.name === 'tests' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) quellen(p, aus);
    else if (/\.(ts|mjs|md)$/.test(e.name)) aus.push(p);
  }
  return aus;
}

test('no source file under djk/ui (excluding public/ and tests/) mentions a removed place channel, loop box or slot symbol', () => {
  const treffer = [];
  for (const f of quellen(UI)) fs.readFileSync(f, 'utf8').split('\n').forEach((z, i) => { if (ENTFERNT.test(z)) treffer.push(`${path.relative(UI, f)}:${i + 1}: ${z.trim().slice(0, 100)}`); });
  assert.deepEqual(treffer, [], `hits:\n${treffer.join('\n')}`);
});

test('the route table has no /platz/kanal, /loopdeck/plaetze, /loop/automation, /loop/raster; /loop answers only rec and kit, loop box actions are unknown', async (t) => {
  const { o, url } = await stapel(t);
  const namen = o.routen().map((r) => `${r.methode} ${r.pfad}`);
  for (const p of ['/platz/kanal', '/e/platz/kanal', '/loopdeck/plaetze', '/loop/automation', '/loop/raster']) {
    assert.ok(!namen.some((n) => n.endsWith(` ${p}`)), `${p} is not routed`);
  }
  assert.ok(namen.includes('POST /loop'), 'POST /loop stays for rec and kit');
  for (const aktion of ['laden', 'start', 'stopp', 'raster', 'raster_fix']) {
    const r = await fetch(`${url}/loop`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ aktion, box: 1, name: 'x' }) });
    assert.deepEqual([r.status, (await r.json()).fehler], [400, 'unbekannte_aktion'], aktion);
  }
});

test('kern never receives /k/platz/kanal in a full open/close cycle of the live project', async (t) => {
  const z = sitzung(t, { arrFristMs: 30 });
  assert.equal((await z.s.liveOeffnen('andreas')).code, 200);
  assert.equal((await z.s.neu('Flat', 'andreas')).code, 200);
  assert.equal((await z.s.liveOeffnen('andreas')).code, 200);
  assert.ok(z.k.gesendet.length > 0, 'the cycle sent something to the kern');
  assert.deepEqual(z.k.gesendet.map((x) => x.adresse).filter((a) => /platz\/kanal/.test(a)), []);
});

test('command table has no loopdeck_plaetze', () => {
  assert.ok(!BEFEHL_NAMEN.includes('loopdeck_plaetze'));
  assert.ok(!Object.hasOwn(PRO_BEFEHL, 'loopdeck_plaetze'));
});
