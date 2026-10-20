// Paket 1.18, E-b, AK-b: POST /proj/lautheit als Ablauf (bereiche/proj/ausgabe.ts, lautheit()) gegen die ECHTE S2-Integration (tests/hilfen/ausgabe_aufbau.mjs).
// Der Render ist das Doppel tests/hilfen/render_attrappe.mjs im Modus RENDER_ATTRAPPE_MISCHUNG: je Spur ein Sinus, dessen Pegel vom Fader in der
// Regler-Datei abhängt. Die Lautheit misst das echte ffmpeg. Kein Netz, kein Kern, kein Ton. Der Lauf mit dem echten cypherdj-render folgt auf einer Prüfinstanz.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aufbau } from './hilfen/ausgabe_aufbau.mjs';
import { alsAntwort, belegteSpuren, reglerEinzeln } from '../bereiche/proj/ausgabe.ts';

async function ruf(f) {
  try { return { code: 200, body: await f() }; } catch (e) { return alsAntwort(e); }
}
const mitUmgebung = async (werte, f) => {
  const alt = {};
  for (const [k, v] of Object.entries(werte)) { alt[k] = process.env[k]; process.env[k] = v; }
  try { return await f(); } finally { for (const [k, v] of Object.entries(alt)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const protokollDatei = (a) => path.join(a.tmp, 'render.jsonl');
const renderAufrufe = (a) => (fs.existsSync(protokollDatei(a)) ? fs.readFileSync(protokollDatei(a), 'utf8').trim().split('\n').map((z) => JSON.parse(z)) : []);
const MISCHUNG = (a) => ({ RENDER_ATTRAPPE_MISCHUNG: '1', RENDER_ATTRAPPE_PROTOKOLL: protokollDatei(a) });
const tmpReste = () => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('djk-lautheit-')).sort();
const nr = (r, n) => r.body.spuren.find((s) => s.nr === n);

test('Lautheit: je belegter Spur ein Render ohne Neustart-Zustand, alle anderen Spuren stumm; Summe aus allen; WAVs und Wiedergabe räumen sich ab', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const vorher = tmpReste();
  const r = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({})));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.von_beat, r.body.bis_beat], [0, 16], 'Vorgabe: die Loop-Klammer');
  assert.deepEqual(r.body.spuren.map((s) => [s.nr, s.name, s.stumm]), [[1, 'Kick', false], [2, 'Bass', false], [3, 'Lead', false]]);
  for (const s of r.body.spuren) {
    assert.ok(s.lufs_i < -10 && s.lufs_i > -30, `spur ${s.nr}: ${s.lufs_i} LUFS`);
    assert.equal(typeof s.lra, 'number'); assert.equal(typeof s.true_peak_dbtp, 'number'); assert.ok(s.spitze_db < 0);
  }
  assert.ok(r.body.summe.lufs_i > nr(r, 1).lufs_i + 2, 'die Summe ist lauter als jede einzelne Spur');
  assert.equal(r.body.summe.regler_quelle, 'projekt');
  // vier Renders (drei Spuren, Summe), alle mit --ohne-zustand; in der Datei der Spur n stehen alle anderen Slots stumm, Solo überall aus
  const aufrufe = renderAufrufe(a);
  assert.equal(aufrufe.length, 4);
  assert.ok(aufrufe.every((x) => x.argv.includes('--ohne-zustand') && x.argv.includes('--spur-regler')));
  const reglerVon = (k) => aufrufe[k].regler;
  assert.deepEqual(Object.entries(reglerVon(0)).filter(([p]) => p.endsWith('/mute')).map(([, v]) => v), [0, 1, 1, 1, 1, 1, 1, 1], 'Spur 1 allein');
  assert.deepEqual(Object.entries(reglerVon(1)).filter(([p]) => p.endsWith('/mute')).map(([, v]) => v), [1, 0, 1, 1, 1, 1, 1, 1], 'Spur 2 allein');
  assert.ok(Object.entries(reglerVon(0)).filter(([p]) => p.endsWith('/solo')).every(([, v]) => v === 0));
  assert.deepEqual(reglerVon(3), { 'spur/1/fader': 0, 'spur/1/pan': 0, 'spur/1/mute': 0, 'spur/1/solo': 0, 'spur/2/fader': 0, 'spur/2/pan': 0, 'spur/2/mute': 0,
    'spur/2/solo': 0, 'spur/3/fader': 0, 'spur/3/pan': 0, 'spur/3/mute': 0, 'spur/3/solo': 0 }, 'die Summe rendert mit den Reglern des Projekts');
  // aufgeräumt: kein temporärer Ordner, keine Export-Wiedergabe, kein Eintrag im Export-Ordner, kein Lauf mehr
  assert.deepEqual(tmpReste(), vorher);
  assert.ok(!fs.existsSync(a.protokoll.wiedergaben.at(-1).datei), 'die Export-Wiedergabe ist gelöscht');
  assert.ok(!fs.existsSync(path.join(a.offen().ordner, 'export')), 'es entsteht keine Export-Datei');
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  assert.equal(a.protokoll.log.at(-1).typ, 'proj_lautheit');
});

