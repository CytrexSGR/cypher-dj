// Paket 1.13 Slice 7: POST /proj/zusammenfuehren als Ablauf (areas/proj/output.ts, zusammenfuehre()) gegen die ECHTE S2-Integration
// (tests/support/output_setup.mjs). Der Render ist das Doppel render_mock.mjs im Modus RENDER_ATTRAPPE_MISCHUNG. Kein Netz, kein Kern, kein Ton.
// Der Null-Test gegen den echten cypherdj-render folgt am Ziel (check/acceptance_w7.mjs, Task 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { aufbau } from './support/output_setup.mjs';
import { warteBis } from './support/proj_context.mjs';
import { alsAntwort, sha256Datei } from '../areas/proj/output.ts';

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
const merge = (a, d, env = {}) => mitUmgebung({ ...MISCHUNG(a), ...env }, () => ruf(() => a.ausgabe.zusammenfuehre(d)));
const spur = (a, id) => a.projekt().spuren.find((s) => s.id === id);
// ein Audio-Clip, dessen Quelle der Katalog nicht kennt (sha b…): an der Sitzung vorbei gesetzt, wird nie dekodiert
const padClip = (a) => a.vorbei([{ befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 0, laenge_beats: 16, sha256: 'b'.repeat(64) }]);
const mergeOrdner = (a) => path.join(a.offen().ordner, 'merge');

test('Merge: ein Render der Menge, Regler-Datei, neue Spur mit dem Render als Quelle, Quellen stumm, EIN Undo, Aufräumen', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  // Fund 1: eine vierte, NICHT gewählte Audio-Spur. Ohne sie lieferte auch `exportSicht` (output.ts:147-151) für den Aufbau [1, 2],
  // und die Gegenprobe in Step 5 bliebe grün.
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6, pan: 0.5 }, { befehl: 'spur_neu', art: 'audio', name: 'Pad' }]);
  await padClip(a);
  const rev0 = a.projekt().rev, spuren0 = structuredClone(a.projekt().spuren);
  const r = await merge(a, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 16 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.rev, rev0 + 1, 'genau eine Projektänderung');
  const aufrufe = renderAufrufe(a);
  assert.equal(aufrufe.length, 1, 'ein Render, nicht je Spur');
  assert.ok(aufrufe[0].argv.includes('--ohne-zustand') && aufrufe[0].argv.includes('--spur-regler'));
  assert.equal(aufrufe[0].argv[aufrufe[0].argv.indexOf('--abgriff') + 1], 'produktion');
  assert.deepEqual([aufrufe[0].regler['spur/1/fader'], aufrufe[0].regler['spur/1/pan'], aufrufe[0].regler['spur/2/mute'], aufrufe[0].regler['spur/3/mute']],
    [-6, 0.5, 0, 1]);
  assert.deepEqual(aufrufe[0].wiedergabe.spuren.map((s) => s.nr), [1, 2],
    'der Snapshot (Protokoll des Doubles) enthält nur die gewählten Spuren, nicht s4 (exportSicht gäbe [1, 2, 4])');
  const p = a.projekt(), neu = p.spuren.find((s) => s.id === r.body.spur_id);
  assert.equal(neu.clips.length, 1);
  assert.equal(neu.clips[0].quelle.sha256, await sha256Datei(r.body.datei), 'sha256 über die ganze Datei');
  assert.equal(neu.clips[0].quelle.pfad_hinweis, r.body.datei);
  assert.ok(r.body.datei.startsWith(mergeOrdner(a) + path.sep));
  const stumm = (id) => p.spuren.find((s) => s.id === id).mute;
  assert.deepEqual([stumm('s1'), stumm('s2'), stumm('s3'), stumm('s4'), stumm(r.body.spur_id)], [true, true, false, false, false],
    'Quellen stumm, s3, s4 und die neue Spur nicht');
  assert.equal(await warteBis(() => spur(a, r.body.spur_id).clips[0].dekodiert === 'fertig', 10000), true, 'der Dekodier-Cache nimmt die WAV an');
  assert.equal(a.protokoll.uebernommen.length, 1, 'ein uebernimm');
  assert.equal(a.protokoll.log.at(-1).typ, 'proj_zusammenfuehren');
  assert.equal(a.protokoll.log.at(-1).regler_quelle, 'projekt', 'der Merge-Render rechnet ohne Kern-Zustand (Fund 9)');
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  assert.ok(!fs.existsSync(a.protokoll.wiedergaben.at(-1).datei), 'die Merge-Wiedergabe ist gelöscht');
  assert.deepEqual(fs.readdirSync(path.dirname(r.body.datei)), [path.basename(r.body.datei)], 'keine .teil, keine Regler-Datei im merge-Ordner');
  // EIN Undo stellt Spurenliste, mute und Clips exakt her
  const u = await a.s.umkehr('undo', { rev: a.projekt().rev }, 'andreas');
  assert.equal(u.code, 200);
  const ohneDekodiert = (liste) => liste.map((s) => ({ ...s, clips: s.clips.map((c) => ({ ...c, dekodiert: undefined })) }));
  assert.deepEqual(ohneDekodiert(a.projekt().spuren), ohneDekodiert(spuren0));
});

