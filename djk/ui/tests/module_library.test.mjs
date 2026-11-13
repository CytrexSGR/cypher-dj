// Plan live-module task 10: the module library. A module saved in the live container and placed into a production project plays the same (the
// playback the translator writes for the group, compared field by field; the offline render with the built core is left to the integration run),
// search by origin, saving any top group, the limits (routing_grenze), live slots and the page module. Never writes outside the test folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { liveAufbau } from './support/live_module.mjs';
import { bibliothekBereich } from '../areas/live/library.ts';
import { listeModule, modulId, speichereModul } from '../project/module_storage.ts';
import os from 'node:os';
import { baueModul, baueNeuePfade, liveSlots } from '../project/live.ts';
import { fuehreListeAus } from '../project/commands.ts';
import { neuesProjekt } from '../project/model.ts';
import { liesModul, setzeModulEin } from '../project/module_storage.ts';
import { uebersetze } from '../project/playback.ts';
import { modulZeilen, bindeModule } from '../public/module_library.js';

const FRAMES = 4 * 24000;
// Live container with one exported module (loop only), the library on the module folder of the test
async function mitModul(t) {
  const z = await liveAufbau(t);
  assert.equal((await z.m.exportiere({ deck: 1 }, 'andreas')).code, 200);
  await z.abbruch('A');
  const bib = bibliothekBereich(z.ctx, z.zugang, { basis: () => z.modulOrdner, jetzt: () => new Date('2026-11-12T10:00:00Z') });
  const g = z.gruppeVon(z.projekt(), 'A');
  const live = structuredClone(z.projekt());
  return { ...z, bib, id: g.modul.id, live, g };
}
const fehl = async (f) => { try { await f(); } catch (e) { return { code: e.code, fehler: e.fehler }; } assert.fail('no refusal'); };
const spielt = (z, p, gid) => {                                                 // what the core would play for the module group: no ids, no paths
  const w = uebersetze(p, { nr: 1, audioOrdner: path.join(z.arbeitsordner, 'audio'), frames: () => FRAMES });
  return JSON.parse(JSON.stringify({ spuren: w.spuren, gruppen: w.gruppen ?? [] }, (k, v) => (k === 'id' || k === 'clip_id' || k === 'datei' ? undefined : v)));
};
const baum = (p, gid) => {                                                      // the tree of a module group as a value without ids and audio paths
  const alle = [p.gruppen.find((g) => g.id === gid)];
  for (let i = 0; i < alle.length; i++) for (const g of p.gruppen) if (g.ausgang?.id === alle[i].id) alle.push(g);
  const ids = alle.map((g) => g.id);
  const tief = (x) => JSON.parse(JSON.stringify(x, (k, v) => (['id', 'nr', 'von', 'pfad_hinweis', 'dekodiert', 'slot'].includes(k) ? undefined : (k === 'ausgang' ? ids.indexOf(v.id) : (k === 'ziel' && String(v).startsWith('blend:') ? 'blend' : v)))));
  return { gruppen: tief(alle), spuren: tief(p.spuren.filter((s) => ids.includes(s.ausgang?.id))) };
};

