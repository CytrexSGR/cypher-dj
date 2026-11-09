// 1.10 slice 7 (T6, spec 5.7, plan D6 to D10): POST /proj/resample as a flow (areas/proj/output.ts, resample()) against the REAL S2 integration with the
// fake core of tests/support/output_setup.mjs (it answers /k/arr/abgriff and /e/abgriff for a prepared .f32), plus the route in the real server.
// Review focus 4: a silent strip, a running transport or freeze and every other refusal write nothing. No sound.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { stapel, post } from './support/media_library.mjs';
import { innen } from './support/inside.mjs';
import { alsAntwort, sha256Datei } from '../areas/proj/output.ts';
import { wavKopf } from '../project/recording.ts';
import { PAN_MITTE_DB } from '../project/merge.ts';

async function ruf(f) {
  try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); }
}
const resample = (a, d) => ruf(() => a.ausgabe.resample(d));
const sauber = { lauf: null, wartend: 0, abbruch: 0 };
const geladen = (a) => warteBis(() => a.zustand.kernNr === a.projekt().wiedergabe_rev && !a.s.ladenGesperrt());
const ordner = (a) => path.join(a.offen().ordner, 'resample');
const dateien = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);
const tapDateien = (a) => dateien(a.arbeitsordner).filter((f) => f.startsWith('abgriff-'));
const namen = (a) => a.projekt().spuren.map((s) => s.name);
const eintraege = (a) => a.s.verlaufListe().j.length;
// the state a refused resample must leave behind: nothing sent or written, nothing saved, no lock, no run
async function nichtsGeschrieben(a, vorher, wie = '') {
  const jetzt = { rev: a.projekt().rev, namen: namen(a), eintraege: eintraege(a) };
  assert.deepEqual(jetzt, vorher, `${wie}: project and history unchanged`);
  assert.deepEqual(dateien(ordner(a)), [], `${wie}: no resample file`);
  assert.deepEqual(tapDateien(a), [], `${wie}: no tap file left over`);
  assert.equal(a.s.ladenGesperrt(), false, `${wie}: lock released`);
  assert.deepEqual(a.ausgabe.zustand(), sauber, `${wie}: no run left`);
}
const vorher = (a) => ({ rev: a.projekt().rev, namen: namen(a), eintraege: eintraege(a) });
const gesendet = (a) => a.abgriffe().length;

test('Resample of a track: tap of the track post with the range and a counter id, ONE entry "Resample <name>", new track below the source, clip with the WAV sha, undo keeps the WAV', async (t) => {
  const a = await aufbau(t, { tempo: 120, abgriff: { art: 'ok', ms: 150 } });
  const rev0 = a.projekt().rev, n0 = eintraege(a), quelle0 = structuredClone(a.projekt().spuren.find((s) => s.id === 's2'));
  const lauf = ruf(() => a.ausgabe.resample({ strang_id: 's2', von_beat: 0, bis_beat: 8 }));
  assert.ok(await warteBis(() => a.s.aktuell().j.ausgabe_lauf?.art === 'resample'), 'the run shows in GET /proj/aktuell');
  assert.deepEqual(a.s.aktuell().j.ausgabe_lauf, { art: 'resample', strang_id: 's2' });
  const r = await lauf;
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const kennung = a.abgriffe()[0].felder.kennung;
  assert.deepEqual(a.abgriffe().map((x) => x.felder), [{ quelle: 'andreas', art: 0, nr: 2, punkt: 1, von_beat: 0, bis_beat: 8, kennung }]);
  assert.ok(Number.isInteger(kennung) && kennung > 0, 'id from the one counter of the instance');
  assert.deepEqual(namen(a), ['Kick', 'Bass', 'Bass (resampled)', 'Lead'], 'below the source');
  const neu = a.projekt().spuren[2];
  assert.equal(neu.ausgang, undefined, 'output master');
  assert.equal(neu.clips.length, 1);
  const wav = path.join(ordner(a), `resample-${kennung}.wav`);
  assert.deepEqual([neu.clips[0].start_beat, neu.clips[0].laenge_beats, neu.clips[0].gain_db, neu.clips[0].quelle.sha256],
    [0, 8, PAN_MITTE_DB, await sha256Datei(wav)]);
  assert.equal(neu.clips[0].quelle.pfad_hinweis, wav);
  assert.deepEqual([r.body.rev, r.body.spur_id, r.body.clip_id, r.body.datei, r.body.frames, r.body.quelle, r.body.punkt, r.body.von_beat, r.body.bis_beat],
    [rev0 + 1, neu.id, neu.clips[0].id, wav, 192000, 's2', 'post', 0, 8]);
  assert.equal(fs.statSync(wav).size, wavKopf(192000).length + 192000 * 8, 'WAV: header plus 192000 frames');
  assert.deepEqual(a.projekt().spuren.find((s) => s.id === 's2'), quelle0, 'the source is unchanged');
  assert.deepEqual(tapDateien(a), [], 'the tap file is only the way to the WAV');
  assert.equal(eintraege(a), n0 + 1, 'exactly ONE history entry');
  const e = a.s.verlaufListe().j.at(-1);
  assert.deepEqual([e.rev, e.quelle, e.label, e.art], [rev0 + 1, 'andreas', 'Resample Bass', 'aendern']);
  assert.deepEqual(a.protokoll.reihenfolge.slice(0, 4), ['sperre', 'tempo', 'uebernimm', 'frei']);
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  assert.ok(await geladen(a));
  const u = await a.s.umkehr('undo', { rev: a.projekt().rev }, 'andreas');
  assert.equal(u.code, 200, JSON.stringify(u.j));
  assert.deepEqual(namen(a), ['Kick', 'Bass', 'Lead'], 'undo removes track and clip');
  assert.ok(fs.existsSync(wav), 'the WAV stays after undo (D1 policy)');
});

