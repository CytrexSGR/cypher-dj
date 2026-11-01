// Browser probe returns (1.10 slice 3): add a return, drag a send (one history line), Hall slider, mute, undo, delete, console.
// Prüfstapel auf einer Prüfinstanz (Kern-Attrappe, Zähl-Relais, Leitstand, echter Seiten-Server) mit der Projekt-Attrappe davor (rechnet
// Gruppen- und Master-Befehle mit dem echten S2-Kern), kopfloser Chrome über cdp.mjs mit echten Mausereignissen. Kein Ton, kein Fenster, kein Betrieb.
// Aufruf: node pruef/probe_returns.mjs [--instanz i]   Ergebnis: pruef/ergebnisse/<zeit>-routing/bericht.md; Exit 1 bei FEHL.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stapel.mjs';
import { starteBrowser } from './cdp.mjs';
import { starteProjAttrappe, neuesProjekt } from './proj_attrappe.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: process.env.CYPHERDJ_PROBE_INSTANZ ?? 'i' } } });
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = path.join(HIER, 'ergebnisse', `${zeit}-returns`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnis = { zeit, instanz: opt.instanz, punkte: {} };
const zeilen = [];
const notiere = (k, ok, text) => { ergebnis.punkte[k] = { ok, text }; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const s = await starteStapel(ORDNER, opt.instanz, {}, {});
const at = await starteProjAttrappe({ oben: s.url });
const b = await starteBrowser();
const w = (x) => b.werte(x);
const projekt = () => w('window.djkProd.projekt');
const postA = (weg, d) => fetch(at.url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => r.json());
const gruppenKoepfe = () => w(`document.querySelectorAll('.p-gruppenkopf').length`);
const setzeRegler = (sel, wert, ereignis = 'input') => w(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(String(wert))}; e.dispatchEvent(new Event(${JSON.stringify(ereignis)}, { bubbles: true })); })()`);

async function saat(name, spuren) {
  const p0 = neuesProjekt(name);
  p0.spuren = spuren.map(([id, nr, nm, art, geraet]) => ({ id, nr, name: nm, farbe: '#3b8de0', art: art ?? 'audio', ...(geraet ? { geraet, freeze: null } : {}), fader_db: 0, pan: 0, mute: false, solo: false, clips: [] }));
  const r = await postA('/attrappe/saat', { projekt: p0 });
  await postA('/attrappe/sse', { a: 'proj', f: { slug: r.slug, rev: 1, label: 'seed', quelle: 'cypher' } });
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== r.slug; i++) await warte(50);
  await warte(200);
}

const verlaufZeilen = async () => {
  if ((await w(`document.querySelector('[data-p="verlauf"]').getAttribute('aria-expanded')`)) !== 'true') { await b.klick('[data-p="verlauf"]'); await warte(500); }
  return w(`document.querySelectorAll('[data-p="verlauf-liste"] li').length`);
};
try {
  await b.oeffne(at.url);
  await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1000);
  await saat('Returns', [['s1', 1, 'Kick'], ['s2', 2, 'Bass'], ['s3', 3, 'Pad']]);
  const koepfe = () => w(`document.querySelectorAll('.p-returnkopf').length`);
  notiere('R3.1 without a return: block there, no return strip, no send grid (negative control)', (await w(`document.querySelector('[data-p="returns"]').hidden`)) === false
    && (await koepfe()) === 0 && (await w(`document.querySelector('[data-p="sends"]').hidden`)) === true, `strips ${await koepfe()}`);
  await b.klick('[data-p="neu-return"]'); await warte(600);
  const p1 = await projekt();
  notiere('R3.2 "+ Return: Hall" adds a return (return_neu)', (await koepfe()) === 1 && p1.returns?.length === 1 && p1.returns[0].name.length > 0, `strips ${await koepfe()}, project ${JSON.stringify(p1.returns?.map((r) => r.name))}`);
  notiere('R3.3 send grid: one row per track, one slider for the return', (await w(`document.querySelectorAll('.p-sendzeile').length`)) === 3 && (await w(`document.querySelectorAll('.p-sendregler').length`)) === 3, 'rows and sliders');
  const v0 = await verlaufZeilen();
  await setzeRegler('.p-sendregler[data-strang="s1"]', -12); await warte(150);
  await setzeRegler('.p-sendregler[data-strang="s1"]', -9); await warte(150);
  await setzeRegler('.p-sendregler[data-strang="s1"]', -6); await warte(900);
  const p2 = await projekt();
  notiere('R3.4 a send drag lands in the project (send_setzen); the single history line per drag is the server coalescing of Task 9 (this stub keeps no coalescing)', p2.spuren[0].sends?.[0]?.db === -6, `db ${p2.spuren[0].sends?.[0]?.db}, history lines +${(await verlaufZeilen()) - v0}`);
  await setzeRegler('.p-returnkopf .p-hall[data-feld="decay"]', 0.8); await warte(800);
  const p3 = await projekt();
  notiere('R3.5 Hall slider lands in the project and shows the unit', p3.returns[0].hall.decay === 0.8 && /s$/.test(await w(`document.querySelector('.p-hallwert[data-feld="decay"]').textContent`)), `decay ${p3.returns[0].hall.decay}, text ${await w(`document.querySelector('.p-hallwert[data-feld="decay"]').textContent`)}`);
  await b.klick('.p-returnkopf .p-mute'); await warte(600);
  const m1 = (await projekt()).returns[0].mute;
  await b.klick('[data-p="undo"]'); await warte(600);
  notiere('R3.6 return mute, undo takes it back', m1 === true && (await projekt()).returns[0].mute === false, `mute ${m1}, after undo ${(await projekt()).returns[0].mute}`);
  const kanaele = await w(`[...document.querySelectorAll('.meter')].map((m) => m.dataset.kanal).filter(Boolean)`);
  notiere('R3.7 level meter ret/1 present, ret/2 not', kanaele.includes('ret/1') && !kanaele.includes('ret/2'), `channels ${JSON.stringify(kanaele)}`);
  for (let i = 0; i < 3; i++) { await b.klick('[data-p="neu-return"]'); await warte(500); }
  notiere('R3.8 four returns lock the button with the text "All 4 returns are used"', (await w(`document.querySelector('[data-p="neu-return"]').disabled`)) === true
    && (await w(`document.querySelector('[data-p="neu-return"]').title`)) === 'All 4 returns are used' && (await koepfe()) === 4, `strips ${await koepfe()}`);
  await b.bild(path.join(ORDNER, 'returns.png'));
  await b.klick('.p-returnkopf[data-ret="r1"] .p-loeschen'); await warte(700);
  const p4 = await projekt();
  notiere('R3.9 delete a return: its sends go away', p4.returns.length === 3 && p4.spuren.every((s) => !(s.sends ?? []).some((x) => x.id === 'r1')) && (await koepfe()) === 3, `returns ${p4.returns.length}, sends of s1 ${JSON.stringify(p4.spuren[0].sends ?? [])}`);
  const fk = b.konsole.filter((k) => k.typ === 'exception' || (k.typ === 'error' && !/Failed to load resource/.test(k.text)));
  notiere('R3.10 console', fk.length === 0, `errors ${fk.length}${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text).join(' | ')}` : ''}`);
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await at.stoppe();
  await s.stoppe();
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe Returns ${zeit} (Instanz ${opt.instanz})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