test('a module saved live and placed into a production project plays the same, as ONE undo step, with its audio copied into the project', async (t) => {
  const z = await mitModul(t);
  const vorher = spielt(z, z.live, z.g.id);
  assert.ok(JSON.stringify(vorher).includes('"warp"') && vorher.gruppen.length === 1, 'the compared playback is not empty');
  await z.s.neu('Production', 'andreas');
  const o0 = z.projekt();
  const a = await z.bib.einsetzen({ modul_id: z.id }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const p = z.projekt();
  assert.equal(p.rev, o0.rev + 1, 'one history step');
  assert.equal(a.j.spuren, 1);
  assert.equal(a.j.slot, undefined, 'no live slot in a production project');
  const g = p.gruppen.find((x) => x.id === a.j.gruppe_id);
  assert.equal(g.modul.titel, 'Song');
  assert.equal(g.modul.slot, undefined);
  assert.deepEqual(liveSlots(p), {});
  assert.deepEqual(baum(p, g.id), baum(z.live, z.g.id), 'same tree: groups, tracks, clips, faders, warp');
  assert.deepEqual(spielt(z, p, g.id), vorher, 'the translator writes the same playback');
  const clip = p.spuren[0].clips[0];
  assert.ok(clip.quelle.pfad_hinweis.startsWith(z.offen().ordner), 'audio lives in the project folder');
  assert.ok(fs.readFileSync(clip.quelle.pfad_hinweis).equals(fs.readFileSync(z.live.spuren[0].clips[0].quelle.pfad_hinweis)), 'the copy equals the loop');
  await z.s.umkehr('undo', { rev: p.rev }, 'andreas');
  assert.equal(z.projekt().gruppen.length, 0);
  assert.equal(z.projekt().spuren.length, 0, 'one undo takes the whole module out');
});

test('placing twice gives new ids and numbers every time; the stems tree (nested groups) keeps its shape', async (t) => {
  const z = await mitModul(t);
  // a module with stem groups: the loop group plus two child groups, built the way the stems step does (baueModul)
  const { baueModul } = await import('../project/live.ts');
  const p0 = z.projekt();
  const loop = p0.spuren[0].clips[0].quelle;
  const mitStems = baueModul(structuredClone(p0), 'B', { sha256: loop.sha256, pfad: loop.pfad_hinweis, beats: 4, frames: FRAMES },
    { drums: { sha256: loop.sha256, pfad: loop.pfad_hinweis }, bass: { sha256: loop.sha256, pfad: loop.pfad_hinweis } },
    { ...(({ id: _i, ...r }) => r)(z.g.modul), von_beat: 9 }, 'andreas');
  const gB = liveSlots(mitStems).B;
  const idB = speichereModul(mitStems, gB, { basis: z.modulOrdner }).id;
  await z.s.neu('Production', 'andreas');
  const e1 = await z.bib.einsetzen({ modul_id: idB }, 'andreas'), e2 = await z.bib.einsetzen({ modul_id: z.id }, 'andreas');
  assert.equal(e1.code, 200); assert.equal(e2.code, 200);
  const p = z.projekt();
  assert.equal(p.gruppen.length, 4);
  assert.equal(new Set(p.gruppen.map((g) => g.id)).size, 4);
  assert.equal(new Set(p.gruppen.map((g) => g.nr)).size, 4);
  assert.equal(p.spuren.length, 4);
  assert.equal(new Set(p.spuren.map((s) => s.id)).size, 4);
  assert.equal(new Set(p.spuren.map((s) => s.nr)).size, 4);
  assert.equal(new Set(p.spuren.flatMap((s) => s.clips.map((c) => c.id))).size, p.spuren.flatMap((s) => s.clips).length);
  assert.deepEqual(baum(p, e1.j.gruppe_id), baum(mitStems, gB), 'the nested tree is the one that was saved');
  assert.equal(p.gruppen.filter((g) => g.ausgang === undefined).length, 2, 'two top groups');
});

test('search by origin: the source title finds all modules of that track; set, date, key, artist and the source sha narrow it', async (t) => {
  const z = await mitModul(t);
  const basis = z.modulOrdner;
  const sicher = (p, f) => { const k = structuredClone(p); const m = k.gruppen.find((x) => x.id === z.g.id).modul; f(m); delete m.id; return speichereModul(k, z.g.id, { basis }).id; };
  const b2 = sicher(z.live, (m) => { m.von_beat = 9; m.set = 'Friday Set'; m.datum = '2019-03-08'; });
  const b3 = sicher(z.live, (m) => { m.von_beat = 17; m.titel = 'Other Track'; m.quelle_sha256 = 'b'.repeat(64); m.tonart = '5A'; m.kuenstler = 'Someone'; });
  const ids = (o) => listeModule({ basis, ...o }).map((e) => e.id).sort();
  assert.deepEqual(ids({ q: 'song' }), [z.id, b2].sort(), 'all modules of the track');
  assert.deepEqual(ids({ q: 'SONG art' }), [z.id, b2].sort(), 'all words, any case, title and artist');
  assert.deepEqual(ids({ q: 'friday' }), [b2]);
  assert.deepEqual(ids({ q: '2019-03-08' }), [b2]);
  assert.deepEqual(ids({ q: '5a' }), [b3]);
  assert.deepEqual(ids({ sha: 'b'.repeat(64) }), [b3]);
  assert.deepEqual(ids({ q: 'song other' }), []);
  assert.equal(ids({}).length, 3);
  const e = listeModule({ basis, q: 'other' })[0];
  assert.deepEqual([e.titel, e.kuenstler, e.tonart, e.stems, e.spuren], ['Other Track', 'Someone', '5A', false, 1]);
  const r = z.bib.liste(new URL('http://x/module?q=friday'));
  assert.deepEqual(r.j.module.map((x) => x.id), [b2]);
  assert.deepEqual(listeModule({ basis: path.join(z.tmp, 'gibt-es-nicht') }), [], 'no library yet: empty');
});

test('placing into a project with too few free tracks or groups is refused routing_grenze and changes nothing', async (t) => {
  const z = await mitModul(t);
  await z.s.neu('Full tracks', 'andreas');
  await z.aendern(Array.from({ length: 32 }, () => ({ befehl: 'spur_neu', art: 'audio' })));
  let rev = z.projekt().rev;
  assert.deepEqual(await fehl(async () => { const a = await z.bib.einsetzen({ modul_id: z.id }, 'andreas'); throw Object.assign(new Error(), { code: a.code, ...a.j }); }),
    { code: 409, fehler: 'routing_grenze' });
  assert.equal(z.projekt().rev, rev);
  await z.s.neu('Full groups', 'andreas');
  await z.aendern(Array.from({ length: 16 }, () => ({ befehl: 'gruppenspur_neu' })));
  rev = z.projekt().rev;
  const a = await z.bib.einsetzen({ modul_id: z.id }, 'andreas').catch((e) => ({ code: e.code, j: { fehler: e.fehler } }));
  assert.deepEqual([a.code, a.j.fehler], [409, 'routing_grenze']);
  assert.equal(z.projekt().rev, rev);
  assert.equal(z.projekt().spuren.length, 0, 'nothing placed');
  const n = z.projekt().spuren.length;
  await z.s.neu('One short', 'andreas');
  await z.aendern(Array.from({ length: 31 }, () => ({ befehl: 'spur_neu', art: 'audio' })));
  assert.equal((await z.bib.einsetzen({ modul_id: z.id }, 'andreas')).code, 200, '31 tracks used: the one track still fits');
  assert.equal(n, 0);
});

test('live container: the module takes the first free slot with its fader closed; both taken is slot_belegt; unknown module and no project are refused', async (t) => {
  const z = await mitModul(t);
  const a = await z.bib.einsetzen({ modul_id: z.id }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.slot, 'B', 'slot A holds the exported module');
  const p = z.projekt();
  assert.equal(p.gruppen.find((g) => g.id === a.j.gruppe_id).fader_db, -200);
  assert.deepEqual(Object.keys(liveSlots(p)).sort(), ['A', 'B']);
  const b = await z.bib.einsetzen({ modul_id: z.id }, 'andreas').catch((e) => ({ code: e.code, j: { fehler: e.fehler } }));
  assert.deepEqual([b.code, b.j.fehler], [409, 'slot_belegt']);
  const c = await z.bib.einsetzen({ modul_id: '0123456789abcdef' }, 'andreas').catch((e) => ({ code: e.code, j: { fehler: e.fehler } }));
  assert.deepEqual([c.code, c.j.fehler], [404, 'modul_unbekannt']);
  const d = await z.bib.einsetzen({ modul_id: '../../etc' }, 'andreas').catch((e) => ({ code: e.code, j: { fehler: e.fehler } }));
  assert.deepEqual([d.code, d.j.fehler], [404, 'modul_unbekannt'], 'an id is 16 hex characters, never a path');
});

test('modul_speichern: any top group is saved (minimal origin), a nested group is refused 400, and placing it back gives the same tree', async (t) => {
  const z = await mitModul(t);
  const quelle = z.live.spuren[0].clips[0].quelle;
  await z.s.neu('Production', 'andreas');
  await z.aendern([
    { befehl: 'spur_neu', art: 'audio', name: 'Hook' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'audio', start_beat: 2, laenge_beats: 6, sha256: 'a'.repeat(64), pfad_hinweis: quelle.pfad_hinweis, name: 'hook clip' },
    { befehl: 'spur_aendern', spur_id: 's1', fader_db: -4.5, pan: 0.25 },
    { befehl: 'gruppenspur_neu', name: 'Hooks', mitglieder: ['s1'] },
    { befehl: 'gruppenspur_neu', name: 'Outer', mitglieder: ['g1'] },
  ]);
  const gruppen = z.projekt().gruppen;
  const innen = gruppen.find((g) => g.name === 'Hooks'), aussen = gruppen.find((g) => g.name === 'Outer');
  const n1 = await Promise.resolve().then(() => z.bib.speichern({ gruppe_id: innen.id }, 'andreas')).catch((e) => ({ code: e.code, j: { fehler: e.fehler } }));
  assert.deepEqual([n1.code, n1.j.fehler], [400, 'argument_ungueltig'], 'a group inside a group is no module');
  const n2 = await Promise.resolve().then(() => z.bib.speichern({ gruppe_id: 'g99' }, 'andreas')).catch((e) => ({ code: e.code, j: { fehler: e.fehler } }));
  assert.deepEqual([n2.code, n2.j.fehler], [404, 'gruppe_unbekannt']);
  const s = z.bib.speichern({ gruppe_id: aussen.id }, 'andreas');
  assert.equal(s.code, 200);
  assert.match(s.j.modul_id, /^[0-9a-f]{16}$/);
  const e = listeModule({ basis: z.modulOrdner, q: 'outer' });
  assert.deepEqual([e.length, e[0].titel, e[0].datum, e[0].spuren], [1, 'Outer', '2026-11-12', 1]);
  assert.equal(z.bib.speichern({ gruppe_id: aussen.id }, 'andreas').j.modul_id, s.j.modul_id, 'the same content is the same module');
  const vorBaum = baum(z.projekt(), aussen.id);
  await z.s.neu('Second', 'andreas');
  const a = await z.bib.einsetzen({ modul_id: s.j.modul_id }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const p = z.projekt();
  assert.equal(p.gruppen.length, 2);
  assert.equal(p.gruppen.find((g) => g.id === a.j.gruppe_id).modul, undefined, 'no module origin was invented in a production project');
  assert.deepEqual(baum(p, a.j.gruppe_id), vorBaum, 'saved and placed back: the same tree');
  const o = p.spuren[0];
  assert.deepEqual([o.name, o.fader_db, o.pan, o.clips[0].start_beat, o.clips[0].laenge_beats], ['Hook', -4.5, 0.25, 2, 6]);
  assert.deepEqual(p.gruppen.map((g) => g.name).sort(), ['Hooks', 'Outer']);
});

test('the routes exist: GET /module, POST /modul/einsetzen, POST /modul/speichern', async (t) => {
  const z = await mitModul(t);
  assert.deepEqual(z.bib.routen().map((r) => `${r.methode} ${r.pfad}`), ['GET /module', 'POST /modul/einsetzen', 'POST /modul/speichern']);
  const a = await z.bib.einsetzen({ modul_id: z.id, falsch: 1 }, 'andreas').catch((e) => ({ code: e.code, j: { fehler: e.fehler } }));
  assert.deepEqual([a.code, a.j.fehler], [400, 'argument_unbekannt']);
});

test('page: the MODULES list shows title, artist, key, date, set and a PLACE button; search and PLACE call the routes', async () => {
  const html = modulZeilen([{ id: 'abc', titel: 'Song <1>', kuenstler: 'Art', tonart: '8A', datum: '2026-11-12', set: 'Fri', stems: true }]);
  for (const x of ['Song &lt;1&gt;', 'Art', '8A', '2026-11-12', 'Fri', 'data-modul-setzen="abc"', 'PLACE']) assert.ok(html.includes(x), x);
  assert.ok(modulZeilen([]).includes('No modules saved yet'));
  const el = () => { const e = { innerHTML: '', value: '', ereignisse: {}, addEventListener: (n, f) => { e.ereignisse[n] = f; }, kinder: {}, querySelector: (s) => e.kinder[s] }; return e; };
  const reiter = el(), tabelle = el(), suche = el(), liste = el();
  tabelle.kinder['[data-modul-suche]'] = suche; tabelle.kinder['[data-modul-liste]'] = liste;
  const rufe = [], meldungen = [];
  const ruf = async (m, pfad, body) => { rufe.push([m, pfad, body]); return pfad.startsWith('/module') ? { code: 200, j: { module: [{ id: 'abc', titel: 'T', stems: false }] } } : { code: 200, j: { name: 'A · T' } }; };
  bindeModule({ reiter, tabelle, ruf, melde: (t) => meldungen.push(t) });
  await reiter.ereignisse.click();
  assert.deepEqual(rufe[0], ['GET', '/module', undefined]);
  assert.ok(liste.innerHTML.includes('data-modul-setzen="abc"') && liste.innerHTML.includes('loop only'));
  suche.value = 'song 8a';
  await reiter.ereignisse.click();
  assert.equal(rufe[1][1], '/module?q=song%208a');
  liste.ereignisse.click({ target: { closest: () => ({ dataset: { modulSetzen: 'abc' } }) } });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(rufe[2], ['POST', '/modul/einsetzen', { modul_id: 'abc' }]);
  assert.match(meldungen.at(-1), /Module placed as group A · T/);
});

// Task 8 modules: instrument paths (bk tracks with MIDI clips, fader closed), blend 0.5 on the stem groups, a blend lane
const HASH = 'c'.repeat(64), D = (n) => ({ sha256: n.repeat(64), pfad: `/nicht/da/${n}.wav` });
const NOTEN = [{ beat: 0, laenge: 0.25, ton: 36, vel: 100 }, { beat: 4, laenge: 0.25, ton: 42, vel: 90 }];
const mitPfaden = () => {
  const p0 = neuesProjekt('live'); p0.live = true;
  const herkunft = { quelle_sha256: HASH, titel: 'Song', kuenstler: 'Art', fassung: '1', basis_bpm: 120, von_beat: 4, laenge_beats: 16, bpm: 120, tonart: '8A', datum: '2026-11-12' };
  let p = baueModul(p0, 'A', { ...D('e'), beats: 16, frames: 16 * 24000 }, { drums: D('1'), bass: D('2'), other: D('3') }, herkunft);
  p = baueNeuePfade(p, 'A', { drums: NOTEN, bass: NOTEN });
  const kind = (n) => p.gruppen.find((g) => g.name === n);
  p = fuehreListeAus(p, [{ befehl: 'blend_setzen', gruppe_id: kind('Drums').id, wert: 0.5 },
    { befehl: 'auto_neu', strang_id: kind('Bass').id, ziel: `blend:${kind('Bass').id}`, punkte: [{ beat: 0, wert: 0 }, { beat: 8, wert: 1 }] }]).projekt;
  return p;
};
const kopf = (p) => ({ ...p, rev: 0 });

test('a module with instrument paths, blend 0.5 and a blend lane is saved and placed: same tree, same playback, lanes and blend target on the new ids', async (t) => {
  const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'modul-pfade-'));
  t.after(() => fs.rmSync(basis, { recursive: true, force: true }));
  const live = mitPfaden();
  const top = liveSlots(live).A;
  assert.equal(live.spuren.filter((s) => s.art === 'instrument').length, 2);
  const id = speichereModul(live, top, { basis }).id;
  const prod = neuesProjekt('prod');
  prod.naechste_id = { spur: 7, clip: 40, gruppe: 5, lane: 3 };                   // counters that differ from the live container: nothing may collide
  const r = setzeModulEin(prod, liesModul(id, basis), { modulOrdner: path.join(basis, id), audioZiel: path.join(basis, 'target'), quelle: 'andreas' });
  const p = r.projekt;
  assert.deepEqual(baum(p, r.gruppeId), baum(live, top), 'same tree: bk devices and knobs, MIDI clips, faders, blend, lanes');
  const drums = p.gruppen.find((g) => g.name === 'Drums'), bass = p.gruppen.find((g) => g.name === 'Bass');
  assert.equal(drums.blend, 0.5);
  assert.equal(bass.automation[0].ziel, `blend:${bass.id}`, 'the blend target names the new group');
  assert.ok(!live.gruppen.some((g) => g.id === bass.id), 'new id');
  assert.equal(p.spuren.filter((s) => s.geraet?.name === 'bk').length, 2);
  const mach = (q) => JSON.parse(JSON.stringify(uebersetze(q, { nr: 1, audioOrdner: path.join(basis, 'a'), frames: () => 16 * 24000 }),
    (k, v) => (['id', 'clip_id', 'datei', 'nr'].includes(k) ? undefined : v)));
  const a = mach(live), b = mach(p);
  const nach = (l) => [...l].map((x) => JSON.stringify(x)).sort();   // the saved file lists parents first, the live project children first
  assert.deepEqual({ s: nach(b.spuren), g: nach(b.gruppen) }, { s: nach(a.spuren), g: nach(a.gruppen) }, 'the translator writes the same playback');
  assert.ok(JSON.stringify(a).includes('"noten"'), 'the compared playback holds the MIDI notes');
  assert.equal(kopf(p).live, undefined);
});

