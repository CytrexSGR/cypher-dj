// 1.8 S3.5 browser probe: the monitor buttons IN / AUTO / OFF and the input level bar in the track head (headless Chrome against the page server with the
// project stub). Test instance only (default d), under the instance lock of the caller.
//   node check/probe_monitor.mjs [--instanz d]
// Criteria: M1 external track shows three buttons and the bar, internal / instrument / empty tracks show neither (negative control); M2 the pressed button
// follows the project (no key = AUTO); M3 a click sends spur_aendern with monitor ein / auto / aus (the request is captured in the page; the stub does not
// know the field and answers a refusal, which is fine here); M4 no two visible head elements overlap and none leaves the head; M5 console clean.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stack.mjs';
import { starteBrowser } from './cdp.mjs';
import { starteProjAttrappe, neuesProjekt } from './proj_mock.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: process.env.CYPHERDJ_PROBE_INSTANZ ?? 'd' } } });
if (!/^[bde]$/.test(opt.instanz)) { process.stderr.write(`probe_monitor: instance ${opt.instanz} is not allowed: b, d or e only\n`); process.exit(2); }
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = process.env.PROBE_AUSGABE ?? path.join(HIER, 'ergebnisse', `${zeit}-monitor`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnis = { zeit, instanz: opt.instanz, punkte: {} };
const zeilen = [];
const notiere = (k, ok, text) => { ergebnis.punkte[k] = { ok, text }; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`); };

const s = await starteStapel(ORDNER, opt.instanz, {}, {});
const at = await starteProjAttrappe({ oben: s.url });
const b = await starteBrowser();
const w = (x) => b.werte(x);
const postA = (weg, d) => fetch(at.url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }).then((r) => r.json());
const ext = (monitor) => ({ scharf: true, eingang: { art: 'extern', paar: 1, modus: 'stereo' }, ...(monitor ? { monitor } : {}) });
try {
  await b.oeffne(at.url);
  await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1000);
  const p0 = neuesProjekt('Monitor');
  const sp = (id, nr, name, extra = {}) => ({ id, nr, name, farbe: '#3b8de0', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [], ...extra });
  p0.spuren = [sp('s1', 1, 'Guitar', { aufnahme: ext() }), sp('s2', 2, 'Synth', { aufnahme: ext('ein') }), sp('s3', 3, 'Vox', { aufnahme: ext('aus') }),
    sp('s4', 4, 'Drums', { aufnahme: { scharf: false, eingang: { art: 'intern', name: 'erz/1' } } }), sp('s5', 5, 'Empty'),
    { ...sp('s6', 6, 'Bass', { geraet: { art: 'intern', name: 'rb338' }, freeze: null }), art: 'instrument' }];
  const r = await postA('/attrappe/saat', { projekt: p0 });
  await postA('/attrappe/sse', { a: 'proj', f: { slug: r.slug, rev: 1, label: 'seed', quelle: 'cypher' } });
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== r.slug; i++) await warte(50);
  await warte(500);
  const info = (name) => w(`(() => { const k = [...document.querySelectorAll('.p-kopf')].find((e) => e.querySelector('.p-spurname')?.textContent === ${JSON.stringify(name)});
    if (!k) return null; const vis = (e) => e && !e.hidden && getComputedStyle(e).display !== 'none';
    return { mon: vis(k.querySelector('.p-monitor')), tasten: [...k.querySelectorAll('.p-mon')].map((x) => [x.dataset.mon, x.textContent, x.getAttribute('aria-pressed')]),
      pegel: vis(k.querySelector('.p-eingpegel')), kanal: k.querySelector('.p-eingpegel')?.dataset.kanal, label: k.querySelector('.p-monitor')?.getAttribute('aria-label') }; })()`);
  const g = await info('Guitar'), sy = await info('Synth'), v = await info('Vox');
  notiere('M1 external track: three buttons IN / AUTO / OFF and the input bar ein/1', g.mon && g.pegel && g.kanal === 'ein/1' && JSON.stringify(g.tasten.map((t) => t[1])) === '["IN","AUTO","OFF"]' && g.label === 'Monitor Guitar', JSON.stringify(g));
  const neg = [];
  for (const n of ['Drums', 'Empty', 'Bass']) { const x = await info(n); if (!x || x.mon || x.pegel) neg.push(n); }
  notiere('M1 negative control: internal input, no input and instrument track show neither buttons nor bar', neg.length === 0, neg.length ? `shown on ${neg}` : 'Drums, Empty, Bass hidden');
  const gedrueckt = (x) => x.tasten.filter((t) => t[2] === 'true').map((t) => t[0]);
  notiere('M2 the pressed button follows the project: no key AUTO, ein IN, aus OFF', JSON.stringify([gedrueckt(g), gedrueckt(sy), gedrueckt(v)]) === '[["auto"],["ein"],["aus"]]', JSON.stringify([gedrueckt(g), gedrueckt(sy), gedrueckt(v)]));
  // M3: capture the requests of the page
  await w(`(() => { window.__gesendet = []; const f = window.fetch; window.fetch = (u, o) => { if (String(u).includes('/proj/aendern')) { try { window.__gesendet.push(JSON.parse(o.body)); } catch {} } return f(u, o); }; })()`);
  const klickeTaste = async (name, mon) => {
    const sel = await w(`(() => { const k = [...document.querySelectorAll('.p-kopf')].find((e) => e.querySelector('.p-spurname')?.textContent === ${JSON.stringify(name)}); const i = [...document.querySelectorAll('.p-kopf')].indexOf(k); return '.p-kopf:nth-of-type(' + (i + 1) + ') .p-mon[data-mon="${mon}"]'; })()`);
    await b.klick(sel); await warte(500);
  };
  const gesendet = [];
  for (const [name, mon] of [['Guitar', 'ein'], ['Synth', 'auto'], ['Vox', 'ein']]) {
    await w('window.__gesendet.length = 0');
    await klickeTaste(name, mon);
    const x = await w('window.__gesendet.slice()');
    gesendet.push([name, mon, x.flatMap((q) => q.befehle).map((c) => [c.befehl, c.monitor, c.spur_id])]);
  }
  const erwartet = [['Guitar', 'ein', [['spur_aendern', 'ein', 's1']]], ['Synth', 'auto', [['spur_aendern', 'auto', 's2']]], ['Vox', 'ein', [['spur_aendern', 'ein', 's3']]]];
  notiere('M3 a click sends spur_aendern with the monitor value to the right track', JSON.stringify(gesendet) === JSON.stringify(erwartet), JSON.stringify(gesendet));
  // M4 geometry
  const geo = await w(`(() => { const teile = ['.p-spurname', '.p-geraet', '.p-hoch', '.p-runter', '.p-mute', '.p-solo', '.p-fader', '.p-ausgang', '.p-monitor', '.p-pan', '.p-eingpegel', '.p-arm', '.p-eingang', '.p-modus', '.p-pegel', '.p-autoarm', '.p-loeschen'];
    const out = {};
    for (const name of ['Guitar', 'Vox']) {
      const k = [...document.querySelectorAll('.p-kopf')].find((e) => e.querySelector('.p-spurname')?.textContent === name);
      const K = k.getBoundingClientRect(), r = [];
      for (const t of teile) { const e = k.querySelector(t); if (!e || e.hidden || getComputedStyle(e).display === 'none') continue; const q = e.getBoundingClientRect(); r.push([t, Math.round(q.left - K.left), Math.round(q.top - K.top), Math.round(q.width), Math.round(q.height)]); }
      const knoepfe = [...k.querySelectorAll('.p-mon')].map((e) => { const q = e.getBoundingClientRect(); return [e.textContent, Math.round(q.width), Math.round(q.height), e.scrollWidth > e.clientWidth]; });
      out[name] = { kopf: [Math.round(K.width), Math.round(K.height)], r, knoepfe };
    }
    return out; })()`);
  const schneiden = (a, c) => a[1] < c[1] + c[3] && c[1] < a[1] + a[3] && a[2] < c[2] + c[4] && c[2] < a[2] + a[4];
  const probleme = [];
  for (const [name, x] of Object.entries(geo)) {
    for (let i = 0; i < x.r.length; i++) {
      const a = x.r[i];
      if (a[3] <= 0 || a[4] <= 0 || a[1] < 0 || a[2] < 0 || a[1] + a[3] > x.kopf[0] || a[2] + a[4] > x.kopf[1]) probleme.push(`${name}: ${a[0]} outside or empty ${a}`);
      for (let j = i + 1; j < x.r.length; j++) if (schneiden(a, x.r[j])) probleme.push(`${name}: ${a[0]} overlaps ${x.r[j][0]} (${a} / ${x.r[j]})`);
    }
    for (const kn of x.knoepfe) if (kn[3]) probleme.push(`${name}: button ${kn[0]} text is clipped (${kn})`);
  }
  notiere('M4 head geometry: no visible element overlaps another, none leaves the head, no button text is clipped', probleme.length === 0, probleme.length ? probleme.slice(0, 6).join(' | ') : `Guitar ${JSON.stringify(geo.Guitar.r.map((q) => q.slice(0, 1).concat(q.slice(3))))}, buttons ${JSON.stringify(geo.Guitar.knoepfe)}`);
  await b.bild(path.join(ORDNER, 'monitor.png'));
  const fk = b.konsole.filter((k) => k.typ === 'exception' || (k.typ === 'error' && !/Failed to load resource/.test(k.text)));
  notiere('M5 console', fk.length === 0, `errors ${fk.length}${fk.length ? `: ${fk.slice(0, 3).map((k) => k.text).join(' | ')}` : ''}`);
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await at.stoppe();
  await s.stoppe();
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe monitor ${zeit} (instance ${opt.instanz})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALLES OK' : `${fehl} FEHL`} · Bericht ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