test('Lautheit (AK-b): die Summe weicht von proj_export desselben Bereichs um höchstens 0,1 LU ab; der Fader der Spur wird angewandt', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const eins = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 8 })));
  const ex = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 8 })));
  assert.equal(ex.code, 200, JSON.stringify(ex.body));
  assert.ok(Math.abs(eins.body.summe.lufs_i - ex.body.lufs_i) <= 0.1, `Summe ${eins.body.summe.lufs_i} gegen Export ${ex.body.lufs_i}`);
  // Fader der Kick-Spur auf −6 dB: ihre Lautheit sinkt um 6 LU (±0,15), die Bass-Spur bleibt (Negativ-Kontrolle)
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -6 }], 'Fader Kick');
  const zwei = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 8 })));
  assert.equal(zwei.code, 200, JSON.stringify(zwei.body));
  const d = (n) => nr(zwei, n).lufs_i - nr(eins, n).lufs_i;
  assert.ok(Math.abs(d(1) + 6) <= 0.15, `Kick ${d(1)} LU statt −6`);
  assert.ok(Math.abs(d(2)) <= 0.05, `Bass ${d(2)} LU statt 0`);
  assert.ok(zwei.body.summe.lufs_i < eins.body.summe.lufs_i);
});

test('Lautheit (AK-b): eine gemutete Spur meldet null und stumm (nicht −70) und wird nicht gerendert; Spuren ohne Inhalt im Bereich fehlen', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', mute: true }], 'Bass stumm');
  const r = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 })));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.spuren.map((s) => s.nr), [1, 2], 'Lead (ab Beat 8) liegt außerhalb von 0..4');
  assert.deepEqual([nr(r, 2).stumm, nr(r, 2).lufs_i, nr(r, 2).lra, nr(r, 2).true_peak_dbtp], [true, null, null, null]);
  assert.equal(nr(r, 1).stumm, false);
  assert.equal(typeof nr(r, 1).lufs_i, 'number');
  assert.equal(renderAufrufe(a).length, 2, 'Spur 1 und die Summe; die gemutete Spur wird nicht gerendert');
  // Stille aus dem Inhalt: alle Spuren stumm, die Summe meldet null statt −70
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's1', mute: true }], 'Kick stumm');
  const still = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 })));
  assert.deepEqual([still.body.summe.lufs_i, still.body.summe.lra, still.body.summe.true_peak_dbtp, still.body.summe.spitze_db], [null, null, null, -200]);
});