test('Merge mit Gruppe: die neue Spur trägt das Ziel der Quellen, die Gruppe steht im Render neutral; am Master kein Ziel', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1', 's2'] }]);
  const gid = a.projekt().gruppen[0].id;
  await a.aendern([{ befehl: 'gruppenspur_aendern', gruppe_id: gid, fader_db: -3 }, { befehl: 'master_aendern', fader_db: -2 }]);
  const r = await merge(a, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 16 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(spur(a, r.body.spur_id).ausgang, { art: 'gruppe', id: gid });
  const regler = renderAufrufe(a)[0].regler;
  assert.deepEqual([regler['grp/1/fader'], regler['grp/1/pan'], regler['grp/1/mute']], [0, 0, 0], 'die Gruppe wirkt später einmal');
  assert.equal('pm/fader' in regler, false, 'der PM-Fader steht auf der Vorgabe');
  // Negativ-Kontrolle: beide Spuren am Master
  const b = await aufbau(t, { tempo: 120 });
  const m = await merge(b, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 16 });
  assert.equal(m.code, 200, JSON.stringify(m.body));
  assert.equal(spur(b, m.body.spur_id).ausgang, undefined, 'am Master: kein Ziel');
});

test('Merge leer (D11): keine Spur spielt im Bereich → merge_leer ohne Render; stiller Render → merge_leer, kein merge/-Ordner, rev gleich', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const rev0 = a.projekt().rev;
  const l = await merge(a, { spur_ids: ['s1', 's2'], von_beat: 100, bis_beat: 104 });
  assert.deepEqual([l.code, l.body.fehler], [409, 'merge_leer']);
  assert.equal(renderAufrufe(a).length, 0, 'kein Render gestartet');
  assert.equal(a.projekt().rev, rev0);
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's1', mute: true }, { befehl: 'spur_aendern', spur_id: 's2', mute: true }], 'stumm');
  const rev1 = a.projekt().rev;
  const s = await merge(a, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4 });
  assert.deepEqual([s.code, s.body.fehler], [409, 'merge_leer']);
  assert.equal(renderAufrufe(a).length, 1, 'der Render lief und war still');
  assert.ok(!fs.existsSync(mergeOrdner(a)), 'kein merge/-Ordner');
  assert.equal(a.projekt().rev, rev1, 'nichts geändert');
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  // Negativ-Kontrolle: derselbe Bereich mit klingenden Quellen läuft durch
  const b = await aufbau(t, { tempo: 120 });
  assert.equal((await merge(b, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4 })).code, 200);
});

test('Merge: audio_fehlt zählt nur die gewählten Spuren (P6)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Pad' }]);
  await padClip(a);
  assert.notEqual(spur(a, 's4').clips[0].dekodiert, 'fertig', 'der Clip auf s4 wird nie dekodiert (kein Katalog-Treffer)');
  const ok = await merge(a, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4 });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  const b = await aufbau(t, { tempo: 120 });
  await b.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Pad' }]);
  await padClip(b);
  const nein = await merge(b, { spur_ids: ['s1', 's4'], von_beat: 0, bis_beat: 4 });
  assert.deepEqual([nein.code, nein.body.fehler], [409, 'audio_fehlt'], 'Negativ-Kontrolle: die Spur mit dem offenen Clip gewählt');
});

