// Paket 1.13 Slice 6: Bereich proj-stems mit dem echten werkstatt.stems (Prüftrenner identitaet, P3) am Kick-Clip des S3-Aufbaus. Eine Projektänderung,
// ein Undo; die WAVs liegen im Projektordner, Temp im Arbeitsordner ist weg; das Kind sieht CUDA_VISIBLE_DEVICES leer.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aufbau } from './hilfen/ausgabe_aufbau.mjs';
import { warteBis } from './hilfen/proj_kontext.mjs';
import { Stems } from '../bereiche/proj/stems.ts';
import { pythonVorgabe } from '../server.ts';
import { REPO_PFADE } from '../pfade.ts';

export async function mitStems(t, { trenner = 'identitaet', killMs = 2000, aufbauOpt = {}, extra = {}, mantel = (zg) => zg } = {}) {
  const r = await aufbau(t, aufbauOpt);
  const stems = new Stems(r.ctx, mantel(r.zugang),
    { python: pythonVorgabe(), cwd: REPO_PFADE.werkstatt, zusatzArgs: ['--trenner', trenner], killMs, ...extra });
  t.after(() => stems.schliesse());
  stems.ereignis('/zustand/kern', { generation: 1, quantum: 256, ki_gestoppt: 0 });
  const stand = () => r.s.aktuell().j.stems;
  const ende = async (ms = 60000) => { assert.ok(await warteBis(() => stand() && stand().zustand !== 'laeuft', ms), JSON.stringify(stand())); return stand(); };
  return { ...r, stems, stand, ende };
}

