// Package 1.14 slice 4 (bounce, N08), unit U2: POST /proj/bounce as a flow (bereiche/proj/ausgabe.ts bounce()) against the REAL S2 integration
// (tests/hilfen/ausgabe_aufbau.mjs). The render is the double render_attrappe.mjs in mode RENDER_ATTRAPPE_MISCHUNG. No network, no core, no sound.
// The null tests against the real cypherdj-render belong to U5b (pruef/abnahme_b14.mjs).
// Setup of aufbau(): s1 Kick (audio, clip [0,1), decoded), s2 Bass (RB-338, notes [0,16)), s3 Lead (Surge, notes from beat 8).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './hilfen/ausgabe_aufbau.mjs';
import { warteBis } from './hilfen/proj_kontext.mjs';
import { alsAntwort, sha256Datei } from '../bereiche/proj/ausgabe.ts';
import { projektSchluessel } from '../pruef/b14_messen.mjs';
import { BOUNCE_LANE_NAME } from '../projekt/bounce.ts';
import { PAN_MITTE_DB } from '../projekt/zusammenfuehren.ts';

async function ruf(f) {
  try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); }
}
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally {
    for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
};
const protokollDatei = (a) => path.join(a.tmp, 'render.jsonl');
const renderAufrufe = (a) => (fs.existsSync(protokollDatei(a))
  ? fs.readFileSync(protokollDatei(a), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
const MISCHUNG = (a) => ({ RENDER_ATTRAPPE_MISCHUNG: '1', RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) });
const SCHLAF = (ms) => ({ RENDER_ATTRAPPE_SCHLAF_MS: String(ms) });
const bounce = (a, d, env = {}) => mitUmgebung({ ...MISCHUNG(a), ...env }, () => ruf(() => a.ausgabe.bounce(d)));
const spur = (a, id) => a.projekt().spuren.find((s) => s.id === id);
const bounceOrdner = (a) => path.join(a.offen().ordner, 'bounce');
const dateien = (a) => (fs.existsSync(bounceOrdner(a)) ? fs.readdirSync(bounceOrdner(a)) : []);
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const arr = (a, status) => { a.zustand.kernStatus = status; a.arrMeldung(); };

// The undo comparison key (spec B-AK3): projektSchluessel of U5a (pruef/b14_messen.mjs), the canonical project without rev, wiedergabe_rev, every
// dekodiert and the id counters naechste_id and naechste_noten_id (monotonic by design, in no patch: projekt/patch.ts ZAEHLER).
const schluessel = projektSchluessel;

// s4 Pad (audio, empty paste target) and a take lane "Alt" on s1; s1 fader -6, pan 0.5
async function mitZiel(a, quelle = 'andreas') {
  await a.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Pad' }, { befehl: 'take_neu', spur_id: 's1', name: 'Alt' }], 'Ziel', quelle);
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6, pan: 0.5 }], 'Mix', quelle);
}
const AN_ORT = { art: 'an_ort', spur_id: 's1' };
const NEUE = { art: 'neue_spur', spur_ids: ['s1'] };
const EIN = { art: 'einfuegen', spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4, ziel_spur_id: 's4', ziel_beat: 8 };
const ARTEN = [['an_ort', AN_ORT], ['neue_spur', NEUE], ['einfuegen', EIN]];