test('Resample of a group, a return and the master: tap kinds 1, 2 and 3, point pre, the default range, the new track at the end', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'gruppenspur_neu', name: 'Drums', mitglieder: ['s1', 's2'] }, { befehl: 'return_neu', name: 'Hall' }]);
  await geladen(a);
  const g = await resample(a, { strang_id: 'g1' });
  assert.equal(g.code, 200, JSON.stringify(g.body));
  assert.deepEqual(a.abgriffe().at(-1).felder, { quelle: 'andreas', art: 1, nr: 1, punkt: 1, von_beat: 0, bis_beat: 16, kennung: a.abgriffe().at(-1).felder.kennung });
  assert.equal(namen(a).at(-1), 'Drums (resampled)', 'at the end');
  assert.equal(a.projekt().spuren.at(-1).clips[0].laenge_beats, 16, 'the loop bracket is the default range');
  await geladen(a);
  const r = await resample(a, { strang_id: 'r1', punkt: 'pre', von_beat: 4, bis_beat: 12 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([a.abgriffe().at(-1).felder.art, a.abgriffe().at(-1).felder.nr, a.abgriffe().at(-1).felder.punkt], [2, 1, 0]);
  assert.deepEqual([namen(a).at(-1), a.projekt().spuren.at(-1).clips[0].start_beat, r.body.punkt], ['Hall (resampled)', 4, 'pre']);
  await geladen(a);
  const m = await resample(a, { strang_id: 'master', von_beat: 0, bis_beat: 4 });
  assert.equal(m.code, 200, JSON.stringify(m.body));
  assert.deepEqual([a.abgriffe().at(-1).felder.art, a.abgriffe().at(-1).felder.nr], [3, 1]);
  assert.deepEqual([namen(a).at(-1), m.body.quelle], ['Master (resampled)', 'master']);
  assert.deepEqual(a.s.verlaufListe().j.slice(-3).map((x) => x.label), ['Resample Drums', 'Resample Hall', 'Resample Master']);
});

