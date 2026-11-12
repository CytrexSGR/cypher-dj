// Page and reason texts name the public builder (djk/start/djk-bibliothek), not the private "mediathek katalog".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { IMPORT_FEHLER_TEXT, SPALTEN } from '../public/browse.js';

const wurzel = new URL('..', import.meta.url);
const lies = (p) => readFileSync(new URL(p, wurzel), 'utf8');
function quellen(dir, endung) {
  return readdirSync(new URL(dir, wurzel), { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? quellen(`${dir}${d.name}/`, endung) : d.name.endsWith(endung) ? [`${dir}${d.name}`] : []);
}

// One neutral wording, true for a catalog built by djk-bibliothek and for one built by another program.
const FEHLT = 'no library catalog found (is its drive mounted?). To build one from your own folders: djk/start/djk-bibliothek dazu <folder>, then bauen';
const FEHLT_GROSS = FEHLT[0].toUpperCase() + FEHLT.slice(1);
const WEG = 'this entry is not in the library catalog anymore (the catalog may have been rebuilt); search again';
const WEG_GROSS = WEG[0].toUpperCase() + WEG.slice(1);

test('no text under oeffentlich/ and http/ names "mediathek katalog"', () => {
  for (const f of [...quellen('oeffentlich/', '.js'), ...quellen('http/', '.ts')]) {
    assert.ok(!/mediathek katalog/i.test(lies(f)), `${f} still names "mediathek katalog"`);
  }
});

test('missing catalog: app.js names djk-bibliothek bauen', () => {
  const app = lies('public/app.js');
  assert.ok(app.includes(`'${FEHLT_GROSS}'`));
  assert.ok(app.includes(`'${WEG_GROSS}'`));
});

test('foreign or damaged catalog: the app.js reason line does not name the builder', () => {
  const app = lies('public/app.js');
  const zeile = app.split('\n').find((z) => z.includes("j.fehler === 'katalog_fehlt'"));
  assert.ok(zeile);
  const rest = app.slice(app.indexOf(zeile) + zeile.length).split('\n')[1];
  // only the katalog_fehlt branch names the builder
  assert.equal((zeile + rest).match(/djk-bibliothek/g).length, 1);
  assert.ok(!/bauen”/.test(zeile + rest));
  assert.ok(!/katalog_schema|katalog_kaputt/.test(zeile + rest), 'no special text for those reasons');
  assert.ok(rest.includes('`Library: ${j.fehler}`'));
});

test('import reason unbekannt names djk-bibliothek bauen', () => {
  assert.equal(IMPORT_FEHLER_TEXT.unbekannt, WEG);
});

test('reasons.ts: katalog_fehlt names the command', () => {
  const g = lies('http/reasons.ts');
  assert.ok(g.includes(`katalog_fehlt: '${FEHLT}'`));
  assert.ok(g.includes("katalog_kaputt: 'the sample catalogue is damaged'"));
  assert.ok(g.includes("katalog_schema: 'the sample catalogue has an unknown format'"));
});

test('pattern source starter has a name in the Source column', () => {
  const quelle = SPALTEN.strudel.find((x) => x.titel === 'Source');
  assert.equal(quelle.wert({ quelle: 'starter' }), 'Starter');
  assert.equal(quelle.wert({ quelle: 'eigen' }), 'mine');
});