test('2.2 (a) each art: 200, one undo step, a WAV in bounce/ whose sha256 is the clip sha, run state cleared, render files gone', async (t) => {
  for (const [art, d] of ARTEN) {
    const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
    const rev0 = a.projekt().rev;
    const r = await bounce(a, d);
    assert.equal(r.code, 200, `${art}: ${JSON.stringify(r.body)}`);
    assert.deepEqual([r.body.art, r.body.rev], [art, rev0 + 1], `${art}: exactly one change`);
    assert.equal(a.protokoll.uebernommen.length, 1, `${art}: one uebernimm`);
    const clip = spur(a, r.body.spur_id).clips.find((c) => c.id === r.body.clip_id);
    assert.ok(clip, `${art}: the clip is on the answered track`);
    assert.equal(clip.quelle.sha256, await sha256Datei(r.body.datei), `${art}: sha256 of the whole file`);
    assert.deepEqual([clip.quelle.pfad_hinweis, clip.gain_db], [r.body.datei, PAN_MITTE_DB]);
    assert.ok(r.body.datei.startsWith(bounceOrdner(a) + path.sep) && /bounce-\d+\.wav$/.test(r.body.datei), `${art}: bounce/bounce-<id>.wav`);
    assert.deepEqual(dateien(a), [path.basename(r.body.datei)], `${art}: no .teil, no regler file`);
    assert.ok(!fs.existsSync(a.protokoll.wiedergaben.at(-1).datei), `${art}: the bounce playback is deleted`);
    assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
    assert.equal(a.protokoll.log.at(-1).typ, 'proj_bounce');
    assert.equal(a.protokoll.log.at(-1).regler_quelle, 'projekt', `${art}: rendered without the core's state`);
    assert.equal(a.protokoll.uebernommen[0].label,
      { an_ort: 'Bounce in place Kick', neue_spur: 'Bounce Kick', einfuegen: 'Paste bounced audio to Pad' }[art]);
    assert.equal(await warteBis(() => spur(a, r.body.spur_id).clips.find((c) => c.id === r.body.clip_id)?.dekodiert === 'fertig', 10000), true,
      `${art}: the decode cache takes the WAV`);
  }
});

test('2.2 (b) undo gives the state before, redo the state after (key without rev, dekodiert and id counters); the counters never fall', async (t) => {
  for (const [art, d] of ARTEN) {
    const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
    const vorher = structuredClone(a.projekt());
    const r = await bounce(a, d);
    assert.equal(r.code, 200, `${art}: ${JSON.stringify(r.body)}`);
    const nachher = structuredClone(a.projekt());
    assert.notEqual(schluessel(nachher), schluessel(vorher), `${art}: the bounce changed the key`);
    const u = await a.s.umkehr('undo', { rev: a.projekt().rev }, 'andreas');
    assert.equal(u.code, 200, JSON.stringify(u.j));
    assert.equal(schluessel(a.projekt()), schluessel(vorher), `${art}: undo restores everything`);
    for (const [k, n] of Object.entries(vorher.naechste_id ?? {})) assert.ok(a.projekt().naechste_id[k] >= n, `${art}: naechste_id.${k} never falls`);
    const w = await a.s.umkehr('redo', { rev: a.projekt().rev }, 'andreas');
    assert.equal(w.code, 200, JSON.stringify(w.j));
    assert.equal(schluessel(a.projekt()), schluessel(nachher), `${art}: redo gives the state after`);
  }
});

test('2.2 (c) the render call: --ohne-zustand, --abgriff produktion, regler file of U1b (an_ort pre-mixer at fader 0, neue_spur post-fader)', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
  assert.equal((await bounce(a, AN_ORT)).code, 200);
  const [x] = renderAufrufe(a);
  assert.ok(x.argv.includes('--ohne-zustand') && x.argv.includes('--spur-regler'));
  assert.equal(x.argv[x.argv.indexOf('--abgriff') + 1], 'produktion');
  assert.deepEqual([x.regler['spur/1/fader'], x.regler['spur/1/pan'], x.regler['spur/1/mute'], x.regler['spur/2/mute']], [0, 0, 0, 1]);
  assert.deepEqual(x.wiedergabe.spuren.map((s) => s.nr), [1], 'the snapshot holds only the source');
  const b = await aufbau(t, { tempo: 120 }); await mitZiel(b);
  assert.equal((await bounce(b, NEUE)).code, 200);
  assert.deepEqual([renderAufrufe(b)[0].regler['spur/1/fader'], renderAufrufe(b)[0].regler['spur/1/pan']], [-6, 0.5], 'negative control: post-fader');
});