test('S6: Stems am Kick-Clip: vier Spuren unter s1, Original stumm, eine Gruppe, WAVs mit n Frames, ein Undo stellt alles her', async (t) => {
  const z = await mitStems(t);
  const vorher = structuredClone(z.projekt());
  const a = z.stems.starte({ clip_id: 'c1' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.frames, 24000);
  const e = await z.ende();
  assert.equal(e.zustand, 'fertig', JSON.stringify(e));
  const p = z.projekt();
  const name = p.spuren[0].clips[0].name;
  assert.deepEqual(p.spuren.slice(1, 5).map((s) => s.name), ['Drums', 'Bass', 'Other', 'Vocals'].map((n) => `${name} ${n}`));
  assert.equal(p.spuren[0].clips[0].stumm, true);
  assert.equal(p.gruppen.at(-1).name, `Stems: ${vorher.spuren[0].clips[0].name}`);
  const ordner = z.offen().ordner;
  const wavs = fs.readdirSync(path.join(ordner, 'stems')).sort();
  assert.equal(wavs.length, 4);
  for (const w of wavs) assert.equal(fs.statSync(path.join(ordner, 'stems', w)).size, 58 + 24000 * 8, w);   // Kopf 58 Bytes (wavKopf), n Frames
  assert.equal(fs.readdirSync(z.arbeitsordner).filter((f) => f.startsWith('stems-')).length, 0, 'Temp weg');
  assert.ok(await warteBis(() => z.projekt().spuren.slice(1, 5).every((s) => s.clips[0].dekodiert === 'fertig'), 10000), 'Stems dekodiert');
  assert.equal(z.protokoll.uebernommen.filter((u) => u.label.startsWith('Stems ')).length, 1, 'genau eine Übernahme');
  await z.s.umkehr('undo', { rev: z.projekt().rev }, 'andreas');
  const nach = z.projekt();
  assert.deepEqual(nach.spuren.map((s) => s.id), vorher.spuren.map((s) => s.id));
  assert.equal(nach.spuren[0].clips[0].stumm, undefined);
  assert.equal(nach.gruppen?.length ?? 0, vorher.gruppen?.length ?? 0);
});

test('S6: ein CPU-Lauf (geraet cpu) sieht CUDA_VISIBLE_DEVICES leer (P4): fehlt es im Kind, endet der Lauf mit fehler gpu_sichtbar (Gegenprobe)', async (t) => {
  const z = await mitStems(t);
  const alt = process.env.CUDA_VISIBLE_DEVICES;
  process.env.CUDA_VISIBLE_DEVICES = '0';                                     // der Server überschreibt es für das Kind
  t.after(() => { if (alt === undefined) delete process.env.CUDA_VISIBLE_DEVICES; else process.env.CUDA_VISIBLE_DEVICES = alt; });
  assert.equal(z.stems.starte({ clip_id: 'c1', geraet: 'cpu' }, 'andreas').code, 200);
  assert.equal((await z.ende()).zustand, 'fertig');
});

test('S6 (Review MINOR 5): schreibeWavAusF32Stueckweise = schreibeWavAusF32 Byte für Byte; die Ereignisschleife läuft dabei weiter', async (t) => {
  const { schreibeWavAusF32, schreibeWavAusF32Stueckweise } = await import('../projekt/aufnahme.ts');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-wav-')); t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  const roh = path.join(d, 'x.f32'); const b = Buffer.alloc(3 * 1024 * 1024 + 8); for (let i = 0; i < b.length; i += 4) b.writeFloatLE((i % 997) / 997, i);
  fs.writeFileSync(roh, b);
  const a = schreibeWavAusF32(roh, path.join(d, 'a.wav'));
  let ticks = 0; const u = setInterval(() => ticks++, 0);
  const s = await schreibeWavAusF32Stueckweise(roh, path.join(d, 's.wav'));
  clearInterval(u);
  assert.deepEqual(s, a);
  assert.ok(fs.readFileSync(path.join(d, 's.wav')).equals(fs.readFileSync(path.join(d, 'a.wav'))));
  assert.ok(ticks >= 2, `Ereignisschleife lief ${ticks} Mal`);
  await assert.rejects(schreibeWavAusF32Stueckweise(roh, path.join(d, 's.wav')), /EEXIST/);   // 'wx': nie ersetzen
});

test('S6 (Review MINOR 4): ein neuer Bereich räumt verwaiste stems-* und tötet ein verwaistes Kind dieser Instanz, fremde bleiben', async (t) => {
  const z = await mitStems(t);
  const rest = path.join(z.arbeitsordner, 'stems-77'); fs.mkdirSync(rest, { recursive: true }); fs.writeFileSync(path.join(rest, 'drums.f32'), 'x');
  const fremd = path.join(z.tmp, 'woanders', 'stems-5'); fs.mkdirSync(fremd, { recursive: true });
  const { spawn } = await import('node:child_process');
  const quelle = path.join(z.arbeitsordner, 'audio', `${'a'.repeat(64)}.f32`);
  const kind = spawn(pythonVorgabe(), ['-m', 'werkstatt.stems', '--quelle', quelle, '--f0', '0', '--f1', '24000', '--aus', rest, '--trenner', 'taub'],
    { cwd: REPO_PFADE.werkstatt, env: { ...process.env, CUDA_VISIBLE_DEVICES: '' }, stdio: 'ignore' });
  t.after(() => { try { kind.kill('SIGKILL'); } catch { /* weg */ } });
  await new Promise((r) => setTimeout(r, 300));
  const zu = new Promise((r) => kind.once('exit', (_c, s) => r(s)));
  const neu = new Stems(z.ctx, z.zugang, { python: pythonVorgabe(), cwd: REPO_PFADE.werkstatt });
  t.after(() => neu.schliesse());
  assert.equal(await zu, 'SIGKILL');
  assert.equal(fs.existsSync(rest), false);
  assert.equal(fs.existsSync(fremd), true, 'Negativ-Kontrolle: fremder Ordner bleibt');
});


// Review T6 B1/M1: der Schreiber wird verlangsamt (Einhängepunkt schreibeWav, kein Sleep im Produktivcode); im WAV-Fenster ändert sich der Stand
const imFenster = (aktion) => {
  let einmal = false;
  return async (quelle, ziel) => {
    if (!einmal) { einmal = true; await aktion(); }
    const { schreibeWavAusF32Stueckweise } = await import('../projekt/aufnahme.ts');
    return schreibeWavAusF32Stueckweise(quelle, ziel);
  };
};
const stemsWavs = (ordner) => (fs.existsSync(path.join(ordner, 'stems')) ? fs.readdirSync(path.join(ordner, 'stems')) : []);

test('S6 (Review B1/E1): Projektwechsel im WAV-Fenster → veraltet, das neue Projekt bleibt unberührt, die WAVs sind weg', async (t) => {
  let z = null;
  z = await mitStems(t, { extra: { schreibeWav: imFenster(async () => { assert.equal((await z.s.neu('Zwei', 'andreas')).code, 200); }) } });
  const ordnerA = z.offen().ordner;
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  const letzte = () => z.protokoll.verteilt.map((v) => v.f?.stems).filter(Boolean).at(-1);   // GET /proj/aktuell zeigt den Stand eines fremden Slugs nicht
  assert.ok(await warteBis(() => letzte() && letzte().zustand !== 'laeuft', 60000), JSON.stringify(letzte()));
  const e = letzte();
  assert.deepEqual([e.zustand, e.grund], ['veraltet', 'veraltet'], JSON.stringify(e));
  const b = z.offen();
  assert.equal(b.slug, 'zwei');
  const platte = JSON.parse(fs.readFileSync(path.join(b.ordner, 'project.json'), 'utf8'));
  assert.equal(platte.name, 'Zwei', 'B auf der Platte');
  assert.equal(platte.spuren.length, 0);
  assert.equal(b.projekt.spuren.length, 0, 'B im Speicher');
  assert.deepEqual(stemsWavs(ordnerA), [], 'die eigenen WAVs sind geräumt');
  assert.equal(z.protokoll.uebernommen.filter((u) => u.label.startsWith('Stems ')).length, 0);
});

test('S6 (Review M1/E2): Tempo im WAV-Fenster → veraltet, nicht fehler; die Handänderung bleibt, keine WAVs', async (t) => {
  let z = null;
  z = await mitStems(t, { extra: { schreibeWav: imFenster(async () => { await z.aendern([{ befehl: 'tempo_setzen', bpm: 130 }], 'Hand'); }) } });
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['veraltet', 'veraltet'], JSON.stringify(e));
  assert.equal(z.projekt().tempo_bpm, 130);
  assert.equal(z.projekt().spuren.length, 3, 'keine Stem-Spuren (der Aufbau hat drei Spuren)');
  assert.deepEqual(stemsWavs(z.offen().ordner), []);
});

