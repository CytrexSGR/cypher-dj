// Test-Instanz aus der Umgebung (Plan 2026-10-10-mediathek-browser, Task 2.0): CYPHERDJ_TEST_INSTANZ=a..i, Vorgabe h
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const hilfe = path.join(import.meta.dirname, 'hilfen', 'instanz.mjs');
const lies = (env) => JSON.parse(execFileSync(process.execPath, ['-e', `import(${JSON.stringify(hilfe)}).then((m) => console.log(JSON.stringify({ i: m.TEST_INSTANZ, k: m.K })))`],
  { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString());
test('Vorgabe h (K 8000, Seite 55300), per Umgebung g (K 7000); Unsinn bricht ab', () => {
  const ohne = { ...process.env }; delete ohne.CYPHERDJ_TEST_INSTANZ;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', `import(${JSON.stringify(hilfe)}).then((m) => console.log(JSON.stringify({ i: m.TEST_INSTANZ, k: m.K })))`], { env: ohne }).toString()), { i: 'h', k: 8000 });
  assert.deepEqual(lies({ CYPHERDJ_TEST_INSTANZ: 'g' }), { i: 'g', k: 7000 });
  assert.throws(() => lies({ CYPHERDJ_TEST_INSTANZ: 'z' }), /CYPHERDJ_TEST_INSTANZ/);
});

// Review S2 B6, S3-B4, Re-Review N5: der Prüfstapel (stapel.test.mjs) nimmt nie die Instanz der Server-Tests derselben Session, nie h (Vorgabe der
// Server-Tests, die Schwester) und nie g (Abnahme). Dafür bleiben a bis f als Ziele für acht Quellen: Kollisionen sind unvermeidlich und stehen
// hier offen, statt versteckt zu sein. CYPHERDJ_STAPEL_INSTANZ überschreibt das Mapping.
const stapelMit = (env) => JSON.parse(execFileSync(process.execPath, ['-e', `import(${JSON.stringify(hilfe)}).then((m) => console.log(JSON.stringify(m.STAPEL_INSTANZ)))`],
  { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).toString());
test('STAPEL_INSTANZ: nie die eigene Test-Instanz, nie h, g oder i; die Kollisionen sind genau die dokumentierten', () => {
  const bild = Object.fromEntries([...'abcdefgh'].map((b) => [b, stapelMit({ CYPHERDJ_TEST_INSTANZ: b })]));
  for (const [b, s] of Object.entries(bild)) assert.notEqual(s, b, `${b}: der Prüfstapel nimmt nicht die Instanz der Server-Tests`);
  for (const [b, s] of Object.entries(bild)) assert.ok(/^[a-f]$/.test(s), `${b} → ${s}: weder h (Vorgabe) noch g (Abnahme) noch i (Browser-Probe)`);
  const je = {};
  for (const [b, s] of Object.entries(bild)) (je[s] ??= []).push(b);
  const kollisionen = Object.fromEntries(Object.entries(je).filter(([, q]) => q.length > 1).map(([z, q]) => [z, q.join('')]));
  assert.deepEqual(kollisionen, { a: 'bg', f: 'eh' }, 'zwei Sessions teilen sich einen Stapel nur hier: b und g auf a, e und h auf f');
  const ohne = { ...process.env }; delete ohne.CYPHERDJ_TEST_INSTANZ; delete ohne.CYPHERDJ_STAPEL_INSTANZ;
  assert.equal(JSON.parse(execFileSync(process.execPath, ['-e', `import(${JSON.stringify(hilfe)}).then((m) => console.log(JSON.stringify(m.STAPEL_INSTANZ)))`], { env: ohne }).toString()), 'f', 'Vorgabe h → f wie bisher');
});
test('CYPHERDJ_STAPEL_INSTANZ überschreibt das Mapping; die eigene Test-Instanz und Unsinn brechen ab', () => {
  assert.equal(stapelMit({ CYPHERDJ_TEST_INSTANZ: 'b', CYPHERDJ_STAPEL_INSTANZ: 'c' }), 'c');
  assert.equal(stapelMit({ CYPHERDJ_TEST_INSTANZ: 'b' }), 'a', 'ohne Variable das Mapping');
  assert.throws(() => stapelMit({ CYPHERDJ_TEST_INSTANZ: 'b', CYPHERDJ_STAPEL_INSTANZ: 'b' }), /CYPHERDJ_STAPEL_INSTANZ/);
  assert.throws(() => stapelMit({ CYPHERDJ_TEST_INSTANZ: 'b', CYPHERDJ_STAPEL_INSTANZ: 'z' }), /CYPHERDJ_STAPEL_INSTANZ/);
});

// Plan 2026-10-15-d1-s1, Task 1: Sperre der Test-Instanz. Ein zweiter lebender Prozess auf demselben Buchstaben scheitert sofort mit
// einer Meldung, die die Ursache nennt (statt verschränkt mit „attrappe rc 3“); eine verwaiste Sperre (Halter mit SIGKILL beendet) wird übernommen.
test('belegeTestInstanz: zweiter Prozess auf demselben Buchstaben scheitert laut; nach dem Tod des Halters geht es wieder', async () => {
  const { spawn, spawnSync } = await import('node:child_process');
  const { TEST_INSTANZ } = await import('./hilfen/instanz.mjs');
  const code = (warten) => `import(${JSON.stringify(hilfe)}).then((m) => { m.belegeTestInstanz(); console.log('belegt'); ${warten ? 'setTimeout(() => {}, 60000);' : ''} })`;
  const env = { ...process.env, CYPHERDJ_TEST_INSTANZ: TEST_INSTANZ };
  const halter = spawn(process.execPath, ['-e', code(true)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((ok, f) => { halter.stdout.once('data', ok); halter.once('exit', (c) => f(new Error(`halter rc ${c}`))); });
    const zweiter = spawnSync(process.execPath, ['-e', code(false)], { env, encoding: 'utf8' });
    assert.notEqual(zweiter.status, 0, 'der zweite Prozess darf nicht starten');
    assert.match(zweiter.stderr, new RegExp(`Testinstanz ${TEST_INSTANZ} belegt \\(PID ${halter.pid},`));
  } finally {
    const weg = new Promise((r) => halter.once('exit', r)); halter.kill('SIGKILL'); await weg;
  }
  const danach = spawnSync(process.execPath, ['-e', code(false)], { env, encoding: 'utf8' });
  assert.equal(danach.status, 0, `verwaiste Sperre wird übernommen: ${danach.stderr}`);
  assert.equal(danach.stdout.trim(), 'belegt');
});
