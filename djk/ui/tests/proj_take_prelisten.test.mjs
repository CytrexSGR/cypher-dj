// 1.14 comping, slice 1, task 6: audition of one take per track as session state (spec R8, AK8 to AK10, 9a).
// Session part: ProjSitzung against the test context (kern calls are recorded, nothing is played). Route part: the real server (tests/support/proj_stack.mjs).
// An audition playback is its own file with its own number; only the main playback ever becomes wiedergabe_rev.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjSitzung } from '../areas/proj/session.ts';
import { WiedergabeFehler, wiedergabeDatei } from '../project/playback.ts';
import { aufbau } from './support/output_setup.mjs';
import { pruefKontext, sitzung, arrNr, warteBis, wav } from './support/proj_context.mjs';
import { tmpOrdner } from './support/project.mjs';
import { stapel } from './support/media_library.mjs';
import { ruf, sse, bis, CYPHER } from './support/proj_stack.mjs';

const SHA_M = 'a'.repeat(64), SHA_T = 'b'.repeat(64), SHA_U = 'c'.repeat(64), SHA_D = 'd'.repeat(64);
const schlaf = (ms) => new Promise((r) => setTimeout(r, ms));
const clipJ = (id, sha, von, laenge, hinweis = '') => ({ id, art: 'audio', name: id, start_beat: von, laenge_beats: laenge,
  quelle: { sha256: sha, pfad_hinweis: hinweis }, dekodiert: 'nein', offset_s: 0, gain_db: 0, fade_ein_beats: 0, fade_aus_beats: 0 });
// the session throws ProjFehler (the route makes the answer from it): here as {code, fehler}
const sitz = async (p) => { try { return await p; } catch (e) { if (typeof e?.code !== 'number') throw e; return { code: e.code, fehler: e.fehler }; } };
const f32 = (arr, sha) => { fs.mkdirSync(path.join(arr, 'audio'), { recursive: true }); fs.writeFileSync(path.join(arr, 'audio', `${sha}.f32`), Buffer.alloc(3 * 48000 * 8)); };

// project: s1 (main c1/M, takes t1 = c2/T, t2 = c3/U), s2 (main c4/M, take t3 = c5/T); every sha is decoded (fake f32 files), so every clip plays
async function offen(t, opt = {}) {
  const e = sitzung(t, { arrFristMs: 30, ...opt }, opt.kontext);
  for (const sha of [SHA_M, SHA_T, SHA_U]) f32(e.arr, sha);
  await e.s.neu('V', 'andreas');
  const r = await e.s.aendern({ rev: 0, label: 'Tracks', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'G' }, { befehl: 'spur_neu', art: 'audio', name: 'H' }] }, 'andreas');
  assert.equal(r.code, 200);
  e.slug = e.s.liste().j[0].slug;
  const datei = path.join(e.wurzel, e.slug, 'project.json');
  const j = JSON.parse(fs.readFileSync(datei, 'utf8'));
  j.spuren[0].clips = [clipJ('c1', SHA_M, 0, 4)];
  j.spuren[0].takes = [{ id: 't1', name: 'Take 1', clips: [clipJ('c2', SHA_T, 0, 4)] }, { id: 't2', name: 'Take 2', clips: [clipJ('c3', SHA_U, 0, 4)] }];
  j.spuren[1].clips = [clipJ('c4', SHA_M, 0, 4)];
  j.spuren[1].takes = [{ id: 't3', name: 'Take 3', clips: [clipJ('c5', SHA_T, 0, 4)] }];
  j.naechste_id.clip = 6; j.naechste_id.take = 4;
  fs.writeFileSync(datei, JSON.stringify(j));
  const o = await e.s.oeffnen(e.slug, 'andreas');
  assert.equal(o.code, 200);
  e.k.leere();
  return e;
}
const rev = (e) => e.s.aktuell().j.projekt.rev;
const projekt = (e) => e.s.aktuell().j.projekt;
const vor = (e, spur, take, quelle = 'andreas') => sitz(e.s.vorhoerenSetzen({ spur_id: spur, take_id: take }, quelle));
const aend = (e, befehle, label = 'x') => e.s.aendern({ rev: rev(e), label, befehle }, 'andreas');
const laeden = (e) => e.k.an('/k/arr/laden').map((x) => x.felder.nr);
const datei = (e, nr) => JSON.parse(fs.readFileSync(wiedergabeDatei(e.arr, nr), 'utf8'));
const ids = (w, spurNr = 1) => w.spuren.find((s) => s.nr === spurNr).clips.map((c) => c.id);
const ereignisse = (e) => e.k.verteilt.filter((x) => x.a === 'take_vorhoeren').map((x) => x.f.vorhoeren);
const karte = (e) => e.s.vorhoerenLage().j.vorhoeren;

