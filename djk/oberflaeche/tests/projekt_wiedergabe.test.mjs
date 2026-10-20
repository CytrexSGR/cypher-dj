// D1 S2-Kern, Wiedergabe: Übersetzer Projekt → cypherdj-arr/1 (Spec 3.2) und Schreiben nach <arbeitsordner>/wiedergabe-<rev>.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { uebersetze, schreibeWiedergabe, WiedergabeFehler } from '../projekt/wiedergabe.ts';
import { fuehreAus } from '../projekt/befehle.ts';
import { tmpOrdner, specProjekt, kopie, SHA_A, SHA_B } from './hilfen/projekt.mjs';

const AUDIO = '/arbeit/arr/audio';
const opt = (extra = {}) => ({ nr: 1, audioOrdner: AUDIO, frames: (sha) => (sha === SHA_A || sha === SHA_B ? 24000 : null), ...extra });

test('Spec 3.2: das Beispielprojekt ergibt genau die Form aus der Spec (Audio, intern, Wirt)', () => {
  const w = uebersetze(specProjekt(), opt());
  assert.deepEqual(w, {
    format: 'cypherdj-arr/1', nr: 1,
    spuren: [
      { nr: 1, art: 'audio', clips: [{ id: 'c1', start_beat: 0, laenge_beats: 1, sha256: SHA_A, datei: `${AUDIO}/${SHA_A}.f32`, frames: 24000,
        offset_frames: 0, gain_db: 0, ein_beats: 0, aus_beats: 0 }] },
      { nr: 2, art: 'intern', geraet: 'rb338', parameter: {}, noten: [{ id: 'c2/n1', beat: 0, laenge: 0.5, ton: 36, vel: 100 }] },
      { nr: 3, art: 'wirt', slot: 1, noten: [] },
    ],
  });
});

test('nur Klangwirksames: Mixer, Namen, Farben, Tempo, Loop, Metronom stehen nicht in der Wiedergabe', () => {
  const p = specProjekt(); p.spuren[0].fader_db = -9; p.spuren[0].mute = true; p.spuren[1].solo = true; p.spuren[1].pan = 1; p.name = 'ZZZ'; p.tempo_bpm = 99;
  assert.deepEqual(uebersetze(p, opt()), uebersetze(specProjekt(), opt()));
  assert.ok(!JSON.stringify(uebersetze(p, opt())).includes('ZZZ'));
});

test('Audio-Clips nur mit dekodiert=fertig UND vorhandener Datei; sonst bleibt die Spur da, der Clip fehlt', () => {
  for (const z of ['nein', 'laeuft', 'fehler']) {
    const p = specProjekt(); p.spuren[0].clips[0].dekodiert = z;
    const s = uebersetze(p, opt()).spuren[0];
    assert.deepEqual([s.nr, s.art, s.clips], [1, 'audio', []], z);
  }
  const q = specProjekt(); q.spuren[0].clips[0].quelle.sha256 = 'c'.repeat(64);   // fertig, aber der Cache kennt die Datei nicht
  assert.deepEqual(uebersetze(q, opt()).spuren[0].clips, []);
});

test('offset_frames = offset_s × 48000 gerundet; Fades und Gain werden durchgereicht; Clip jenseits des Dateiendes entfällt', () => {
  const p = specProjekt(); const c = p.spuren[0].clips[0];
  Object.assign(c, { offset_s: 0.123456, gain_db: -4.5, fade_ein_beats: 0.25, fade_aus_beats: 0.5, laenge_beats: 2 });
  const o = uebersetze(p, opt()).spuren[0].clips[0];
  assert.deepEqual([o.offset_frames, o.gain_db, o.ein_beats, o.aus_beats, o.laenge_beats], [5926, -4.5, 0.25, 0.5, 2]);
  c.offset_s = 0.4; assert.equal(uebersetze(p, opt()).spuren[0].clips[0].offset_frames, 19200);
  // 24000 Frames Datei: Offset auf dem Ende (0,5 s) → nichts zu spielen
  c.offset_s = 0.5; assert.equal(uebersetze(p, opt()).spuren[0].clips.length, 0, 'offset_frames == frames: kein Clip');
  c.offset_s = 0.49; assert.equal(uebersetze(p, opt()).spuren[0].clips.length, 1);
});

function mitNoten() {
  const p = specProjekt();
  p.spuren[1].clips = [
    { id: 'c2', art: 'midi', name: 'a', start_beat: 4, laenge_beats: 2, noten: [
      { id: 'n1', beat: 0, laenge: 1, ton: 36, vel: 100 },     // 4..5 ganz drin
      { id: 'n2', beat: 1.5, laenge: 1, ton: 38, vel: 90 },    // 5.5..6.5 → auf 0.5 gekürzt
      { id: 'n3', beat: 2, laenge: 1, ton: 40, vel: 80 },      // beginnt genau am Ende → weg
      { id: 'n4', beat: 3, laenge: 1, ton: 41, vel: 80 },      // dahinter → weg
    ] },
    { id: 'c5', art: 'midi', name: 'b', start_beat: 0, laenge_beats: 4, noten: [
      { id: 'n1', beat: 2, laenge: 0.5, ton: 36, vel: 70 }, { id: 'n9', beat: 0, laenge: 0.5, ton: 48, vel: 70 },
    ] },
  ];
  return p;
}

