// K2 Task 3.6: Kleber-Knopf (GLUE) im Master-Bereich, kopflos gegen die Attrappe. Knopf da, Zug sendet /griff (→ /test/hand
// master/kleber), ein /e/regler von außen (Griff per HTTP) bewegt ihn, nach Neuladen steht er noch da. Bild des Master-Bereichs.
// Aufruf: node pruef/probe_kleber.mjs [--bild <png>] [--instanz g]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';
import { baueBestand } from '../tests/hilfen/bestand.mjs';

const { values: opt } = parseArgs({ options: { bild: { type: 'string' }, instanz: { type: 'string', default: 'g' } } });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kleber-'));
const bestand = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-kleber-best-'));
baueBestand(bestand, []);
const s = await starteStapel(ORDNER, opt.instanz, {}, { bestand });
const b = await starteBrowser();
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z)) : []);
let rot = 0;
const pruefe = (k, ok, text) => { if (!ok) rot++; process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };
const SEL = '.knopf[data-pfad="master/kleber"]';
const stellung = () => b.werte(`window.djkRegler.get('master/kleber').x`);
const anzeige = () => b.werte(`document.querySelector('[data-wert="master/kleber"]').textContent`);
try {
  await b.oeffne(s.url);
  await warte(1500);
  pruefe('Knopf da', (await b.werte(`document.querySelectorAll('${SEL}').length`)) === 1 && (await b.werte(`document.querySelector('.mitte').contains(document.querySelector('${SEL}'))`)),
    'genau ein Knopf master/kleber im Master-Bereich');
  pruefe('Beschriftung', (await b.werte(`document.querySelector('${SEL}').closest('.summe').querySelector('.glutext span').textContent`)) === 'GLUE', 'GLUE');
  pruefe('Vorgabe', (await stellung()) === 0 && (await anzeige()) === 'OFF', `Stellung ${await stellung()}, Anzeige ${await anzeige()}`);
  const t = Date.now();
  await b.ziehe(SEL, 0, -120);   // nach oben = mehr
  await warte(500);
  const an = jsonl(path.join(ORDNER, 'relais.jsonl')).filter((z) => z.t >= t && z.adresse === '/test/hand' && z.felder.pfad === 'master/kleber');
  const x1 = await stellung();
  pruefe('Zug sendet', an.length >= 1 && an.every((z) => z.felder.midi_roh >= 0 && z.felder.midi_roh <= 1) && an.at(-1).felder.midi_roh > 0.3,
    `${an.length} Griffe, letzter midi_roh ${an.at(-1)?.felder.midi_roh}, Stellung ${x1}, Anzeige ${await anzeige()}`);
  // eingehend: Griff von außen (HTTP), die Seite darf nicht selbst gezogen haben
  const vor = await b.werte('window.djkGesendet.length');
  await fetch(s.url + 'griff', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad: 'master/kleber', u: 0.2 }) });
  await warte(600);
  const x2 = await stellung();
  pruefe('eingehend bewegt', Math.abs(x2 - 0.2) < 0.02 && Math.abs(x2 - x1) > 0.1 && (await b.werte('window.djkGesendet.length')) === vor,
    `Stellung ${x1} → ${x2} (Soll 0,2), Anzeige ${await anzeige()}`);
  await b.oeffne(s.url);   // Neuladen: Stand kommt aus dem Strom
  await warte(1500);
  const x3 = await stellung();
  pruefe('nach Neuladen', Math.abs(x3 - 0.2) < 0.02 && (await anzeige()) === '20%', `Stellung ${x3}, Anzeige ${await anzeige()}`);
  await b.ziehe(SEL, 0, 0); // Klick
  await b.werte(`document.querySelector('${SEL}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  await warte(500);
  pruefe('Doppelklick Reset', (await stellung()) === 0 && (await anzeige()) === 'OFF', `Stellung ${await stellung()}, Anzeige ${await anzeige()}`);
  await b.ziehe(SEL, 0, -60);
  await warte(300);
  if (opt.bild) { fs.mkdirSync(path.dirname(opt.bild), { recursive: true }); await b.bild(opt.bild); }
  pruefe('Konsole', b.konsole.length === 0, `${b.konsole.length} Meldungen ${JSON.stringify(b.konsole.slice(0, 2))}`);
} finally { await b.zu(); await s.stoppe(); fs.rmSync(ORDNER, { recursive: true, force: true }); fs.rmSync(bestand, { recursive: true, force: true }); }
process.exit(rot ? 1 : 0);