test('2.2 an_ort result: the lane Before bounce holds the old clips, the answer names it; fader and pan stay', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
  const alt = structuredClone(spur(a, 's1'));
  const r = await bounce(a, AN_ORT);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const s = spur(a, 's1');
  assert.deepEqual(s.takes.map((x) => x.name), ['Alt', BOUNCE_LANE_NAME]);
  assert.equal(r.body.take_id, s.takes[1].id);
  assert.deepEqual(s.takes[1].clips.map((c) => ({ ...c, dekodiert: undefined })), alt.clips.map((c) => ({ ...c, dekodiert: undefined })));
  assert.deepEqual([s.fader_db, s.pan, s.mute, s.clips.length, s.clips[0].start_beat, s.clips[0].laenge_beats], [-6, 0.5, false, 1, 0, 1]);
});

test('2.2 (d) a silent render gives merge_leer: rev unchanged, no bounce/ folder (neue_spur on a muted source); a playing source passes', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's1', mute: true }], 'stumm');
  const rev0 = a.projekt().rev;
  const r = await bounce(a, NEUE);
  assert.deepEqual([r.code, r.body.fehler], [409, 'merge_leer']);
  assert.equal(renderAufrufe(a).length, 1, 'the render ran and was silent');
  assert.ok(!fs.existsSync(bounceOrdner(a)), 'no bounce/ folder');
  assert.equal(a.projekt().rev, rev0);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  const b = await aufbau(t, { tempo: 120 }); await mitZiel(b);
  assert.equal((await bounce(b, NEUE)).code, 200, 'negative control: not muted');
});

test('2.2 (e) a change during the render gives veraltet, nothing saved, the file removed (source, take lanes, paste target); a foreign track does not', async (t) => {
  const faelle = [
    ['an_ort source clip', AN_ORT, [{ befehl: 'clip_aendern', clip_id: 'c1', gain_db: -3 }]],
    ['an_ort take lanes', AN_ORT, [{ befehl: 'take_neu', spur_id: 's1' }]],
    ['neue_spur source fader', NEUE, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -1 }]],
    ['einfuegen target', EIN, [{ befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 9, laenge_beats: 1, sha256: 'a'.repeat(64) }]],
  ];
  for (const [name, d, befehle] of faelle) {
    const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
    const lauf = bounce(a, d, SCHLAF(300));
    await warte(150); await a.vorbei(befehle, name);
    const stand = a.projekt().rev;
    const r = await lauf;
    assert.deepEqual([r.code, r.body.fehler], [409, 'veraltet'], name);
    assert.deepEqual(dateien(a), [], `${name}: file removed`);
    assert.equal(a.projekt().rev, stand, `${name}: nothing saved`);
    assert.ok(a.protokoll.log.every((z) => z.typ !== 'proj_bounce'), name);
  }
  const b = await aufbau(t, { tempo: 120 }); await mitZiel(b);
  const l2 = bounce(b, AN_ORT, SCHLAF(300));
  await warte(150); await b.vorbei([{ befehl: 'spur_aendern', spur_id: 's3', fader_db: -3 }]);
  assert.equal((await l2).code, 200, 'negative control: s3 is not a source');
});

test('2.2 (f) Stop Cypher set during the render gives ki_gestoppt, no file; with source Andreas the same run ends with 200', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Mein' }, { befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 0, laenge_beats: 1,
    sha256: 'a'.repeat(64) }], 'mein', 'cypher');
  assert.equal(await warteBis(() => spur(a, 's4').clips[0].dekodiert === 'fertig', 10000), true);
  a.zustand.quelle = 'cypher';
  const rev0 = a.projekt().rev;
  const lauf = bounce(a, { art: 'an_ort', spur_id: 's4' }, SCHLAF(300));
  await warte(150); a.zustand.ki = true;
  const r = await lauf;
  assert.deepEqual([r.code, r.body.fehler], [409, 'ki_gestoppt']);
  assert.deepEqual(dateien(a), []); assert.equal(a.projekt().rev, rev0);
  a.zustand.ki = false; a.zustand.quelle = 'andreas';
  const l2 = bounce(a, { art: 'an_ort', spur_id: 's4' }, SCHLAF(300));
  await warte(150); a.zustand.ki = true;
  assert.equal((await l2).code, 200, 'negative control: Stop Cypher does not stop Andreas');
});

