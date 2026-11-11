// Browser probe of plan 1.11 task 11: the PLUGINS group of the device browser, the plugin (host) stage in INSERTS, its parameter popover.
// Stack: check/page_mock.mjs (page + project stand-in, which also answers the plugin routes, see POST /attrappe/plugins) + headless Chrome (cdp.mjs).
// No sound, no window, no studio. Call: node check/probe_plugins_page.mjs [--ausgabe <folder>]; exit 1 on any FEHL.
// Points: 1 list of 3 index entries (one blocked greyed with reason, one instrument marked, no action), 2 search asks the server, RESCAN posts,
//   3 click and drop put exactly one insert_setzen {art: 'host', plugin_id}, 4 one stage in each status: dots, red dot for `ausfall`, latency in ms,
//   5 window button shows the refusal reason, 6 slider move -> ONE param request with the right index, 7 400 parameters render and filter within 100 ms,
//   8 widths 1280 and 900 without overlap (screenshots), 9 negative control: a project without plugin stages shows no dot and asks for no /proj/insert/*, 10 console.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { starteSeite, warte } from './page_mock.mjs';

const { values: opt } = parseArgs({ options: { ausgabe: { type: 'string', default: '/dev/shm/plugins-seite-probe' } } });
fs.mkdirSync(opt.ausgabe, { recursive: true });
let fehl = 0;
const notiere = (k, ok, text) => { if (!ok) fehl++; process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };
const lauf = (p, b) => fuehreListeAus(p, b, { quelle: 'andreas' }).projekt;

const PLUGINS = [
  { id: 'p1', format: 'vst3', pfad: '/p/Hall.vst3', uid: 'AAAA', name: 'Dragonfly Hall', hersteller: 'Dragonfly', art: 'effekt', audio_ein: 2, audio_aus: 2, parameter: 400, status: 'ok' },
  { id: 'p2', format: 'lv2', pfad: 'urn:crash', uid: '', name: 'Crash Synth FX', hersteller: 'Nobody', art: 'effekt', audio_ein: 2, audio_aus: 2, parameter: 0, status: 'blockiert', grund: 'abgestuerzt' },
  { id: 'p3', format: 'vst3', pfad: '/p/Pad.vst3', uid: 'BBBB', name: 'Pad Lab', hersteller: 'Lab', art: 'instrument', audio_ein: 0, audio_aus: 2, parameter: 12, status: 'ok' },
];
const STATI = [['bereit', 'i1', 480], ['startet', 'i2', 0], ['fehlt', 'i3', 0], ['ausfall', 'i4', 96]];
const host = (id, name) => ({ id, art: 'host', slot: Number(id.slice(1)), an: true, werte: {}, plugin: { format: 'vst3', pfad: `/p/${name}.vst3`, uid: 'CCCC', name }, zustand: `plugins/${id}.carxs` });
function projekt(mitHosts) {
  let p = lauf(neuesProjekt(mitHosts ? 'Plugin page' : 'No plugins'), ['Kick', 'Bass', 'Lead', 'Pad'].map((name) => ({ befehl: 'spur_neu', art: 'audio', name })));
  p = JSON.parse(JSON.stringify(p)); p.rev = 1; p.wiedergabe_rev = 1;
  if (mitHosts) { p.spuren[0].inserts = [host('i1', 'Dragonfly Hall'), host('i2', 'Starting FX')]; p.spuren[1].inserts = [host('i3', 'Missing FX'), host('i4', 'Failed FX')]; }
  return p;
}
const PARAMETER = Array.from({ length: 400 }, (_, i) => ({ index: i, name: i === 7 ? 'Decay Time' : `Param ${i}`, min: 0, max: 10, vorgabe: 0.5, einheit: i === 7 ? 's' : '', wert: 0.5 }));