test('Merge: Gründe vor dem Render (merge_freeze_noetig, merge_gruppen, merge_teil_solo, export_bereich, argument_ungueltig)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const rev0 = a.projekt().rev;
  const grund = async (d) => { const r = await merge(a, d); return [r.code, r.body.fehler]; };
  assert.deepEqual(await grund({ spur_ids: ['s1', 's3'], von_beat: 8, bis_beat: 16 }), [409, 'merge_freeze_noetig']);
  assert.equal(a.protokoll.wiedergaben.length, 0, 'keine Wiedergabe-Datei geschrieben');
  assert.equal(a.freezes().length, 0, 'nichts eingefroren (D7)');
  await a.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Pad' }, { befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1'] }]);
  assert.deepEqual(await grund({ spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4 }), [409, 'merge_gruppen']);
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', solo: true }]);
  assert.deepEqual(await grund({ spur_ids: ['s2', 's4'], von_beat: 0, bis_beat: 4 }), [409, 'merge_teil_solo']);
  assert.deepEqual(await grund({ spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 0.5 }), [400, 'export_bereich']);
  assert.deepEqual(await grund({ spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 1025 }), [400, 'export_bereich']);
  assert.deepEqual(await grund({ spur_ids: ['s1', 's2'], bis_beat: 4 }), [400, 'argument_ungueltig']);
  assert.deepEqual(await grund({ spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4, extra: 1 }), [400, 'argument_ungueltig']);
  assert.equal(renderAufrufe(a).length, 0, 'in keinem dieser Fälle lief ein Render');
  assert.equal(a.projekt().spuren.length, 4);
  assert.ok(a.projekt().rev > rev0);
  // Negativ-Kontrolle: genau 1 und genau 1024 Beats laufen
  const b = await aufbau(t, { tempo: 120 });
  assert.equal((await merge(b, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 1 })).code, 200);
  const c = await aufbau(t, { tempo: 120 });
  assert.equal((await merge(c, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 1024 })).code, 200);
});

// ---- Task 3: Fehlerfälle, Riegel, Abbruch, Neustart (D10 bis D13). Jede Zeile der Tabelle hat ihre Negativ-Kontrolle. ----------------------------------

const SCHLAF = (ms) => ({ RENDER_ATTRAPPE_SCHLAF_MS: String(ms) });
const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
const arr = (a, status) => { a.zustand.kernStatus = status; a.arrMeldung(); };
const lebende = (a) => { try { return execFileSync('pgrep', ['-f', a.tmp], { encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; } };
// zwei weitere Audio-Spuren s4, s5 mit dekodiertem Kick-Clip (Katalog: sha a…), von der Quelle wählbar
async function mitPaar(a, quelle = 'andreas') {
  await a.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Pad' }, { befehl: 'spur_neu', art: 'audio', name: 'Perc' },
    { befehl: 'clip_neu', spur_id: 's4', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: 'a'.repeat(64) },
    { befehl: 'clip_neu', spur_id: 's5', art: 'audio', start_beat: 0, laenge_beats: 1, sha256: 'a'.repeat(64) }], 'Paar', quelle);
  assert.equal(await warteBis(() => ['s4', 's5'].every((id) => spur(a, id).clips[0].dekodiert === 'fertig'), 10000), true, 'Paar dekodiert');
}
const S12 = { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 4 };
const S45 = { spur_ids: ['s4', 's5'], von_beat: 0, bis_beat: 1 };
const keinRender = (a, bis) => { assert.equal(renderAufrufe(a).length, 0, 'kein Render gestartet'); assert.equal(a.protokoll.wiedergaben.length, 0,
  'keine Wiedergabe'); void bis; };

test('Merge T3-1: Transport läuft beim Start → transport_laeuft (kein Render, rev gleich); Status 0 läuft durch', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const rev0 = a.projekt().rev;
  arr(a, 1);
  const r = await merge(a, S12);
  assert.deepEqual([r.code, r.body.fehler], [409, 'transport_laeuft']);
  keinRender(a); assert.equal(a.projekt().rev, rev0);
  arr(a, 0);
  assert.equal((await merge(a, S12)).code, 200, 'Negativ-Kontrolle: Status 0');
});

