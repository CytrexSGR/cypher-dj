// Browserprobe Routing (1.10 Slice 1): Gruppe anlegen, Spur einstecken, Gruppen- und Master-Fader, Mute, Undo, Löschen, Spurkopf-Raster.
// Prüfstapel auf einer Prüfinstanz (Kern-Attrappe, Zähl-Relais, Leitstand, echter Seiten-Server) mit der Projekt-Attrappe davor (rechnet
// Gruppen- und Master-Befehle mit dem echten S2-Kern), kopfloser Chrome über cdp.mjs mit echten Mausereignissen. Kein Ton, kein Fenster, kein Betrieb.
// Aufruf: node pruef/probe_routing.mjs [--instanz i]   Ergebnis: pruef/ergebnisse/<zeit>-routing/bericht.md; Exit 1 bei FEHL.
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
const ORDNER = path.join(HIER, 'ergebnisse', `${zeit}-routing`);
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
// Raster des Spurkopfs (Nachzug N3): Breiten per getBoundingClientRect, Überlappung je Paar von Kindern
const rastermessung = (sel) => w(`(() => {
  const k = document.querySelector(${JSON.stringify(sel)}); if (!k) return null;
  const kr = k.getBoundingClientRect();
  const kinder = [...k.children].filter((e) => !e.hidden && getComputedStyle(e).display !== 'none').map((e) => { const r = e.getBoundingClientRect(); return { k: e.className.split(' ')[0], x: r.x, y: r.y, b: r.width, h: r.height }; });
  const ueber = [];
  for (let i = 0; i < kinder.length; i++) for (let j = i + 1; j < kinder.length; j++) {
    const a = kinder[i], c = kinder[j];
    if (a.x < c.x + c.b - 0.5 && c.x < a.x + a.b - 0.5 && a.y < c.y + c.h - 0.5 && c.y < a.y + a.h - 0.5) ueber.push(a.k + '×' + c.k);
  }
  const breite = (n) => kinder.find((e) => e.k === n)?.b ?? null;
  return { kopf: { b: kr.width, h: kr.height }, ueber, fader: breite('p-fader'), ausgang: breite('p-ausgang'), eingang: breite('p-eingang'), freeze: breite('p-freeze'), kinder: kinder.map((e) => e.k) };
})()`);