// --- the request ----------------------------------------------------------------------------------------------------------------------
test('audition on: the map holds spur -> take, exactly one playback is loaded and it carries the take clips; wiedergabe_rev stays the main playback', async (t) => {
  const e = await offen(t);
  const r = await vor(e, 's1', 't1');
  assert.deepEqual([r.code, r.j.vorhoeren], [200, { s1: 't1' }]);
  assert.equal(r.j.kern.wiedergabe.quittung.status, 3, 'the answer carries the core receipt of the load like the other write paths');
  assert.deepEqual(karte(e), { s1: 't1' });
  assert.deepEqual(e.s.aktuell().j.vorhoeren, { s1: 't1' }, '/proj/aktuell carries the map');
  const n = laeden(e);
  assert.equal(n.length, 1, 'one load');
  assert.deepEqual([ids(datei(e, n[0])), ids(datei(e, n[0]), 2)], [['c2'], ['c4']], 'track 1 plays the take, track 2 its main lane');
  const wr = projekt(e).wiedergabe_rev;
  assert.notEqual(wr, n[0], 'the audition playback never becomes wiedergabe_rev');
  assert.deepEqual(ids(datei(e, wr)), ['c1'], 'wiedergabe_rev names the main playback file');
});

test('several tracks at once, one take per track: a second take on the same track replaces the first', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1'); await vor(e, 's2', 't3');
  assert.deepEqual(karte(e), { s1: 't1', s2: 't3' });
  await vor(e, 's1', 't2');
  assert.deepEqual(karte(e), { s1: 't2', s2: 't3' });
  const w = datei(e, laeden(e).at(-1));
  assert.deepEqual([ids(w), ids(w, 2)], [['c3'], ['c5']]);
});

test('audition off (take_id null): the entry goes, the main lane is loaded again; off on an empty map changes nothing (no load, no event)', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1');
  e.k.leere();
  const r = await vor(e, 's1', null);
  assert.deepEqual([r.code, r.j.vorhoeren], [200, {}]);
  assert.equal(laeden(e).length, 1);
  assert.deepEqual(ids(datei(e, laeden(e)[0])), ['c1']);
  assert.deepEqual(ereignisse(e), [{}]);
  e.k.leere();
  assert.equal((await vor(e, 's1', null)).code, 200);
  assert.deepEqual([laeden(e).length, ereignisse(e).length], [0, 0], 'negative control: no change, nothing happens');
});

test('SSE take_vorhoeren: one event per change with the full map, none when nothing changed', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1');
  await vor(e, 's1', 't1');                       // same again: no change
  await vor(e, 's2', 't3');
  await vor(e, 's1', null);
  await vor(e, 's1', null);                       // already off: no change
  assert.deepEqual(ereignisse(e), [{ s1: 't1' }, { s1: 't1', s2: 't3' }, { s2: 't3' }]);
  assert.deepEqual(e.k.verteilt.find((x) => x.a === 'take_vorhoeren'), { a: 'take_vorhoeren', f: { vorhoeren: { s1: 't1' } } });
});