test('Noten flach je Spur, absolute Beats, ID <clip>/<noten>, an Clip-Grenzen geschnitten, sortiert nach Beat; gleiche Noten-ID in zwei Clips kollidiert nicht', () => {
  const n = uebersetze(mitNoten(), opt()).spuren[1].noten;
  assert.deepEqual(n.map((x) => [x.id, x.beat, x.laenge, x.ton, x.vel]), [
    ['c5/n9', 0, 0.5, 48, 70], ['c5/n1', 2, 0.5, 36, 70], ['c2/n1', 4, 1, 36, 100], ['c2/n2', 5.5, 0.5, 38, 90]]);
  assert.equal(new Set(n.map((x) => x.id)).size, n.length);
});

test('Wirt-Spur ohne Freeze: Noten wie bei intern; mit Freeze: art audio, Freeze-Clip statt Noten, kein slot/noten-Feld', () => {
  const p = specProjekt(); p.spuren[2].clips = [{ id: 'c3', art: 'midi', name: 'l', start_beat: 8, laenge_beats: 4, noten: [{ id: 'n1', beat: 1, laenge: 1, ton: 60, vel: 90 }] }];
  assert.deepEqual(uebersetze(p, opt()).spuren[2], { nr: 3, art: 'wirt', slot: 1, noten: [{ id: 'c3/n1', beat: 9, laenge: 1, ton: 60, vel: 90 }] });
  p.tempo_bpm = 120; p.spuren[2].freeze = { datei: 'freeze/s3-1.f32', frames: 96000, kennung: 1, sha256: SHA_B };
  const w = uebersetze(p, opt({ arbeitsordner: '/arr/x', existiert: () => true }));
  assert.deepEqual(w.spuren[2], { nr: 3, art: 'audio', clips: [{ id: 's3/freeze', start_beat: 0, laenge_beats: 4, sha256: SHA_B, datei: '/arr/x/freeze/s3-1.f32',
    frames: 96000, offset_frames: 0, gain_db: 0, ein_beats: 0, aus_beats: 0 }] });   // 2 s bei 120 BPM = 4 Beats
  p.spuren[2].freeze.von_beat = 16;
  assert.equal(uebersetze(p, opt({ arbeitsordner: '/arr/x', existiert: () => true })).spuren[2].clips[0].start_beat, 16);
  assert.throws(() => uebersetze(p, opt()), (e) => e instanceof WiedergabeFehler && e.grund === 'arbeitsordner_fehlt');
});

test('Freeze-Datei fehlt auf der Platte → datei_fehlt (kein stilles Stummschalten); mit vorhandener Datei läuft es durch, die sha256 kommt aus dem Projekt', (t) => {
  const d = tmpOrdner(t); fs.mkdirSync(path.join(d, 'freeze'));
  const p = specProjekt(); p.spuren[2].freeze = { datei: 'freeze/s3-1.f32', frames: 100, kennung: 1, sha256: SHA_B };
  assert.throws(() => uebersetze(p, opt({ arbeitsordner: d })), (e) => e instanceof WiedergabeFehler && e.grund === 'datei_fehlt');
  fs.writeFileSync(path.join(d, 'freeze', 's3-1.f32'), Buffer.alloc(800, 1));
  const c = uebersetze(p, opt({ arbeitsordner: d })).spuren[2].clips[0];
  assert.equal(c.sha256, SHA_B); assert.equal(c.datei, path.join(d, 'freeze', 's3-1.f32'));
});

test('Standard-Lookup: frames aus der Dateigröße des Dekodier-Caches (8 Bytes je Stereo-Frame), fehlende/leere Datei = nicht bereit', (t) => {
  const d = tmpOrdner(t); const p = specProjekt();
  assert.deepEqual(uebersetze(p, { nr: 1, audioOrdner: d }).spuren[0].clips, []);
  fs.writeFileSync(path.join(d, `${SHA_A}.f32`), Buffer.alloc(0)); assert.deepEqual(uebersetze(p, { nr: 1, audioOrdner: d }).spuren[0].clips, []);
  fs.writeFileSync(path.join(d, `${SHA_A}.f32`), Buffer.alloc(8 * 1234));
  const c = uebersetze(p, { nr: 1, audioOrdner: d }).spuren[0].clips[0];
  assert.equal(c.frames, 1234); assert.equal(c.datei, path.join(d, `${SHA_A}.f32`));
});