test('Merge T3-2: Freeze, Export, Lautheit laufen → beschaeftigt mit der Art im Text; nach dem Ende läuft der Merge', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const neben = async (starte, text) => {
    const lauf = mitUmgebung({ ...MISCHUNG(a), ...SCHLAF(300) }, () => ruf(starte));
    await warte(150);
    const r = await merge(a, S12);
    assert.deepEqual([r.code, r.body.fehler, r.body.text], [409, 'beschaeftigt', text]);
    assert.equal((await lauf).code, 200);
  };
  await neben(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 4 }), 'an export is running');
  await neben(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 }), 'a loudness measurement is running');
  // Freeze: das Kern-Doppel hängt, der Freeze belegt den Lauf, bis der Server schließt
  const b = await aufbau(t, { tempo: 120, kern: { art: 'haengt' } });
  const freeze = ruf(() => b.ausgabe.freeze({ spur_id: 's3', an: true }));
  await warte(150);
  const f = await merge(b, S12);
  assert.deepEqual([f.code, f.body.fehler, f.body.text], [409, 'beschaeftigt', 'a freeze is running']);
  b.ausgabe.schliesse(); await freeze;
  // Negativ-Kontrolle: nach dem Ende der Läufe läuft der Merge
  assert.equal((await merge(a, S12)).code, 200);
});

test('Merge T3-3: zweiter Merge während des ersten → beschaeftigt, der erste endet mit rev+1; danach läuft ein dritter (der Riegel hängt nicht)', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitPaar(a);
  const rev0 = a.projekt().rev;
  const erster = merge(a, S12, SCHLAF(300));
  await warte(150);
  assert.deepEqual(a.s.aktuell().j.ausgabe_lauf, { art: 'merge' });
  const zweiter = await merge(a, S45);
  assert.deepEqual([zweiter.code, zweiter.body.fehler, zweiter.body.text], [409, 'beschaeftigt', 'a merge is running']);
  const e = await erster;
  assert.deepEqual([e.code, e.body.rev], [200, rev0 + 1]);
  const dritter = await merge(a, S45);
  assert.deepEqual([dritter.code, dritter.body.rev], [200, rev0 + 2]);
});

test('Merge T3-4: Surge-Spur mit Noten ohne Freeze → merge_freeze_noetig, nichts eingefroren; mit Freeze läuft sie durch und ist im Snapshot', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const S13 = { spur_ids: ['s1', 's3'], von_beat: 8, bis_beat: 16 };
  const r = await merge(a, S13);
  assert.deepEqual([r.code, r.body.fehler], [409, 'merge_freeze_noetig']);
  assert.equal(a.freezes().length, 0); keinRender(a);
  assert.equal((await a.ausgabe.freeze({ spur_id: 's3', an: true })).rev, a.projekt().rev);
  assert.ok(a.projekt().spuren[2].freeze, 'eingefroren');
  const m = await merge(a, S13);
  assert.equal(m.code, 200, JSON.stringify(m.body));
  assert.ok(renderAufrufe(a).at(-1).wiedergabe.spuren.some((s) => s.nr === 3), 'die eingefrorene Spur ist im Snapshot');
});

test('Merge T3-5: Spuren in zwei Gruppen / Gruppe und Master → merge_gruppen, rev gleich; zwei Spuren derselben Gruppe laufen durch', async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitPaar(a);
  await a.aendern([{ befehl: 'gruppenspur_neu', name: 'G', mitglieder: ['s1', 's2'] }, { befehl: 'gruppenspur_neu', name: 'H', mitglieder: ['s4'] }]);
  const rev0 = a.projekt().rev;
  for (const ids of [['s1', 's4'], ['s2', 's5']]) {
    const r = await merge(a, { ...S12, spur_ids: ids });
    assert.deepEqual([r.code, r.body.fehler], [409, 'merge_gruppen'], ids.join());
  }
  keinRender(a); assert.equal(a.projekt().rev, rev0);
  assert.equal((await merge(a, S12)).code, 200, 'Negativ-Kontrolle: s1 und s2 sind in G');
});