test('reasons: take_unbekannt, spur_unbekannt, kein_projekt, ki_gestoppt (source cypher), aufnahme_laeuft, argument_ungueltig; nothing changes', async (t) => {
  const e = sitzung(t);
  assert.deepEqual(await vor(e, 's1', 't1'), { code: 409, fehler: 'kein_projekt' });
  const o = await offen(t);
  assert.deepEqual(await vor(o, 's1', 't3'), { code: 404, fehler: 'take_unbekannt' }, 'a take of another track is unknown');
  assert.deepEqual(await vor(o, 's1', 't9'), { code: 404, fehler: 'take_unbekannt' });
  assert.deepEqual(await vor(o, 's9', 't1'), { code: 404, fehler: 'spur_unbekannt' });
  assert.deepEqual(await sitz(o.s.vorhoerenSetzen({ spur_id: 5, take_id: 't1' }, 'andreas')), { code: 400, fehler: 'argument_ungueltig' });
  assert.deepEqual(await sitz(o.s.vorhoerenSetzen({ spur_id: 's1', take_id: 7 }, 'andreas')), { code: 400, fehler: 'argument_ungueltig' });
  assert.deepEqual(await sitz(o.s.vorhoerenSetzen({ spur_id: 's1' }, 'andreas')), { code: 400, fehler: 'argument_ungueltig' }, 'take_id must be given (null or an id)');
  o.k.ki = true;
  assert.deepEqual(await vor(o, 's1', 't1', 'cypher'), { code: 409, fehler: 'ki_gestoppt' });
  assert.equal((await vor(o, 's1', 't1', 'andreas')).code, 200, 'negative control: Andreas is not held back by Stop Cypher');
  o.k.ki = false;
  await vor(o, 's1', null);
  o.s.setzeAufnahmeLauf({ art: 'aufnahme' });
  assert.deepEqual(await vor(o, 's1', 't1'), { code: 409, fehler: 'aufnahme_laeuft' });
  assert.deepEqual(karte(o), {});
  o.s.setzeAufnahmeLauf(null);
  assert.equal((await vor(o, 's1', 't1', 'cypher')).code, 200, 'negative control: without a recording Cypher may audition');
});

// --- refusals of the load are never invisible (fix round 1) ---------------------------------------------------------------------------------
const kernLehntAb = (e, an = true) => {
  const regel = e.k.regel;
  e.k.regel = (adr, f) => (an && adr === '/k/arr/laden' ? { status: 6, grund: 'audio_fehlt' } : regel(adr, f));
  return () => { e.k.regel = regel; };
};

test('the core refuses the audition load (status 6): 409 with the core reason and receipt, the map stays as it was, no event', async (t) => {
  const e = await offen(t);
  const frei = kernLehntAb(e);
  const r = await vor(e, 's1', 't1');
  assert.deepEqual([r.code, r.fehler], [409, 'audio_fehlt']);
  assert.deepEqual([karte(e), ereignisse(e)], [{}, []], 'nothing set, nothing announced');
  const fehler = await e.s.vorhoerenSetzen({ spur_id: 's1', take_id: 't1' }, 'andreas').catch((z) => z);
  assert.equal(fehler.extra.kern.wiedergabe.quittung.status, 6, 'the core receipt travels with the reason');
  frei();
  assert.equal((await vor(e, 's1', 't1')).code, 200, 'negative control: the same request without the refusal sets the audition');
  assert.deepEqual(ereignisse(e), [{ s1: 't1' }]);
  // a refused change of an existing audition (other take, then off) keeps the entry that is in force
  const frei2 = kernLehntAb(e);
  assert.equal((await vor(e, 's1', 't2')).code, 409);
  assert.equal((await vor(e, 's1', null)).code, 409);
  assert.deepEqual([karte(e), ereignisse(e).length], [{ s1: 't1' }, 1]);
  frei2();
});

test('the translator refuses the audition lane: 409 with its reason, the map stays, nothing is loaded', async (t) => {
  const e = await offen(t);
  const echt = e.s.uebersetzeFuer.bind(e.s);
  e.s.uebersetzeFuer = (p, nr, v) => { if (v) throw new WiedergabeFehler('zu_gross', 'audition lane too big'); return echt(p, nr, v); };
  const r = await vor(e, 's1', 't1');
  assert.deepEqual([r.code, r.fehler], [409, 'zu_gross']);
  assert.deepEqual([karte(e), ereignisse(e), laeden(e).length], [{}, [], 0]);
  e.s.uebersetzeFuer = echt;
  assert.equal((await vor(e, 's1', 't1')).code, 200, 'negative control');
});

test('a command while auditioning does not fail when the translator refuses the audition lane: the main lane is loaded, the refusal is logged', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1');
  e.k.leere();
  const echt = e.s.uebersetzeFuer.bind(e.s);
  e.s.uebersetzeFuer = (p, nr, v) => { if (v) throw new WiedergabeFehler('zu_gross', 'audition lane too big'); return echt(p, nr, v); };
  const r = await aend(e, [{ befehl: 'comp_waehlen', spur_id: 's1', take_id: 't2', von_beat: 1, bis_beat: 3 }], 'Comp');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(laeden(e), [projekt(e).wiedergabe_rev], 'fallback: the main playback is loaded');
  assert.ok(e.k.protokoll.some((z) => z.typ === 'proj_vorhoeren_wiedergabe_fehler' && z.grund === 'zu_gross'));
  assert.deepEqual(karte(e), { s1: 't1' }, 'the audition stays set');
});