test('Grenzen 8 Spuren / 4096 Clips / 65536 Noten: genau am Deckel geht, einer drüber → zu_gross', () => {
  const clips = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, art: 'audio', name: 'k', start_beat: i, laenge_beats: 1, quelle: { sha256: SHA_A, pfad_hinweis: '' }, dekodiert: 'fertig', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 }));
  const p = specProjekt(); p.spuren[0].clips = clips(4096);
  assert.equal(uebersetze(p, opt()).spuren[0].clips.length, 4096);
  p.spuren[0].clips = clips(4097);
  assert.throws(() => uebersetze(p, opt()), (e) => e instanceof WiedergabeFehler && e.grund === 'zu_gross' && /clips/.test(e.message));
  const q = specProjekt(); const noten = (n) => Array.from({ length: n }, (_, i) => ({ id: `n${i}`, beat: 0, laenge: 1, ton: 36, vel: 100 }));
  q.spuren[1].clips[0].noten = noten(65536);
  assert.equal(uebersetze(q, opt()).spuren[1].noten.length, 65536);
  q.spuren[1].clips[0].noten = noten(65537);
  assert.throws(() => uebersetze(q, opt()), (e) => e.grund === 'zu_gross' && /noten/.test(e.message));
  const s = specProjekt(); for (let i = 4; i <= 9; i++) s.spuren.push({ id: `s${i}`, nr: i, name: 'x', farbe: '#000000', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] });
  assert.throws(() => uebersetze(s, opt()), (e) => e.grund === 'zu_gross' && /spuren/.test(e.message));
});

test('Ausgabe ist deterministisch und mit dem Projekt nicht verbunden (Parameter kopiert); Spuren nach nr sortiert, nicht nach Anzeigereihenfolge', () => {
  const p = specProjekt(); p.spuren[1].geraet.parameter = { cutoff: 0.5 }; p.spuren.reverse();
  const a = uebersetze(p, opt()); const b = uebersetze(p, opt());
  assert.equal(JSON.stringify(a), JSON.stringify(b)); assert.deepEqual(a.spuren.map((s) => s.nr), [1, 2, 3]);
  a.spuren[1].parameter.cutoff = 0.9; assert.equal(p.spuren.find((s) => s.nr === 2).geraet.parameter.cutoff, 0.5);
});

test('aus dem Befehlsweg: eine Spur-Clip-Noten-Kette ergibt die erwarteten absoluten Beats (Clip bei Beat 8)', () => {
  let p = specProjekt(); p.spuren[1].clips = [];
  p = fuehreAus(p, { befehl: 'clip_neu', spur_id: 's2', art: 'midi', start_beat: 8, laenge_beats: 4, noten: [{ beat: 1, laenge: 0.5, ton: 40, vel: 99 }] }).projekt;
  assert.deepEqual(uebersetze(p, opt()).spuren[1].noten, [{ id: 'c2/n1', beat: 9, laenge: 0.5, ton: 40, vel: 99 }]);
});

test('schreibeWiedergabe: wiedergabe-<nr>.json atomar (kein .teil), Inhalt gleich; behält die letzten 5, fasst Fremdes nicht an', (t) => {
  const d = tmpOrdner(t); fs.mkdirSync(path.join(d, 'audio')); fs.writeFileSync(path.join(d, 'audio', 'x.f32'), 'a'); fs.writeFileSync(path.join(d, 'freeze-1-k.f32'), 'f');
  fs.writeFileSync(path.join(d, 'wiedergabe-abc.json'), '{}'); fs.writeFileSync(path.join(d, 'wiedergabe-1.json.bak'), '{}');
  const p = specProjekt(); const geschrieben = [];
  for (let nr = 3; nr <= 12; nr += 1) geschrieben.push(schreibeWiedergabe(d, uebersetze(p, opt({ nr }))));
  assert.equal(geschrieben[0], path.join(d, 'wiedergabe-3.json'));
  const da = fs.readdirSync(d).filter((n) => /^wiedergabe-\d+\.json$/.test(n)).sort((a, b) => parseInt(a.slice(11)) - parseInt(b.slice(11)));
  assert.deepEqual(da, ['wiedergabe-8.json', 'wiedergabe-9.json', 'wiedergabe-10.json', 'wiedergabe-11.json', 'wiedergabe-12.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(d, 'wiedergabe-12.json'), 'utf8')), uebersetze(p, opt({ nr: 12 })));
  assert.ok(!fs.readdirSync(d).some((n) => n.endsWith('.teil') || n.endsWith('.tmp')));
  for (const n of ['wiedergabe-abc.json', 'wiedergabe-1.json.bak', 'freeze-1-k.f32', 'audio']) assert.ok(fs.existsSync(path.join(d, n)), `${n} bleibt`);
});

test('schreibeWiedergabe: legt den Ordner an; eine kleinere Nummer wird nicht sofort wieder gelöscht (die gerade geschriebene bleibt immer)', (t) => {
  const d = path.join(tmpOrdner(t), 'neu', 'arr'); const p = specProjekt();
  for (const nr of [20, 21, 22, 23, 24, 25]) schreibeWiedergabe(d, uebersetze(p, opt({ nr })));
  const f = schreibeWiedergabe(d, uebersetze(p, opt({ nr: 2 })));
  assert.ok(fs.existsSync(f), 'gerade geschriebene Datei bleibt, auch wenn ihre Nummer klein ist');
  assert.ok(fs.readdirSync(d).filter((n) => n.startsWith('wiedergabe-')).length <= 6);
});