// ---- Task 7: Fortschritt und Abbruch (D1, D2) ----
// Das Kind legt stems-<id> erst in der Stufe schreiben an; damit die Aufräum-Assertion nicht leer ist, liegt vor dem Abbruch ein Teil-f32 im Temp
const legeTeil = (z) => {
  const tmp = z.stems.lauf.tmp;
  fs.mkdirSync(tmp, { recursive: true }); fs.writeFileSync(path.join(tmp, 'drums.f32'), 'teil');
  assert.equal(fs.existsSync(path.join(tmp, 'drums.f32')), true, 'Positiv-Kontrolle: das Teil-f32 liegt');
};
test('S6: Fortschritt über SSE und /proj/aktuell (laden, trennen mit Prozent, schreiben), cpu_s wächst', async (t) => {
  const z = await mitStems(t, { trenner: 'langsam' });
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.ok(await warteBis(() => (z.stand()?.prozent ?? 0) > 20, 10000), JSON.stringify(z.stand()));
  assert.equal(z.stand().stufe, 'trennen');
  assert.ok(await warteBis(() => (z.stand()?.cpu_s ?? -1) >= 0, 3000), 'cpu_s gemessen');
  const e = await z.ende();
  assert.equal(e.zustand, 'fertig');
  const sse = z.protokoll.verteilt.filter((v) => v.a === 'proj' && v.f.stems).map((v) => v.f.stems);
  assert.ok(sse.some((s) => s.stufe === 'laden') && sse.some((s) => s.stufe === 'schreiben') && sse.at(-1).zustand === 'fertig');
  const p = sse.filter((s) => s.stufe === 'trennen').map((s) => s.prozent);
  assert.ok(p.length >= 10 && p.every((x, i) => i === 0 || x >= p[i - 1]), `steigend: ${p}`);
});

