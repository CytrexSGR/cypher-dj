// Task 2 of the browser-6 plan: preview source (role phrase, effect input loop) and cache key, all pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rolleVon, phraseFuer, effektEingang, vorhoerSchluessel, klangVon, VORHOEREN_VERSION, ROLLEN, EFFEKT_ARTEN } from '../presets/prelisten_source.ts';
import { PresetSpeicher } from '../presets/store.ts';
import { bauen } from '../presets/register.ts';

const LOOPS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'starter', 'loops.json'), 'utf8'));
const PHRASEN = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'presets', 'vorhoeren_phrasen.json'), 'utf8'));
const NAMEN = new Set(LOOPS.map((l) => l.name));

const preset = (extra = {}) => ({
  schema: 1, name: 'A', geraet_typ: 'instrument', geraet: 'rb338', werte: { cutoff: 800 },
  beschreibung: { art: 'bass', unterart: 'acid', charakter: ['warm'], genre: ['techno'], einsatz: ['drop'], energie: 3, text: 'x.' },
  tags: [], notiz: '', angelegt: '2026-01-01T00:00:00.000Z', geaendert: '2026-01-01T00:00:00.000Z', ...extra,
});
const effekt = (art, geraet = 'hall') => preset({ geraet_typ: 'effekt', geraet, beschreibung: { ...preset().beschreibung, art } });

test('every role maps to a starter loop that exists, notes lie inside beats 0 to 8', () => {
  assert.deepEqual([...ROLLEN].sort(), Object.keys(PHRASEN.rollen).sort());
  for (const r of ROLLEN) {
    const ph = phraseFuer(r, LOOPS);
    assert.ok(NAMEN.has(ph.loop), `${r}: ${ph.loop}`);
    assert.equal(ph.bpm, 128); assert.equal(ph.takte, 2);
    assert.ok(ph.noten.length > 0, r);
    for (const n of ph.noten) {
      assert.ok(n.beat >= 0 && n.beat < 8 && n.beat + n.laenge_beats <= 8 + 1e-9, `${r} ${JSON.stringify(n)}`);
      assert.ok(n.vel >= 1 && n.vel <= 127 && Number.isInteger(n.vel) && n.ton >= 0 && n.ton <= 127, `${r} ${JSON.stringify(n)}`);
    }
  }
  for (const n of Object.values(PHRASEN.effekte)) assert.ok(NAMEN.has(n), n);
});

test('phrase notes: length from off_beats, velocity from the fraction, default 100, nothing from beat 8 on', () => {
  const ph = phraseFuer('drums', [{ name: 'starter-909-groove', graph: 'g', beats: 16, off_beats: 0.3, hits: ['36@0', '38@1:0.5', '40@9'] }]);
  assert.deepEqual(ph.noten.map((n) => [n.ton, n.beat, n.vel, n.laenge_beats]), [[36, 0, 100, 0.3], [38, 1, 64, 0.3]]);
  const ohne = phraseFuer('drums', [{ name: 'starter-909-groove', graph: 'g', beats: 8, hits: ['36@0'] }]);
  assert.equal(ohne.noten[0].laenge_beats, 0.25);
});

test('rolleVon: instrument role, null for an effect, fallback to the family default', () => {
  assert.equal(rolleVon(preset()), 'bass');
  assert.equal(rolleVon(effekt('reverb')), null);
  assert.equal(rolleVon(preset({ beschreibung: { ...preset().beschreibung, art: 'nonsense' } })), 'bass');
  assert.equal(rolleVon(preset({ geraet: 'baukasten', graph: 'g', beschreibung: { ...preset().beschreibung, art: 'nonsense' } })), 'keys');
  assert.equal(rolleVon(preset({ geraet: 'baukasten', graph: 'g', beschreibung: undefined })), 'keys');
  assert.equal(rolleVon(preset({ beschreibung: undefined })), 'bass');
  assert.equal(rolleVon(preset({ geraet: 'baukasten', graph: 'g', beschreibung: { ...preset().beschreibung, art: 'pad' } })), 'pad');
});

test('every effect kind has an input loop; unknown kinds fall back by device', () => {
  for (const k of EFFEKT_ARTEN) assert.ok(NAMEN.has(effektEingang(effekt(k)).loop), k);
  assert.equal(effektEingang(effekt('nonsense', 'komp')).loop, PHRASEN.effekte.compressor);
  assert.equal(effektEingang(effekt(undefined, 'hall')).loop, PHRASEN.effekte.reverb);
  assert.equal(effektEingang(effekt('utility')).loop, LOOPS[0].name);
});

test('the key follows the sound, not the file: name, tags, notes and times do not matter', () => {
  const q = { loop: 'starter-neuro-bass' };
  const k0 = vorhoerSchluessel(preset(), q, null);
  assert.match(k0, /^[0-9a-f]{64}$/);
  assert.equal(vorhoerSchluessel(preset({ name: 'Other', tags: ['a'], notiz: 'n', geaendert: '2027-01-01T00:00:00.000Z', angelegt: '2027-01-01T00:00:00.000Z' }), q, null), k0);
  assert.equal(vorhoerSchluessel(preset({ beschreibung: { ...preset().beschreibung, text: 'Other.' } }), q, null), k0);
  assert.notEqual(vorhoerSchluessel(preset({ werte: { cutoff: 801 } }), q, null), k0);
  assert.notEqual(vorhoerSchluessel(preset(), { loop: 'starter-poly-chords' }, null), k0);
  assert.notEqual(vorhoerSchluessel(preset(), q, 'a'.repeat(64)), k0);
  assert.notEqual(vorhoerSchluessel(preset(), q, 'a'.repeat(64)), vorhoerSchluessel(preset(), q, 'b'.repeat(64)));
  const bk = preset({ geraet: 'baukasten', graph: 'synth-neuro' });
  assert.notEqual(vorhoerSchluessel(bk, q, null), k0);
  assert.notEqual(vorhoerSchluessel(preset({ geraet: 'baukasten', graph: 'synth-poly' }), q, null), vorhoerSchluessel(bk, q, null));
  assert.ok(Number.isInteger(VORHOEREN_VERSION));
});

test('the sound hash is the register klang of the same preset', (t) => {
  const nutzer = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vq-'));
  t.after(() => fs.rmSync(nutzer, { recursive: true, force: true }));
  const sp = new PresetSpeicher({ nutzer });
  const { register } = bauen(sp);
  assert.ok(register.eintraege.length > 0);
  for (const e of register.eintraege) assert.equal(klangVon(sp.lies(e.herkunft, e.geraet, e.slug)), e.klang, e.id);
});
