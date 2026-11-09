// Bug t_bffc3708 (live jam 2026-11-07): /lage.regler listed the mixer of erz/1..3 only. erz/5..7 (pad, supersaw, ...) were set and acked by the kern
// (stand.regler tracks every /e/regler echo) but never shown, so a level helper assumed 0 dB for them. /lage now shows fader, trim, eq, kill, filter
// and every send (1..4, once off its default) of deck/1..2, pad/1..2 and erz/1..3, 5..7.
// Runs the real in-process server without a kern (the pattern of proj_bk_no_core.test.mjs): server.test.mjs is red at its start assertion on this
// branch (the stapel helper counts 2 commands instead of 1), so it cannot carry this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Oberflaeche } from '../server.ts';
import { schreibeLeerenRing } from './support/ring.mjs';
import { K, TEST_INSTANZ, belegeTestInstanz } from './support/instance.mjs';

belegeTestInstanz();
const hol = (u, o = {}) => fetch(u, { ...o, headers: { connection: 'close', ...(o.headers ?? {}) } });

async function realerServer(t) {
  const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  const bkOrdner = tmp('le57-graphen-');
  fs.mkdirSync(path.join(bkOrdner, 'samples'));
  const huellen = path.join(tmp('le57-huellen-'), 'huellen'); schreibeLeerenRing(huellen);
  const log = [];
  const alt = { inst: process.env.CYPHERDJ_INSTANZ, bk: process.env.CYPHERDJ_BK_ORDNER };
  process.env.CYPHERDJ_INSTANZ = TEST_INSTANZ;
  process.env.CYPHERDJ_BK_ORDNER = bkOrdner;
  const o = new Oberflaeche({ port: 47340 + K, kernPort: 47140 + K, aboPort: 47190 + K, leitstandWs: 47240 + K, bestand: tmp('le57-bestand-'), arbeitsbestand: tmp('le57-ab-'),
    mutationen: [], loops: tmp('le57-loops-'), kits: tmp('le57-kits-'), welleCache: tmp('le57-welle-'), musterOrdner: tmp('le57-muster-'), hotcueOrdner: tmp('le57-hc-'),
    rasterOrdner: tmp('le57-raster-'), huellen, wirtOrdner: tmp('le57-wirt-'), sammlungen: tmp('le57-sets-'), musterBibliothek: tmp('le57-mb-'), musterSets: tmp('le57-ms-'),
    mediathek: path.join(tmp('le57-med-'), 'nix.sqlite'), katalog: path.join(tmp('le57-kat-'), 'nix.sqlite'), digitalout: path.join(tmp('le57-do-'), 'nix'),
    kernPruefmodus: true, geraete: { konfigPfad: path.join(tmp('le57-ger-'), 'geraete.json'), kantenPfad: path.join(tmp('le57-ger-'), 'kanten'), cacheMs: 0, erkenne: async () => ({ audio: [], midi: [] }) },
    log: (z) => log.push(z) });
  await o.starte();
  t.after(async () => {
    await o.stoppe();
    if (alt.inst === undefined) delete process.env.CYPHERDJ_INSTANZ; else process.env.CYPHERDJ_INSTANZ = alt.inst;
    if (alt.bk === undefined) delete process.env.CYPHERDJ_BK_ORDNER; else process.env.CYPHERDJ_BK_ORDNER = alt.bk;
  });
  const url = `http://127.0.0.1:${47340 + K}`;
  return { o, url };
}


test('/lage.regler shows fader, trim and sends 1..4 of erz/5..7 exactly as of erz/1..3 (kern echo is the source)', { timeout: 60000 }, async (t) => {
  const { o, url } = await realerServer(t);
  const regler = async () => (await (await hol(`${url}/lage`)).json()).regler;
  const echo = (pfad, wert) => o.vomKern({ adresse: '/e/regler', felder: { pfad, wert } });
  const kanaele = ['erz/1', 'erz/2', 'erz/3', 'erz/5', 'erz/6', 'erz/7', 'pad/1', 'pad/2', 'deck/1', 'deck/2'];
  kanaele.forEach((k, i) => { echo(`${k}/fader`, -22 + i); echo(`${k}/trim`, 3); echo(`${k}/send/1`, -9); echo(`${k}/send/2`, -10); echo(`${k}/send/3`, -11.5); echo(`${k}/send/4`, -12); });
  const r = await regler();
  kanaele.forEach((k, i) => {
    assert.equal(r[`${k}/fader`], -22 + i, `${k}/fader`);
    assert.equal(r[`${k}/trim`], 3, `${k}/trim`);
    for (const [n, w] of [[1, -9], [2, -10], [3, -11.5], [4, -12]]) assert.equal(r[`${k}/send/${n}`], w, `${k}/send/${n}`);
  });
});