test('S6: Abbrechen: SIGTERM, Ende abgebrochen, kein Projektwechsel, Temp und WAVs weg; fremde auftrag_id → 404', async (t) => {
  const z = await mitStems(t, { trenner: 'langsam' });
  const rev = z.projekt().rev;
  const a = z.stems.starte({ clip_id: 'c1' }, 'andreas');
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  assert.throws(() => z.stems.abbrechen({ auftrag_id: a.j.auftrag_id + 1 }), (e) => e.code === 404 && e.fehler === 'kein_auftrag');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(z.stems.lauf.abgebrochen, null, 'die falsche id bricht nichts ab');
  assert.equal(z.stand().zustand, 'laeuft');
  legeTeil(z);
  assert.equal(z.stems.abbrechen({ auftrag_id: a.j.auftrag_id }).code, 200);
  const e = await z.ende(5000);
  assert.deepEqual([e.zustand, e.grund], ['abgebrochen', 'abbruch']);
  assert.equal(z.projekt().rev, rev);
  assert.equal(fs.readdirSync(z.arbeitsordner).filter((f) => f.startsWith('stems-')).length, 0);
  assert.equal(fs.existsSync(path.join(z.offen().ordner, 'stems')), false);
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200, 'danach wieder startbar');
  await z.ende();
});

test('S6: taub gegen SIGTERM → nach killMs SIGKILL, Ende abgebrochen; zweiter Start während des Laufs → stems_laeuft', async (t) => {
  const z = await mitStems(t, { trenner: 'taub', killMs: 300 });
  const a = z.stems.starte({ clip_id: 'c1' }, 'andreas');
  assert.throws(() => z.stems.starte({ clip_id: 'c1' }, 'andreas'), (e) => e.fehler === 'stems_laeuft' && e.extra.auftrag_id === a.j.auftrag_id);
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  const t0 = Date.now();
  z.stems.abbrechen({ auftrag_id: a.j.auftrag_id });
  const e = await z.ende(3000);
  assert.equal(e.zustand, 'abgebrochen');
  assert.ok(Date.now() - t0 >= 250 && Date.now() - t0 < 2500, `SIGKILL nach killMs (${Date.now() - t0} ms)`);
});

test('S6: Gegenprobe: taub mit killMs 60000 endet nach dem Abbruch nicht binnen 3 s (SIGKILL greift erst nach killMs)', async (t) => {
  const z = await mitStems(t, { trenner: 'taub', killMs: 60000 });
  const a = z.stems.starte({ clip_id: 'c1' }, 'andreas');
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  const pid = z.stems.lauf.prozess.pid;
  z.stems.abbrechen({ auftrag_id: a.j.auftrag_id });
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(z.stand().zustand, 'laeuft', 'läuft weiter, das Kind ignoriert SIGTERM');
  process.kill(pid, 'SIGKILL');                                              // Aufräumen
  assert.equal((await z.ende(5000)).zustand, 'abgebrochen');
});

test('S6: Zeitlimit → Ende abgebrochen, Grund stems_zeitlimit, Temp weg, keine Projektänderung', async (t) => {
  const z = await mitStems(t, { trenner: 'langsam', extra: { zeitlimitMs: 1500 } });
  const rev = z.projekt().rev;
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  legeTeil(z);
  const e = await z.ende(10000);
  assert.deepEqual([e.zustand, e.grund], ['abgebrochen', 'stems_zeitlimit'], JSON.stringify(e));
  assert.equal(z.projekt().rev, rev);
  assert.equal(fs.readdirSync(z.arbeitsordner).filter((f) => f.startsWith('stems-')).length, 0);
});

test('S6: zweiter Start (anderer Clip, anderer Aufrufer) → 409 stems_laeuft mit auftrag_id des laufenden; der Lauf bleibt unberührt', async (t) => {
  const z = await mitStems(t, { trenner: 'langsam' });
  const a = z.stems.starte({ clip_id: 'c1' }, 'andreas');
  assert.throws(() => z.stems.starte({ clip_id: 'c1' }, 'cypher'),
    (e) => e.code === 409 && e.fehler === 'stems_laeuft' && e.extra.auftrag_id === a.j.auftrag_id);
  assert.equal(z.stand().auftrag_id, a.j.auftrag_id);
  assert.equal((await z.ende()).zustand, 'fertig');
});