test('2.2 (g) a running transport gives transport_laeuft, no render; status 0 passes', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
  const rev0 = a.projekt().rev;
  arr(a, 1);
  const r = await bounce(a, AN_ORT);
  assert.deepEqual([r.code, r.body.fehler], [409, 'transport_laeuft']);
  assert.equal(renderAufrufe(a).length, 0); assert.equal(a.projekt().rev, rev0);
  arr(a, 0);
  assert.equal((await bounce(a, AN_ORT)).code, 200);
});

test('2.1 run state: GET /proj/aktuell shows ausgabe_lauf bounce; a second run gives beschaeftigt "a bounce is running", a merge too', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
  const erster = bounce(a, AN_ORT, SCHLAF(300));
  await warte(150);
  assert.deepEqual(a.s.aktuell().j.ausgabe_lauf, { art: 'bounce' });
  const zweiter = await bounce(a, NEUE);
  assert.deepEqual([zweiter.code, zweiter.body.fehler, zweiter.body.text], [409, 'beschaeftigt', 'a bounce is running']);
  const merge = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.zusammenfuehre({ spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4 })));
  assert.deepEqual([merge.code, merge.body.fehler, merge.body.text], [409, 'beschaeftigt', 'a bounce is running']);
  assert.equal((await erster).code, 200);
  assert.equal(await warteBis(() => spur(a, 's1').clips.every((c) => c.dekodiert === 'fertig'), 10000), true, 'the bounced clip is decoded');
  assert.equal((await bounce(a, NEUE)).code, 200, 'negative control: after the end a bounce runs');
});

test('2.2 (h) an audition running on the track is ended before the render', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
  const tid = spur(a, 's1').takes[0].id;
  assert.equal((await a.s.vorhoerenSetzen({ spur_id: 's1', take_id: tid }, 'andreas')).code, 200);
  assert.deepEqual(a.s.vorhoerenLage().j.vorhoeren, { s1: tid });
  const lauf = bounce(a, AN_ORT, SCHLAF(300));
  await warte(150);
  assert.deepEqual(a.s.vorhoerenLage().j.vorhoeren, {}, 'ended while the render runs');
  assert.equal((await lauf).code, 200);
  // negative control: neue_spur leaves an audition alone (it does not replace the main lane)
  const b = await aufbau(t, { tempo: 120 }); await mitZiel(b);
  await b.s.vorhoerenSetzen({ spur_id: 's1', take_id: spur(b, 's1').takes[0].id }, 'andreas');
  assert.equal((await bounce(b, NEUE)).code, 200);
  assert.equal(Object.keys(b.s.vorhoerenLage().j.vorhoeren).length, 1);
});

test('2.2 (i) an audition started DURING the render is ended by the result: no audition, the main playback is loaded', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
  const tid = spur(a, 's1').takes[0].id;
  const lauf = bounce(a, AN_ORT, SCHLAF(300));
  await warte(150);
  assert.equal((await a.s.vorhoerenSetzen({ spur_id: 's1', take_id: tid }, 'andreas')).code, 200);
  assert.deepEqual(a.s.vorhoerenLage().j.vorhoeren, { s1: tid }, 'the audition runs during the render');
  const r = await lauf;
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(a.s.vorhoerenLage().j.vorhoeren, {});
  assert.equal(await warteBis(() => a.zustand.kernNr === a.projekt().wiedergabe_rev, 5000), true, 'the core plays the main playback');
});