test('under a load lock the audition is set and the answer says the load is deferred; the release loads the audition once', async (t) => {
  const e = await offen(t);
  const frei = e.s.sperreLaden();
  const r = await vor(e, 's1', 't1');
  assert.deepEqual([r.code, r.j.vorhoeren, r.j.kern.wiedergabe], [200, { s1: 't1' }, { nr: null, aufgeschoben: true }]);
  assert.deepEqual([laeden(e).length, ereignisse(e)], [0, [{ s1: 't1' }]]);
  frei();
  assert.ok(await warteBis(() => laeden(e).length === 1, 2000), 'the release loads');
  await schlaf(50);
  assert.deepEqual([laeden(e).length, ids(datei(e, laeden(e)[0]))], [1, ['c2']], 'once, and the audition lane');
});

test('beendeVorhoeren with a second lock holder: the map is emptied, the load waits for the last release', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1');
  e.k.leere();
  const f1 = e.s.sperreLaden(), f2 = e.s.sperreLaden();
  await e.s.beendeVorhoeren();
  assert.deepEqual([karte(e), laeden(e).length, e.s.offen.merk.laden], [{}, 0, true], 'no load while another holder may be freezing');
  f2(); await schlaf(50);
  assert.equal(laeden(e).length, 0, 'one holder left');
  f1();
  assert.ok(await warteBis(() => laeden(e).length === 1, 2000));
  assert.deepEqual(ids(datei(e, laeden(e)[0])), ['c1']);
  // negative control: the single holder (the caller) loads at once
  await vor(e, 's1', 't1'); e.k.leere();
  const f3 = e.s.sperreLaden();
  await e.s.beendeVorhoeren();
  assert.equal(laeden(e).length, 1);
  f3();
});

test('a failing log entry leaves the audition map alone (cleanup of stale entries happens only after the entry is logged)', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1');
  e.k.leere();
  const v = e.s.offen.verlauf, echt = v.haengeAn.bind(v);
  v.haengeAn = () => { throw new Error('log full'); };
  await assert.rejects(aend(e, [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't1' }]), /log full/);
  assert.deepEqual([karte(e), ereignisse(e)], [{ s1: 't1' }, []], 'no event, the entry is still there');
  v.haengeAn = echt;
});

// --- clear rules ----------------------------------------------------------------------------------------------------------------------
test('open, new and re-open of a project end the audition (also when Cypher opens), one event {}', async (t) => {
  for (const quelle of ['andreas', 'cypher']) {
    const e = await offen(t);
    await vor(e, 's1', 't1');
    e.k.leere();
    assert.equal((await e.s.oeffnen(e.slug, quelle)).code, 200);
    assert.deepEqual(karte(e), {}, `open by ${quelle}`);
    assert.deepEqual(e.s.aktuell().j.vorhoeren ?? {}, {});
    assert.deepEqual(ereignisse(e), [{}]);
  }
  const e = await offen(t);
  await vor(e, 's1', 't1');
  assert.equal((await e.s.neu('Anders', 'andreas')).code, 200);
  assert.deepEqual(karte(e), {}, 'a new project');
  const n = laeden(e).at(-1);
  assert.equal(n, projekt(e).wiedergabe_rev, 'the new project loads its main playback');
});

test('take_loeschen of the auditioned take: entry gone, exactly one playback loaded (the main lane); undo of the delete keeps it empty', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1'); await vor(e, 's2', 't3');
  e.k.leere();
  const r = await aend(e, [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't1' }]);
  assert.equal(r.code, 200);
  assert.deepEqual(karte(e), { s2: 't3' });
  assert.equal(laeden(e).length, 1, 'exactly one load');
  const w = datei(e, laeden(e)[0]);
  assert.deepEqual([ids(w), ids(w, 2)], [['c1'], ['c5']], 'track 1 plays its main lane again, track 2 keeps its audition');
  assert.deepEqual(ereignisse(e), [{ s2: 't3' }]);
  e.k.leere();
  const u = await e.s.umkehr('undo', { rev: rev(e) }, 'andreas');
  assert.equal(u.code, 200);
  assert.deepEqual(karte(e), { s2: 't3' }, 'the restored take is not auditioned again');
  assert.deepEqual(ereignisse(e), [], 'no change of the map, no event');
});