test('Lautheit: Prüfungen wie beim Export (Stop Cypher, Bereich, Argumente, laufender Lauf); der Lauf belegt ausgabe_lauf', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  a.zustand.quelle = 'cypher'; a.zustand.ki = true;
  assert.deepEqual([(await ruf(() => a.ausgabe.lautheit({}))).code, (await ruf(() => a.ausgabe.lautheit({}))).body.fehler], [409, 'ki_gestoppt']);
  a.zustand.ki = false; a.zustand.quelle = 'andreas';
  assert.equal((await ruf(() => a.ausgabe.lautheit({ von_beat: -1, bis_beat: 4 }))).body.fehler, 'export_bereich');
  assert.equal((await ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4000 }))).body.fehler, 'export_bereich');
  assert.equal((await ruf(() => a.ausgabe.lautheit({ spur: 1 }))).body.fehler, 'argument_ungueltig');
  assert.equal((await ruf(() => a.ausgabe.lautheit({ von_beat: 'a' }))).body.fehler, 'argument_ungueltig');
  const lauf = mitUmgebung({ ...MISCHUNG(a), RENDER_ATTRAPPE_SCHLAF_MS: '300' }, () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 })));
  await new Promise((ok) => setTimeout(ok, 150));
  assert.deepEqual(a.s.aktuell().j.ausgabe_lauf, { art: 'lautheit' });
  assert.equal((await ruf(() => a.ausgabe.exportiere({}))).body.fehler, 'beschaeftigt', 'ein Export neben der Messung ist beschäftigt');
  assert.equal((await lauf).code, 200);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
  // ein Render-Fehler endet als render_fehler und räumt trotzdem auf
  const vorher = tmpReste();
  const f = await mitUmgebung({ RENDER_ATTRAPPE_RC: '4' }, () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 })));
  assert.deepEqual([f.code, f.body.fehler], [502, 'render_fehler']);
  assert.deepEqual(tmpReste(), vorher);
  assert.equal(a.s.aktuell().j.ausgabe_lauf, null);
});

test('Lautheit: belegteSpuren und reglerEinzeln (reine Teile)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const p = a.projekt();
  assert.deepEqual(belegteSpuren(p, 0, 16).map((s) => s.nr), [1, 2], 'vor dem Freeze: Lead ist eine Wirt-Spur ohne Freeze und spielt nicht');
  assert.deepEqual(belegteSpuren(p, 4, 8).map((s) => s.nr), [2], 'Kick liegt bei Beat 0..1, Bass 0..16');
  const r = reglerEinzeln({ ...p.spuren[1], fader_db: -9, pan: 0.5, mute: false });
  assert.equal(r['spur/2/fader'], -9); assert.equal(r['spur/2/pan'], 0.5); assert.equal(r['spur/2/mute'], 0);
  assert.equal(Object.keys(r).filter((k) => k.endsWith('/mute') && r[k] === 1).length, 7);
  assert.ok(Object.keys(r).filter((k) => k.endsWith('/solo')).every((k) => r[k] === 0));
});

// S3-Fix G1 (Review 2026-10-20): der Text von beschaeftigt nennt die Art des laufenden Laufs, bei einer Messung nicht "an export".
test('Lautheit G1: ein zweiter Lauf neben der Messung hört "a loudness measurement is running"; neben Export und Freeze bleibt der alte Text', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  const neben = async (starte, frage) => {
    const lauf = mitUmgebung({ ...MISCHUNG(a), RENDER_ATTRAPPE_SCHLAF_MS: '300' }, () => ruf(starte));
    await new Promise((ok) => setTimeout(ok, 150));
    const r = await ruf(frage);
    assert.equal((await lauf).code, 200);
    return r;
  };
  const gegenMessung = await neben(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 }), () => a.ausgabe.exportiere({}));
  assert.deepEqual([gegenMessung.body.fehler, gegenMessung.body.text], ['beschaeftigt', 'a loudness measurement is running']);
  const gegenMessung2 = await neben(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 }), () => a.ausgabe.freeze({ spur_id: 's3', an: false }));   // Lead ist seit der ersten Messung eingefroren: Verwerfen ist keine Nullrunde
  assert.equal(gegenMessung2.body.text, 'a loudness measurement is running', 'auch ein Freeze neben der Messung');
  // Negativ-Kontrolle: neben einem Export heißt es weiter "an export", neben einer Messung hört auch die Messung den Export
  const gegenExport = await neben(() => a.ausgabe.exportiere({ von_beat: 0, bis_beat: 4 }), () => a.ausgabe.lautheit({}));
  assert.equal(gegenExport.body.text, 'an export is running');
});