try {
  await b.oeffne(at.url);
  await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1000);
  await saat('Routing', [['s1', 1, 'Kick'], ['s2', 2, 'Bass'], ['s3', 3, 'Pad'], ['s4', 4, 'Surge', 'instrument', { art: 'wirt', name: 'surge', slot: 1 }]]);
  notiere('R1.1 ohne Gruppe: Block sichtbar, kein Gruppenkopf (Negativ-Kontrolle)', (await w(`document.querySelector('[data-p="mixer"]').hidden`)) === false && (await gruppenKoepfe()) === 0, 'der Block steht, es gibt keinen Gruppenkopf');
  await b.klick('[data-p="neu-gruppe"]'); await warte(600);
  notiere('R1.2 + GROUP legt eine Gruppe an', (await gruppenKoepfe()) === 1 && (await projekt()).gruppen.length === 1 && (await w(`document.querySelector('.p-gruppenkopf .p-spurname').textContent`)) === 'Group 1',
    `Gruppenköpfe ${await gruppenKoepfe()}, Projekt ${JSON.stringify((await projekt()).gruppen.map((g) => g.name))}, Meldung „${await w(`document.querySelector('[data-p="meldung"]').textContent`)}“, Knopf gesperrt ${await w(`document.querySelector('[data-p="neu-gruppe"]').disabled`)}`);
  await setzeRegler('.p-kopf[data-spur="s2"] .p-ausgang', 'g1', 'change'); await warte(600);
  await setzeRegler('.p-kopf[data-spur="s3"] .p-ausgang', 'g1', 'change'); await warte(600);
  const p1 = await projekt();
  notiere('R1.3 Ausgang-Wahl steckt Bass und Pad in die Gruppe (ziel_setzen), Kick bleibt auf Master', p1.spuren[1].ausgang?.id === 'g1' && p1.spuren[2].ausgang?.id === 'g1' && p1.spuren[0].ausgang === undefined
    && (await w(`document.querySelector('.p-kopf[data-spur="s2"] .p-ausgang').value`)) === 'g1',
    `Ziele ${JSON.stringify(p1.spuren.map((s) => s.ausgang?.id ?? 'master'))}`);
  await setzeRegler('.p-gruppenkopf[data-gruppe="g1"] .p-fader', -6); await warte(700);
  notiere('R1.4 Gruppen-Fader landet im Projekt (gruppenspur_aendern)', (await projekt()).gruppen[0].fader_db === -6, `fader_db ${(await projekt()).gruppen[0].fader_db}`);
  await setzeRegler('[data-p="pm-fader"]', -3); await warte(700);
  notiere('R1.5 Master-Fader landet im Projekt (master_aendern)', (await projekt()).master.fader_db === -3, `master.fader_db ${(await projekt()).master.fader_db}`);
  await b.klick('.p-gruppenkopf[data-gruppe="g1"] .p-mute'); await warte(600);
  const m1 = (await projekt()).gruppen[0].mute;
  await b.klick('[data-p="undo"]'); await warte(600);
  notiere('R1.6 Mute der Gruppe, Undo nimmt es zurück', m1 === true && (await projekt()).gruppen[0].mute === false, `Mute ${m1}, nach Undo ${(await projekt()).gruppen[0].mute}`);
  const kanaele = await w(`[...document.querySelectorAll('.meter')].map((m) => m.dataset.kanal).filter(Boolean)`);
  notiere('R1.7 Pegelanzeigen grp/1 und pm vorhanden', kanaele.includes('grp/1') && kanaele.includes('pm') && !kanaele.includes('grp/2'), `Kanäle ${JSON.stringify(kanaele)}`);
  // Raster (N3): Audio-Spur und Surge-Spur (FREEZE) nebeneinander; Ausgang-Wahl mit dem längsten Gruppennamen
  const ra = await rastermessung('.p-kopf[data-spur="s2"]'), ri = await rastermessung('.p-kopf[data-spur="s4"]');
  notiere('R1.10 Raster Audio-Spur: nichts überlappt, Ausgang ≥ 38 px, Fader ≥ 60 px', ra && ra.ueber.length === 0 && ra.ausgang >= 38 && ra.fader >= 60, JSON.stringify(ra));
  notiere('R1.11 Raster Instrument-Spur mit FREEZE: nichts überlappt, Ausgang ≥ 38 px, Fader ≥ 60 px', ri && ri.ueber.length === 0 && ri.ausgang >= 38 && ri.fader >= 60 && ri.freeze > 0, JSON.stringify(ri));
  // R2 (1.10 Slice 2, Task 22): Lampe SET LIMITER. Die Attrappe meldet /zustand/arr selbst (ohne limiter_db), darum hält /attrappe/stumm ihre Meldungen
  // für die Dauer des Punkts zurück: die Lampe folgt dann nur den hier eingespeisten Meldungen.
  const lampe = () => w(`document.querySelector('[data-p="limiter"]').hidden`);
  const sse = (f) => postA('/attrappe/sse', { a: '/zustand/arr', f: { nr: 1, status: 0, loop_an: 0, projekt_beat: 0, ursprung_sample: 0, start_beat: 0, metronom_an: 0, limiter_db: -3, ...f } });
  await postA('/attrappe/stumm', { ms: 900 });
  await sse({ limiter_db: 0 }); await warte(100);
  notiere('R2.1 ohne Eingriff ist die Lampe aus (Negativ-Kontrolle)', (await lampe()) === true, 'SET LIMITER versteckt');
  const t0 = Date.now(); await sse({});
  let an = false; for (let i = 0; i < 20 && !an; i++) { an = (await lampe()) === false; if (!an) await warte(20); }
  notiere('R2.2 Eingriff des Limiters: Lampe innerhalb 200 ms', an && Date.now() - t0 < 200, `${an ? 'an' : 'AUS'} nach ${Date.now() - t0} ms`);
  await b.bild(path.join(ORDNER, 'limiter-lampe.png'));
  await sse({ limiter_db: 0 }); await warte(150);
  notiere('R2.3 Limiter ruhig: Lampe geht aus', (await lampe()) === true, 'SET LIMITER versteckt');
  // R2.4: der Kern verstummt (älter als ARR_ALTER_MS): die Lampe darf nicht auf dem letzten Wert stehen bleiben
  await postA('/attrappe/stumm', { ms: 4000 }); await sse({});
  const brannte = (await lampe()) === false;
  let aus = false; for (let i = 0; i < 40 && !aus; i++) { aus = (await lampe()) === true; if (!aus) await warte(50); }
  notiere('R2.4 Kern verstummt: die Lampe erlischt (Zustand unbekannt), sie brannte zuvor', brannte && aus, `brannte ${brannte}, danach ${aus ? 'versteckt' : 'AN'}`);
  await postA('/attrappe/stumm', { ms: 0 }); await warte(700);
  // R2.5: Export-Zeile mit Decke (die Attrappe antwortet wie der Server beim Produktions-Abgriff, P10/P11), danach ein ruhiger Export ohne den Zusatz
  const ausgabeText = () => w(`document.querySelector('[data-p="ausgabe"]').textContent`);
  const ausgabeWarn = () => w(`document.querySelector('[data-p="ausgabe"]').classList.contains('warnung')`);
  const exportiere = async () => { await b.klick('[data-p="export"]'); for (let i = 0; i < 60 && !/^Exported/.test(await ausgabeText()); i++) await warte(100); return ausgabeText(); };
  await postA('/attrappe/ausgabe', { freezeMs: 50, renderMs: 50, spitze_db: 2.4, true_peak_dbtp: 2.6, ueber_decke: true, limiter_db_max: 3.4 });
  const laut = await exportiere(), lautWarn = await ausgabeWarn();
  // sichtbar heißt: nicht abgeschnitten (die Zeile hat sonst max-width 44ch mit Auslassung; der Hinweis stünde im Text, aber nicht auf dem Bildschirm)
  const abgeschnitten = await w(`(() => { const e = document.querySelector('[data-p="ausgabe"]'); return e.scrollWidth > e.clientWidth + 1; })()`);
  await b.bild(path.join(ORDNER, 'export-zeile.png'));
  notiere('R2.5 Export über der Decke: Zeile nennt SET LIMITER CEILING und die Absenkung, Warnfarbe', /ABOVE SET LIMITER CEILING \(set limiter would take 3\.4 dB\)/.test(laut) && lautWarn && !abgeschnitten, `„${laut}“, Warnfarbe ${lautWarn}, abgeschnitten ${abgeschnitten}`);
  await postA('/attrappe/ausgabe', { spitze_db: -4, true_peak_dbtp: -4.2, ueber_decke: false, limiter_db_max: 0 });
  await w(`document.querySelector('[data-p="ausgabe"]').textContent = ''`);
  const leise = await exportiere(), leiseWarn = await ausgabeWarn();
  notiere('R2.6 Export unter der Decke: kein SET-LIMITER-Zusatz, keine Warnfarbe (Negativ-Kontrolle)', /^Exported/.test(leise) && !/SET LIMITER/.test(leise) && !leiseWarn, `„${leise}“, Warnfarbe ${leiseWarn}`);
  await b.bild(path.join(ORDNER, 'routing.png'));
  await b.klick('.p-gruppenkopf[data-gruppe="g1"] .p-loeschen'); await warte(700);
  const p2 = await projekt();
  notiere('R1.8 Gruppe löschen: Mitglieder zurück auf Master, Auswahl zeigt master', p2.gruppen.length === 0 && p2.spuren.every((s) => s.ausgang === undefined)
    && (await w(`document.querySelector('.p-kopf[data-spur="s2"] .p-ausgang').value`)) === 'master', `Gruppen ${p2.gruppen.length}, Ziele ${JSON.stringify(p2.spuren.map((s) => s.ausgang?.id ?? 'master'))}`);
  const fk = b.konsole.filter((k) => k.typ === 'exception' || (k.typ === 'error' && !/Failed to load resource/.test(k.text)));
  notiere('R1.9 Konsole', fk.length === 0, `Fehler/Exceptions ${fk.length}${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text).join(' | ')}` : ''}`);
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await at.stoppe();
  await s.stoppe();
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe Routing ${zeit} (Instanz ${opt.instanz})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
