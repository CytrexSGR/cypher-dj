// Starter patterns (plan 2026-11-12 task 15): a read-only source `starter:<name>` in the pattern library, three drum patterns
// that play on the starter kit. Server part (task 16) at the end.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MusterBibliothek } from '../pattern_library.ts';
import { MUSTER_REF } from '../collection.ts';
import { REPO_PFADE } from '../paths.ts';
import { kompiliere } from '../../generator/src/compile.mjs';
import { fuehreListeAus } from '../project/commands.ts';
import { musterZuEreignissen } from '../../generator/src/pattern_ereignisse.mjs';
import { specProjekt } from './support/project.mjs';
import { stapel, hole, post } from './support/media_library.mjs';

const NAMEN = ['starter-four', 'starter-break', 'starter-hats'];
const STARTER = REPO_PFADE.musterStarter;

function welt(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-sm-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const eigen = path.join(d, 'muster'), sets = path.join(d, 'sets');
  fs.mkdirSync(eigen); fs.mkdirSync(sets);
  return { eigen, sets };
}

test('starter source lists the three patterns as drums at 128 bpm, loadable, with the text of the file', async (t) => {
  const { eigen, sets } = welt(t);
  const l = await new MusterBibliothek({ eigen, sets, starter: STARTER }).liste();
  assert.deepEqual(l.map((e) => e.id), NAMEN.map((n) => `starter:${n}`).sort());
  for (const e of l) {
    assert.equal(e.quelle, 'starter'); assert.equal(e.rolle, 'drums'); assert.equal(e.bpm, 128); assert.equal(e.ladbar, true);
    assert.equal(e.text, fs.readFileSync(path.join(STARTER, `${e.name}.js`), 'utf8').trim());
  }
});

test('without a starter folder the list has no starter entry (negative control)', async (t) => {
  const { eigen, sets } = welt(t);
  assert.deepEqual(await new MusterBibliothek({ eigen, sets }).liste(), []);
  assert.deepEqual(await new MusterBibliothek({ eigen, sets, starter: path.join(sets, 'nirgends') }).liste(), []);
});

test('eintrag() finds a starter pattern by id; a collection may reference it', async (t) => {
  const { eigen, sets } = welt(t);
  const mb = new MusterBibliothek({ eigen, sets, starter: STARTER });
  assert.equal((await mb.eintrag('starter:starter-four'))?.name, 'starter-four');
  assert.equal(await mb.eintrag('starter:gibts-nicht'), null);
  assert.match('starter:starter-four', MUSTER_REF);
  assert.doesNotMatch('starter:../x', MUSTER_REF);
  assert.doesNotMatch('starter:Four', MUSTER_REF);
  assert.doesNotMatch('starter:a:b', MUSTER_REF);
});

test('speichere() never writes into the starter folder', async (t) => {
  const { eigen, sets } = welt(t);
  const vorher = fs.readdirSync(STARTER).sort();
  const mb = new MusterBibliothek({ eigen, sets, starter: STARTER });
  mb.speichere({ name: 'meins', text: 's("bd")', rolle: 'drums', strom: 1, von: 'test' });
  assert.deepEqual(fs.readdirSync(STARTER).sort(), vorher);
  assert.ok(fs.existsSync(path.join(eigen, 'meins.js')));
});

test('every starter pattern passes the djk-muster check and every sample name resolves in kit starter', () => {
  const kits = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'starter', 'kits.json'), 'utf8'));
  const klaenge = kits.find((k) => k.name === 'starter').klaenge.map((k) => ({ name: k.name, note: k.note }));
  for (const n of NAMEN) {
    const text = fs.readFileSync(path.join(STARTER, `${n}.js`), 'utf8');
    const meta = JSON.parse(fs.readFileSync(path.join(STARTER, `${n}.json`), 'utf8'));
    assert.deepEqual(meta, { rolle: 'drums', bpm: 128 }, n);
    const k = kompiliere(text);
    assert.equal(k.fehler, undefined, `${n}: ${k.fehler}`);
    // same path the page uses: clip_aus_muster on a kit track resolves each Strudel name against the kit sounds
    const p = specProjekt(); p.format = 'cypherdj-projekt/2'; p.gruppen = []; p.master = { fader_db: 0 };
    p.spuren.push({ id: 's4', nr: 4, name: 'Kit', farbe: '#3b8de0', art: 'instrument', geraet: { art: 'intern', name: 'kit', kit: 'starter' },
      fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
    const meldungen = [];
    const r = fuehreListeAus(p, [{ befehl: 'clip_aus_muster', spur_id: 's4', start_beat: 0, code: text }],
      { musterUebersetze: musterZuEreignissen, kitKlaenge: (x) => (x === 'starter' ? klaenge : null), musterMeldung: (m) => meldungen.push(m) });
    const clip = r.projekt.spuren.find((s) => s.id === 's4').clips.at(-1);
    assert.ok(clip.noten.length >= 8, `${n}: ${clip.noten.length} notes`);
    assert.deepEqual(meldungen.at(-1).ohne_ziel, [], `${n}: fields without target`);
    const toene = new Set(klaenge.map((x) => x.note));
    assert.ok(clip.noten.every((x) => toene.has(x.ton)), `${n}: a note is not a kit note`);
  }
});

test('server: GET /stoebern?typ=strudel lists the starter patterns by default; POST /muster never writes into the starter folder', async (t) => {
  const { eigen, sets } = welt(t);
  const vorher = fs.readdirSync(STARTER).sort();
  const s = await stapel(t, { musterBibliothek: eigen, musterSets: sets, musterStarter: STARTER });
  const r = await hole(s.url, '/stoebern?typ=strudel&sort=name');
  assert.equal(r.code, 200);
  assert.ok(r.j.treffer.some((e) => e.id === 'starter:starter-four' && e.quelle === 'starter' && e.ladbar === true));
  assert.equal((await hole(s.url, '/stoebern?typ=strudel&feld=quelle&wert=starter')).j.gesamt, 3);
  assert.ok((await hole(s.url, '/stoebern/baum?typ=strudel')).j.facetten.quelle.some((f) => JSON.stringify(f).includes('starter')));
  const sv = await post(s.url, '/muster', { name: 'starter-four', strom: 3, text: 's("bd")' });
  assert.equal(sv.code, 409, 'no running pattern on instance 3: nothing saved');
  assert.deepEqual(fs.readdirSync(STARTER).sort(), vorher);
});

test('server: without a starter folder (negative control) the Strudel browser shows no starter entry', async (t) => {
  const { eigen, sets } = welt(t);
  const s = await stapel(t, { musterBibliothek: eigen, musterSets: sets });
  assert.equal((await hole(s.url, '/stoebern?typ=strudel')).j.gesamt, 0);
});