test('Resample refusals before the core: nothing is sent or written (transport, a running freeze, range, strip, arguments, 32 tracks, Stop Cypher)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const v = vorher(a);
  const grund = async (d, wie) => { const r = await resample(a, d); await nichtsGeschrieben(a, v, wie); assert.equal(gesendet(a), 0, `${wie}: nothing sent`); return [r.code, r.body.fehler]; };
  assert.deepEqual(await grund({ strang_id: 's2', von_beat: 0, bis_beat: 257 }, '257 beats'), [400, 'zu_gross']);
  assert.deepEqual(await grund({ strang_id: 's9' }, 'unknown'), [400, 'spur_unbekannt']);
  assert.deepEqual(await grund({}, 'no strip'), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ strang_id: 's2', punkt: 'mitte' }, 'point'), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ strang_id: 's2', von_beat: 0, bis_beat: 0.5 }, 'short'), [400, 'export_bereich']);
  a.zustand.kernStatus = 2; a.arrMeldung();
  assert.deepEqual(await grund({ strang_id: 's2' }, 'transport'), [409, 'transport_laeuft']);
  a.zustand.kernStatus = 0; a.arrMeldung();
  a.zustand.quelle = 'cypher'; a.zustand.ki = true;
  assert.deepEqual(await grund({ strang_id: 's2' }, 'Stop Cypher'), [409, 'ki_gestoppt']);
  a.zustand.quelle = 'andreas';
  a.zustand.zu = true;
  assert.deepEqual(await grund({ strang_id: 's2' }, 'no project'), [409, 'kein_projekt']);
  a.zustand.zu = false; a.zustand.ki = false;
  // a running freeze: the resample waits for nothing, it is refused
  a.zustand.kern = { art: 'haengt' };
  const freeze = ruf(() => a.ausgabe.freeze({ spur_id: 's3', an: true }));
  assert.ok(await warteBis(() => a.ausgabe.zustand().lauf?.art === 'freeze'));
  const rf = await resample(a, { strang_id: 's2' });
  assert.deepEqual([rf.code, rf.body.fehler, rf.body.text], [409, 'beschaeftigt', 'a freeze is running']);
  assert.equal(gesendet(a), 0);
  a.ausgabe.schliesse();
  assert.equal((await freeze).code, 502);
});

test('Resample with 32 tracks: merge_keine_spur_frei, nothing written; negative control with 31 passes', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern(Array.from({ length: 28 }, (_, n) => ({ befehl: 'spur_neu', art: 'audio', name: `T${n}` })));
  await geladen(a);
  assert.equal(a.projekt().spuren.length, 31);
  const ok = await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  await geladen(a);
  assert.equal(a.projekt().spuren.length, 32);
  const v = vorher(a), n = gesendet(a);
  const r = await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 });
  assert.deepEqual([r.code, r.body.fehler, gesendet(a)], [409, 'merge_keine_spur_frei', n]);
  assert.deepEqual(vorher(a), v);
});

test('Resample: a silent file is resample_leer, no track, both files removed (review focus 4)', async (t) => {
  const a = await aufbau(t, { tempo: 120, abgriff: { art: 'ok', still: true } });
  const v = vorher(a);
  const r = await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 });
  assert.deepEqual([r.code, r.body.fehler], [409, 'resample_leer']);
  assert.match(r.body.text, /^Bass is silent in beat 0 to 4/);
  assert.equal(gesendet(a), 1, 'the core ran');
  await nichtsGeschrieben(a, v, 'silent');
  // negative control: the same strip with sound
  a.zustand.abgriff = { art: 'ok' };
  assert.equal((await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 })).code, 200);
});

test('Resample: answers of the core (refusals, abort, no file, wrong size, deadline, no receipt, restart) save nothing and leave nothing', async (t) => {
  const faelle = [
    [{ art: 'ablehnen', grund: 'ueberlappung' }, 409, 'transport_laeuft', /stop the transport first/],
    [{ art: 'ablehnen', grund: 'ki_gestoppt' }, 409, 'ki_gestoppt', /^Stop Cypher is set$/],
    [{ art: 'ablehnen', grund: 'nicht_geladen' }, 409, 'nicht_geladen', /has not loaded the current arrangement/],
    [{ art: 'ablehnen', grund: 'tempo_rampe' }, 409, 'beschaeftigt', /ramping the tempo/],
    [{ art: 'ablehnen', grund: 'zu_gross' }, 400, 'zu_gross', /at most 256 beats/],
    [{ art: 'ablehnen', grund: 'spur_bereich' }, 502, 'resample_fehler', /refused the resample \(spur_bereich\)/],
    [{ art: 'abbruch', grund: 'ki_stopp' }, 409, 'ki_gestoppt', /^Stop Cypher is set$/],   // a waiting start is discarded by Stop Cypher
    [{ art: 'abbruch', grund: 'abbruch' }, 502, 'resample_fehler', /aborted the resample \(transport start or stop/],
    [{ art: 'ohne_datei' }, 502, 'resample_fehler', /did not write the tap file/],
    [{ art: 'falsche_groesse' }, 502, 'resample_fehler', /has 191992 bytes, expected 24000 frames/],
    [{ art: 'stumm' }, 502, 'resample_fehler', /no \/e\/abgriff within \d+ ms/],
    [{ art: 'ohne_quittung' }, 409, 'kein_kernstand', /no answer from the core to \/k\/arr\/abgriff/],
    [{ art: 'neustart' }, 502, 'resample_fehler', /core restarted during the resample/],
  ];
  for (const [abgriff, code, fehler, text] of faelle) {
    const a = await aufbau(t, { tempo: 120, abgriff, mitKick: false });
    const v = vorher(a);
    const r = await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 1 });
    const wie = JSON.stringify(abgriff);
    assert.deepEqual([r.code, r.body.fehler], [code, fehler], `${wie}: ${JSON.stringify(r.body)}`);
    assert.match(r.body.text, text, wie);
    assert.match(r.body.text, /^[\x20-\x7e]+$/, `${wie}: English text`);
    await nichtsGeschrieben(a, v, wie);
  }
});

