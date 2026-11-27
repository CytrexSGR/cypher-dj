// PRODUCTION: the pure functions of the export dialog (export_dialog.js): defaults, request body, metadata command, ISRC, run lock.
// The DOM part (bindeExportDialog) keeps all computing in these functions; the module must not touch the DOM at import.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SPEICHER_SCHLUESSEL, FORMAT_VORGABEN, ZIEL_VORGABEN, ZEILEN_MAX, dialogVorgabe, exportAnfrage, metaBefehl, isrcNormal, jahrNormal, startErlaubt,
  bereichText, neueZeile, zeileAendern, zeilenSteuerung, speicherInhalt, DOPPELT_TEXT, doppelteZeilen, naechsteZeile, SPUREN_HOST_TEXT, spurenVorgaben, wechselModus,
} from '../public/production/export_dialog.js';

const projekt = { name: 'Night Drive', tempo_bpm: 128, taktart: [4, 4], loop: { an: false, von_beat: 16, bis_beat: 48 } };

test('the storage key is versioned', () => assert.equal(SPEICHER_SCHLUESSEL, 'cypherdj.export.v1'));

test('exportAnfrage: the default state sends the request of today', () => {
  assert.deepEqual(exportAnfrage(dialogVorgabe(projekt, null)), { weg: '/proj/export', koerper: {} });
  assert.deepEqual(dialogVorgabe(projekt, null), {
    vorgabe: 'master', zeilen: [], ziel: 'aus', ausklang_beats: 0, modus: 'mix', mit_meta: true,
    meta: { titel: '', kuenstler: '', album: '', jahr: '', genre: '', isrc: '' },
  });
});

test('exportAnfrage: release and promo with the streaming target and a tail', () => {
  const z = { ...dialogVorgabe(projekt, null), vorgabe: 'release_promo', zeilen: FORMAT_VORGABEN.release_promo, ziel: 'streaming', ausklang_beats: 8, mit_meta: false };
  assert.deepEqual(exportAnfrage(z).koerper, { abgabe: FORMAT_VORGABEN.release_promo, ziel: { lufs_i: -14, true_peak_dbtp: -1 }, ausklang_beats: 8, ohne_meta: true });
  assert.deepEqual(exportAnfrage({ ...z, ziel: 'spitze', vorgabe: 'master', zeilen: [], ausklang_beats: 0, mit_meta: true }).koerper, { ziel: { true_peak_dbtp: -1 } });
  assert.equal(exportAnfrage({ ...z, ziel: 'streaming' }).weg, '/proj/export');
  // the body never aliases the constants
  const k = exportAnfrage(z).koerper; k.ziel.lufs_i = 0; k.abgabe[0].bits = 24;
  assert.equal(ZIEL_VORGABEN.streaming.lufs_i, -14); assert.equal(FORMAT_VORGABEN.release_promo[0].bits, 16);
});

test('exportAnfrage: the preset sets the rows; custom keeps the rows the user edited', () => {
  const eigen = [{ format: 'flac', bits: 24, rate_hz: 96000 }, { format: 'wav', bits: 16, rate_hz: 48000, dither: 'aus' }];
  const z = { ...dialogVorgabe(projekt, null), vorgabe: 'eigen', zeilen: eigen };
  assert.deepEqual(exportAnfrage(z).koerper, { abgabe: eigen });
  assert.deepEqual(exportAnfrage({ ...z, zeilen: [] }).koerper, {}, 'no rows: no abgabe');
});