const letzteMeldung = (z) => z.protokoll.verteilt.map((v) => v.f?.stems).filter(Boolean).at(-1);   // GET /proj/aktuell zeigt fremde Slugs nicht
const lebt = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('S6: Projektwechsel während des Rechnens bricht den Lauf ab (SIGTERM, Temp weg, abgebrochen/abbruch); das neue Projekt bleibt unberührt', async (t) => {
  const z = await mitStems(t, { trenner: 'langsam' });
  const ordnerA = z.offen().ordner;
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  const pid = z.stems.lauf.prozess.pid;
  legeTeil(z);
  assert.equal((await z.s.neu('Zwei', 'andreas')).code, 200);
  assert.ok(await warteBis(() => letzteMeldung(z).zustand !== 'laeuft', 10000), JSON.stringify(letzteMeldung(z)));
  const e = letzteMeldung(z);
  assert.deepEqual([e.zustand, e.grund], ['abgebrochen', 'abbruch'], JSON.stringify(e));
  assert.equal(lebt(pid), false, 'das Kind ist tot');
  assert.equal(fs.readdirSync(z.arbeitsordner).filter((f) => f.startsWith('stems-')).length, 0);
  assert.deepEqual(stemsWavs(ordnerA), []);
  assert.equal(z.offen().slug, 'zwei');
  assert.equal(z.offen().projekt.spuren.length, 0);
  assert.throws(() => z.stems.starte({ clip_id: 'c1' }, 'andreas'), (e) => e.fehler !== 'stems_laeuft', 'Lauf frei: es fehlt der Clip, nicht der Riegel');
});

test('S6: schliesse() beendet das laufende Kind (SIGTERM, dann SIGKILL nach killMs), Temp weg, Endmeldung abgebrochen/abbruch', async (t) => {
  const z = await mitStems(t, { trenner: 'taub', killMs: 300 });
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  const pid = z.stems.lauf.prozess.pid;
  legeTeil(z);
  z.stems.schliesse();
  assert.ok(await warteBis(() => !lebt(pid), 3000), 'das taube Kind ist tot');
  assert.ok(await warteBis(() => letzteMeldung(z).zustand !== 'laeuft', 3000), JSON.stringify(letzteMeldung(z)));
  const e = letzteMeldung(z);
  assert.deepEqual([e.zustand, e.grund], ['abgebrochen', 'abbruch'], JSON.stringify(e));
  assert.equal(fs.readdirSync(z.arbeitsordner).filter((f) => f.startsWith('stems-')).length, 0);
});

test('S6: Abbruch im WAV-Fenster (Kind schon fertig) → abgebrochen, keine WAVs, keine Projektänderung', async (t) => {
  let z = null; let id = 0;
  z = await mitStems(t, { extra: { schreibeWav: imFenster(async () => { z.stems.abbrechen({ auftrag_id: id }); }) } });
  const rev = z.projekt().rev;
  id = z.stems.starte({ clip_id: 'c1' }, 'andreas').j.auftrag_id;
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['abgebrochen', 'abbruch'], JSON.stringify(e));
  assert.equal(z.projekt().rev, rev);
  assert.deepEqual(stemsWavs(z.offen().ordner), []);
});

test('S6 (Review T7 M3): Serverstopp tötet ein taubes Kind sofort (SIGKILL, kein Waise), auch bei killMs 60000; pgrep findet keins', async (t) => {
  const z = await mitStems(t, { trenner: 'taub', killMs: 60000 });
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  const { execFileSync } = await import('node:child_process');
  const tmp = z.stems.lauf.tmp, pid = z.stems.lauf.prozess.pid;
  const finde = () => { try { return execFileSync('pgrep', ['-f', `[w]erkstatt.stems.*${tmp}`]).toString().trim(); } catch { return ''; } };
  assert.notEqual(finde(), '', 'Positiv-Kontrolle: pgrep findet das laufende Kind');
  z.stems.schliesse();
  assert.ok(await warteBis(() => !lebt(pid), 1500), 'tot binnen 1,5 s, nicht erst nach killMs');
  assert.equal(finde(), '', 'kein Kind mehr');
});

