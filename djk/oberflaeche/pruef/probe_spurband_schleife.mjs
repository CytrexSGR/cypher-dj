// Browser probe of the Studio track band loop (1.12 S7, M13; plan PLAN-1.12-slices4-5-7 (outside the repo) U12 T12.5 and U13 T13.3, source S8 plan
// tasks 4 and 7). Stack of pruef/stapel.mjs (core MOCK, relay, page server) on a test instance, headless Chrome through cdp.mjs with real mouse
// events. No sound. Default instance d (the plan's instance; run under its flock rule):
//   flock -w 1800 /dev/shm/cypherdj-instanz-d.flock node pruef/probe_spurband_schleife.mjs [--instanz d] [--ausgabe <folder>]
// Checks on the BASS FADER band (stream 2):
//   P1  PLAY sends POST /spur with schleife_takte = the band length and no move behind bar n; the message reads "looping from bar N"
//   P2  the head runs modulo the pass: sampled every 250 ms over 2.5 passes, its x falls back to the left at least twice, PLAY stays marked
//   P3  a drag of a point while the loop runs sends exactly ONE POST /spur/aendern after the release (none while the pointer moves); the
//       message reads "change from bar N"; "next loop" shows while the change waits and goes once GET /spur says naechste false
//   P4  STOP right after a drag: no POST /spur/aendern follows, the message stays "stopped", the head is gone
//   P5  negative control: a drag without a running loop sends no POST /spur/aendern
// Return 0 all OK, 1 at least one FEHL. Screenshots and ergebnis.txt in the output folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: 'd' }, ausgabe: { type: 'string' } } });
if (!/^[bde]$/.test(opt.instanz)) { process.stderr.write(`probe_spurband_schleife: instance ${opt.instanz} not allowed (b, d or e)\n`); process.exit(2); }
const ORDNER = opt.ausgabe ? path.resolve(opt.ausgabe) : path.join(HIER, 'ergebnisse', `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-spurband-schleife`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const zeilen = [];
let fehl = 0;
const notiere = (k, ok, text) => { if (!ok) fehl++; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const s = await starteStapel(ORDNER, opt.instanz);
const b = await starteBrowser();
const w = (x) => b.werte(x);
const BAND = '.instanz[data-strom="2"] .spurband:not([hidden])';
try {
  await b.oeffne(s.url); await warte(1500);
  await b.klick('[data-ansicht="studio"]'); await warte(600);
  await b.klick(`.instanz[data-strom="2"] .spurreiter button[data-schluessel="fader"]`); await warte(300);
  // every request the page sends, with its body (post() of app.js calls the global fetch at call time)
  await w(`(() => { window.__anfragen = []; const f = window.fetch.bind(window);
    window.fetch = (u, o = {}) => { if (o.method === 'POST') window.__anfragen.push({ u: String(u), body: o.body ? JSON.parse(o.body) : null, t: performance.now() }); return f(u, o); }; })()`);
  const anfragen = async (u) => (await w('window.__anfragen')).filter((x) => x.u.endsWith(u));
  const meldung = () => w(`document.querySelector('${BAND} .meldung').textContent`);
  const kopfX = () => w(`Number(document.querySelector('${BAND} svg line.kopf')?.getAttribute('x1') ?? -10)`);
  const hinweis = () => w(`!document.querySelector('${BAND} .naechste').hidden`);
  const zieheLinie = async () => {   // grab the end point area of the line (right half, middle) and drag it down
    const m = await b.mitte(`${BAND} svg`);
    await b.maus('mousePressed', m.x + m.w * 0.25, m.y, { button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) await b.maus('mouseMoved', m.x + m.w * 0.25, m.y + i * 3, { button: 'left' });
    await b.maus('mouseReleased', m.x + m.w * 0.25, m.y + 24, { button: 'left', clickCount: 1 });
  };

  // P5 first (nothing runs yet)
  await zieheLinie(); await warte(800);
  notiere('P5', (await anfragen('/spur/aendern')).length === 0, 'a drag without a running loop sends no /spur/aendern');

  await b.klick(`${BAND} .spielen`); await warte(800);
  const play = (await anfragen('/spur')).at(-1);
  const laenge = Number(await w(`document.querySelector('${BAND} select').value`));
  notiere('P1', play?.body?.spur?.schleife_takte === laenge && play.body.spur.fahrten.every((f) => f.ab_takt <= laenge) && /^looping from bar \d+$/.test(await meldung()),
    `body ${JSON.stringify(play?.body)}, message "${await meldung()}"`);
  // P2: the band length decides the pass (default 8 bars = 15 s at 128 BPM): sample over 2.5 passes
  const xs = [];
  const ende = Date.now() + 2.5 * laenge * 4 * 60 / 128 * 1000;
  while (Date.now() < ende) { xs.push(await kopfX()); await warte(250); }
  const zurueck = xs.filter((x, i) => i > 0 && x >= 0 && xs[i - 1] >= 0 && x < xs[i - 1] - 50).length;
  notiere('P2', zurueck >= 2 && await w(`document.querySelector('${BAND} .spielen').classList.contains('an')`), `head fell back ${zurueck} times over ${xs.length} samples`);
  await b.bild(path.join(ORDNER, 'p2-kopf.png'));

  const vorher = (await anfragen('/spur/aendern')).length;
  await zieheLinie();
  await warte(150);
  const waehrend = (await anfragen('/spur/aendern')).length;
  await warte(700);
  const nachher = await anfragen('/spur/aendern');
  const sah = await hinweis();
  let weg = false;
  for (let i = 0; i < 80 && !weg; i++) { await warte(250); weg = !(await hinweis()); }
  notiere('P3', waehrend === vorher && nachher.length === vorher + 1 && nachher.at(-1).body.spur.schleife_takte === laenge && /^change from bar \d+/.test(await meldung()) && sah && weg,
    `requests ${vorher} -> ${waehrend} (during) -> ${nachher.length}, hint shown ${sah}, gone ${weg}, message "${await meldung()}"`);
  await b.bild(path.join(ORDNER, 'p3-aenderung.png'));

  const n4 = (await anfragen('/spur/aendern')).length;
  await zieheLinie();
  await b.klick(`${BAND} .halten`);
  await warte(1500);
  notiere('P4', (await anfragen('/spur/aendern')).length === n4 && (await meldung()) === 'stopped' && (await kopfX()) < 0,
    `requests after STOP ${(await anfragen('/spur/aendern')).length - n4}, message "${await meldung()}", head x ${await kopfX()}`);
} finally {
  await b.zu();
  await s.stoppe();
  fs.writeFileSync(path.join(ORDNER, 'ergebnis.txt'), `${zeilen.join('\n')}\n`);
}
process.stdout.write(fehl ? `FEHL: ${fehl}\n` : 'ALLES OK\n');
process.exit(fehl ? 1 : 0);