test('dialogVorgabe: project metadata wins, the last artist fills an empty one, broken storage is ignored', () => {
  const mitMeta = { ...projekt, abgabe_meta: { titel: 'Night Drive (Club Mix)', kuenstler: 'Cytrex', jahr: 2026, isrc: 'DEXXX2600001' } };
  const gespeichert = { v: 1, vorgabe: 'release', zeilen: FORMAT_VORGABEN.release, ziel: 'streaming', ausklang_beats: 4, mit_meta: false, kuenstler: 'Someone Else' };
  const a = dialogVorgabe(mitMeta, gespeichert);
  assert.equal(a.meta.kuenstler, 'Cytrex', 'the project artist wins');
  assert.deepEqual([a.meta.titel, a.meta.jahr, a.meta.isrc, a.meta.album], ['Night Drive (Club Mix)', '2026', 'DEXXX2600001', '']);
  assert.deepEqual([a.vorgabe, a.ziel, a.ausklang_beats, a.mit_meta], ['release', 'streaming', 4, false]);
  assert.deepEqual(a.zeilen, FORMAT_VORGABEN.release);
  assert.equal(dialogVorgabe(projekt, gespeichert).meta.kuenstler, 'Someone Else', 'the last artist fills an empty one');
  // custom rows come back from the storage
  const eigen = [{ format: 'mp3', kbps: 256, rate_hz: 48000 }];
  const e = dialogVorgabe(projekt, { v: 1, vorgabe: 'eigen', zeilen: eigen, ziel: 'aus', ausklang_beats: 0, mit_meta: true, kuenstler: '' });
  assert.deepEqual([e.vorgabe, e.zeilen], ['eigen', eigen]);
  // broken or unknown storage is ignored as a whole
  const fallback = dialogVorgabe(projekt, null);
  const kaputt = [
    'text', 42, [], { v: 2 }, { v: 1, vorgabe: 'unbekannt', ziel: 'aus', ausklang_beats: 0, mit_meta: true, kuenstler: '' },
    { v: 1, vorgabe: 'release', ziel: 'laut', ausklang_beats: 0, mit_meta: true, kuenstler: '' },
    { v: 1, vorgabe: 'release', ziel: 'aus', ausklang_beats: 99, mit_meta: true, kuenstler: '' },
    { v: 1, vorgabe: 'release', ziel: 'aus', ausklang_beats: 4, mit_meta: 'ja', kuenstler: '' },
    { v: 1, vorgabe: 'eigen', zeilen: [{ format: 'ogg' }], ziel: 'aus', ausklang_beats: 0, mit_meta: true, kuenstler: '' },
    { v: 1, vorgabe: 'eigen', zeilen: new Array(5).fill({ format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' }), ziel: 'aus', ausklang_beats: 0, mit_meta: true, kuenstler: '' },
  ];
  for (const k of kaputt) assert.deepEqual(dialogVorgabe(projekt, k), fallback, JSON.stringify(k));
});

test('speicherInhalt: what is stored reads back the same', () => {
  const z = { ...dialogVorgabe(projekt, null), vorgabe: 'eigen', zeilen: [{ format: 'flac', bits: 24, rate_hz: 48000 }], ziel: 'spitze', ausklang_beats: 2, mit_meta: false, meta: { ...dialogVorgabe(projekt, null).meta, kuenstler: 'Cytrex' } };
  const s = JSON.parse(JSON.stringify(speicherInhalt(z)));
  const zurueck = dialogVorgabe(projekt, s);
  assert.deepEqual([zurueck.vorgabe, zurueck.zeilen, zurueck.ziel, zurueck.ausklang_beats, zurueck.mit_meta, zurueck.meta.kuenstler], ['eigen', z.zeilen, 'spitze', 2, false, 'Cytrex']);
  assert.equal(s.meta, undefined, 'only the artist of the metadata is kept; the rest lives in the project');
});

test('metaBefehl: null without a change; changed fields set, emptied fields null, everything emptied → {aus: true}', () => {
  const leer = dialogVorgabe(projekt, null);
  assert.equal(metaBefehl(projekt, leer), null);
  const mit = { ...projekt, abgabe_meta: { titel: 'A', kuenstler: 'B', jahr: 2026 } };
  assert.equal(metaBefehl(mit, dialogVorgabe(mit, null)), null, 'unchanged');
  assert.equal(metaBefehl(mit, { ...dialogVorgabe(mit, null), meta: { ...dialogVorgabe(mit, null).meta, titel: '  A  ' } }), null, 'trimmed value equals the stored one');
  const z = { ...leer, meta: { titel: 'Night Drive', kuenstler: ' Cytrex ', album: '', jahr: '2026', genre: '', isrc: 'de-xxx-26-00001' } };
  assert.deepEqual(metaBefehl(projekt, z), { befehl: 'abgabe_meta_setzen', titel: 'Night Drive', kuenstler: 'Cytrex', jahr: 2026, isrc: 'DEXXX2600001' });
  const d = dialogVorgabe(mit, null);
  assert.deepEqual(metaBefehl(mit, { ...d, meta: { ...d.meta, kuenstler: '', jahr: '2027' } }), { befehl: 'abgabe_meta_setzen', kuenstler: null, jahr: 2027 }, 'emptied field is null, only differences go');
  assert.deepEqual(metaBefehl(mit, { ...d, meta: { titel: '', kuenstler: '', album: '', jahr: '', genre: '', isrc: '' } }), { befehl: 'abgabe_meta_setzen', aus: true });
  assert.deepEqual(metaBefehl(mit, { ...d, meta: { ...d.meta, titel: '' } }), { befehl: 'abgabe_meta_setzen', titel: null });
  assert.equal(metaBefehl(projekt, { ...leer, meta: { ...leer.meta, jahr: '20x6' } }), null, 'an invalid year is never sent (startErlaubt blocks the export)');
});

test('isrcNormal / jahrNormal', () => {
  assert.equal(isrcNormal('de-xxx-26-00001'), 'DEXXX2600001');
  assert.equal(isrcNormal(' DEXXX2600001 '), 'DEXXX2600001');
  assert.equal(isrcNormal('DEXXX26'), null);
  assert.equal(isrcNormal('DEXXX260000A'), null);
  assert.equal(isrcNormal(''), '');
  assert.equal(isrcNormal('   '), '');
  assert.equal(jahrNormal('2026'), 2026); assert.equal(jahrNormal(''), '');
  for (const s of ['1899', '2101', '20x6', '2026.5', '-2026', '12345']) assert.equal(jahrNormal(s), null, s);
});

test('startErlaubt: false during a run, false with an invalid ISRC or year, true otherwise', () => {
  const z = dialogVorgabe(projekt, null);
  assert.equal(startErlaubt(z, null), true);
  assert.equal(startErlaubt(z, { art: 'export' }), false);
  assert.equal(startErlaubt(z, { art: 'lautheit' }), false, 'a foreign run counts too');
  assert.equal(startErlaubt({ ...z, meta: { ...z.meta, isrc: 'nope' } }, null), false);
  assert.equal(startErlaubt({ ...z, meta: { ...z.meta, jahr: '1800' } }, null), false);
  assert.equal(startErlaubt({ ...z, meta: { ...z.meta, isrc: 'de-xxx-26-00001', jahr: '2026' } }, null), true);
});

test('bereichText mirrors the loop bracket', () => {
  assert.equal(bereichText(projekt), 'Whole song');
  assert.equal(bereichText({ ...projekt, loop: { an: true, von_beat: 16, bis_beat: 48 } }), 'Loop bracket, bars 5 to 12');
  assert.equal(bereichText({ ...projekt, taktart: [3, 4], loop: { an: true, von_beat: 0, bis_beat: 12 } }), 'Loop bracket, bars 1 to 4');
  assert.equal(bereichText(null), 'Whole song');
});

test('rows: a control that does not apply to the format is hidden, a change keeps the row valid', () => {
  assert.deepEqual(zeilenSteuerung({ format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' }), { bits: [16, 24, 32], dither: true, kbps: null, raten: [44100, 48000, 88200, 96000] });
  assert.deepEqual(zeilenSteuerung({ format: 'wav', bits: 24, rate_hz: 44100 }).dither, false);
  assert.deepEqual(zeilenSteuerung({ format: 'flac', bits: 24, rate_hz: 44100 }).bits, [16, 24]);
  assert.deepEqual(zeilenSteuerung({ format: 'mp3', kbps: 320, rate_hz: 44100 }), { bits: null, dither: false, kbps: [192, 256, 320], raten: [44100, 48000] });
  assert.deepEqual(neueZeile('mp3'), { format: 'mp3', kbps: 320, rate_hz: 44100 });
  assert.deepEqual(zeileAendern({ format: 'wav', bits: 16, rate_hz: 96000, dither: 'tpdf' }, 'format', 'mp3'), { format: 'mp3', kbps: 320, rate_hz: 44100 }, 'a rate mp3 does not know falls back');
  assert.deepEqual(zeileAendern({ format: 'wav', bits: 16, rate_hz: 48000, dither: 'tpdf' }, 'format', 'flac'), { format: 'flac', bits: 16, rate_hz: 48000, dither: 'tpdf' }, 'flac at 16 bit has dither like wav');
  assert.deepEqual(zeileAendern({ format: 'wav', bits: 24, rate_hz: 48000 }, 'format', 'flac'), { format: 'flac', bits: 24, rate_hz: 48000 }, 'no dither at 24 bit');
  assert.deepEqual(zeileAendern({ format: 'wav', bits: 32, rate_hz: 48000 }, 'format', 'flac'), { format: 'flac', bits: 24, rate_hz: 48000 }, '32 bit float does not exist in flac');
  assert.deepEqual(zeileAendern({ format: 'wav', bits: 16, rate_hz: 44100, dither: 'aus' }, 'bits', 24), { format: 'wav', bits: 24, rate_hz: 44100 }, 'no dither at 24 bit');
  assert.deepEqual(zeileAendern({ format: 'wav', bits: 24, rate_hz: 44100 }, 'bits', 16), { format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' });
  assert.deepEqual(zeileAendern({ format: 'mp3', kbps: 320, rate_hz: 44100 }, 'kbps', 192), { format: 'mp3', kbps: 192, rate_hz: 44100 });
  assert.equal(ZEILEN_MAX, 4);
});

// the per-track set (task 6)
const z0 = dialogVorgabe(projekt, null);

test('exportAnfrage in the mode spuren', () => assert.deepEqual(exportAnfrage({ ...z0, modus: 'spuren', zeilen: [{ format: 'flac', bits: 24, rate_hz: 44100 }], ziel: 'streaming', ausklang_beats: 8 }),
  { weg: '/proj/export_spuren', koerper: { abgabe: { format: 'flac', bits: 24, rate_hz: 44100 } } }));

test('exportAnfrage in the mode spuren: Master only sends nothing, tail, target and metadata flag are never sent, the body does not alias', () => {
  assert.deepEqual(exportAnfrage({ ...z0, modus: 'spuren', zeilen: [], ziel: 'spitze', ausklang_beats: 4, mit_meta: false }), { weg: '/proj/export_spuren', koerper: {} });
  const zeile = { format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' };
  const k = exportAnfrage({ ...z0, modus: 'spuren', zeilen: [zeile] }).koerper; k.abgabe.bits = 24;
  assert.equal(zeile.bits, 16);
  assert.equal(exportAnfrage({ ...z0, modus: 'mix' }).weg, '/proj/export', 'the mode mix is today\'s request');
});

test('dialogVorgabe: the mode comes from the storage; a stored state without a mode is mix and is kept', () => {
  const alt = { v: 1, vorgabe: 'release_promo', zeilen: FORMAT_VORGABEN.release_promo, ziel: 'streaming', ausklang_beats: 4, mit_meta: false, kuenstler: 'X' };
  const a = dialogVorgabe(projekt, alt);
  assert.deepEqual([a.modus, a.vorgabe, a.ziel, a.ausklang_beats], ['mix', 'release_promo', 'streaming', 4], 'an old state is not thrown away');
  const s = dialogVorgabe(projekt, { ...alt, vorgabe: 'release', zeilen: FORMAT_VORGABEN.release, modus: 'spuren' });
  assert.deepEqual([s.modus, s.vorgabe, s.zeilen], ['spuren', 'release', FORMAT_VORGABEN.release]);
  const fallback = dialogVorgabe(projekt, null);
  for (const g of [{ ...alt, modus: 'alle' }, { ...alt, modus: 7 }, { ...alt, modus: 'spuren' } /* release_promo is not a set preset */,
    { ...alt, modus: 'spuren', vorgabe: 'eigen', zeilen: [{ format: 'mp3', kbps: 320, rate_hz: 44100 }] },
    { ...alt, modus: 'spuren', vorgabe: 'eigen', zeilen: [{ format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' }, { format: 'flac', bits: 24, rate_hz: 44100 }] }]) {
    assert.deepEqual(dialogVorgabe(projekt, g), fallback, JSON.stringify(g));
  }
  // a plugin stage is on: the mode spuren is not available, the stored mode falls back to mix
  const mitHost = { ...projekt, spuren: [{ id: 's1', inserts: [{ art: 'host', an: true }] }] };
  assert.equal(dialogVorgabe(mitHost, { ...alt, vorgabe: 'release', zeilen: FORMAT_VORGABEN.release, modus: 'spuren' }).modus, 'mix');
});

test('speicherInhalt keeps the mode and reads back; the format stays {v: 1, ...}', () => {
  const z = { ...z0, modus: 'spuren', vorgabe: 'eigen', zeilen: [{ format: 'flac', bits: 16, rate_hz: 48000, dither: 'aus' }] };
  const s = JSON.parse(JSON.stringify(speicherInhalt(z)));
  assert.equal(s.v, 1); assert.equal(s.modus, 'spuren');
  const r = dialogVorgabe(projekt, s);
  assert.deepEqual([r.modus, r.vorgabe, r.zeilen], ['spuren', 'eigen', z.zeilen]);
});

test('spurenVorgaben: the set takes master, release and custom only', () => assert.deepEqual(spurenVorgaben, ['master', 'release', 'eigen']));

test('wechselModus: into the set the rows shrink to one WAV or FLAC row, back to mix the custom rows return', () => {
  const rp = { vorgabe: 'release_promo', zeilen: FORMAT_VORGABEN.release_promo };
  assert.deepEqual(wechselModus(rp, 'spuren', null), { vorgabe: 'release', zeilen: FORMAT_VORGABEN.release });
  assert.deepEqual(wechselModus({ vorgabe: 'promo', zeilen: FORMAT_VORGABEN.promo }, 'spuren', null), { vorgabe: 'master', zeilen: [] });
  assert.deepEqual(wechselModus({ vorgabe: 'master', zeilen: [] }, 'spuren', null), { vorgabe: 'master', zeilen: [] });
  const eigen = [{ format: 'mp3', kbps: 320, rate_hz: 44100 }, { format: 'flac', bits: 24, rate_hz: 96000 }, { format: 'wav', bits: 24, rate_hz: 48000 }];
  assert.deepEqual(wechselModus({ vorgabe: 'eigen', zeilen: eigen }, 'spuren', null), { vorgabe: 'eigen', zeilen: [eigen[1]] });
  assert.deepEqual(wechselModus({ vorgabe: 'eigen', zeilen: [eigen[0]] }, 'spuren', null), { vorgabe: 'master', zeilen: [] });
  assert.deepEqual(wechselModus({ vorgabe: 'eigen', zeilen: [eigen[1]] }, 'mix', eigen), { vorgabe: 'eigen', zeilen: eigen });
  assert.deepEqual(wechselModus({ vorgabe: 'release', zeilen: FORMAT_VORGABEN.release }, 'mix', null), { vorgabe: 'release', zeilen: FORMAT_VORGABEN.release });
  const r = wechselModus(rp, 'spuren', null); r.zeilen[0].bits = 24;
  assert.equal(FORMAT_VORGABEN.release[0].bits, 16, 'no aliasing');
});

test('startErlaubt in the set ignores the metadata (its rows are hidden); the run lock stays', () => {
  const kaputt = { ...z0, modus: 'spuren', meta: { ...z0.meta, isrc: 'nope', jahr: '1800' } };
  assert.equal(startErlaubt(kaputt, null), true);
  assert.equal(startErlaubt(kaputt, { art: 'export' }), false);
  assert.equal(startErlaubt({ ...kaputt, modus: 'mix' }, null), false);
});

test('the text for the disabled mode', () => assert.equal(SPUREN_HOST_TEXT, 'Not available while a plugin stage is on (the per-track export renders offline)'));

// duplicate file names (review I1): abgabeName has no dither in the name, so two rows of one format, depth and rate are one file
test('doppelteZeilen: same format, depth and rate is a duplicate, dither does not tell them apart, mp3 counts kbps', () => {
  const w16 = { format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' };
  assert.equal(doppelteZeilen([w16, { ...w16 }]), true);
  assert.equal(doppelteZeilen([w16, { ...w16, dither: 'aus' }]), true, 'tpdf and aus yield the same file name');
  assert.equal(doppelteZeilen([w16, { format: 'wav', bits: 24, rate_hz: 44100 }]), false);
  assert.equal(doppelteZeilen([w16, { ...w16, rate_hz: 48000 }]), false);
  assert.equal(doppelteZeilen([w16, { format: 'flac', bits: 16, rate_hz: 44100, dither: 'tpdf' }]), false, 'the extension differs');
  assert.equal(doppelteZeilen([{ format: 'mp3', kbps: 320, rate_hz: 44100 }, { format: 'mp3', kbps: 256, rate_hz: 44100 }]), false);
  assert.equal(doppelteZeilen([{ format: 'mp3', kbps: 320, rate_hz: 44100 }, { format: 'mp3', kbps: 320, rate_hz: 44100 }]), true);
  assert.equal(doppelteZeilen([]), false);
});

test('startErlaubt: two rows that would write the same file are not startable; the set has one row and is not affected', () => {
  const w16 = { format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' };
  const z = { ...z0, vorgabe: 'eigen', zeilen: [w16, { ...w16 }] };
  assert.equal(startErlaubt(z, null), false);
  assert.equal(startErlaubt({ ...z, zeilen: [w16, { ...w16, dither: 'aus' }] }, null), false);
  assert.equal(startErlaubt({ ...z, zeilen: [w16, { ...w16, bits: 24, dither: undefined }] }, null), true);
  assert.match(DOPPELT_TEXT, /^Two formats would write the same file/);
});

test('naechsteZeile: Release, Custom, + Add format never creates a duplicate; it proposes the first unused combination', () => {
  let zeilen = FORMAT_VORGABEN.release.map((x) => ({ ...x }));
  for (let i = 0; i < ZEILEN_MAX - 1; i++) {
    zeilen = [...zeilen, naechsteZeile(zeilen)];
    assert.equal(doppelteZeilen(zeilen), false, JSON.stringify(zeilen));
  }
  assert.equal(zeilen.length, ZEILEN_MAX);
  assert.deepEqual(naechsteZeile(FORMAT_VORGABEN.release), { format: 'wav', bits: 24, rate_hz: 44100 });
  assert.deepEqual(naechsteZeile([]), { format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' });
  // every combination used up: the row is still valid (the dialog then shows the duplicate hint), it never throws
  const alle = [];
  for (const f of ['wav', 'flac']) for (const b of f === 'wav' ? [16, 24, 32] : [16, 24]) for (const r of [44100, 48000, 88200, 96000]) alle.push(zeileAendern({ format: f, bits: b, rate_hz: r }, 'bits', b));
  assert.ok(naechsteZeile(alle).format);
});

test('dialogVorgabe: a stored state with a duplicate is read but not startable', () => {
  const w16 = { format: 'wav', bits: 16, rate_hz: 44100, dither: 'tpdf' };
  const z = dialogVorgabe(projekt, { v: 1, vorgabe: 'eigen', zeilen: [w16, { ...w16, dither: 'aus' }], ziel: 'aus', ausklang_beats: 0, mit_meta: true, kuenstler: '' });
  assert.equal(z.zeilen.length, 2);
  assert.equal(startErlaubt(z, null), false);
});

test('production.css: the rows the mode spuren hides stay hidden (a display rule beats the [hidden] of the browser)', () => {
  const css = fs.readFileSync(new URL('../public/production/production.css', import.meta.url), 'utf8');
  assert.match(css, /\.p-export-zeile\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
  // every element of the dialog that gets a display rule of its own and is switched with `hidden` needs the same rule
  assert.match(css, /\.p-export-zeilen\[hidden\]\s*\{\s*display:\s*none/);
});

// "Export to": the folder the files go to (a remembered absolute path), absent = the export folder of the project
const gespeichertOrdner = (o) => ({ v: 1, vorgabe: 'master', zeilen: [], ziel: 'aus', ausklang_beats: 0, mit_meta: true, kuenstler: '', ...o });

test('dialogVorgabe: a stored folder survives, a stored non-string or empty folder is dropped without dropping the rest', () => {
  assert.equal(dialogVorgabe(projekt, gespeichertOrdner({ ordner: '/srv/export' })).ordner, '/srv/export');
  const a = dialogVorgabe(projekt, gespeichertOrdner({ vorgabe: 'release', ordner: 42 }));
  assert.equal(a.vorgabe, 'release', 'the rest of the state is kept');
  for (const o of [42, '', null, [], {}, true]) assert.equal(Object.hasOwn(dialogVorgabe(projekt, gespeichertOrdner({ ordner: o })), 'ordner'), false, JSON.stringify(o));
  assert.equal(Object.hasOwn(dialogVorgabe(projekt, null), 'ordner'), false, 'no folder: the key is absent');
});

test('exportAnfrage: ordner goes into both modes, and only when chosen and available', () => {
  const o = '/srv/export';
  assert.deepEqual(exportAnfrage({ ...z0, ordner: o }), { weg: '/proj/export', koerper: { ordner: o } });
  assert.deepEqual(exportAnfrage({ ...z0, ordner: o, vorgabe: 'release', zeilen: FORMAT_VORGABEN.release }).koerper,
    { abgabe: FORMAT_VORGABEN.release, ordner: o });
  assert.deepEqual(exportAnfrage({ ...z0, modus: 'spuren', ordner: o }), { weg: '/proj/export_spuren', koerper: { ordner: o } });
  assert.deepEqual(exportAnfrage({ ...z0, modus: 'spuren', zeilen: [{ format: 'flac', bits: 24, rate_hz: 44100 }], ordner: o }).koerper,
    { abgabe: { format: 'flac', bits: 24, rate_hz: 44100 }, ordner: o });
  assert.deepEqual(exportAnfrage(z0).koerper, {}, 'none chosen');
  assert.deepEqual(exportAnfrage({ ...z0, ordner: o, ordnerFehlt: true }).koerper, {}, 'marked unavailable: the project folder');
  assert.deepEqual(exportAnfrage({ ...z0, modus: 'spuren', ordner: o, ordnerFehlt: true }).koerper, {});
  assert.deepEqual(exportAnfrage({ ...z0, ordner: '' }).koerper, {}, 'an empty string is no folder');
});

test('speicherInhalt keeps the folder (also an unavailable one) and omits the key without one', () => {
  const o = '/srv/export';
  assert.equal(speicherInhalt({ ...z0, ordner: o, ordnerFehlt: true }).ordner, o);
  assert.equal(Object.hasOwn(speicherInhalt(z0), 'ordner'), false);
  assert.equal(dialogVorgabe(projekt, JSON.parse(JSON.stringify(speicherInhalt({ ...z0, ordner: o })))).ordner, o);
});

test('the export dialog opens the folder picker inside its own <dialog> (top layer) and holds the native cancel while it is open', () => {
  const q = fs.readFileSync(new URL('../public/production/export_dialog.js', import.meta.url), 'utf8');
  assert.match(q, /waehleOrdner\(\{[^}]*in: dlg/, 'the picker is appended to the modal dialog');
  assert.match(q, /export-ordner-wahl/); assert.match(q, /export-ordner-projekt/);
  assert.match(q, /addEventListener\('cancel'/, 'the native cancel is held while the picker is open');
});