test('negative control: take_loeschen of a take that is not auditioned does not touch the audition and loads nothing', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1');
  e.k.leere();
  assert.equal((await aend(e, [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't2' }])).code, 200);
  assert.deepEqual([karte(e), laeden(e).length, ereignisse(e).length], [{ s1: 't1' }, 0, 0]);
});

test('spur_loeschen of an auditioned track: its entry goes with it, one load', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1'); await vor(e, 's2', 't3');
  e.k.leere();
  assert.equal((await aend(e, [{ befehl: 'spur_loeschen', spur_id: 's1' }])).code, 200);
  assert.deepEqual(karte(e), { s2: 't3' });
  assert.equal(laeden(e).length, 1);
  assert.equal(datei(e, laeden(e)[0]).spuren.length, 1);
});

test('undo of the take_neu that made the auditioned take drops the entry (one load); redo of take_loeschen drops it again (one load)', async (t) => {
  const e = await offen(t);
  assert.equal((await aend(e, [{ befehl: 'take_neu', spur_id: 's1' }], 'New take')).code, 200);
  const neu = projekt(e).spuren[0].takes.at(-1).id;
  await vor(e, 's1', neu);
  assert.deepEqual(karte(e), { s1: neu });
  e.k.leere();
  assert.equal((await e.s.umkehr('undo', { rev: rev(e) }, 'andreas')).code, 200);
  assert.deepEqual(karte(e), {}, 'the take is gone, so is the entry');
  assert.equal(laeden(e).length, 1, 'exactly one playback');
  assert.deepEqual(ids(datei(e, laeden(e)[0])), ['c1']);
  assert.deepEqual(ereignisse(e), [{}]);
  e.k.leere();
  assert.equal((await e.s.umkehr('redo', { rev: rev(e) }, 'andreas')).code, 200);
  assert.deepEqual([karte(e), laeden(e).length], [{}, 0], 'redo brings the take back, the map stays empty');
  // redo path of a delete: delete t2, undo, audition t2, redo the delete
  assert.equal((await aend(e, [{ befehl: 'take_loeschen', spur_id: 's1', take_id: 't2' }])).code, 200);
  assert.equal((await e.s.umkehr('undo', { rev: rev(e) }, 'andreas')).code, 200);
  await vor(e, 's1', 't2');
  e.k.leere();
  assert.equal((await e.s.umkehr('redo', { rev: rev(e) }, 'andreas')).code, 200);
  assert.deepEqual(karte(e), {});
  assert.equal(laeden(e).length, 1);
});

test('playback-neutral commands keep the audition and load nothing; comp_waehlen keeps it and reloads once with the audition', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1');
  e.k.leere();
  assert.equal((await aend(e, [{ befehl: 'take_umbenennen', spur_id: 's1', take_id: 't1', name: 'Best' }])).code, 200);
  assert.equal((await aend(e, [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }])).code, 200);
  assert.deepEqual([karte(e), laeden(e).length, ereignisse(e).length], [{ s1: 't1' }, 0, 0]);
  const r = await aend(e, [{ befehl: 'comp_waehlen', spur_id: 's1', take_id: 't2', von_beat: 1, bis_beat: 3 }], 'Comp');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(karte(e), { s1: 't1' });
  assert.equal(laeden(e).length, 1);
  assert.deepEqual(ids(datei(e, laeden(e)[0])), ['c2'], 'the loaded playback is still the audition of take 1');
  const haupt = datei(e, projekt(e).wiedergabe_rev);
  assert.equal(haupt.spuren[0].clips.length, 3, 'wiedergabe_rev holds the new comp: main piece, take piece, main piece');
  assert.deepEqual(haupt.spuren[0].clips.map((c) => c.sha256[0]), ['a', 'c', 'a']);
  assert.notEqual(laeden(e)[0], projekt(e).wiedergabe_rev);
});

