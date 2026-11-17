// ANALYZE slice 1, end to end without a server: the real worker (areas/proj/sound_factory.ts) with the real analysis module (project/sound_measurement.ts, default path),
// the real hint functions and the real ffmpeg. Only the render is replaced: two small WAV files written here stand for the rendered strips. The test process
// (4 s are longer than the long window, so the 55 Hz sine reads its level in its 1/12 band, see sound_measurement.ts). The test process
// must end by itself (no test-force-exit): a worker that stays alive would hang it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { KlangAnalyse } from '../areas/proj/sound_analysis.ts';
import { wavKopf } from '../project/recording.ts';
import { pruefeAntwort } from '../project/sound_contract.ts';

const RATE = 48000, SEK = 4;
function schreibe(dir, name, f) {
  const frames = RATE * SEK, d = Buffer.alloc(frames * 8);
  let spitze = 0;
  for (let i = 0; i < frames; i++) { const v = f(i / RATE); spitze = Math.max(spitze, Math.abs(v)); d.writeFloatLE(v, i * 8); d.writeFloatLE(v, i * 8 + 4); }
  const datei = path.join(dir, name);
  fs.writeFileSync(datei, Buffer.concat([wavKopf(frames), d]));
  return { datei, frames, spitze_db: 20 * Math.log10(spitze) };
}

test('the real worker analyses a bass and a kick, the answer is valid and the two mask each other below 250 Hz', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-ende-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bass = schreibe(dir, 'bass.wav', (s) => 0.5 * Math.sin(2 * Math.PI * 55 * s));
  const kick = schreibe(dir, 'kick.wav', (s) => 0.3 * Math.sin(2 * Math.PI * 55 * s) + 0.1 * Math.sin(2 * Math.PI * 1000 * s));
  const a = {
    analyseVorpruefung: () => ({ slug: 'ende', rev: 1, von: 0, bis: 8, tempo_bpm: 120 }),
    rendereStreifen: async (_q, _von, _bis, _ohne, nimm) => nimm({ rev: 1, slug: 'ende', tempo_bpm: 120,
      teile: [{ name: 'Bass', ...bass }, { name: 'Kick', ...kick }] }),
    protokolliere: () => {},
  };
  const k = new KlangAnalyse(a);   // default worker, default analysis module, default hints
  const r = await k.analysiere({ quelle: { art: 'spur', id: 's1' }, vergleich: { art: 'spur', id: 's2' } });
  assert.deepEqual(pruefeAntwort(r), []);
  assert.equal(r.quelle.stumm, false);
  assert.ok(Math.abs(r.quelle.lautheit.spitze_db - -6.02) < 0.1, `peak ${r.quelle.lautheit.spitze_db}`);
  assert.equal(typeof r.quelle.lautheit.lufs_i, 'number');
  const s = r.quelle.spektrum;
  const lauteste = s.mittel_db.indexOf(Math.max(...s.mittel_db));
  assert.ok(Math.abs(s.hz[lauteste] - 55) < 6, `loudest band ${s.hz[lauteste]} Hz`);
  assert.ok(Math.abs(Math.max(...s.mittel_db) - -6.02) < 0.5, `${Math.max(...s.mittel_db)} dB`);
  assert.ok(r.ueberdeckung.schwerpunkte.length >= 1 && r.ueberdeckung.schwerpunkte[0].hz_von < 250, JSON.stringify(r.ueberdeckung.schwerpunkte));
  assert.ok(r.hinweise.some((h) => h.art === 'ueberdeckung_tief' && /Bass and Kick mask each other/.test(h.text)), JSON.stringify(r.hinweise));
});
