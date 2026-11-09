// Browser probe bounce (package 1.14 slice 4, spec B-AK15, plan task 3.4): every bounce gesture of the page sends exactly ONE POST /proj/bounce with
// the expected body, Use Whole Lane sends ONE /proj/aendern with comp_waehlen, and the console stays clean. Test stack on a test instance (core
// double, counting relay, leitstand, real page server) with the project double in front (proj_mock.mjs records /proj/bounce and answers it
// without a change), headless Chrome through cdp.mjs with real mouse events at 1920x1080. No sound, no window, no operation.
// Call: node check/probe_bounce.mjs [--instanz c]   Result: pruef/ergebnisse/<time>-bounce/bericht.md; exit 1 on FEHL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { starteStapel } from './stack.mjs';
import { starteBrowser } from './cdp.mjs';
import { starteProjAttrappe, neuesProjekt } from './proj_mock.mjs';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { instanz: { type: 'string', default: process.env.CYPHERDJ_PROBE_INSTANZ ?? 'c' } } });
process.env.CYPHERDJ_TEST_INSTANZ = opt.instanz;
const zwei = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const zeit = `${d0.getFullYear()}${zwei(d0.getMonth() + 1)}${zwei(d0.getDate())}T${zwei(d0.getHours())}${zwei(d0.getMinutes())}${zwei(d0.getSeconds())}`;
const ORDNER = path.join(HIER, 'ergebnisse', `${zeit}-bounce`);
fs.mkdirSync(ORDNER, { recursive: true });
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const ergebnis = { zeit, instanz: opt.instanz, punkte: {} };
const zeilen = [];
const notiere = (k, ok, text) => {
  ergebnis.punkte[k] = { ok, text }; zeilen.push(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}`); process.stdout.write(`${ok ? 'OK  ' : 'FEHL'} ${k}: ${text}\n`);
};

const SPUR_HOEHE = 64;                      // layout.js SPUR_HOEHE
const SHA = 'a'.repeat(64);
const clip = (id, start, laenge) => ({ id, art: 'audio', name: id, start_beat: start, laenge_beats: laenge, quelle: { sha256: SHA, pfad_hinweis: `${id}.wav` },
  dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
const spur = (id, nr, name, clips, extra = {}) => ({ id, nr, name, farbe: '#3b8de0', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips, ...extra });

const s = await starteStapel(ORDNER, opt.instanz, {}, {});
const at = await starteProjAttrappe({ oben: s.url });
const b = await starteBrowser({ breite: 1920, hoehe: 1080 });
const w = (x) => b.werte(x);
const postA = (weg, d) => fetch(at.url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) })
  .then((r) => r.json());
const zeiger = (art, x, y, extra = {}) => b.maus(art, x, y, extra);
async function klickBei(p) {
  await zeiger('mouseMoved', p.x, p.y, { buttons: 0 }); await zeiger('mousePressed', p.x, p.y); await zeiger('mouseReleased', p.x, p.y);
}
async function rechtsklick(p) {
  await zeiger('mouseMoved', p.x, p.y, { buttons: 0 });
  await zeiger('mousePressed', p.x, p.y, { button: 'right', buttons: 2 });
  await zeiger('mouseReleased', p.x, p.y, { button: 'right', buttons: 0 });
}
const menue = () => w(`(() => { const u = document.querySelector('.p-menue'); return u ? [...u.querySelectorAll('button')].map((e) => ({ text: e.textContent, aus: e.disabled })) : null; })()`);
const menuePunkt = (anfang) => w(`(() => { const e = [...document.querySelectorAll('.p-menue button')].find((x) => x.textContent.startsWith(${JSON.stringify(anfang)}));
  if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
// a point on the arrangement at (beat, track row); the rows are SPUR_HOEHE high while no lane or take row is open
async function punktBei(beat, spurIndex) {
  const f = await w(`(() => { const r = document.querySelector('[data-p="flaeche"]').getBoundingClientRect(); return { l: r.left, t: r.top }; })()`);
  const a = await w('window.djkProd.ansicht');
  return { x: f.l + (beat - a.beat0) * a.pxProBeat, y: f.t + spurIndex * SPUR_HOEHE + SPUR_HOEHE / 2 };
}
const posts = (n0, weg) => at.zustand.log.slice(n0).filter((e) => e.methode === 'POST' && e.weg === weg);
async function waehleMenue(anfang) {
  const m = await menuePunkt(anfang);
  if (!m) return false;
  await klickBei(m); await warte(600);
  return true;
}

async function saat() {
  const p0 = neuesProjekt('Bounce Probe');
  p0.loop = { an: false, von_beat: 0, bis_beat: 16 };   // the copy range is then the hull of the clips (mergeBereich), beats 0 to 8
  p0.spuren = [
    spur('s1', 1, 'Vox', [clip('c1', 0, 4), clip('c2', 4, 4)], { takes: [{ id: 't1', name: 'Take 1', clips: [clip('c9', 0.5, 7)] }] }),
    spur('s2', 2, 'Pad', [clip('c3', 0, 4)]),
    spur('s3', 3, 'Ziel', []),
  ];
  const r = await postA('/attrappe/saat', { projekt: p0 });
  await postA('/attrappe/sse', { a: 'proj', f: { slug: r.slug, rev: 1, label: 'seed', quelle: 'cypher' } });
  for (let i = 0; i < 40 && (await w('window.djkProd.slug')) !== r.slug; i++) await warte(50);
  await warte(300);
}

try {
  await b.oeffne(at.url);
  await warte(1500);
  await b.klick('[data-ansicht="produktion"]'); await warte(1000);
  await saat();

  // 1. Bounce Track in Place on a clip of s1
  const c1 = await punktBei(2, 0);
  await klickBei(c1); await warte(300);
  let n0 = at.zustand.log.length;
  await rechtsklick(c1); await warte(300);
  const m1 = await menue();
  const hatAlle = ['Bounce Track in Place', 'Bounce to New Track', 'Copy for Bounced Paste'].every((t) => m1?.some((x) => x.text.startsWith(t)));
  const keinMerge = !m1?.some((x) => x.text.startsWith('Merge Tracks'));
  await waehleMenue('Bounce Track in Place');
  let p = posts(n0, '/proj/bounce');
  notiere('B1 in place', hatAlle && keinMerge && p.length === 1 && JSON.stringify(p[0].koerper) === JSON.stringify({ art: 'an_ort', spur_id: 's1' }),
    `menu ${JSON.stringify(m1?.map((x) => x.text))}, ${p.length} POST, body ${JSON.stringify(p[0]?.koerper)}`);

  // 2. Bounce to New Track on the same clip
  n0 = at.zustand.log.length;
  await rechtsklick(c1); await warte(300);
  await waehleMenue('Bounce to New Track');
  p = posts(n0, '/proj/bounce');
  notiere('B2 to new track', p.length === 1 && p[0].koerper.art === 'neue_spur' && JSON.stringify(p[0].koerper.spur_ids) === JSON.stringify(['s1']),
    `${p.length} POST, body ${JSON.stringify(p[0]?.koerper)}`);

  // 3. Copy on s1, then right click an empty spot of s3 at beat 10.3 (grid beat: 10)
  n0 = at.zustand.log.length;
  await rechtsklick(c1); await warte(300);
  await waehleMenue('Copy for Bounced Paste');
  const kopiertOhnePost = posts(n0, '/proj/bounce').length === 0;
  const leer = await punktBei(10.3, 2);
  await rechtsklick(leer); await warte(300);
  const m3 = await menue();
  await waehleMenue('Paste Bounced Audio');
  p = posts(n0, '/proj/bounce');
  const k = p[0]?.koerper;
  notiere('B3 copy and paste', kopiertOhnePost && p.length === 1 && k?.art === 'einfuegen' && k.ziel_spur_id === 's3' && k.ziel_beat === 10
    && JSON.stringify(k.spur_ids) === JSON.stringify(['s1']) && k.von_beat === 0 && k.bis_beat === 8,
    `copy sent ${kopiertOhnePost ? 'nothing' : 'a POST'}, menu ${JSON.stringify(m3?.map((x) => x.text))}, ${p.length} POST, body ${JSON.stringify(k)}`);

  // 4. Use Whole Lane: open the take rows of s1 (T button), right click the take head
  await b.klick('.p-kopf[data-spur="s1"] .p-take'); await warte(500);
  n0 = at.zustand.log.length;
  const kopf = await b.mitte('.p-takekopf[data-spur="s1"][data-take="t1"]');
  await rechtsklick(kopf); await warte(300);
  await waehleMenue('Use Whole Lane');
  const aend = posts(n0, '/proj/aendern');
  const bef = aend[0]?.koerper?.befehle;
  notiere('B4 Use Whole Lane', aend.length === 1 && bef?.length === 1 && bef[0].befehl === 'comp_waehlen' && bef[0].take_id === 't1'
    && bef[0].von_beat === 0 && bef[0].bis_beat === 8, `${aend.length} /proj/aendern, befehle ${JSON.stringify(bef)}`);

  const fk = b.konsole.filter((x) => x.typ === 'exception' || (x.typ === 'error' && !/Failed to load resource/.test(x.text)));
  notiere('B5 console', fk.length === 0, `errors/exceptions ${fk.length}${fk.length ? `: ${fk.slice(0, 3).map((x) => x.text).join(' | ')}` : ''}`);
  await b.bild(path.join(ORDNER, 'bounce.png'));
} catch (e) {
  notiere('ABBRUCH', false, e.stack ?? String(e));
} finally {
  await b.zu();
  await at.stoppe();
  await s.stoppe();
}
fs.writeFileSync(path.join(ORDNER, 'ergebnis.json'), JSON.stringify(ergebnis, null, 2));
fs.writeFileSync(path.join(ORDNER, 'bericht.md'), `# Probe bounce ${zeit} (instance ${opt.instanz})\n\n${zeilen.join('\n')}\n`);
const fehl = Object.values(ergebnis.punkte).filter((x) => !x.ok).length;
process.stdout.write(`\n${fehl === 0 ? 'ALL OK' : `${fehl} FEHL`} · report ${path.join(ORDNER, 'bericht.md')}\n`);
process.exit(fehl === 0 ? 0 : 1);
