// Device page (Task 3 of the surfaces plan): the INSTRUMENTS element enlarged as a fixed layer. Pure helpers plus source checks of app.js and the CSS
// (app.js cannot be imported without a DOM; the same approach as the other page source tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { geraeteseiteKlasse, instrumentReiterHtml } from '../public/instruments_view.js';
import { geraeteknopfHtml, GERAETEKNOPF } from '../public/panel_kopf.js';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/panel.css', import.meta.url), 'utf8');
const funktion = (name) => {   // the text of a top-level function of app.js, up to the next line that starts a top-level statement
  const i = app.search(new RegExp(`^(async )?function ${name}\\(`, 'm'));
  assert.ok(i >= 0, `function ${name} exists`);
  const rest = app.slice(i);
  const ab = rest.indexOf('\n') + 1;
  const ende = rest.slice(ab).search(/^\S/m);
  return rest.slice(0, ende < 0 ? undefined : ab + ende);
};

test('geraeteseiteKlasse: closed sets no class; open sets geraeteseite, in PRODUCTION also geraeteseite-produktion', () => {
  assert.deepEqual(geraeteseiteKlasse(false, false), []);
  assert.deepEqual(geraeteseiteKlasse(false, true), []);
  assert.deepEqual(geraeteseiteKlasse(true, false), ['geraeteseite']);
  assert.deepEqual(geraeteseiteKlasse(true, true), ['geraeteseite', 'geraeteseite-produktion']);
});

test('the header button: marker attribute, title and pressed state follow the page state, no em dash', () => {
  const zu = geraeteknopfHtml(false);
  const auf = geraeteknopfHtml(true);
  assert.match(zu, /<button[^>]*class="fp-gross"[^>]*data-fp-gross[^>]*>/);
  assert.match(zu, /title="Open device page"/);
  assert.match(zu, /aria-pressed="false"/);
  assert.match(auf, /title="Close device page \(Esc\)"/);
  assert.match(auf, /aria-pressed="true"/);
  assert.notEqual(zu, auf);
  assert.ok(!zu.includes('—') && !auf.includes('—'));
  assert.equal(GERAETEKNOPF, '[data-fp-gross]');
});