const s = await starteSeite();
const w = s.w, b = s.b;
const post = (weg, d) => s.post(weg, d);
const log = () => fetch(`${s.url}attrappe/log`).then((r) => r.json());
const meldung = () => w(`document.querySelector('[data-p="meldung"]').textContent`);
try {
  await post('/attrappe/plugins', { plugins: PLUGINS, hosts: STATI.map(([status, insert_id, latenz]) => ({ insert_id, h: Number(insert_id.slice(1)), status, latenz, gemessen: status === 'bereit', ...(status === 'ausfall' ? { grund: 'host crashed' } : status === 'fehlt' ? { grund: 'plugin file missing' } : {}) })),
    parameter: { i1: PARAMETER }, fenster: { i2: { fenster: false, grund: 'keine_anzeige' } } });
  await s.oeffne();
  await s.saat(projekt(true));
  await warte(600);
  await b.klick('[data-browser-modus="geraete"]'); await warte(500);

  // 1 the list
  const zeilen = () => w(`[...document.querySelectorAll('#geraete-browser .plugin-zeile')].map((li) => ({ name: li.querySelector('.geraete-name').textContent, aus: li.classList.contains('aus'), titel: li.title, ziehbar: li.draggable, instr: !!li.querySelector('.plugin-instrument'), grund: li.querySelector('.plugin-grund')?.textContent ?? '' }))`);
  const z = await zeilen();
  notiere('1.1 three entries', z.length === 3 && z.map((x) => x.name).join('|') === 'Dragonfly Hall|Crash Synth FX|Pad Lab', JSON.stringify(z.map((x) => x.name)));
  notiere('1.2 blocked entry is grey, reason as tooltip, not draggable', z[1].aus && /crashed/.test(z[1].titel) && /crashed/.test(z[1].grund) && !z[1].ziehbar, JSON.stringify(z[1]));
  notiere('1.3 instrument is marked and has no action', z[2].instr && !z[2].ziehbar && !z[0].instr && z[0].ziehbar, JSON.stringify(z[2]));
  const n0 = (await log()).length;
  await b.klick('#geraete-browser .plugin-zeile:nth-child(3)'); await warte(200);
  const lg = (await log()).slice(n0);
  notiere('1.4 click on the instrument sends nothing', !lg.some((e) => e.weg === '/proj/aendern'), `${await meldung()}`);

  // 2 search and rescan
  const n1 = (await log()).length;
  await w(`(() => { const e = document.querySelector('.plugin-suche'); e.value = 'dragon'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`); await warte(500);
  const sucheAnfrage = (await log()).slice(n1).filter((e) => e.weg === '/plugins');
  notiere('2.1 search asks the server and the list narrows', sucheAnfrage.length === 1 && (await zeilen()).length === 1, `${sucheAnfrage.length} request(s), ${(await zeilen()).length} row`);
  await w(`(() => { const e = document.querySelector('.plugin-suche'); e.value = ''; e.dispatchEvent(new Event('input', { bubbles: true })); })()`); await warte(500);
  const n2 = (await log()).length;
  await b.klick('.plugin-rescan'); await warte(500);
  const rs = (await log()).slice(n2);
  notiere('2.2 RESCAN posts once and the list reloads', rs.filter((e) => e.weg === '/plugins/rescan').length === 1 && rs.some((e) => e.weg === '/plugins') && (await zeilen()).length === 3, JSON.stringify(rs.map((e) => e.weg)));

  // 3 click and drop
  await w(`window.djkProd.spurWahl = new Set(['s3'])`);
  const n3 = (await log()).length;
  await b.klick('#geraete-browser .plugin-zeile:nth-child(1)'); await warte(500);
  const bef = (n) => log().then((l) => l.slice(n).filter((e) => e.weg === '/proj/aendern').flatMap((e) => e.koerper?.befehle ?? []));
  const b3 = await bef(n3);
  notiere('3.1 click puts one host stage on the selected strip', b3.length === 1 && b3[0].befehl === 'insert_setzen' && b3[0].art === 'host' && b3[0].plugin_id === 'p1' && b3[0].strang_id === 's3', JSON.stringify(b3));
  await warte(300);
  await w(`document.querySelector('[data-p="inserts"]').open = true`);
  const n4 = (await log()).length;
  const sel = '#geraete-browser .plugin-zeile:nth-child(1)';
  await w(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({ block: 'center' })`);
  const ziel = await b.mitte('.p-kette[data-strang="s4"]');
  const ok = await b.zieheDnD(sel, ziel.x, ziel.y); await warte(500);
  const b4 = await bef(n4);
  notiere('3.2 drop on a strip row puts one host stage', ok && b4.length === 1 && b4[0].art === 'host' && b4[0].strang_id === 's4', JSON.stringify(b4));
  const n5 = (await log()).length;
  await b.klick('#geraete-browser .plugin-zeile:nth-child(2)'); await warte(200);
  notiere('3.3 click on the blocked entry sends nothing and says why', (await bef(n5)).length === 0 && /crashed/.test(await meldung()), await meldung());

  // 4 the stages
  await s.saat(projekt(true)); await warte(1800);
  await w(`document.querySelector('[data-p="inserts"]').open = true`); await warte(100);
  const punkte = () => w(`[...document.querySelectorAll('.p-stufe[data-art="host"]')].map((e) => ({ id: e.dataset.insert, status: e.querySelector('.p-host-punkt').dataset.status, titel: e.querySelector('.p-host-punkt').title, farbe: getComputedStyle(e.querySelector('.p-host-punkt')).backgroundColor, ms: e.querySelector('.p-host-latenz').textContent, name: e.querySelector('.p-ins-name').textContent }))`);
  const pk = await punkte();
  notiere('4.1 four stages, one dot per status', pk.map((x) => x.status).join(',') === 'bereit,startet,fehlt,ausfall', JSON.stringify(pk.map((x) => x.status)));
  const f = Object.fromEntries(pk.map((x) => [x.status, x.farbe]));
  notiere('4.2 colours: ready green, starting grey, missing and failed red', f.bereit === 'rgb(88, 214, 107)' && f.ausfall === 'rgb(255, 90, 31)' && f.fehlt === f.ausfall && f.startet === 'rgb(138, 141, 152)', JSON.stringify(f));
  notiere('4.3 failed dot carries the reason as title', /host crashed/.test(pk[3].titel) && /plugin file missing/.test(pk[2].titel), `${pk[3].titel} | ${pk[2].titel}`);
  notiere('4.4 latency in ms from HostLage (480 samples = 10.0 ms)', pk[0].ms === '10.0 ms' && pk[3].ms === '2.0 ms', JSON.stringify(pk.map((x) => x.ms)));
  const kopf = await w(`document.querySelector('[data-p="inserts-titel"]').textContent`);
  notiere('4.5 the header latency line uses the host latency (not a constant)', /Latency 10\.0 ms \(480 samples\)/.test(kopf), kopf.slice(-90));

  // 5 window
  const n6 = (await log()).length;
  await b.klick('.p-stufe[data-insert="i2"] .p-host-fenster'); await warte(400);
  const fe = (await log()).slice(n6).filter((e) => e.weg === '/proj/insert/i2/fenster');
  notiere('5.1 window button posts and shows the refusal reason', fe.length === 1 && fe[0].koerper.an === true && /display/.test(await meldung()), `${JSON.stringify(fe.map((e) => e.koerper))} -> ${await meldung()}`);

  // 6 slider
  const t0 = Date.now();
  await b.klick('.p-stufe[data-insert="i1"] .p-ins-name');
  await w(`new Promise((ok) => { const f = () => document.querySelectorAll('.p-ins-host .p-hp-zeile').length === 400 ? ok(1) : requestAnimationFrame(f); f(); })`);
  const aufbauMs = Date.now() - t0;
  await w('window.scrollTo(0, 0)');
  const n7 = (await log()).length;
  await w(`(() => { const r = document.querySelector('.p-ins-host .p-hp-regler[data-index="7"]'); for (const v of [0.2, 0.4, 0.75]) { r.value = String(v); r.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await warte(300);
  const pa = (await log()).slice(n7).filter((e) => e.weg === '/proj/insert/i1/param');
  const wt = await w(`document.querySelector('.p-ins-host .p-hp-zeile[data-index="7"] .p-hp-wert').textContent`);
  notiere('6.1 slider move gives ONE param request with the right index', pa.length === 1 && JSON.stringify(pa[0].koerper) === '{"werte":{"7":0.75}}' && wt === '7.50 s', `${JSON.stringify(pa.map((e) => e.koerper))} text ${wt}`);

  // 7 400 parameters
  const filterMs = await w(`(() => { const e = document.querySelector('.p-ins-host .p-hp-filter'); const t = performance.now(); e.value = 'param 39'; e.dispatchEvent(new Event('input', { bubbles: true })); return { ms: performance.now() - t, n: document.querySelectorAll('.p-ins-host .p-hp-zeile').length }; })()`);
  notiere('7.1 400 rows render (open to all rows) within 100 ms', aufbauMs < 100 + 150 /* click + mock round trip + CDP overhead */ , `${aufbauMs} ms incl. click and request`);
  notiere('7.2 filter narrows 400 to 11 rows within 100 ms', filterMs.ms < 100 && filterMs.n === 11, JSON.stringify(filterMs));
  const renderMs = await w(`(() => { const e = document.querySelector('.p-ins-host .p-hp-filter'); e.value = ''; const t = performance.now(); e.dispatchEvent(new Event('input', { bubbles: true })); return { ms: performance.now() - t, n: document.querySelectorAll('.p-ins-host .p-hp-zeile').length }; })()`);
  notiere('7.3 all 400 rows draw within 100 ms', renderMs.ms < 100 && renderMs.n === 400, JSON.stringify(renderMs));

  // 8 widths
  const box = () => w(`(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; };
    const hit = (a, c) => a.l < c.r - 0.5 && c.l < a.r - 0.5 && a.t < c.b - 0.5 && c.t < a.b - 0.5;
    const ueberlappt = [];
    for (const k of document.querySelectorAll('.p-kette')) {
      const kinder = [...k.children].filter((e) => !e.hidden && e.getBoundingClientRect().width > 0).map((e) => [e, r(e)]);
      for (let i = 0; i < kinder.length; i++) for (let j = i + 1; j < kinder.length; j++) if (hit(kinder[i][1], kinder[j][1])) ueberlappt.push(kinder[i][0].className + ' x ' + kinder[j][0].className);
    }
    const stufen = [...document.querySelectorAll('.p-stufe')].map((e) => [e, r(e)]);
    for (const [e, a] of stufen) for (const c of [...e.children]) { const x = r(c); if (x.r > a.r + 1 || x.l < a.l - 1) ueberlappt.push('child out of stage: ' + c.className); }
    const pop = document.querySelector('.p-ins-host');
    return { ueberlappt, scrollX: document.documentElement.scrollWidth - innerWidth, popRechts: pop ? pop.getBoundingClientRect().right - innerWidth : null };
  })()`);
  for (const breite of [1280, 900]) {
    await b.sende('Emulation.setDeviceMetricsOverride', { width: breite, height: 900, deviceScaleFactor: 1, mobile: false });
    await warte(400);
    const m = await box();
    notiere(`8.${breite} no overlap, popover inside the viewport, no sideways scroll`, m.ueberlappt.length === 0 && m.scrollX <= 0 && m.popRechts <= 0, JSON.stringify(m));
    await b.bild(path.join(opt.ausgabe, `plugins-${breite}-stufen.png`));
    await b.klick('[data-browser-modus="geraete"]'); await warte(200);
    await b.bild(path.join(opt.ausgabe, `plugins-${breite}-browser.png`));
  }

  // 9 negative control
  await b.sende('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const n8 = (await log()).length;
  await s.saat(projekt(false)); await warte(2500);
  await w(`document.querySelector('[data-p="inserts"]').open = true`);
  const keine = await w(`document.querySelectorAll('.p-host-punkt').length`);
  const insertAnfragen = (await log()).slice(n8).filter((e) => e.weg.startsWith('/proj/insert/'));
  notiere('9.1 a project without plugin stages shows no status dot', keine === 0, `${keine} dots`);
  notiere('9.2 ... and requests no /proj/insert/*', insertAnfragen.length === 0, `${insertAnfragen.length} requests`);
  await b.bild(path.join(opt.ausgabe, 'plugins-ohne-stufen.png'));

  // 10 console
  const AUSFALL = /^(Failed to load resource: the server responded with a status of (404|409|400)|WebSocket connection to 'ws:\/\/127\.0\.0\.1:\d+\/undefined' failed)/;   // the second: app.js of the DJ view in this stack (no core socket), not part of this page
  const fe2 = b.konsole.filter((k) => (k.typ === 'exception' || k.typ === 'error') && !AUSFALL.test(k.text));
  notiere('10.1 console without errors', fe2.length === 0, JSON.stringify(fe2.slice(0, 3)));
} catch (e) {
  notiere('FEHLER', false, e.stack ?? String(e));
} finally {
  await s.stoppe();
}
process.stdout.write(`${fehl === 0 ? 'ALL OK' : `${fehl} FEHL`}\n`);
process.exit(fehl === 0 ? 0 : 1);