test('S6 (Review T7 m3): Abbrechen nach erfolgreichem aendereStand → 409 zu_spaet, die Stems bleiben, Ende fertig', async (t) => {
  let z = null; let id = 0; let antwort = null;
  const mantel = (zg) => ({ ...zg, uebernimm: async (w, meta) => {
    try { antwort = z.stems.abbrechen({ auftrag_id: id }); } catch (e) { antwort = e; }
    return zg.uebernimm(w, meta);
  } });
  z = await mitStems(t, { mantel });
  id = z.stems.starte({ clip_id: 'c1' }, 'andreas').j.auftrag_id;
  const e = await z.ende();
  assert.equal(antwort?.code, 409, JSON.stringify(antwort?.j ?? antwort?.message));
  assert.equal(antwort.fehler, 'zu_spaet');
  assert.equal(e.zustand, 'fertig', JSON.stringify(e));
  assert.equal(z.projekt().spuren.length, 7, 'drei Aufbau-Spuren plus vier Stems');
  assert.equal(stemsWavs(z.offen().ordner).length, 4);
});

// ---- Task 8: Riegel, Quantum, KI-Stopp, GPU, Veraltet (D10, D11, D15, D16) ----
test('S6 D10: Quantum unbekannt → kein_kernstand, 128 → stems_quantum; Wechsel auf 128 im Lauf → abgebrochen stems_quantum, Teil-f32 geräumt', async (t) => {
  const z = await mitStems(t, { trenner: 'langsam' });
  const roh = new Stems(z.ctx, z.zugang, { python: pythonVorgabe(), cwd: REPO_PFADE.werkstatt });
  assert.throws(() => roh.starte({ clip_id: 'c1' }, 'andreas'), (e) => e.fehler === 'kein_kernstand');
  z.stems.ereignis('/e/quantum', { alt: 256, neu: 128, sample: 0n });
  assert.throws(() => z.stems.starte({ clip_id: 'c1' }, 'andreas'), (e) => e.fehler === 'stems_quantum');
  z.stems.ereignis('/zustand/kern', { generation: 1, quantum: 256, ki_gestoppt: 0 });
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  const rev = z.projekt().rev;
  legeTeil(z);
  z.stems.ereignis('/e/quantum', { alt: 256, neu: 128, sample: 0n });
  const e = await z.ende(5000);
  assert.deepEqual([e.zustand, e.grund], ['abgebrochen', 'stems_quantum']);
  assert.equal(z.projekt().rev, rev);
  assert.equal(fs.readdirSync(z.arbeitsordner).filter((f) => f.startsWith('stems-')).length, 0);
  assert.equal(fs.existsSync(path.join(z.offen().ordner, 'stems')), false);
});

test('S6 D11 (aufgehoben 2026-10-31): geraet gpu ist die Vorgabe und startet, cpu startet, anderes → argument_ungueltig', async (t) => {
  const { STEMS_GPU } = await import('../bereiche/proj/stems.ts');
  assert.equal(STEMS_GPU, true);
  const z = await mitStems(t);
  assert.throws(() => z.stems.starte({ clip_id: 'c1', geraet: 'tpu' }, 'andreas'), (e) => e.fehler === 'argument_ungueltig');
  assert.equal(z.stand(), undefined, 'kein Lauf entstanden');
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.equal((await z.ende()).zustand, 'fertig');
  assert.equal(z.stems.starte({ clip_id: 'c1', geraet: 'cpu' }, 'andreas').code, 200);
  assert.equal((await z.ende()).zustand, 'fertig');
});