test('/lage.regler: a send that is off (-200) stays out, a hard-closed fader (-200) stays in; erz/6 set to -22 is there', { timeout: 60000 }, async (t) => {
  const { o, url } = await realerServer(t);
  const echo = (pfad, wert) => o.vomKern({ adresse: '/e/regler', felder: { pfad, wert } });
  echo('erz/6/fader', -22); echo('erz/5/fader', -200); echo('erz/6/send/3', -200); echo('erz/7/send/4', -200); echo('erz/7/send/3', -6);
  const r = (await (await hol(`${url}/lage`)).json()).regler;
  assert.equal(r['erz/6/fader'], -22);
  assert.equal(r['erz/5/fader'], -200, 'a closed fader is a value, not an absence');
  assert.equal('erz/6/send/3' in r, false);
  assert.equal('erz/7/send/4' in r, false);
  assert.equal(r['erz/7/send/3'], -6);
});

test('/lage.regler keeps out channels that are not generator mixers shown there (erz/8 cue, erz/4 production)', { timeout: 60000 }, async (t) => {
  const { o, url } = await realerServer(t);
  o.vomKern({ adresse: '/e/regler', felder: { pfad: 'erz/8/fader', wert: -3 } });
  const r = (await (await hol(`${url}/lage`)).json()).regler;
  assert.equal('erz/8/fader' in r, false);
});

// Review t_bffc3708 Minor 4: stand.regler kept the values of the old kern after a kern restart, /lage then showed them as current (a fader the new kern
// does not have, or has at another value, until it said so). A new generation clears them; the new kern reports its own on its first hallo.
test('/lage.regler: a new kern generation (/e/neustart or /k/willkommen with another generation) clears the old values; the same generation keeps them', { timeout: 60000 }, async (t) => {
  const { o, url } = await realerServer(t);
  const regler = async () => (await (await hol(`${url}/lage`)).json()).regler;
  const echo = (pfad, wert) => o.vomKern({ adresse: '/e/regler', felder: { pfad, wert } });
  const willkommen = (g) => o.vomKern({ adresse: '/k/willkommen', felder: { vertrag: 1, generation: g, sample: 0, beat: 0, bpm: 120, version: 't' } });
  willkommen(1);
  echo('erz/6/fader', -22); echo('erz/6/send/3', -11); echo('erz/1/fader', -6);
  let r = await regler();
  assert.equal(r['erz/6/fader'], -22);
  willkommen(1);   // the heartbeat of the same generation changes nothing
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 1, sample: 0 } });
  r = await regler();
  assert.deepEqual([r['erz/6/fader'], r['erz/6/send/3'], r['erz/1/fader']], [-22, -11, -6], 'same generation: kept');
  o.vomKern({ adresse: '/e/neustart', felder: { generation: 2, sample: 0 } });   // the kern restarted: it says its own values from now on
  r = await regler();
  assert.equal('erz/6/fader' in r, false, JSON.stringify(r));
  assert.equal('erz/6/send/3' in r, false);
  assert.equal('erz/1/fader' in r, false);
  assert.equal(r.keylock, null, 'keylock is unknown again until the new kern says it');
  echo('erz/1/fader', -3);   // the first hallo of the new kern
  r = await regler();
  assert.deepEqual([r['erz/1/fader'], 'erz/6/fader' in r], [-3, false]);
  echo('erz/5/fader', -9);
  willkommen(3);   // the kern restarted and the willkommen came first (no /e/neustart before it): the same
  r = await regler();
  assert.equal('erz/5/fader' in r, false);
  assert.equal('erz/1/fader' in r, false);
  echo('erz/5/fader', -12);
  willkommen(0);   // a braked kern starts with a smaller generation: also a new kern
  r = await regler();
  assert.equal('erz/5/fader' in r, false);
});