// --- restart guard (spec R8, trap 3.9) ---------------------------------------------------------------------------------------------------
test('page-server restart during an audition: the core plays the audition number, not wiedergabe_rev, so the new server loads the main lane', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1');
  const nrVor = laeden(e).at(-1), wr = projekt(e).wiedergabe_rev;
  const opt = { wurzel: e.wurzel, arbeitsordner: e.arr, arrFristMs: 30 };
  const k2 = pruefKontext();
  const s2 = new ProjSitzung(k2, opt); t.after(() => s2.schliesse());
  e.s.schliesse();
  s2.ereignis('/zustand/arr', arrNr(nrVor));
  const o = await s2.oeffnen(e.slug, 'andreas');
  assert.equal(o.code, 200);
  assert.equal(o.j.kern.wiederanlauf, undefined, 'no restart takeover: the core plays something else than the project says');
  const n = k2.an('/k/arr/laden').map((x) => x.felder.nr);
  assert.equal(n.length, 1);
  assert.deepEqual(ids(datei(e, n[0])), ['c1'], 'the loaded playback is the main lane');
  assert.ok(n[0] >= wr, 'a main playback written now, not the audition file');
});

test('negative control: the core plays wiedergabe_rev (no audition): restart takeover, no load', async (t) => {
  const e = await offen(t);
  const wr = projekt(e).wiedergabe_rev;
  const k2 = pruefKontext();
  const s2 = new ProjSitzung(k2, { wurzel: e.wurzel, arbeitsordner: e.arr, arrFristMs: 30 }); t.after(() => s2.schliesse());
  e.s.schliesse();
  s2.ereignis('/zustand/arr', arrNr(wr));
  const o = await s2.oeffnen(e.slug, 'andreas');
  assert.equal(o.j.kern.wiederanlauf, true);
  assert.equal(k2.an('/k/arr/laden').length, 0);
});

test('comp_waehlen during an audition, then a core restart: the loaded playback is wiedergabe_rev, it contains the comp, the map is empty', async (t) => {
  const e = await offen(t);
  e.s.ereignis('/k/willkommen', { generation: 1 });
  await vor(e, 's1', 't1');
  assert.equal((await aend(e, [{ befehl: 'comp_waehlen', spur_id: 's1', take_id: 't2', von_beat: 1, bis_beat: 3 }], 'Comp')).code, 200);
  e.k.leere();
  e.s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => e.k.an('/k/arr/loop').length > 0, 1000), 'the restart handling ran');
  await schlaf(30);
  assert.deepEqual(karte(e), {}, 'a core restart empties the map');
  assert.deepEqual(ereignisse(e), [{}]);
  assert.deepEqual(laeden(e), [projekt(e).wiedergabe_rev], 'one load, the main playback');
  assert.deepEqual(datei(e, laeden(e)[0]).spuren[0].clips.map((c) => c.sha256[0]), ['a', 'c', 'a'], 'the comp is in the loaded playback');
});

test('negative control: a core restart without an audition loads wiedergabe_rev and sends no event', async (t) => {
  const e = await offen(t);
  e.s.ereignis('/k/willkommen', { generation: 1 });
  e.k.leere();
  e.s.ereignis('/e/neustart', { generation: 2 });
  assert.ok(await warteBis(() => e.k.an('/k/arr/loop').length > 0, 1000));
  assert.deepEqual([laeden(e), ereignisse(e).length], [[projekt(e).wiedergabe_rev], 0]);
});

// --- export, loudness and merge never see the audition ---------------------------------------------------------------------------------
test('schreibeWiedergabeFuer (export, loudness, merge, freeze) writes the main lane during an audition', async (t) => {
  const e = await offen(t);
  await vor(e, 's1', 't1');
  const w = e.s.schreibeWiedergabeFuer(projekt(e));
  assert.deepEqual(ids(JSON.parse(fs.readFileSync(w.datei, 'utf8'))), ['c1']);
  assert.deepEqual(karte(e), { s1: 't1' }, 'and it does not touch the audition');
});