test('Merge T3-6: Cypher auf einer Spur von Andreas → merge_andreas_spur; auf eigenen Spuren läuft er (Verlaufseintrag quelle cypher, AK28)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await mitPaar(a, 'cypher');
  a.zustand.quelle = 'cypher';
  const nein = await merge(a, S12);
  assert.deepEqual([nein.code, nein.body.fehler], [409, 'merge_andreas_spur']);
  keinRender(a);
  const ja = await merge(a, S45);
  assert.equal(ja.code, 200, JSON.stringify(ja.body));
  assert.equal(a.protokoll.uebernommen.at(-1).quelle, 'cypher');
  assert.equal(spur(a, ja.body.spur_id).von, 'cypher');
});

test('Merge T3-7: Stop Cypher beim Start → ki_gestoppt; Stop Cypher mit Quelle Andreas läuft', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  a.zustand.ki = true; a.zustand.quelle = 'cypher';
  const r = await merge(a, S12);
  assert.deepEqual([r.code, r.body.fehler], [409, 'ki_gestoppt']);
  keinRender(a);
  a.zustand.quelle = 'andreas';
  assert.equal((await merge(a, S12)).code, 200, 'Negativ-Kontrolle: Stop Cypher sperrt Andreas nicht');
});

test('Merge T3-8: Stop Cypher MITTEN im Render → ki_gestoppt, WAV und merge/ weg, rev gleich; mit Quelle Andreas endet derselbe Aufbau mit rev+1',
  async (t) => {
  const a = await aufbau(t, { tempo: 120 }); await mitPaar(a, 'cypher');
  a.zustand.quelle = 'cypher';
  const rev0 = a.projekt().rev;
  const lauf = merge(a, S45, SCHLAF(300));
  await warte(150); a.zustand.ki = true;
  const r = await lauf;
  assert.deepEqual([r.code, r.body.fehler], [409, 'ki_gestoppt']);
  assert.ok(!fs.existsSync(mergeOrdner(a)), 'merge/ weg'); assert.equal(a.projekt().rev, rev0);
  const b = await aufbau(t, { tempo: 120 }); await mitPaar(b, 'cypher');
  const rev1 = b.projekt().rev;
  const l2 = merge(b, S45, SCHLAF(300));
  await warte(150); b.zustand.ki = true;
  const r2 = await l2;
  assert.deepEqual([r2.code, r2.body.rev], [200, rev1 + 1], 'Negativ-Kontrolle: Quelle Andreas, ki gesetzt');
});

const fuelle = (a, n) => a.vorbei(Array.from({ length: n }, (_, k) => ({ befehl: 'spur_neu', art: 'audio', name: `X${k}` })));

test('Merge T3-9: 32 Spuren belegt → merge_keine_spur_frei beim Start; 31 laufen durch', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await fuelle(a, 29);
  assert.equal(a.projekt().spuren.length, 32);
  const r = await merge(a, S12);
  assert.deepEqual([r.code, r.body.fehler], [409, 'merge_keine_spur_frei']);
  keinRender(a);
  const b = await aufbau(t, { tempo: 120 });
  await fuelle(b, 28);
  assert.equal(b.projekt().spuren.length, 31);
  assert.equal((await merge(b, S12)).code, 200, 'Negativ-Kontrolle: 31 Spuren');
});

test('Merge T3-10: Platz geht im Render verloren → merge_keine_spur_frei, WAV weg; bleibt Platz, läuft der Merge', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await fuelle(a, 27);                                                       // 30 Spuren
  const lauf = merge(a, S12, SCHLAF(300));
  await warte(150); await fuelle(a, 2);                                       // 32
  const r = await lauf;
  assert.deepEqual([r.code, r.body.fehler], [409, 'merge_keine_spur_frei']);
  assert.ok(!fs.existsSync(mergeOrdner(a)), 'WAV weg');
  const b = await aufbau(t, { tempo: 120 });
  await fuelle(b, 27);
  const l2 = merge(b, S12, SCHLAF(300));
  await warte(150); await fuelle(b, 1);                                       // 31
  assert.equal((await l2).code, 200, 'Negativ-Kontrolle: bleibt Platz');
});