test('Resample: a dead Surge host for a sounding Surge track is wirt_fehlt (not a silent file), nothing sent; other strips pass', async (t) => {
  const a = await aufbau(t, { tempo: 120, mitWirt: false });
  const v = vorher(a);
  const r = await resample(a, { strang_id: 's3', von_beat: 8, bis_beat: 16 });
  assert.deepEqual([r.code, r.body.fehler], [409, 'wirt_fehlt']);
  assert.match(r.body.text, /Surge host for production slot 1 is not running/);
  assert.equal(gesendet(a), 0);
  await nichtsGeschrieben(a, v, 'wirt');
  const master = await resample(a, { strang_id: 'master', von_beat: 0, bis_beat: 16 });
  assert.equal(master.body.fehler, 'wirt_fehlt', 'the master carries the Surge track');
  const dumm = await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 });
  assert.equal(dumm.code, 200, 'negative control: a track without a host needs none');
  await geladen(a);
  const vor = await resample(a, { strang_id: 's3', von_beat: 0, bis_beat: 4 });
  assert.equal(vor.code, 200, 'negative control: no Surge note sounds in beat 0 to 4');
});

test('Resample: tempo or strip changed during the run is veraltet, nothing saved; the freeze lock is released', async (t) => {
  const a = await aufbau(t, { tempo: 120, abgriff: { art: 'ok', ms: 200 } });
  const v = vorher(a);
  const lauf = resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 });
  assert.ok(await warteBis(() => gesendet(a) === 1));
  await a.vorbei([{ befehl: 'tempo_setzen', bpm: 130 }]);
  const r = await lauf;
  assert.deepEqual([r.code, r.body.fehler], [409, 'veraltet']);
  assert.deepEqual(dateien(ordner(a)), []);
  assert.deepEqual(tapDateien(a), []);
  assert.equal(a.projekt().spuren.length, v.namen.length, 'no track');
  assert.equal(a.s.ladenGesperrt(), false);
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  const b = await aufbau(t, { tempo: 120, abgriff: { art: 'ok', ms: 200 } });
  const lauf2 = resample(b, { strang_id: 's1', von_beat: 0, bis_beat: 4 });
  assert.ok(await warteBis(() => gesendet(b) === 1));
  await b.vorbei([{ befehl: 'spur_loeschen', spur_id: 's1' }]);
  assert.equal((await lauf2).body.fehler, 'veraltet', 'the source is gone');
  assert.deepEqual(dateien(ordner(b)), []);
});

test('Resample as cypher with Stop Cypher set after the run: ki_gestoppt, the result is discarded (the WAV removed)', async (t) => {
  const a = await aufbau(t, { tempo: 120, abgriff: { art: 'ok', ms: 150 } });
  a.zustand.quelle = 'cypher';
  const v = vorher(a);
  const lauf = resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 });
  assert.ok(await warteBis(() => gesendet(a) === 1));
  a.zustand.ki = true;
  const r = await lauf;
  assert.deepEqual([r.code, r.body.fehler], [409, 'ki_gestoppt']);
  await nichtsGeschrieben(a, v, 'discarded');
  a.zustand.ki = false;
  const ok = await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 });
  assert.equal(ok.code, 200);
  assert.equal(a.abgriffe().at(-1).felder.quelle, 'cypher');
  assert.equal(a.s.verlaufListe().j.at(-1).quelle, 'cypher');
});

