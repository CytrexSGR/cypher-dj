// Browserprobe Varianten (Paket 1.18, E-c): Tastenreihe A, B, C je Gruppe in der Transportleiste, Klick schaltet über variante_waehlen (AK-c, Seite).
// Prüfstapel auf einer Prüfinstanz (Kern-Attrappe, Zähl-Relais, Leitstand, echter Seiten-Server) mit der Projekt-Attrappe davor (rechnet
// variante_waehlen mit dem echten S2-Kern), kopfloser Chrome über cdp.mjs mit echten Mausereignissen. Kein Ton, kein Fenster, kein Betrieb.
// Aufruf: node pruef/probe_varianten.mjs [--instanz i]   Ergebnis: pruef/ergebnisse/<zeit>-varianten/bericht.md; Exit 1 bei FEHL.
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
const ORDNER = path.join(HIER, 'ergebnisse', `${zeit}-varianten`);
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
const mutes = async () => (await projekt()).spuren.map((x) => x.mute);
const tasten = () => w(`[...document.querySelectorAll('[data-p="varianten"] .p-var')].map((k) => k.textContent + (k.classList.contains('an') ? '*' : '') + ':' + k.getAttribute('aria-pressed'))`);

async function saat(name, spuren) {
  const p0 = neuesProjekt(name);
  p0.spuren = spuren.map(([id, nr, nm, gruppe, mute]) => ({ id, nr, name: nm, farbe: '#3b8de0', art: 'audio', ...(gruppe ? { gruppe } : {}), fader_db: 0, pan: 0, mute, solo: false, clips: [] }));
  const r = await postA('/attrappe/saat', { projekt: p0 });
  await postA('/attrappe/sse', { a: 'proj', f: { slug: r.slug, rev: 1, label: 'seed', quelle: 'cypher' } });
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== r.slug; i++) await warte(50);
  await warte(200);
}

try {
  await b.oeffne(at.url);
  await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1000);
  // ohne Gruppe: keine Tastenreihe (Negativ-Kontrolle)
  await saat('Ohne', [['s1', 1, 'Kick', null, false], ['s2', 2, 'Snare', null, false]]);
  notiere('7.1 ohne Gruppe versteckt', await w(`document.querySelector('[data-p="varianten"]').hidden`) === true, 'die Reihe ist versteckt, solange keine Spur eine Gruppe hat');
  // drei Basslines in der Gruppe bass und ein Kick
  await saat('Bass', [['s1', 1, 'Bass A', 'bass', false], ['s2', 2, 'Bass B', 'bass', true], ['s3', 3, 'Bass C', 'bass', true], ['s4', 4, 'Kick', null, false]]);
  const t0 = await tasten();
  notiere('7.2 Tastenreihe A B C', JSON.stringify(t0) === JSON.stringify(['A*:true', 'B:false', 'C:false']) && (await w(`document.querySelector('[data-p="varianten"]').hidden`)) === false,
    `Tasten ${JSON.stringify(t0)}`);
  const n0 = at.zustand.log.length;
  await b.klick('.p-var[data-spur="s3"]'); await warte(600);
  const m = await mutes();
  const aend = at.zustand.log.slice(n0).filter((e) => e.weg === '/proj/aendern');
  notiere('7.3 Klick auf C (AK-c Seite)', JSON.stringify(m) === JSON.stringify([true, true, false, false]) && aend.length === 1
    && JSON.stringify(await tasten()) === JSON.stringify(['A:false', 'B:false', 'C*:true']),
    `mute ${JSON.stringify(m)} (Kick ${m[3] === false ? "unberührt" : "VERÄNDERT"}), ${aend.length} Anfrage, Tasten ${JSON.stringify(await tasten())}`);
  await b.klick('[data-p="undo"]'); await warte(600);
  const u = await mutes();
  notiere('7.4 Undo stellt den Stand davor her', JSON.stringify(u) === JSON.stringify([false, true, true, false]), `mute ${JSON.stringify(u)}`);
  const fk = b.konsole.filter((k) => k.typ === 'exception' || (k.typ === 'error' && !/Failed to load resource/.test(k.text)));   // der Stapel ohne Katalog beantwortet zwei Ressourcen mit 503
  notiere("7.9 Konsole", fk.length === 0, `Fehler/Exceptions ${fk.length}${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text).join(" | ")}` : ""}`);
  await b.bild(path.join(ORDNER, 'varianten.png'));
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await at.stoppe();
  await s.stoppe();
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe Varianten ${zeit} (Instanz ${opt.instanz})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