test('Merge T3-11 und 20: Quelle ändert sich im Render (Fader, Clip, Tempo, Solo) → veraltet, WAV weg; eine fremde Spur ändern stört nicht', async (t) => {
  const aenderungen = [
    ['Fader', [{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -3 }]],
    ['Clip', [{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 1 }]],
    ['Tempo', [{ befehl: 'tempo_setzen', bpm: 100 }]],
    ['Solo', [{ befehl: 'spur_aendern', spur_id: 's1', solo: true }]],
  ];
  for (const [name, befehle] of aenderungen) {
    const a = await aufbau(t, { tempo: 120 });
    const lauf = merge(a, S12, SCHLAF(300));
    await warte(150); await a.vorbei(befehle, name);
    const stand = a.projekt().rev;
    const r = await lauf;
    assert.deepEqual([r.code, r.body.fehler], [409, 'veraltet'], name);
    assert.ok(!fs.existsSync(mergeOrdner(a)), `${name}: WAV weg`);
    assert.equal(a.projekt().rev, stand, `${name}: rev = Stand der Änderung`);
    assert.ok(a.protokoll.log.every((z) => z.typ !== 'proj_zusammenfuehren'), `${name}: kein Merge-Eintrag`);
  }
  const b = await aufbau(t, { tempo: 120 });
  const l2 = merge(b, S12, SCHLAF(300));
  await warte(150); await b.vorbei([{ befehl: 'spur_aendern', spur_id: 's3', fader_db: -3 }, { befehl: 'spur_aendern', spur_id: 's3', solo: false }]);
  assert.equal((await l2).code, 200, 'Negativ-Kontrolle: s3 ist nicht gewählt');
});

test('Merge T3-12: Projekt wird im Render geschlossen → kein_projekt, WAV und merge/ weg; ohne Schließen rev+1', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const rev0 = a.projekt().rev;
  const lauf = merge(a, S12, SCHLAF(300));
  await warte(150); a.zustand.zu = true;
  const r = await lauf; a.zustand.zu = false;
  assert.deepEqual([r.code, r.body.fehler], [409, 'kein_projekt']);
  assert.ok(!fs.existsSync(mergeOrdner(a))); assert.equal(a.projekt().rev, rev0, 'rev des alten Projekts unberührt');
  const b = await aufbau(t, { tempo: 120 });
  const rev1 = b.projekt().rev;
  assert.equal((await merge(b, S12, SCHLAF(300))).body.rev, rev1 + 1, 'Negativ-Kontrolle');
});

test('Merge T3-13: ein anderes Projekt wird im Render geöffnet (Slug ≠) → veraltet, WAV weg, kein Merge-Eintrag im neuen; bleibt es offen: rev+1',
  async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const alt = a.offen().slug, ordner = a.offen().ordner;
  const lauf = merge(a, S12, SCHLAF(300));
  await warte(150);
  const echt = a.zugang.offen;
  a.zugang.offen = () => { const o = echt(); return o && { ...o, slug: `${o.slug}-anderes` }; };   // das Projekt unter dem Lauf ist ein anderes
  const r = await lauf; a.zugang.offen = echt;
  assert.deepEqual([r.code, r.body.fehler], [409, 'veraltet']);
  assert.ok(!fs.existsSync(path.join(ordner, 'merge')), 'WAV weg'); assert.notEqual(alt, `${alt}-anderes`);
  assert.ok(a.protokoll.log.every((z) => z.typ !== 'proj_zusammenfuehren'));
  const b = await aufbau(t, { tempo: 120 });
  const rev1 = b.projekt().rev;
  assert.equal((await merge(b, S12, SCHLAF(300))).body.rev, rev1 + 1, 'Negativ-Kontrolle: dasselbe Projekt bleibt offen');
});