test('POST /proj/resample in the real server: area proj-ausgabe, protection fremdePost, unreadable body 400, kein_projekt, Stop Cypher only for cypher', async (t) => {
  const { o, url } = await stapel(t);
  const i = innen(o);
  const routen = o.routen().filter((r) => r.pfad === '/proj/resample');
  assert.deepEqual(routen.map((r) => [r.bereich, r.methode, r.schutz]), [['proj-ausgabe', 'POST', 'fremdePost']]);
  const n0 = i.gesendet, kopf = { 'content-type': 'application/json' };
  const roh = await fetch(`${url}/proj/resample`, { method: 'POST', body: '{}' });
  assert.deepEqual([roh.status, (await roh.json()).fehler], [415, 'nur_json']);
  const fremd = await fetch(`${url}/proj/resample`, { method: 'POST', headers: { ...kopf, origin: 'https://boese.example' }, body: '{}' });
  assert.deepEqual([fremd.status, (await fremd.json()).fehler], [403, 'fremde_herkunft']);
  const kaputt = await fetch(`${url}/proj/resample`, { method: 'POST', headers: kopf, body: '{"strang_id":' });
  const kj = await kaputt.json();
  assert.deepEqual([kaputt.status, kj.fehler], [400, 'argument_ungueltig']);
  assert.match(kj.text, /^unreadable request body/);
  const ohne = await post(url, '/proj/resample', { strang_id: 's1' });
  assert.deepEqual([ohne.code, ohne.j.fehler, ohne.j.text], [409, 'kein_projekt', 'no project is open']);
  i.vomKern('/e/ki', { gestoppt: 1, grund: 'hand', sample: 0 });
  const ki = await post(url, '/proj/resample', { strang_id: 's1' }, { 'x-djk-quelle': 'cypher' });
  assert.deepEqual([ki.code, ki.j.fehler], [409, 'ki_gestoppt']);
  const hand = await post(url, '/proj/resample', { strang_id: 's1' });
  assert.deepEqual([hand.code, hand.j.fehler], [409, 'kein_projekt'], 'negative control: Stop Cypher does not stop Andreas');
  i.vomKern('/e/ki', { gestoppt: 0, grund: '', sample: 0 });
  assert.equal(i.gesendet, n0, 'nothing sent to the core');
});

// The stand-in of the page (check/proj_mock.mjs, used by the page probes of T7) answers like the server: same keys, same reasons, ausgabe_lauf while it runs.
test('stand-in of the page: POST /proj/resample answers in the shape of the server, refuses with the same reasons, shows ausgabe_lauf while it runs', async (t) => {
  const { starteProjAttrappe } = await import('../check/proj_mock.mjs');
  const http = await import('node:http');
  const oben = http.createServer((q, r) => { r.writeHead(200); r.end('oben'); });
  await new Promise((ok) => oben.listen(0, '127.0.0.1', ok));
  const at = await starteProjAttrappe({ oben: `http://127.0.0.1:${oben.address().port}/`, freezeMs: 300, renderMs: 50 });
  t.after(async () => { await at.stoppe(); oben.closeAllConnections(); oben.close(); });
  const post = async (weg, d) => { const r = await fetch(at.url + weg.slice(1), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) }); return { code: r.status, j: await r.json() }; };
  const aktuell = async () => (await (await fetch(at.url + 'proj/aktuell')).json());
  await post('/proj/neu', { name: 'Erster Track' });
  const befehle = [{ befehl: 'spur_neu', art: 'audio', name: 'Kick' }, { befehl: 'spur_neu', art: 'audio', name: 'Bass' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 0, laenge_beats: 8, sha256: 'a'.repeat(64) }, { befehl: 'loop_setzen', an: true, von_beat: 0, bis_beat: 16 }];
  assert.equal((await post('/proj/aendern', { rev: (await aktuell()).projekt.rev, label: 'Aufbau', befehle })).code, 200);
  const grund = async (d) => { const r = await post('/proj/resample', d); return [r.code, r.j.fehler]; };
  assert.deepEqual(await grund({ strang_id: 's9' }), [400, 'spur_unbekannt']);
  assert.deepEqual(await grund({ strang_id: 's1', von_beat: 0, bis_beat: 257 }), [400, 'zu_gross']);
  assert.deepEqual(await grund({ strang_id: 's1', punkt: 'x' }), [400, 'argument_ungueltig']);
  const lauf = post('/proj/resample', { strang_id: 's2', von_beat: 0, bis_beat: 8 });
  await new Promise((ok) => setTimeout(ok, 100));
  assert.deepEqual((await aktuell()).ausgabe_lauf, { art: 'resample', strang_id: 's2' });
  assert.deepEqual(await grund({ strang_id: 's1' }), [409, 'beschaeftigt']);
  const r = await lauf;
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(Object.keys(r.j).sort(), ['bis_beat', 'clip_id', 'datei', 'frames', 'punkt', 'quelle', 'rev', 'spur_id', 'von_beat']);
  assert.deepEqual([r.j.quelle, r.j.punkt, r.j.frames], ['s2', 'post', 192000]);
  const p = (await aktuell()).projekt;
  assert.deepEqual(p.spuren.map((s) => s.name), ['Kick', 'Bass', 'Bass (resampled)']);
  assert.equal((await aktuell()).ausgabe_lauf, null);
});