// --- decode: a take-only decode reloads when a track auditions that take ------------------------------------------------------------------
test('a take clip that becomes decoded reloads the playback when its take is auditioned; not when another take is (negative control)', async (t) => {
  const tmp = tmpOrdner(t, 'djk-vorh-dek-');
  const lang = path.join(tmp, 'ffmpeg-langsam.sh');
  fs.writeFileSync(lang, '#!/bin/sh\nsleep 0.6\nexec ffmpeg "$@"\n', { mode: 0o755 });
  for (const gewaehlt of ['t2', 't1']) {
    const e = sitzung(t, { arrFristMs: 30, ffmpeg: [lang] });
    for (const sha of [SHA_M, SHA_T]) f32(e.arr, sha);
    const quelle = wav(path.join(tmp, gewaehlt), 'q.wav');
    await e.s.neu('D', 'andreas');
    await e.s.aendern({ rev: 0, label: 'Track', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'G' }] }, 'andreas');
    const dat = path.join(e.wurzel, e.s.liste().j[0].slug, 'project.json');
    const j = JSON.parse(fs.readFileSync(dat, 'utf8'));
    j.spuren[0].clips = [clipJ('c1', SHA_M, 0, 4)];
    j.spuren[0].takes = [{ id: 't1', name: 'Take 1', clips: [clipJ('c2', SHA_T, 0, 4)] }, { id: 't2', name: 'Take 2', clips: [clipJ('c3', SHA_D, 0, 4, quelle)] }];
    j.naechste_id.clip = 4; j.naechste_id.take = 3;
    fs.writeFileSync(dat, JSON.stringify(j));
    await e.s.oeffnen(e.s.liste().j[0].slug, 'andreas');
    assert.equal(projekt(e).spuren[0].takes[1].clips[0].dekodiert, 'laeuft', 'the decode of the take-only sha is running');
    await e.s.vorhoerenSetzen({ spur_id: 's1', take_id: gewaehlt }, 'andreas');
    e.k.leere();
    const fertig = await warteBis(() => projekt(e).spuren[0].takes[1].clips[0].dekodiert === 'fertig', 8000);
    assert.ok(fertig, 'decoded');
    await schlaf(150);
    if (gewaehlt === 't2') {
      assert.equal(laeden(e).length, 1, 'the auditioned take became playable: one reload');
      assert.deepEqual(ids(datei(e, laeden(e)[0])), ['c3']);
    } else assert.equal(laeden(e).length, 0, 'negative control: another take is auditioned, a take-only decode reloads nothing');
  }
});

// --- recording start and freeze end the audition first ---------------------------------------------------------------------------------
test('a recording start ends the audition before the transport: map empty, main lane loaded, event {}', async (t) => {
  const { projBereich } = await import('../areas/proj/area.ts');
  const { aufnahmeBereich } = await import('../areas/proj/recording.ts');
  const k = pruefKontext();
  const roh = k.warteQuittung.bind(k);
  k.warteQuittung = async (id) => {
    const g = k.gesendet.find((x) => x.id === id);
    return g?.adresse === '/k/rec/start' ? { status: 2, grund: '' } : roh(id);
  };
  const d = tmpOrdner(t, 'djk-vorh-rec-');
  const b = projBereich(k, { wurzel: path.join(d, 'projekte'), arbeitsordner: path.join(d, 'arr'), arrFristMs: 30 });
  t.after(() => b.sitzung.schliesse());
  const br = aufnahmeBereich(k, b.zugang, { fristMs: 60 });
  t.after(() => br.aufnahme.schliesse());
  const s = b.sitzung;
  await s.neu('R', 'andreas');
  s.ereignis('/uhr', { beat: 2, bpm: 120 });
  await s.aendern({ rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'G' }] }, 'andreas');
  let p = s.aktuell().j.projekt;
  await s.aendern({ rev: p.rev, label: 'Arm', befehle: [{ befehl: 'spur_aendern', spur_id: 's1', eingang: { art: 'intern', name: 'erz/1' }, arm: true },
    { befehl: 'take_neu', spur_id: 's1' }] }, 'andreas');
  await s.vorhoerenSetzen({ spur_id: 's1', take_id: 't1' }, 'andreas');
  assert.deepEqual(s.vorhoerenLage().j.vorhoeren, { s1: 't1' });
  const geladenVor = k.an('/k/arr/laden').length;
  k.leere();
  const r = await br.aufnahme.start({ von_beat: 0 }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.deepEqual(s.vorhoerenLage().j.vorhoeren, {});
  assert.ok(geladenVor > 0);
  const n = k.an('/k/arr/laden').map((x) => x.felder.nr);
  assert.equal(n.length, 1, 'the main lane is loaded once, while the lock is held');
  assert.equal(n[0], s.aktuell().j.projekt.wiedergabe_rev);
  assert.ok(k.gesendet.findIndex((x) => x.adresse === '/k/arr/laden') < k.gesendet.findIndex((x) => x.adresse === '/k/arr/start'), 'before the transport start');
  assert.deepEqual(k.verteilt.filter((x) => x.a === 'take_vorhoeren').map((x) => x.f.vorhoeren), [{}]);
  p = s.aktuell().j.projekt;
  assert.ok(p.wiedergabe_rev > 0);
});