test('Merge T3-14 bis 16: Render scheitert (RC 4), keine lesbare Antwort, Zeitlimit → 502 render_fehler, nichts bleibt liegen; ohne Störung 200', async (t) => {
  const a = await aufbau(t, { tempo: 120, opt: { zeitlimitMs: 2500 } });
  const rev0 = a.projekt().rev;
  const rc = await merge(a, S12, { RENDER_ATTRAPPE_RC: '4' });
  assert.deepEqual([rc.code, rc.body.fehler], [502, 'render_fehler']);
  assert.match(rc.body.text, /nothing was changed/);
  assert.ok(!fs.existsSync(mergeOrdner(a)), 'kein merge/-Ordner'); assert.equal(a.projekt().rev, rev0);
  const kaputt = await merge(a, S12, { RENDER_ATTRAPPE_AUSGABE: 'kaputt' });
  assert.deepEqual([kaputt.code, kaputt.body.fehler], [502, 'render_fehler']);
  assert.ok(!fs.existsSync(mergeOrdner(a)), '.teil und Regler-Datei weg');
  const zeit = await merge(a, S12, SCHLAF(8000));
  assert.deepEqual([zeit.code, zeit.body.fehler], [502, 'render_fehler']);
  assert.deepEqual(lebende(a), [], 'Gruppe getötet'); assert.ok(!fs.existsSync(mergeOrdner(a)));
  assert.equal(a.projekt().rev, rev0);
  // Negativ-Kontrolle: derselbe Aufbau ohne Störung (mit demselben Zeitlimit und SCHLAF 0)
  const ok = await merge(a, S12, SCHLAF(0));
  assert.deepEqual([ok.code, ok.body.rev], [200, rev0 + 1]);
});

test('Merge T3-17: Serverstopp im Render (D13) → 502 render_fehler, kein Waise-Prozess, Dateien weg; schliesse() ohne Lauf ändert nichts', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const lauf = merge(a, S12, SCHLAF(3000));
  await warte(200); a.ausgabe.schliesse();
  const r = await lauf;
  assert.deepEqual([r.code, r.body.fehler], [502, 'render_fehler']);
  assert.deepEqual(lebende(a), []); assert.ok(!fs.existsSync(mergeOrdner(a)));
  const b = await aufbau(t, { tempo: 120 });
  const rev0 = b.projekt().rev;
  b.ausgabe.schliesse();
  assert.equal(b.projekt().rev, rev0); assert.equal(b.ausgabe.zustand().lauf, null); assert.ok(!fs.existsSync(mergeOrdner(b)));
});

test('Merge T3-18: Kern-Neustart im Render (D13) → der Merge endet trotzdem mit rev+1; ein Freeze im selben Aufbau endet mit freeze_fehler', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const rev0 = a.projekt().rev;
  const lauf = merge(a, S12, SCHLAF(300));
  await warte(150); a.vomKern('/e/neustart', { generation: 2 });
  const r = await lauf;
  assert.deepEqual([r.code, r.body.rev], [200, rev0 + 1]);
  const b = await aufbau(t, { tempo: 120, kern: { art: 'haengt' } });
  const freeze = ruf(() => b.ausgabe.freeze({ spur_id: 's3', an: true }));
  await warte(150); b.vomKern('/e/neustart', { generation: 2 });
  const f = await freeze;
  assert.deepEqual([f.code, f.body.fehler], [502, 'freeze_fehler'], 'der Neustart-Pfad wirkt beim Freeze');
});

test('Merge T3-19: Teil-Solo → merge_teil_solo ohne Render; Solo bei beiden: die neue Spur erbt es; Solo nur außerhalb: kein Solo', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's1', solo: true }]);
  const rev0 = a.projekt().rev;
  const r = await merge(a, S12);
  assert.deepEqual([r.code, r.body.fehler], [409, 'merge_teil_solo']);
  keinRender(a); assert.equal(a.projekt().rev, rev0);
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', solo: true }]);
  const beide = await merge(a, S12);
  assert.equal(beide.code, 200, JSON.stringify(beide.body));
  assert.equal(spur(a, beide.body.spur_id).solo, true);
  const b = await aufbau(t, { tempo: 120 });
  await b.aendern([{ befehl: 'spur_aendern', spur_id: 's3', solo: true }]);
  const aussen = await merge(b, S12);
  assert.equal(aussen.code, 200, JSON.stringify(aussen.body));
  assert.equal(spur(b, aussen.body.spur_id).solo, false);
});