test('S6 D15: Cypher auf Andreas-Spur → nur_andreas_spur; KI-Stopp beim Start und am Ende (nur Cyphers Lauf, P5)', async (t) => {
  const z = await mitStems(t, { trenner: 'langsam' });
  assert.throws(() => z.stems.starte({ clip_id: 'c1' }, 'cypher'), (e) => e.fehler === 'nur_andreas_spur');
  await z.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Cy' }], 'Cy', 'cypher');
  const cy = z.projekt().spuren.at(-1).id;
  await z.aendern([{ befehl: 'clip_neu', spur_id: cy, art: 'audio', start_beat: 0, laenge_beats: 1, sha256: 'a'.repeat(64) }], 'Cy-Clip', 'cypher');
  assert.ok(await warteBis(() => z.projekt().spuren.at(-1).clips[0].dekodiert === 'fertig', 10000));
  const cid = z.projekt().spuren.at(-1).clips[0].id;
  z.zustand.ki = true;
  assert.throws(() => z.stems.starte({ clip_id: cid }, 'cypher'), (e) => e.fehler === 'ki_gestoppt');
  z.zustand.ki = false;
  const rev = z.projekt().rev;
  assert.equal(z.stems.starte({ clip_id: cid }, 'cypher').code, 200);
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  z.zustand.ki = true;                                                       // gedrückt während des Laufs
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['veraltet', 'ki_gestoppt']);
  assert.equal(z.projekt().rev, rev);
  assert.deepEqual(stemsWavs(z.offen().ordner), []);
  assert.equal(fs.readdirSync(z.arbeitsordner).filter((f) => f.startsWith('stems-')).length, 0);
  z.zustand.ki = true;                                                       // Andreas' Lauf bleibt (P5, Negativ-Kontrolle)
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.equal((await z.ende()).zustand, 'fertig');
});

test('S6 D16: Clip im Lauf verschoben → veraltet, nichts gesetzt, WAVs nicht geschrieben; Gain im Lauf → fertig', async (t) => {
  const z = await mitStems(t, { trenner: 'langsam' });
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  await z.aendern([{ befehl: 'clip_aendern', clip_id: 'c1', start_beat: 2 }], 'Weg');
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['veraltet', 'veraltet']);
  assert.equal(fs.existsSync(path.join(z.offen().ordner, 'stems')), false);
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  await z.aendern([{ befehl: 'clip_aendern', clip_id: 'c1', gain_db: -3 }], 'Gain');
  assert.equal((await z.ende()).zustand, 'fertig');
});

test('S6 D16, D14: zu_viele_spuren schon beim Start, mehrere_clips über spur_id', async (t) => {
  const z = await mitStems(t);
  assert.throws(() => z.stems.starte({ spur_id: 's2' }, 'andreas'), (e) => e.grund === 'mehrere_clips');
  await z.aendern(Array.from({ length: 26 }, () => ({ befehl: 'spur_neu', art: 'audio' })), 'Voll');
  assert.throws(() => z.stems.starte({ clip_id: 'c1' }, 'andreas'), (e) => e.grund === 'zu_viele_spuren');
});

// ---- Task 8 Nachbesserung (Review-T8) ----
const cypherClip = async (z) => {
  await z.aendern([{ befehl: 'spur_neu', art: 'audio', name: 'Cy' }], 'Cy', 'cypher');
  const spur_id = z.projekt().spuren.at(-1).id;
  await z.aendern([{ befehl: 'clip_neu', spur_id, art: 'audio', start_beat: 0, laenge_beats: 1, sha256: 'a'.repeat(64) }], 'Cy-Clip', 'cypher');
  assert.ok(await warteBis(() => z.projekt().spuren.at(-1).clips[0].dekodiert === 'fertig', 10000));
  return z.projekt().spuren.at(-1).clips[0].id;
};
test('S6 T8-NB MAJOR: Stop Cypher im WAV-Fenster → veraltet ki_gestoppt, nichts gesetzt, WAVs weg; Andreas-Lauf im Fenster bleibt fertig (P5)', async (t) => {
  let z = null;
  z = await mitStems(t, { extra: { schreibeWav: imFenster(async () => { z.zustand.ki = true; }) } });
  const cid = await cypherClip(z);
  const rev = z.projekt().rev;
  assert.equal(z.stems.starte({ clip_id: cid }, 'cypher').code, 200);
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['veraltet', 'ki_gestoppt'], JSON.stringify(e));
  assert.equal(z.projekt().rev, rev);
  assert.deepEqual(stemsWavs(z.offen().ordner), []);
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200, 'Negativ-Kontrolle: Andreas startet trotz Stop');
  assert.equal((await z.ende()).zustand, 'fertig');
});