test('one function is the only way in and out: it sets the body classes, rebuilds the plate and measures the header', () => {
  const f = funktion('setzeGeraeteseite');
  assert.match(f, /geraeteseiteKlasse\(/);
  assert.match(f, /classList\.(toggle|add|remove)/);
  assert.match(f, /instrumenteAnsicht\??\.neuBauen\(\)/);   // rebuilt with breit true/false, deferred while a pointer is down in the knob area
  assert.ok(!/instrumenteAnsicht\??\.baue\(\)/.test(f), 'never past the pointer guard');
  assert.match(f, /instrumenteSichtbar\(\)/);   // only while the INSTRUMENTS area shows
  assert.match(f, /--geraete-oben/);   // the layer sits under the page header, whatever its height
  assert.match(app, /function istGeraeteseite\(\)/);
  const aussen = app.replace(f, '');
  assert.ok(!/classList\.[a-z]+\('geraeteseite'/.test(aussen), 'no other code touches the body class');
});

test('every plate in #instrumente gets breit from the state and the header button: bk, Surge and host plates', () => {
  assert.match(app, /function breitFuer\(liste\)/);
  assert.match(funktion('breitFuer'), /istGeraeteseite\(\)[\s\S]*closest\('#instrumente'\)/);   // the EFFECTS plates never go wide
  const platte = funktion('platteBauen');
  assert.match(platte, /const breit = breitFuer\(liste\)/);
  assert.match(platte, /baueFrontplatte\(liste, \{ \.\.\.opt, breit/);
  assert.match(platte, /geraeteknopfHtml\(false\)/);   // the plate button opens; while open the tab strip carries the closer
  assert.match(platte, /!istGeraeteseite\(\)/);
  assert.match(platte, /closest\('#instrumente'\)/);
  // two callers: platteBauen (all device plates) and the REMIX place of the DJ view, which is always wide and scaled into its place
  assert.equal((app.match(/baueFrontplatte\(/g) ?? []).length, 2, 'only platteBauen and the remix place call the renderer');
  assert.match(app, /remixFp = baueFrontplatte\(feld, \{ panel: info\.panel, regler: info\.regler, adapter: remixAdapter, breit: true \}\)/);
  const aufrufe = app.match(/_fp = platteBauen\(liste, /g) ?? [];
  assert.equal(aufrufe.length, 3, 'host plate (RB-338, Cypher Modular), Surge plate and bk plate');
  assert.match(funktion('baueHostBereich'), /platteBauen\(liste, \{ \.\.\.platte/);
  assert.match(funktion('bindeBkKnobs'), /platteBauen\(liste, \{ panel: info\.panel/);
});

test('the tab strip carries the closer while open, so the page has an exit without any plate', () => {
  const zu = instrumentReiterHtml(['erz/5'], 'erz/5', {}, {}, false);
  const auf = instrumentReiterHtml(['erz/5'], 'erz/5', {}, {}, true);
  assert.ok(!zu.includes('data-fp-gross'));
  assert.match(auf, /<button[^>]*class="fp-gross"[^>]*data-fp-gross[^>]*aria-pressed="true"/);
  assert.match(auf, /Close device page/);
  assert.match(app, /geraeteseite: istGeraeteseite/);   // bindeInstrumente is told the state
});

test('the button click toggles the page through one delegated listener on #instrumente', () => {
  assert.match(app, /\$\('#instrumente'\)\.addEventListener\('click', [\s\S]{0,200}closest\(GERAETEKNOPF\)[\s\S]{0,120}setzeGeraeteseite\(!istGeraeteseite\(\)\)/);
});

test('Escape is exclusive: an armed MIDI learn only cancels the learning; the production selection ignores an Escape the page used', () => {
  const k = app.indexOf("e.key === 'Escape' && istGeraeteseite()");
  assert.match(app.slice(k, k + 260), /lernen\.wartet/);
  assert.match(app.slice(k, k + 260), /preventDefault\(\)/);
  const pj = fs.readFileSync(new URL('../public/production/production.js', import.meta.url), 'utf8');
  assert.match(pj, /e\.key === 'Escape' && st\.sichtbar && !menueOffen\(\) && !e\.defaultPrevented && !document\.body\.classList\.contains\('geraeteseite'\)/);
});

test('Escape closes the device page before it touches lib-gross', () => {
  const k = app.indexOf("document.addEventListener('keydown'");
  const gross = app.indexOf("document.body.classList.contains('lib-gross')) gross(false)", k);
  const esc = app.indexOf("e.key === 'Escape' && istGeraeteseite()", k);
  assert.ok(k > 0 && esc > k, 'the Escape branch exists in the keydown handler');
  assert.ok(esc < gross, 'and comes before the lib-gross branch');
  assert.match(app.slice(esc, esc + 120), /setzeGeraeteseite\(false\);[\s}]*return/);
  assert.ok(esc < app.indexOf("e.key === 'l'", k), 'even before the single-letter shortcuts');
});

test('a change of area and a change of page mode close it', () => {
  assert.match(funktion('setzeBereich'), /setzeGeraeteseite\(false(, false)?\)/);
  assert.match(funktion('setzeAnsicht'), /setzeGeraeteseite\(false\)/);
});

test('switching the channel tab while open rebuilds for the new channel and stays wide (no own state in the tab code)', () => {
  const ia = fs.readFileSync(new URL('../public/instruments_view.js', import.meta.url), 'utf8');
  assert.ok(!/classList\.|document\.body/.test(ia), 'the tab code keeps no page state of its own: breit comes from istGeraeteseite() in the bind function, the strip only shows the closer');
  assert.match(funktion('bindeBkKnobs'), /platteBauen\(/);
});

test('the echo refresh still reaches the open plate (same host, same selectors)', () => {
  assert.match(app, /instrumenteSichtbar\(\) && m\[1\] === instrumenteAnsicht\.gewaehlt\(\)\) instrumenteAnsicht\.aktualisiere\(\)/);
  assert.match(app, /liste\._fp = platteBauen\(/);
  assert.match(funktion('bindeBkKnobs'), /liste\._fp = platteBauen\(/);
  assert.match(funktion('baueHostBereich'), /liste\._fp = platteBauen\(|liste\._fp\?\.aktualisiere/);
});

test('CSS: #instrumente is a fixed layer under the header, in the normal view and under body.produktion', () => {
  const regel = /body\.geraeteseite #instrumente\s*\{([^}]*)\}/.exec(css);
  assert.ok(regel, 'rule body.geraeteseite #instrumente');
  assert.match(regel[1], /position:\s*fixed/);
  assert.match(regel[1], /var\(--geraete-oben/);
  assert.match(regel[1], /z-index:\s*\d+/);
  assert.match(regel[1], /background:/);   // opaque: the mixer must not shine through
  assert.match(regel[1], /overflow:\s*auto/);
  assert.match(css, /body\.produktion\.lib-zu\.geraeteseite-produktion #bestand > #instrumente:not\(\[hidden\]\)\s*\{[^}]*display:\s*flex/);   // the narrow production browser hides its children when closed
  assert.match(css, /\.fp-gross\s*\{/);
  assert.match(css, /body\.geraeteseite #bestand\s*\{[^}]*z-index:\s*(2[2-9]|[3-9]\d)/);   // above .p-verlauf (20) and .p-midi (21) of the production view
});

const prodCss = fs.readFileSync(new URL('../public/production/production.css', import.meta.url), 'utf8');
test('PRODUCTION shows the area tabs LIBRARY and INSTRUMENTS only, and INSTRUMENTS hides the browser modes', () => {
  assert.ok(!/body\.produktion #bestand \.bereich[,\s]/.test(prodCss.replace(/body\.produktion #bestand \.bereich button[^{]*\{[^}]*\}/g, '')), 'the whole .bereich group is no longer hidden');
  assert.match(prodCss, /body\.produktion #bestand \.bereich button:not\(\[data-bereich="library"\]\):not\(\[data-bereich="instrumente"\]\)\s*\{\s*display:\s*none/);
  assert.match(prodCss, /body\.produktion\.bereich-instrumente #bestand \.tabelle\[data-tabelle\][^{]*\{[^}]*display:\s*none !important/);
  assert.match(prodCss, /body\.produktion\.bereich-instrumente #geraete-browser[^{]*\{[^}]*display:\s*none !important/);
  assert.ok(prodCss.lastIndexOf('body.produktion.bereich-instrumente #geraete-browser') > prodCss.indexOf('body.produktion.b-geraete #geraete-browser'), 'after the mode rules, same strength');
});

test('narrow plates wrap instead of clipping; wide modules may grow to 200 px per column', () => {
  assert.match(css, /\.frontplatte:not\(\.fp-breit\) \.fp-modul \.fp-gitter\s*\{[^}]*repeat\(auto-fill, minmax\(64px, 1fr\)\)/);
  assert.match(css, /\.frontplatte:not\(\.fp-breit\) \.fp-modul \.fp-zelle\[style\*="span 3"\][^{]*\{[^}]*grid-column:\s*1 \/ -1 !important/);
  assert.match(css, /\.fp-breit \.fp-modul \{[^}]*max-width: calc\(var\(--spalten, 4\) \* 200px \+ 20px\)/);
});

// ---- Task 6: spectrum of the channel on the device page (Decision 7) ----
import { SpektrumLeihe, SpektrumAnsicht, spektrumIndex, spektrumFlaeche } from '../public/spectrum.js';
import { GRAPH_KANAL_ART } from '../public/effects.js';
const INSTRUMENTE = Object.keys(GRAPH_KANAL_ART).filter((k) => GRAPH_KANAL_ART[k] === 'instrument');
const speicherAttrappe = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const leiheMit = (start = 0) => {
  const st = speicherAttrappe(), gesendet = [];
  const wert = { v: start };
  const beacon = [];
  const l = new SpektrumLeihe({ speicher: st, kanaele: INSTRUMENTE, aktuell: () => wert.v, sende: (p, n) => { gesendet.push([p, n]); wert.v = n; }, beacon: (p, n) => beacon.push([p, n]) });
  return { l, st, gesendet, wert, beacon };
};

test('spectrum source index of all seven instrument channels (server.ts SPEKTRUM_QUELLEN)', () => {
  assert.equal(INSTRUMENTE.length, 7);
  assert.deepEqual(INSTRUMENTE.map(spektrumIndex), [6, 7, 9, 10, 11, 13, 14]);
  assert.equal(spektrumIndex('nope'), 0);
});

test('open sets the channel index and keeps the old value; a switch sets the new index; close restores the FIRST value and clears the key', () => {
  const { l, st, gesendet } = leiheMit(19);   // EFFECTS showed the master sum
  l.oeffnen('erz/5');
  assert.deepEqual(gesendet, [['spektrum/kanal', 9]]);
  assert.match(st.getItem('djk-spektrum-vorher'), /^[a-z0-9]+\|19$/);
  l.oeffnen('pad/2');   // channel switch: the stored value stays the first one
  assert.deepEqual(gesendet.at(-1), ['spektrum/kanal', 14]);
  assert.match(st.getItem('djk-spektrum-vorher'), /^[a-z0-9]+\|19$/);
  l.schliessen();
  assert.deepEqual(gesendet.at(-1), ['spektrum/kanal', 19]);
  assert.equal(st.getItem('djk-spektrum-vorher'), null);
  const n = gesendet.length;
  l.schliessen();   // a second close sends nothing
  assert.equal(gesendet.length, n);
});

test('a close that never opened sends nothing (page init calls setzeGeraeteseite(false) on every area and view change)', () => {
  const { l, gesendet } = leiheMit(0);
  l.schliessen();
  assert.deepEqual(gesendet, []);
});

test('page load with the key present: restored once when the row still shows an instrument channel, otherwise only cleared', () => {
  const a = leiheMit(9); a.st.setItem('djk-spektrum-vorher', '0');
  a.l.schliessen();   // the init-time close must not act on a key of the previous page life
  assert.deepEqual(a.gesendet, []);
  a.l.beiStand(9);
  assert.deepEqual(a.gesendet, [['spektrum/kanal', 0]]);
  assert.equal(a.st.getItem('djk-spektrum-vorher'), null);
  a.l.beiStand(9);
  assert.equal(a.gesendet.length, 1, 'only once');
  const b = leiheMit(19); b.st.setItem('djk-spektrum-vorher', '0');   // somebody picked the master sum meanwhile: not ours to undo
  b.l.beiStand(19);
  assert.deepEqual(b.gesendet, []);
  assert.equal(b.st.getItem('djk-spektrum-vorher'), null);
});

test('without browser storage the old value is kept in memory', () => {
  const gesendet = [];
  const wert = { v: 3 };
  const l = new SpektrumLeihe({ speicher: { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } },
    kanaele: INSTRUMENTE, aktuell: () => wert.v, sende: (p, n) => { gesendet.push(n); wert.v = n; } });
  l.oeffnen('erz/2'); l.schliessen();
  assert.deepEqual(gesendet, [6, 3]);
});

test('app.js: setzeGeraeteseite is the one place that opens and closes the lease; the tab switch and the first state snapshot use it too', () => {
  const f = funktion('setzeGeraeteseite');
  assert.match(f, /spektrumLeihe\.oeffnen\(instrumenteAnsicht\.gewaehlt\(\)\)/);
  assert.match(f, /spektrumLeihe\.schliessen\(\)/);
  assert.ok(f.indexOf('schliessen') > 0 && /an !== war/.test(f), 'transitions only: a resize call keeps the source');
  assert.match(app, /beiWechsel: \(alt, neu\) => \{[^}]*lernAbbrechenFuer\(alt\)[^}]*istGeraeteseite\(\)[^}]*spektrumLeihe\.oeffnen\(neu\)/);
  assert.match(app, /spektrumLeihe\.beiStand\(f\.regler\['spektrum\/kanal'\]\)/);
  assert.equal((app.match(/spektrumLeihe\.(oeffnen|schliessen)\(/g) ?? []).length, 3, 'no other code touches the row spektrum/kanal for the device page');
});

test('app.js: frames and the source echo feed every registered view; a plate registers through platteBauen', () => {
  assert.match(app, /for \(const a of spektrumAnsichten\) \{?[^;]*aufnehmen\(f\)/);
  assert.match(app, /for \(const a of spektrumAnsichten\) a\.setzeQuelle\(f\.wert\)/);
  assert.match(app, /for \(const a of spektrumAnsichten\) a\.setzeQuelle\(f\.regler\['spektrum\/kanal'\]\)/);
  const p = funktion('platteBauen');
  assert.match(p, /beiSpektrum/);
  assert.match(p, /spektrumStreifen\(/);   // no `spektrum` control in the panel: the strip under the plate
});

test('two views both receive a frame; a frame of another source is ignored; the plate flaeche is a view of its own', () => {
  const mk = () => ({ getContext: () => null, width: 600, height: 160 });
  const a = new SpektrumAnsicht({ leinwand: mk(), wahl: null, info: { textContent: '' }, sende: null });
  const b = new SpektrumAnsicht({ leinwand: mk(), wahl: null, info: { textContent: '' }, sende: null });
  a.setzeQuelle(9); b.setzeQuelle(9);
  const f = { kanal: 'erz/5', rahmen: 1, pegel: Array(29).fill(-300).join(',') };
  assert.ok(a.aufnehmen(f) && b.aufnehmen(f));
  assert.ok(!a.aufnehmen({ ...f, kanal: 'erz/6' }));
  const d = { createElement: (t) => ({ tag: t, kinder: [], append(...k) { this.kinder.push(...k); }, setAttribute() {}, classList: { add() {} } }) };
  const { wurzel, ansicht } = spektrumFlaeche(d);
  assert.ok(wurzel && ansicht instanceof SpektrumAnsicht);
});

test('pagehide while the lease is held restores through the beacon (not the awaiting sender) and clears the key; without a lease it does nothing', () => {
  const { l, st, gesendet, beacon } = leiheMit(19);
  l.seiteVerlassen();
  assert.deepEqual(beacon, []);
  l.oeffnen('erz/5');
  l.seiteVerlassen();
  assert.deepEqual(beacon, [['spektrum/kanal', 19]]);
  assert.equal(gesendet.length, 1, 'only the open went through the normal sender');
  assert.equal(st.getItem('djk-spektrum-vorher'), null);
  l.schliessen();
  assert.deepEqual(beacon.length, 1);
});

test('the stored key carries the page life id; a duplicated tab (inherited key, not reloaded) never restores or clears the original lease', () => {
  const a = leiheMit(19);
  a.l.oeffnen('erz/5');
  const kopie = new SpektrumLeihe({ speicher: a.st, kanaele: INSTRUMENTE, aktuell: () => 9, sende: (p, n) => a.gesendet.push([p, n]), neuGeladen: false });
  assert.match(a.st.getItem('djk-spektrum-vorher'), /^[a-z0-9]+\|19$/);
  const n = a.gesendet.length;
  kopie.beiStand(9);
  assert.equal(a.gesendet.length, n);
  assert.match(a.st.getItem('djk-spektrum-vorher'), /\|19$/, 'key untouched');
  const fremd = new SpektrumLeihe({ speicher: a.st, kanaele: INSTRUMENTE, aktuell: () => 9, sende: () => {}, id: 'zzz' });
  fremd.oeffnen('erz/6'); fremd.schliessen();   // a foreign holder closing restores only what it stored itself
  a.l.schliessen();
  assert.deepEqual(a.gesendet.at(-1), ['spektrum/kanal', 19].map((x) => x));
});

test('a snapshot while the lease is held sets the source again when the row does not point at the open channel (core restart)', () => {
  const { l, gesendet } = leiheMit(0);
  l.oeffnen('erz/5');
  const n = gesendet.length;
  l.beiStand(9);
  assert.equal(gesendet.length, n, 'row is right: nothing sent');
  l.beiStand(0);
  assert.deepEqual(gesendet.at(-1), ['spektrum/kanal', 9]);
  l.oeffnen('pad/1');
  l.beiStand(9);
  assert.deepEqual(gesendet.at(-1), ['spektrum/kanal', 13]);
});

test('app.js: pagehide handler with sendBeacon to /regler, unregistering of detached views, a per-reload flag', () => {
  assert.match(app, /addEventListener\('pagehide', \(\) => spektrumLeihe\.seiteVerlassen\(\)\)/);
  assert.match(app, /navigator\.sendBeacon\('\/regler'/);
  assert.match(app, /type === 'reload'/);
  assert.match(funktion('setzeGeraeteseite'), /spektrumAbmelden\(\)/);
  assert.match(funktion('platteBauen'), /spektrumAbmelden\(\)/);
  assert.match(funktion('spektrumAbmelden'), /spektrumAnsichten\.delete/);
});

// ---- tablet view (#tablet, task 10): source checks like the rest of this file ----
test('tablet view: #tablet keeps the device page open, hides the header, and has no way out', () => {
  assert.match(funktion('bindeTablet'), /location\.hash === '#tablet'/);
  assert.match(funktion('bindeTablet'), /setzeBereich\('instrumente'\)[\s\S]*setzeGeraeteseite\(true\)/);
  assert.match(funktion('setzeGeraeteseite'), /\(!!an \|\| tabletModus\) && instrumenteSichtbar\(\)/, 'a close request is ignored while the tablet view is on');
  assert.match(funktion('setzeGeraeteseite'), /tabletModus\) document\.body\.style\.setProperty\('--geraete-oben', '0px'\)/);
  assert.match(css, /body\.tablet #kopf[^{]*\{ display: none !important/);
  assert.match(css, /body\.tablet \.fp-gross[^{]*\{ display: none/);
  assert.match(css, /body\.tablet\.geraeteseite #instrumente \{ top: 0/);
});

test('tablet view: knob cap 72 px, fader travel 160 px, tabs on top and sticky', () => {
  assert.match(css, /body\.tablet \.fp-knopf \{ width: 72px; height: 72px; \}/);
  assert.match(css, /body\.tablet \.fp-bahn \{ width: 48px; height: 160px; \}/);
  assert.match(css, /body\.tablet \.fp-zelle\.waagrecht \.fp-bahn \{ width: 160px; height: 48px; \}/);
  assert.match(css, /body\.tablet \.instrument-reiter \{[^}]*position: sticky; top: -8px/);
  assert.match(css, /body\.tablet \.instrument-reiter \{ flex: 0 0 auto/, 'the strip does not shrink inside the flex layer (measured: 16 px high without it)');
});

test('web app manifest: linked with credentials (the tablet listener needs the cookie), valid, icons exist', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest" crossorigin="use-credentials">/);
  assert.match(html, /id="kopplung-knopf"/);
  assert.match(html, /<dialog id="kopplung"/);
  const m = JSON.parse(fs.readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/#tablet');
  assert.ok(m.icons.length >= 2);
  for (const i of m.icons) assert.ok(fs.existsSync(new URL(`../public/${i.src}`, import.meta.url)), i.src);
  assert.ok(m.icons.some((i) => i.sizes === '512x512' && i.type === 'image/png') && m.icons.some((i) => i.sizes === '192x192'));
  const server = fs.readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
  assert.match(server, /'\.webmanifest': 'application\/manifest\+json'/);
});