// Review focus 4 against the real Ausgabe (fix round 1): the early guards of resample() are pinned by their reason AND by what did NOT happen: no lock,
// no tempo command, no end of the preview, nothing sent to the core. (Mutations: without the early pruefeFrei() a running tap reports core status 3 and the
// answer would be transport_laeuft; without the early transport check the second check in tappe() refuses only after beendeVorhoeren and tempoAnMaster.)
function beobachte(a) {
  const n = { vorhoeren: 0 };
  const orig = a.zugang.beendeVorhoeren;
  a.zugang.beendeVorhoeren = (...x) => { n.vorhoeren += 1; return orig(...x); };
  return n;
}
const nichtsAngefasst = (a, n, wie) => {
  assert.deepEqual(a.protokoll.reihenfolge, [], `${wie}: no lock, no tempo command, no uebernimm`);
  assert.equal(n.vorhoeren, 0, `${wie}: the preview was not ended`);
  assert.equal(gesendet(a), 0, `${wie}: nothing sent to the core`);
};

test('Resample while another resample runs (core reports status 3): beschaeftigt, not transport_laeuft; the second one touches nothing, the first one finishes', async (t) => {
  const a = await aufbau(t, { tempo: 120, abgriff: { art: 'ok', ms: 400 } });
  const erst = resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 });
  assert.ok(await warteBis(() => a.ausgabe.arr?.status === 3 && a.ausgabe.zustand().lauf?.art === 'resample'), 'the tap runs, the core reports status 3');
  a.protokoll.reihenfolge.length = 0;
  const n = beobachte(a), davor = gesendet(a);
  const zweit = await resample(a, { strang_id: 's1', von_beat: 0, bis_beat: 4 });
  assert.deepEqual([zweit.code, zweit.body.fehler, zweit.body.text], [409, 'beschaeftigt', 'a resample is running']);
  assert.deepEqual(a.protokoll.reihenfolge, [], 'no lock, no tempo command');
  assert.deepEqual([n.vorhoeren, gesendet(a)], [0, davor], 'no preview end, no second tap');
  assert.equal((await erst).code, 200, 'the first resample is not disturbed');
  assert.equal(a.projekt().spuren.filter((s) => s.name.endsWith('(resampled)')).length, 1);
});

test('Resample with a running transport: transport_laeuft before anything is touched (no lock, no tempo, no preview end, no tap)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const n = beobachte(a);
  a.zustand.kernStatus = 2; a.arrMeldung();
  const r = await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 });
  assert.deepEqual([r.code, r.body.fehler, r.body.text], [409, 'transport_laeuft', 'stop the transport first']);
  nichtsAngefasst(a, n, 'transport');
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  a.zustand.kernStatus = 0; a.arrMeldung();
  assert.equal((await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 })).code, 200, 'negative control: stopped, it runs');
});

test('Resample while a recording runs: beschaeftigt, nothing sent, no lock, no tempo, no preview end; negative control without the recording', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const n = beobachte(a);
  a.zugang.aufnahmeAktiv = () => true;
  const r = await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 });
  assert.deepEqual([r.code, r.body.fehler, r.body.text], [409, 'beschaeftigt', 'a recording is running; this waits until it is done']);
  nichtsAngefasst(a, n, 'recording');
  assert.deepEqual(a.ausgabe.zustand(), sauber);
  a.zugang.aufnahmeAktiv = () => false;
  assert.equal((await resample(a, { strang_id: 's2', von_beat: 0, bis_beat: 4 })).code, 200);
});