test('S6 T8-NB MINOR 1: Quantum 128 im WAV-Fenster → abgebrochen stems_quantum, nichts gesetzt; nach dem Setzen ignoriert', async (t) => {
  let z = null;
  z = await mitStems(t, { extra: { schreibeWav: imFenster(async () => { z.stems.ereignis('/e/quantum', { alt: 256, neu: 128, sample: 0n }); }) } });
  const rev = z.projekt().rev;
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  const e = await z.ende();
  assert.deepEqual([e.zustand, e.grund], ['abgebrochen', 'stems_quantum'], JSON.stringify(e));
  assert.equal(z.projekt().rev, rev);
  assert.deepEqual(stemsWavs(z.offen().ordner), []);
  // nach dem Setzen (uebernimm läuft, gespeichert) kommt 128: ignoriert
  let z2 = null;
  const mantel = (zg) => ({ ...zg, uebernimm: async (w, meta) => {
    z2.stems.ereignis('/e/quantum', { alt: 256, neu: 128, sample: 0n }); return zg.uebernimm(w, meta);
  } });
  z2 = await mitStems(t, { mantel });
  z2.stems.ereignis('/zustand/kern', { generation: 1, quantum: 256, ki_gestoppt: 0 });
  assert.equal(z2.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.equal((await z2.ende()).zustand, 'fertig');
});

test('S6 T8-NB MINOR 2: Quantum 0 = unbekannt: Start kein_kernstand, im Lauf kein Abbruch, danach 128 bricht ab; 512 → stems_quantum', async (t) => {
  const z = await mitStems(t, { trenner: 'langsam' });
  z.stems.ereignis('/zustand/kern', { generation: 2, quantum: 0, ki_gestoppt: 0 });
  assert.throws(() => z.stems.starte({ clip_id: 'c1' }, 'andreas'), (e) => e.fehler === 'kein_kernstand');
  z.stems.ereignis('/zustand/kern', { generation: 2, quantum: 512, ki_gestoppt: 0 });
  assert.throws(() => z.stems.starte({ clip_id: 'c1' }, 'andreas'), (e) => e.fehler === 'stems_quantum');
  z.stems.ereignis('/zustand/kern', { generation: 2, quantum: 256, ki_gestoppt: 0 });
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  z.stems.ereignis('/zustand/kern', { generation: 3, quantum: 0, ki_gestoppt: 0 });   // Kernneustart: unbekannt
  z.stems.ereignis('/zustand/kern', { generation: 3, quantum: 256, ki_gestoppt: 0 });
  assert.equal((await z.ende(10000)).zustand, 'fertig', 'Negativ-Kontrolle: 0 dann 256 bricht nicht ab');
  assert.equal(z.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  z.stems.ereignis('/zustand/kern', { generation: 4, quantum: 0, ki_gestoppt: 0 });
  z.stems.ereignis('/e/quantum', { alt: 0, neu: 128, sample: 0n });                    // danach bekannt und falsch: normale Regel
  const e = await z.ende(5000);
  assert.deepEqual([e.zustand, e.grund], ['abgebrochen', 'stems_quantum']);
});

test('S6 T8-NB MINOR 3: nur_andreas_spur auch über spur_id; Quantumabbruch tötet das Kind; zu_viele_spuren am Ende → veraltet', async (t) => {
  const z = await mitStems(t, { trenner: 'taub', killMs: 300 });
  assert.throws(() => z.stems.starte({ spur_id: 's1' }, 'cypher'), (e) => e.fehler === 'nur_andreas_spur');
  assert.equal(z.stems.starte({ spur_id: 's1' }, 'andreas').code, 200, 'Negativ-Kontrolle: Andreas darf');
  assert.ok(await warteBis(() => z.stand()?.stufe === 'trennen', 10000));
  const pid = z.stems.lauf.prozess.pid;
  z.stems.ereignis('/e/quantum', { alt: 256, neu: 128, sample: 0n });
  assert.ok(await warteBis(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, 3000), 'das (taube) Kind ist nach killMs tot');
  assert.equal((await z.ende(5000)).grund, 'stems_quantum');
  const y = await mitStems(t, { trenner: 'langsam' });
  assert.equal(y.stems.starte({ clip_id: 'c1' }, 'andreas').code, 200);
  await y.aendern(Array.from({ length: 26 }, () => ({ befehl: 'spur_neu', art: 'audio' })), 'Voll');
  const e = await y.ende();
  assert.deepEqual([e.zustand, e.grund], ['veraltet', 'zu_viele_spuren'], JSON.stringify(e));
});
