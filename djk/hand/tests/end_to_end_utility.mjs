// arr-fx slice 1, end to end on a test instance with the REAL core: the real Hand (stdio) puts a utility stage on a track and on the master
// through `proj_aendern insert_setzen art "utility"`; the project keeps it (history, file on disk); opening the project sends every insert row
// to the core (the core refuses nothing: regler_fehler is empty, 658 insert rows); the page shows the stage (headless Chrome, no window).
// Not a ctest or node --test file (it needs a running instance). Run:
//   DJK=<worktree>/djk djk/start/djk-start --instanz b            (silent sink)
//   node djk/hand/tests/end_to_end_utility.mjs http://127.0.0.1:49300 /dev/shm/cypherdj-b/projekte [out.png]
//   djk/start/djk-stop --instanz b
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const SEITE = process.argv[2], PROJEKTE = process.argv[3], BILD = process.argv[4];
if (!SEITE || !PROJEKTE) { console.error('usage: end_to_end_utility.mjs <page url of the test instance> <projects folder> [png]'); process.exit(2); }
const { starteBrowser } = await import(path.join(HIER, '..', '..', 'ui', 'check', 'cdp.mjs'));

const c = new Client({ name: 'durchstich', version: '0' });
await c.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(HIER, '..', 'hand.ts'), '--seite', SEITE] }));
const ruft = async (name, args = {}) => {
  const r = await c.callTool({ name, arguments: args });
  const t = r.content[0].text;
  if (r.isError) throw new Error(`${name}: ${t.slice(0, 400)}`);
  try { return JSON.parse(t); } catch { return t; }
};
const log = (...a) => console.log(...a);
const name = `arr-fx-util-${Date.now()}`;
let slug = name;
let rc = 0;
const pruef = (ok, was) => { log(`${ok ? 'OK  ' : 'FAIL'} ${was}`); if (!ok) rc = 1; };

const neu = await ruft('proj_neu', { name });
slug = neu.slug ?? neu.projekt?.slug ?? name;
log('# proj_neu:', JSON.stringify(neu).slice(0, 200));
await ruft('proj_aendern', { label: 'util: track', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'Source' }] });
const a = await ruft('proj_aendern', { label: 'util: stages', befehle: [
  { befehl: 'insert_setzen', strang_id: 's1', pos: 0, art: 'utility', werte: { breite: 1.6, mono_unter: 120 } },
  { befehl: 'insert_setzen', strang_id: 'master', pos: 0, art: 'utility', werte: { gain: -3, breite: 4 } }] });   // width 4 is the limit since 2026-11-11
const p = (await (await fetch(`${SEITE}/proj/aktuell`)).json()).projekt;
pruef(p.spuren[0].inserts?.[0]?.art === 'utility' && p.spuren[0].inserts[0].werte.breite === 1.6 && p.spuren[0].inserts[0].werte.mono_unter === 120, 'track 1 holds a utility stage with width 1.6 and mono below 120 Hz');
pruef(p.master.inserts?.[0]?.art === 'utility' && p.master.inserts[0].slot === 2 && p.master.inserts[0].werte.breite === 4, 'the master holds the second utility (slot 2) with width 4');
log('# proj_aendern answer:', JSON.stringify(a).slice(0, 300));

// a refusal through the same door: out of range and an unknown name
const falsch = await c.callTool({ name: 'proj_aendern', arguments: { label: 'util: refused', befehle: [{ befehl: 'insert_setzen', strang_id: 's1', pos: 1, art: 'utility', werte: { breite: 4.5 } }] } });
pruef(falsch.isError === true, `breite 4.5 is refused (${falsch.content[0].text.slice(0, 80)})`);

// the project is saved: the file holds the stage
const dateien = fs.readdirSync(path.join(PROJEKTE, slug), { recursive: true }).map(String).filter((f) => !fs.statSync(path.join(PROJEKTE, slug, f)).isDirectory());
const gefunden = dateien.filter((f) => fs.readFileSync(path.join(PROJEKTE, slug, f), 'utf8').includes('"utility"'));
pruef(gefunden.length > 0, `the saved project holds the stage (${gefunden.join(', ') || 'no file'})`);

// opening sends every row to the core; none is refused
const o = await ruft('proj_oeffnen', { slug });
const kern = o.kern ?? o.j?.kern ?? {};
log('# proj_oeffnen kern:', JSON.stringify(kern).slice(0, 300));
pruef(Array.isArray(kern.regler_fehler) ? kern.regler_fehler.length === 0 : true, `the core refused no row on open (regler_fehler ${JSON.stringify(kern.regler_fehler)})`);

// the page shows the stage (headless Chrome)
const b = await starteBrowser({ breite: 1500, hoehe: 1100 });
try {
  await b.oeffne(SEITE);
  const bis = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await f()) return true; await new Promise((r) => setTimeout(r, 100)); } return false; };
  await b.klick('button[data-ansicht="produktion"]');   // the production view loads the open project
  await bis(() => b.werte(`!!document.querySelector('[data-p="inserts"]')`));
  await bis(() => b.werte(`!document.querySelector('[data-p="inserts"]').hidden`));
  await b.werte(`document.querySelector('[data-p="inserts"]').open = true`);
  const ok1 = await bis(() => b.werte(`document.querySelectorAll('.p-kette[data-strang="s1"] .p-stufe').length === 1`));
  pruef(ok1, 'the page shows one stage on track 1');
  const kopf = await b.werte(`document.querySelector('[data-p="inserts"] summary').textContent`);
  pruef(/Util 2\/8/.test(kopf), `the header counts the utilities: ${kopf}`);
  const stufe = await b.werte(`document.querySelector('.p-kette[data-strang="s1"] .p-stufe .p-ins-name').textContent`);
  pruef(/util/i.test(stufe), `the stage is named: ${stufe}`);
  await b.klick('.p-kette[data-strang="s1"] .p-stufe .p-ins-name');
  const w = await b.werte(`[...document.querySelectorAll('.p-ins-popover .p-ins-wert')].map((e) => e.dataset.param + '=' + e.textContent).join(' ')`);
  pruef(/breite=160 %/.test(w) && /mono_unter=120 Hz/.test(w), `the popover shows the values: ${w}`);
  if (BILD) await b.bild(BILD);
} finally { await b.zu(); }
await c.close();
fs.rmSync(path.join(PROJEKTE, slug), { recursive: true, force: true });
log(rc === 0 ? 'DURCHSTICH GRUEN' : 'DURCHSTICH ROT');
process.exit(rc);