test('Merge T3-21: Transport startet NACH dem Start → der Merge endet mit rev+1 (Grenze D10, wie /proj/export); Start bei Status 1: transport_laeuft',
  async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const rev0 = a.projekt().rev;
  const lauf = merge(a, S12, SCHLAF(300));
  await warte(150); arr(a, 1);
  const r = await lauf;
  assert.deepEqual([r.code, r.body.rev], [200, rev0 + 1]);
  arr(a, 0);
  const b = await aufbau(t, { tempo: 120 });
  const l2 = mitUmgebung({ ...MISCHUNG(b), ...SCHLAF(300) }, () => ruf(() => b.ausgabe.exportiere({ von_beat: 0, bis_beat: 4 })));
  await warte(150); arr(b, 1);
  assert.equal((await l2).code, 200, 'Export: Transport nach dem Start stört nicht');
  arr(b, 1);
  assert.equal((await merge(b, S12)).body.fehler, 'transport_laeuft', 'Negativ-Kontrolle: Start bei Status 1');
});

test('Merge T3-22/23: leerer Bereich / Stille → merge_leer; Bereich genau 1 und genau 1024 Beats laufen, darunter und darüber export_bereich', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  assert.equal((await merge(a, { ...S12, von_beat: 100, bis_beat: 104 })).body.fehler, 'merge_leer');
  for (const [von, bis, code] of [[0, 0.99, 400], [0, 1025, 400], [-1, 4, 400]]) {
    const r = await merge(a, { ...S12, von_beat: von, bis_beat: bis });
    assert.deepEqual([r.code, r.body.fehler], [code, 'export_bereich'], `${von}..${bis}`);
  }
  assert.equal((await merge(a, { ...S12, von_beat: 0, bis_beat: 1 })).code, 200);
  const b = await aufbau(t, { tempo: 120 });
  assert.equal((await merge(b, { ...S12, von_beat: 0, bis_beat: 1024 })).code, 200);
});

test('S2 T5 Merge: muted sources drop only their mute and solo lanes (fader, pan stay), the count is reported, the render keeps all, an unselected track keeps its lanes, Undo restores', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const lane = async (spur, ziel, punkte) => {
    await a.aendern([{ befehl: 'auto_neu', spur_id: spur, ziel }], `lane ${ziel}`);
    const id = a.projekt().spuren.find((s) => s.id === spur).automation.find((l) => l.ziel === ziel).id;
    await a.aendern([{ befehl: 'auto_punkte', lane_id: id, setze: punkte, loesche_von: 0, loesche_bis: 1e6 }], `points ${ziel}`);
    return id;
  };
  await lane('s1', 'mute', [{ beat: 0, wert: 0 }]);
  await lane('s1', 'solo', [{ beat: 0, wert: 1 }]);
  await lane('s1', 'fader', [{ beat: 0, wert: -3 }]);
  await lane('s1', 'pan', [{ beat: 0, wert: 0.25 }]);
  const gesperrt = await lane('s2', 'mute', [{ beat: 0, wert: 0 }]);        // s2: only a locked mute lane
  await a.aendern([{ befehl: 'auto_aendern', lane_id: gesperrt, gesperrt: true }], 'lock');
  await lane('s3', 'mute', [{ beat: 0, wert: 0 }]);
  const spuren0 = structuredClone(a.projekt().spuren);
  const r = await merge(a, { spur_ids: ['s1', 's2'], von_beat: 0, bis_beat: 8 });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.lanes_verworfen, 3, 'mute + solo of s1 and the locked mute of s2');
  const render = renderAufrufe(a)[0].wiedergabe.spuren;
  assert.deepEqual(render.find((s) => s.nr === 1).auto.map((x) => x.ziel), ['mute', 'solo', 'fader', 'pan'], 'the merge render keeps all lanes of the sources');
  assert.deepEqual(spur(a, 's1').automation.map((l) => l.ziel), ['fader', 'pan'], 'fader and pan stay');
  assert.equal('automation' in spur(a, 's2'), false, 'an emptied list loses its key');
  assert.deepEqual(spur(a, 's3').automation, spuren0.find((s) => s.id === 's3').automation, 'negative control: the unselected track keeps its lanes');
  assert.equal('automation' in spur(a, r.body.spur_id), false);
  const u = await a.s.umkehr('undo', { rev: a.projekt().rev }, 'andreas');
  assert.equal(u.code, 200);
  for (const id of ['s1', 's2']) assert.deepEqual(spur(a, id).automation, spuren0.find((s) => s.id === id).automation, `Undo restores ${id}`);
});