test('2.2 guards: plan refusals before the render leave rev and bounce/ untouched', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
  const rev0 = a.projekt().rev;
  const grund = async (d) => { const r = await bounce(a, d); return [r.code, r.body.fehler]; };
  assert.deepEqual(await grund({ art: 'an_ort', spur_id: 's2' }), [409, 'bounce_nur_audio']);
  assert.deepEqual(await grund({ ...EIN, ziel_spur_id: 's2' }), [409, 'bounce_ziel_art']);
  assert.deepEqual(await grund({ art: 'neue_spur', gruppe_id: 'g9' }), [400, 'gruppe_unbekannt']);
  assert.deepEqual(await grund({ art: 'neue_spur', spur_ids: ['s1', 's3'], von_beat: 8, bis_beat: 16 }), [409, 'merge_freeze_noetig']);
  assert.deepEqual(await grund({ art: 'neue_spur', spur_ids: ['s1'], von_beat: 100, bis_beat: 104 }), [409, 'merge_leer'], 'nothing plays there');
  assert.deepEqual(await grund({ art: 'neue_spur', spur_ids: ['s1'], von_beat: 0, bis_beat: 1025 }), [400, 'export_bereich']);
  assert.deepEqual(await grund({ art: 'quer' }), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ ...AN_ORT, extra: 1 }), [400, 'argument_ungueltig']);
  const voll = Array.from({ length: 31 }, () => ({ befehl: 'take_neu', spur_id: 's1' }));
  await a.vorbei(voll, 'voll');
  assert.deepEqual(await grund(AN_ORT), [409, 'takes_voll']);
  assert.equal(renderAufrufe(a).length, 0, 'no render in any of these cases');
  assert.ok(!fs.existsSync(bounceOrdner(a)));
  assert.equal(a.projekt().rev, rev0 + 1, 'only the setup change of the take lanes');
});

test('2.2 audio_fehlt counts only the sources; an undecoded clip on another track does not block', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
  await a.vorbei([{ befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: 'b'.repeat(64) }]);
  assert.equal((await bounce(a, AN_ORT)).code, 200, 'the undecoded clip on s4 is not a source');
  const b = await aufbau(t, { tempo: 120 }); await mitZiel(b);
  await b.vorbei([{ befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 0, laenge_beats: 4, sha256: 'b'.repeat(64) }]);
  const r = await bounce(b, { art: 'an_ort', spur_id: 's4' });
  assert.deepEqual([r.code, r.body.fehler], [409, 'audio_fehlt']);
});

test('2.4 answer fields (R10): exact key sets per art; hinweis quellen_laenger for a neue_spur range shorter than the content', async (t) => {
  const keys = { an_ort: ['art', 'clip_id', 'datei', 'frames', 'projekt', 'quellen', 'rev', 'spur_id', 'take_id'],
    neue_spur: ['art', 'clip_id', 'datei', 'frames', 'lanes_verworfen', 'projekt', 'quellen', 'rev', 'spur_id'],
    einfuegen: ['art', 'clip_id', 'datei', 'frames', 'projekt', 'quellen', 'rev', 'spur_id'] };
  for (const [art, d] of ARTEN) {
    const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
    const r = await bounce(a, d);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body).sort(), keys[art], art);
  }
  const a = await aufbau(t, { tempo: 120 }); await mitZiel(a);
  await a.aendern([{ befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 8, laenge_beats: 1, sha256: 'a'.repeat(64) }], 'zweiter');
  assert.equal(await warteBis(() => spur(a, 's1').clips.every((c) => c.dekodiert === 'fertig'), 10000), true);
  const r = await bounce(a, { ...NEUE, von_beat: 0, bis_beat: 4 });
  assert.deepEqual([r.code, r.body.hinweis], [200, 'quellen_laenger']);
});
