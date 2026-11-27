// Export delivery engine (project/abgabe.ts): argument validation, file names and real ffmpeg conversions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ABGABE_MAX, AbgabeFehler, abgabeArgumente, abgabeName, leseAbgaben, wandle } from '../project/abgabe.ts';
import { wavKopf } from '../project/recording.ts';

test('leseAbgaben fills defaults and keeps only the fields of the format', () => {
  assert.deepEqual(leseAbgaben([{ format: 'wav', bits: 16 }]), [{ format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' }]);
  assert.deepEqual(leseAbgaben([{ format: 'flac' }]), [{ format: 'flac', bits: 24, rate_hz: 44100 }]);
  assert.deepEqual(leseAbgaben([{ format: 'mp3' }]), [{ format: 'mp3', kbps: 320, rate_hz: 44100 }]);
  assert.equal(ABGABE_MAX, 4);
});

test('leseAbgaben refuses what no format allows', () => {
  for (const v of [null, {}, [], Array(5).fill({ format: 'mp3' }), [{ format: 'ogg' }], [{ format: 'wav', kbps: 320 }], [{ format: 'mp3', bits: 24 }],
    [{ format: 'wav', bits: 24, dither: 'tpdf' }], [{ format: 'mp3', rate_hz: 96000 }], [{ format: 'flac', bits: 32 }], [{ format: 'wav', rate_hz: 22050 }],
    [{ format: 'wav', bits: 16 }, { format: 'wav', bits: 16, dither: 'aus' }], [{ format: 'wav', farbe: 1 }]]) assert.throws(() => leseAbgaben(v), AbgabeFehler);
  assert.throws(() => leseAbgaben([{ format: 'mp3' }], ['wav', 'flac']), AbgabeFehler);
});

test('leseAbgaben error text names the field', () => {
  assert.throws(() => leseAbgaben([{ format: 'wav', kbps: 320 }]), /kbps/);
  assert.throws(() => leseAbgaben([{ format: 'mp3', rate_hz: 96000 }]), /rate_hz/);
  assert.throws(() => leseAbgaben([{ format: 'ogg' }]), /format/);
});

test('abgabeName puts the tag between the master name and the extension', () => {
  assert.equal(abgabeName('/x/song-20261126-101500.wav', { format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' }), '/x/song-20261126-101500.16bit-44k.wav');
  assert.equal(abgabeName('/x/song-20261126-101500.wav', { format: 'wav', bits: 32, rate_hz: 96000 }), '/x/song-20261126-101500.32float-96k.wav');
  assert.equal(abgabeName('/x/song-20261126-101500-2.wav', { format: 'mp3', kbps: 320, rate_hz: 44100 }), '/x/song-20261126-101500-2.320kbps-44k.mp3');
});

test('abgabeArgumente builds the documented vectors', () => {
  const kopf = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', 'in.wav', '-map_metadata', '-1'];
  assert.deepEqual(abgabeArgumente({ format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' }, 'in.wav', 'out.teil'),
    [...kopf, '-af', 'aresample=44100:resampler=soxr:precision=28:dither_method=triangular', '-c:a', 'pcm_s16le', '-f', 'wav', 'out.teil']);
  assert.deepEqual(abgabeArgumente({ format: 'wav', bits: 16, rate_hz: 48000, dither: 'aus' }, 'in.wav', 'out.teil'),
    [...kopf, '-af', 'aresample=48000:resampler=soxr:precision=28', '-c:a', 'pcm_s16le', '-f', 'wav', 'out.teil']);
  assert.deepEqual(abgabeArgumente({ format: 'wav', bits: 32, rate_hz: 96000 }, 'in.wav', 'out.teil', { title: 'T' }),
    [...kopf, '-af', 'aresample=96000:resampler=soxr:precision=28', '-c:a', 'pcm_f32le', '-f', 'wav', '-metadata', 'title=T', '-write_bext', '1', 'out.teil']);
  assert.deepEqual(abgabeArgumente({ format: 'flac', bits: 24, rate_hz: 44100 }, 'in.wav', 'out.teil'),
    [...kopf, '-af', 'aresample=44100:resampler=soxr:precision=28', '-c:a', 'flac', '-compression_level', '8', '-sample_fmt', 's32', '-bits_per_raw_sample', '24', '-f', 'flac', 'out.teil']);
  assert.deepEqual(abgabeArgumente({ format: 'flac', bits: 16, rate_hz: 44100, dither: 'tpdf' }, 'in.wav', 'out.teil').slice(8),
    ['-af', 'aresample=44100:resampler=soxr:precision=28:dither_method=triangular', '-c:a', 'flac', '-compression_level', '8', '-sample_fmt', 's16', '-f', 'flac', 'out.teil']);
  assert.deepEqual(abgabeArgumente({ format: 'mp3', kbps: 256, rate_hz: 48000 }, 'in.wav', 'out.teil', { artist: 'a=b' }),
    [...kopf, '-af', 'aresample=48000:resampler=soxr:precision=28', '-c:a', 'libmp3lame', '-b:a', '256k', '-id3v2_version', '3', '-f', 'mp3', '-metadata', 'artist=a=b', 'out.teil']);
});

// ---- real ffmpeg -------------------------------------------------------------------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-abgabe-')) + '/Ordner Müller';
fs.mkdirSync(dir, { recursive: true });
test.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));

// seconds of stereo float32 48 kHz: 440 Hz at 0.5 in the first second, exact zeros afterwards
function quelle(name, sek) {
  const frames = 48000 * sek, d = Buffer.alloc(frames * 8);
  for (let i = 0; i < 48000 && i < frames; i++) { const v = 0.5 * Math.sin(2 * Math.PI * 440 * i / 48000); d.writeFloatLE(v, i * 8); d.writeFloatLE(v, i * 8 + 4); }
  const p = path.join(dir, name);
  fs.writeFileSync(p, Buffer.concat([wavKopf(frames), d]));
  return p;
}
const src = quelle('quelle.wav', 2);
const probe = (f, was = 'stream=codec_name,sample_rate,bits_per_sample,bits_per_raw_sample,duration_ts,bit_rate') =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', was, '-of', 'json', f]).toString());
const strom = (f) => probe(f).streams[0];
// 16 bit PCM samples (interleaved) of a WAV, found by walking the chunks
function pcm16(f) {
  const b = fs.readFileSync(f);
  let o = 12;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4);
    if (id === 'data') return new Int16Array(b.buffer.slice(b.byteOffset + o + 8, b.byteOffset + o + 8 + n));
    o += 8 + n + (n & 1);
  }
  throw new Error('no data chunk');
}
const keineTeile = () => assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.teil')), []);
const ziel = (n) => path.join(dir, n);
const stille = (s) => s.slice(48000 * 2);   // the second second, both channels

test('wandle wav 16 / 44100 / tpdf dithers the silence by at most one LSB', async () => {
  const z = ziel('t16.wav');
  await wandle({ quelle: src, ziel: z, abgabe: { format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' } });
  const s = strom(z);
  assert.equal(s.codec_name, 'pcm_s16le'); assert.equal(s.sample_rate, '44100'); assert.equal(Number(s.duration_ts), 88200);
  const x = stille(pcm16(z));
  assert.ok(x.filter((v) => v !== 0).length >= 1000, 'dither noise present');
  assert.ok(x.every((v) => v >= -1 && v <= 1), 'within one LSB');
  keineTeile();
});

test('wandle wav 16 / 44100 / aus leaves the silence at zero', async () => {
  const z = ziel('a16.wav');
  await wandle({ quelle: src, ziel: z, abgabe: { format: 'wav', bits: 16, rate_hz: 44100, dither: 'aus' } });
  assert.ok(stille(pcm16(z)).every((v) => v === 0));
  keineTeile();
});

test('wandle wav 24 / 48000', async () => {
  const z = ziel('t24.wav');
  await wandle({ quelle: src, ziel: z, abgabe: { format: 'wav', bits: 24, rate_hz: 48000 } });
  const s = strom(z);
  assert.equal(s.codec_name, 'pcm_s24le'); assert.equal(s.sample_rate, '48000'); assert.equal(Number(s.duration_ts), 96000);
});

test('wandle wav 32 / 96000', async () => {
  const z = ziel('t32.wav');
  await wandle({ quelle: src, ziel: z, abgabe: { format: 'wav', bits: 32, rate_hz: 96000 } });
  const s = strom(z);
  assert.equal(s.codec_name, 'pcm_f32le'); assert.equal(s.sample_rate, '96000');
});

test('wandle flac 24 / 44100', async () => {
  const z = ziel('f24.flac');
  await wandle({ quelle: src, ziel: z, abgabe: { format: 'flac', bits: 24, rate_hz: 44100 } });
  const s = strom(z);
  assert.equal(s.codec_name, 'flac'); assert.equal(s.sample_rate, '44100'); assert.equal(s.bits_per_raw_sample, '24');
});

test('wandle mp3 320 / 44100', async () => {
  const z = ziel('m320.mp3');
  await wandle({ quelle: src, ziel: z, abgabe: { format: 'mp3', kbps: 320, rate_hz: 44100 } });
  const s = strom(z);
  assert.equal(s.codec_name, 'mp3'); assert.equal(s.sample_rate, '44100'); assert.equal(s.bit_rate, '320000');
});

test('wandle writes a tag with quotes, equals sign and emoji that reads back identical', async () => {
  const z = ziel('tags.flac'), titel = 'A "b" = ü 🎚';
  await wandle({ quelle: src, ziel: z, abgabe: { format: 'flac', bits: 24, rate_hz: 44100 }, tags: { title: titel } });
  assert.equal(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=title', '-of', 'default=nw=1:nk=1', z]).toString().trimEnd(), titel);
});

test('wandle never replaces an existing target', async () => {
  const z = ziel('da.wav');
  fs.writeFileSync(z, 'alt');
  await assert.rejects(wandle({ quelle: src, ziel: z, abgabe: { format: 'wav', bits: 16, rate_hz: 44100, dither: 'aus' } }), AbgabeFehler);
  assert.equal(fs.readFileSync(z, 'utf8'), 'alt');
  keineTeile();
});

test('wandle with a missing program throws AbgabeFehler and leaves no .teil', async () => {
  const z = ziel('nix.wav');
  await assert.rejects(wandle({ quelle: src, ziel: z, abgabe: { format: 'wav', bits: 16, rate_hz: 44100, dither: 'aus' }, ffmpeg: ['/does/not/exist'] }),
    (e) => e instanceof AbgabeFehler && /ffmpeg is not installed/.test(e.message));
  assert.ok(!fs.existsSync(z));
  keineTeile();
});

test('wandle throws AbgabeFehler with the last stderr line when ffmpeg fails', async () => {
  const z = ziel('kaputt.wav'), kaputt = ziel('kaputt-quelle.wav');
  fs.writeFileSync(kaputt, 'not audio');
  await assert.rejects(wandle({ quelle: kaputt, ziel: z, abgabe: { format: 'wav', bits: 16, rate_hz: 44100, dither: 'aus' } }), AbgabeFehler);
  assert.ok(!fs.existsSync(z));
  keineTeile();
});

test('wandle aborts a running conversion: ffmpeg killed, no .teil, no target', async () => {
  const lang = quelle('lang.wav', 60), z = ziel('abbruch.flac'), ac = new AbortController();
  const p = wandle({ quelle: lang, ziel: z, abgabe: { format: 'flac', bits: 24, rate_hz: 96000 }, abbruch: ac.signal });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, AbgabeFehler);
  assert.ok(!fs.existsSync(z));
  keineTeile();
});

test('wandle with an already aborted signal does not start', async () => {
  const ac = new AbortController(); ac.abort();
  await assert.rejects(wandle({ quelle: src, ziel: ziel('vorab.wav'), abgabe: { format: 'wav', bits: 16, rate_hz: 44100, dither: 'aus' }, abbruch: ac.signal }), AbgabeFehler);
  keineTeile();
});

// ---- legeAb: hard link, copy when the file system has no hard links, never replace ----
const fehlerMit = (code) => () => { throw Object.assign(new Error(code), { code }); };
const legeTemp = (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-legeab-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return { teil: path.join(d, 'a.wav.1.teil'), ziel: path.join(d, 'a.wav') };
};

test('legeAb: a link that fails with EPERM falls back to a copy with the same content', async (t) => {
  const { legeAb } = await import('../project/abgabe.ts');
  const { teil, ziel } = legeTemp(t);
  fs.writeFileSync(teil, 'inhalt');
  for (const code of ['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV']) {
    fs.rmSync(ziel, { force: true });
    await legeAb(teil, ziel, async () => fehlerMit(code)());
    assert.equal(fs.readFileSync(ziel, 'utf8'), 'inhalt', code);
    assert.notEqual(fs.statSync(ziel).ino, fs.statSync(teil).ino, 'a copy, not a link');
  }
  fs.rmSync(ziel);
  await legeAb(teil, ziel);
  assert.equal(fs.statSync(ziel).ino, fs.statSync(teil).ino, 'a working link stays a link');
});

test('legeAb: an existing target is never replaced, in the link path and in the copy path; other errors are thrown as they are', async (t) => {
  const { legeAb } = await import('../project/abgabe.ts');
  const { teil, ziel } = legeTemp(t);
  fs.writeFileSync(teil, 'neu'); fs.writeFileSync(ziel, 'alt');
  await assert.rejects(legeAb(teil, ziel), { code: 'EEXIST' });
  await assert.rejects(legeAb(teil, ziel, async () => fehlerMit('EPERM')()), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(ziel, 'utf8'), 'alt');
  await assert.rejects(legeAb(teil, ziel, async () => fehlerMit('EACCES')()), { code: 'EACCES' });
  assert.equal(fs.readFileSync(ziel, 'utf8'), 'alt');
});

test('legeAb: a failed copy removes only the half file it created itself, never a target that was there', async (t) => {
  const { legeAb } = await import('../project/abgabe.ts');
  const { teil, ziel } = legeTemp(t);
  fs.writeFileSync(teil, 'neu');
  const kaputt = async (_a, b) => { fs.writeFileSync(b, 'halb'); throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); };
  await assert.rejects(legeAb(teil, ziel, async () => fehlerMit('EPERM')(), kaputt), { code: 'ENOSPC' });
  assert.equal(fs.existsSync(ziel), false, 'the half file is gone');
  fs.writeFileSync(ziel, 'alt');
  await assert.rejects(legeAb(teil, ziel, async () => fehlerMit('EPERM')(), async () => { throw Object.assign(new Error('x'), { code: 'EIO' }); }), { code: 'EIO' });
  assert.equal(fs.readFileSync(ziel, 'utf8'), 'alt', 'the target that was there stays');
});