// S3-Fix G2: eine leise, nicht stille Spur (Spitze über STILLE_DB −90, Lautheit unter dem Gate-Boden −70 von ffmpeg) meldet nicht −70.0.
// Entscheidung (Cypher 2026-10-20): lufs_i null, stumm false, unter_messgrenze true.
test('Lautheit G2: Spur mit Spitze −80 dBFS meldet lufs_i null, stumm false, unter_messgrenze true; −20 dBFS wird gemessen (Negativ-Kontrolle)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  // Doppel: Spitze der Spur = 0,2 · 10^(Fader/20), also Fader −66,02 dB → −80 dBFS, Fader −6,02 dB → −20 dBFS
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's1', fader_db: -66.02 }, { befehl: 'spur_aendern', spur_id: 's2', fader_db: -6.02 }], 'Pegel');
  const r = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 })));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const leise = nr(r, 1), laut = nr(r, 2);
  assert.ok(Math.abs(leise.spitze_db + 80) < 0.1, `Spitze ${leise.spitze_db}`);
  assert.deepEqual([leise.lufs_i, leise.lra, leise.stumm, leise.unter_messgrenze], [null, null, false, true], 'leise Spur');
  assert.equal(typeof leise.true_peak_dbtp, 'number', 'der True Peak ist auch hier gemessen');
  assert.ok(Math.abs(laut.spitze_db + 20) < 0.1, `Spitze ${laut.spitze_db}`);
  assert.equal(typeof laut.lufs_i, 'number'); assert.ok(laut.lufs_i > -40 && laut.lufs_i < -20, `${laut.lufs_i} LUFS`);
  assert.deepEqual([laut.stumm, laut.unter_messgrenze], [false, false], 'Negativ-Kontrolle −20 dBFS');
  assert.equal(r.body.summe.unter_messgrenze, false, 'die Summe wird vom lauten Bass getragen');
  // gemutete Spur: stumm true, nicht unter der Messgrenze (zwei verschiedene Auskünfte)
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', mute: true }], 'Bass stumm');
  const nur = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 })));
  assert.deepEqual([nr(nur, 2).stumm, nr(nur, 2).unter_messgrenze, nr(nur, 2).lufs_i], [true, false, null], 'Mute');
  // nur die leise Spur klingt: auch die Summe liegt unter der Messgrenze
  assert.deepEqual([nur.body.summe.lufs_i, nur.body.summe.unter_messgrenze], [null, true]);
  // Stille (alles stumm): lufs_i null und unter_messgrenze false (es gibt nichts, das zu leise wäre)
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's1', mute: true }], 'Kick stumm');
  const still = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 })));
  assert.deepEqual([still.body.summe.lufs_i, still.body.summe.unter_messgrenze], [null, false]);
});

// S3-Fix G3: Einzel-Renders ignorieren Solo (reglerEinzeln setzt Solo überall 0), die Summe nicht. Entscheidung (Cypher 2026-10-20): steht irgendeine
// Spur des Projekts auf Solo, gilt eine Spur ohne Solo wie im Mix als stumm (stumm true, lufs_i null, kein Render).
test('Lautheit G3: Solo auf Spur 2 macht Spur 1 stumm (kein Render), Spur 2 wird gemessen; ohne Solo messen beide (Negativ-Kontrolle)', async (t) => {
  const a = await aufbau(t, { tempo: 120 });
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', solo: true }], 'Solo Bass');
  const r = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 })));
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.deepEqual([nr(r, 1).stumm, nr(r, 1).lufs_i, nr(r, 1).lra, nr(r, 1).true_peak_dbtp, nr(r, 1).spitze_db], [true, null, null, null, -200], 'Spur 1 ohne Solo');
  assert.deepEqual([nr(r, 2).stumm, typeof nr(r, 2).lufs_i], [false, 'number'], 'Spur 2 mit Solo');
  assert.equal(renderAufrufe(a).length, 2, 'Spur 2 und die Summe; Spur 1 wird nicht gerendert');
  assert.deepEqual(renderAufrufe(a)[1].regler['spur/2/solo'], 1, 'die Summe rendert mit Solo wie das Projekt');
  fs.rmSync(protokollDatei(a));
  await a.aendern([{ befehl: 'spur_aendern', spur_id: 's2', solo: false }], 'Solo aus');
  const ohne = await mitUmgebung(MISCHUNG(a), () => ruf(() => a.ausgabe.lautheit({ von_beat: 0, bis_beat: 4 })));
  assert.deepEqual(ohne.body.spuren.map((s) => [s.nr, s.stumm, typeof s.lufs_i]), [[1, false, 'number'], [2, false, 'number']]);
  assert.equal(renderAufrufe(a).length, 3, 'ohne Solo: zwei Spuren und die Summe');
});
