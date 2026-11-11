// strudel-clip: the page side of the PATTERN field (pure parts) and the texts of its answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { musterBefehl, musterInfo, attr, MUSTER_TEXT } from '../public/production/pattern_field.js';
import { fehlerText, musterMeldung, meldeNachSchreiben } from '../public/production/production.js';

const clip = { id: 'c3', art: 'midi', name: 'x', start_beat: 0, laenge_beats: 4, noten: [] };

test('GENERATE sends one clip_aus_muster on the selected clip; BARS empty keeps the length, a number is sent as takte', () => {
  const r = musterBefehl(clip, '  s("bd*4")  ', '');
  assert.deepEqual(r.befehl, { befehl: 'clip_aus_muster', clip_id: 'c3', code: 's("bd*4")' });
  assert.equal(r.label, MUSTER_TEXT.label);
  assert.equal(musterBefehl(clip, 'note("c3")', '4').befehl.takte, 4);
  assert.equal(musterBefehl(clip, 'note("c3")', '0,5').befehl.takte, 0.5);   // a comma works too
});

test('GENERATE refuses locally: empty pattern, bad BARS, an audio clip', () => {
  assert.equal(musterBefehl(clip, '   ', '').fehler, MUSTER_TEXT.leer);
  for (const t of ['0', '-1', 'x', '2000']) assert.equal(musterBefehl(clip, 'note("c3")', t).fehler, MUSTER_TEXT.takte_ungueltig, t);
  assert.ok(musterBefehl({ ...clip, art: 'audio' }, 'note("c3")', '').fehler);
});

test('the info line names the fields that were not applied; a clip without origin shows nothing', () => {
  assert.equal(musterInfo(clip), '');
  assert.equal(musterInfo({ ...clip, muster: { code: 'x' } }), 'All fields of this pattern were applied');
  assert.match(musterInfo({ ...clip, muster: { code: 'x', ohne_ziel: ['delay', 'room'] } }), /Not applied \(no target here\): delay, room/);
});

test('a pattern refusal shows its detail (line, column, the kit sounds); other reasons keep their fixed text', () => {
  const t = fehlerText({ status: 400, j: { fehler: 'muster_fehler', detail: 'Zeile 2, Spalte 5: x is not a function' } });
  assert.match(t, /^The pattern does not run: Zeile 2, Spalte 5/);
  assert.match(fehlerText({ status: 400, j: { fehler: 'klang_unbekannt', detail: 'sound "x" is not in kit k; the kit has: bd:0-3' } }), /the kit has: bd:0-3/);
  assert.equal(fehlerText({ status: 404, j: { fehler: 'spur_unbekannt' } }), 'That track no longer exists');
});

test('the report after a generated clip says what was written and, in the warning colour, what has no target', () => {
  const m = musterMeldung([{ noten_zahl: 12, takte: 8, loop_beats: 16, huellkurven: ['geraet.cutoff'], ohne_ziel: ['room'], hinweise: [] }]);
  assert.equal(m.text, 'Pattern: 12 notes, 8 bars, loop 16 beats, envelopes geraet.cutoff. Not applied (no target here): room');
  assert.equal(m.fehler, true);
  assert.equal(musterMeldung([{ noten_zahl: 4, takte: 1, loop_beats: null, huellkurven: [], ohne_ziel: [], hinweise: [] }]).fehler, false);
  assert.equal(musterMeldung(undefined), null);
  const gemeldet = [];
  meldeNachSchreiben({ muster: [{ noten_zahl: 1, takte: 1, loop_beats: null, huellkurven: [], ohne_ziel: [], hinweise: [] }] }, (t, f) => gemeldet.push([t, f]));
  assert.deepEqual(gemeldet, [['Pattern: 1 note, 1 bar', false]]);
});

test('OVERWRITE: the command carries ueberschreiben only when the box is ticked', () => {
  assert.equal('ueberschreiben' in musterBefehl(clip, 'note("c3")', '').befehl, false);
  assert.equal(musterBefehl(clip, 'note("c3")', '', true).befehl.ueberschreiben, true);
  assert.equal('ueberschreiben' in musterBefehl(clip, 'note("c3")', '', false).befehl, false);
  assert.match(fehlerText({ status: 409, j: { fehler: 'handarbeit_vorhanden' } }), /tick OVERWRITE/);
});

test('the hints of the PATTERN field survive as HTML attributes: no double quote ends a title early (K1)', () => {
  for (const t of [MUSTER_TEXT.hilfe, MUSTER_TEXT.platzhalter, MUSTER_TEXT.takte_titel, MUSTER_TEXT.erzeugen_titel, MUSTER_TEXT.ueberschreiben_titel]) {
    assert.ok(!/"/.test(attr(t)), attr(t));
    assert.ok(!/</.test(attr(t)), attr(t));
  }
  assert.equal(attr('s("bd") <x>&'), 's(&quot;bd&quot;) &lt;x>&amp;');
  // the template the field is built with, parsed back: the title attribute comes out whole
  const html = `<textarea title="${attr(MUSTER_TEXT.hilfe)}" placeholder="${attr(MUSTER_TEXT.platzhalter)}"></textarea>`;
  const attrs = [...html.matchAll(/\s([a-z-]+)="/g)].map((m) => m[1]);
  assert.deepEqual(attrs, ['title', 'placeholder']);
  const titel = /title="([^"]*)"/.exec(html)[1].replace(/&quot;/g, '"');
  assert.equal(titel, MUSTER_TEXT.hilfe);
});

test('the pattern report and the core hint are both shown (the core hint no longer hides the fields without a target)', () => {
  const gemeldet = [];
  const muster = [{ noten_zahl: 2, takte: 1, loop_beats: null, huellkurven: [], ohne_ziel: ['cpm'], hinweise: [] }];
  meldeNachSchreiben({ kern: { regler: 'kein_kern' }, muster }, (t, f) => gemeldet.push([t, f]));
  assert.equal(gemeldet.length, 1);
  assert.match(gemeldet[0][0], /Saved; the core is not running/); assert.match(gemeldet[0][0], /Not applied \(no target here\): cpm/);
  assert.equal(gemeldet[0][1], true);
});