test('a freeze start ends the audition first: the freeze is not refused as nicht_geladen, the map is empty afterwards', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.s.aendern({ rev: a.projekt().rev, label: 'Take', befehle: [{ befehl: 'take_neu', spur_id: 's1' }] }, 'andreas');
  await a.s.vorhoerenSetzen({ spur_id: 's1', take_id: 't1' }, 'andreas');
  assert.ok(await warteBis(() => a.zustand.kernNr !== a.projekt().wiedergabe_rev && a.zustand.kernNr > 0), 'the core plays the audition number');
  const r = await a.ausgabe.freeze({ spur_id: 's3', an: true });
  assert.ok(r.rev > 0, JSON.stringify(r));
  assert.deepEqual(a.s.vorhoerenLage().j.vorhoeren, {});
  assert.deepEqual(a.protokoll.verteilt.filter((x) => x.a === 'take_vorhoeren').map((x) => x.f.vorhoeren), [{ s1: 't1' }, {}]);
  assert.ok(await warteBis(() => a.zustand.kernNr === a.projekt().wiedergabe_rev && !a.s.ladenGesperrt()), 'the main playback is what the core plays');
});

// --- the route (real server) -------------------------------------------------------------------------------------------------------------
async function stapelMitTakes(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vorh-st-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  await ruf(url, 'POST', '/proj/neu', { name: 'Route' });
  const a = await ruf(url, 'POST', '/proj/aendern', { rev: 0, label: 'Spur', befehle: [{ befehl: 'spur_neu', art: 'audio', name: 'G' }, { befehl: 'take_neu', spur_id: 's1' }] });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  return url;
}

test('route: POST /proj/take_vorhoeren sets and clears, GET and /proj/aktuell carry the map, SSE sends one event per change, Cypher may use it', async (t) => {
  const url = await stapelMitTakes(t);
  const strom = sse(url); t.after(() => strom.zu());
  await schlaf(100);
  const alle = () => strom.ereignisse.filter((x) => x.a === 'take_vorhoeren');
  const r = await ruf(url, 'POST', '/proj/take_vorhoeren', { spur_id: 's1', take_id: 't1' });
  assert.deepEqual([r.code, r.j.vorhoeren], [200, { s1: 't1' }]);
  assert.deepEqual((await ruf(url, 'GET', '/proj/take_vorhoeren')).j, { vorhoeren: { s1: 't1' } });
  assert.deepEqual((await ruf(url, 'GET', '/proj/aktuell')).j.vorhoeren, { s1: 't1' });
  assert.ok(await bis(() => alle().length === 1), 'one event');
  assert.deepEqual(alle()[0].f, { vorhoeren: { s1: 't1' } });
  await ruf(url, 'POST', '/proj/take_vorhoeren', { spur_id: 's1', take_id: 't1' });
  const c = await ruf(url, 'POST', '/proj/take_vorhoeren', { spur_id: 's1', take_id: null }, CYPHER);
  assert.deepEqual([c.code, c.j.vorhoeren], [200, {}], 'source cypher is accepted');
  assert.ok(await bis(() => alle().length === 2));
  await schlaf(200);
  assert.deepEqual(alle().map((x) => x.f.vorhoeren), [{ s1: 't1' }, {}], 'the repeated request sent nothing');
  const u = await ruf(url, 'POST', '/proj/take_vorhoeren', { spur_id: 's1', take_id: 't9' });
  assert.deepEqual([u.code, u.j.fehler, typeof u.j.text], [404, 'take_unbekannt', 'string']);
  assert.deepEqual((await ruf(url, 'GET', '/proj/aktuell')).j.vorhoeren ?? {}, {});
});

test('route: without a project GET answers an empty map and POST answers 409 kein_projekt', async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-vorh-st0-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const { url } = await stapel(t, { proj: { wurzel: path.join(d, 'proj'), arbeitsordner: path.join(d, 'arr') } });
  assert.deepEqual((await ruf(url, 'GET', '/proj/take_vorhoeren')).j, { vorhoeren: {} });
  const r = await ruf(url, 'POST', '/proj/take_vorhoeren', { spur_id: 's1', take_id: 't1' });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_projekt']);
});