test('instrument paths count against MAX_BK_SPUREN: 7 bk tracks in the project and a module with 2 is routing_grenze; host instruments and chain automation stay refused', async (t) => {
  const basis = fs.mkdtempSync(path.join(os.tmpdir(), 'modul-grenze-'));
  t.after(() => fs.rmSync(basis, { recursive: true, force: true }));
  const live = mitPfaden();
  const id = speichereModul(live, liveSlots(live).A, { basis }).id;
  const mod = () => liesModul(id, basis);
  const opt = { modulOrdner: path.join(basis, id), audioZiel: path.join(basis, 'target'), quelle: 'andreas' };
  const voll = fuehreListeAus(neuesProjekt('p'), Array.from({ length: 7 }, () => ({ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'synth-neuro' } }))).projekt;
  const grenze = (f) => { try { f(); } catch (e) { return [e.code, e.fehler]; } return null; };
  assert.deepEqual(grenze(() => setzeModulEin(voll, mod(), opt)), [409, 'routing_grenze']);
  const sechs = fuehreListeAus(neuesProjekt('p'), Array.from({ length: 6 }, () => ({ befehl: 'spur_neu', art: 'instrument', geraet: { art: 'intern', name: 'bk', graph: 'synth-neuro' } }))).projekt;
  assert.equal(grenze(() => setzeModulEin(sechs, mod(), opt)), null, '6 + 2 = 8 fit');
  const wirt = mod(); wirt.spuren[0].art = 'instrument'; wirt.spuren[0].geraet = { art: 'wirt', name: 'surge', slot: 1 };
  assert.deepEqual(grenze(() => setzeModulEin(neuesProjekt('p'), wirt, opt)), [409, 'modul_nicht_einsetzbar']);
  const kette = mod(); kette.gruppen[0].automation = [{ id: 'a1', ziel: 'insert.i1.cutoff', punkte: [{ beat: 0, wert: 0 }] }];
  assert.deepEqual(grenze(() => setzeModulEin(neuesProjekt('p'), kette, opt)), [409, 'modul_nicht_einsetzbar']);
});
