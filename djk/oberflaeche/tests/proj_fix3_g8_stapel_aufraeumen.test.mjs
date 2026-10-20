// D1 S2-Integration, dritte Fix-Runde G8: Die Stapel-Hilfe (tests/hilfen/mediathek.mjs) legte Projektwurzel und Arbeitsordner des Bereichs proj
// mit tmpd() direkt unter TMPDIR an und räumte sie nie weg; seit Spec 6.31 kam je Lauf die Zählerdatei <arbeitsordner>.zaehler dazu (Quality-
// Re-Review: 244 djk-*-Ordner, 14 .zaehler unter /tmp). Jetzt liegen beide im eigenen tmp-Ordner des Stapels, den sein t.after wegräumt.
// Geprüft wird nur, was der Stapel selbst anlegt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf } from './hilfen/proj_stapel.mjs';

const zaehle = () => { const n = fs.readdirSync(os.tmpdir()); return { arr: n.filter((x) => /^djk-arr-/.test(x)).length, zaehler: n.filter((x) => /\.zaehler$/.test(x)).length }; };

test('G8 Stapel räumt Arbeitsordner, Zählerdatei und Projektwurzel des Bereichs proj in seinem t.after weg', { timeout: 60_000 }, async () => {
  const vorher = zaehle();
  const afters = [];
  const t = { after: (f) => afters.push(f) };
  let pfade;
  try {
    const { o, url } = await stapel(t);
    assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Aufraeumen' })).code, 200);   // legt Wiedergabe, Zählerdatei und Projekt an
    const s = o.proj.sitzung;
    const arr = s.arbeitsordner;
    pfade = { arr, zaehler: `${arr}.zaehler`, wurzel: s.zugangOffen().ordner };
    assert.ok(fs.existsSync(path.join(arr, 'wiedergabe-1.json')), 'die Wiedergabe liegt im Arbeitsordner');
    assert.ok(fs.existsSync(pfade.zaehler), 'die Zählerdatei liegt neben dem Arbeitsordner');
  } finally { for (const f of afters.reverse()) await f(); }
  const da = Object.fromEntries(Object.entries(pfade).map(([k, p]) => [k, fs.existsSync(p)]));
  const nachher = zaehle();
  console.log(`G8 ${JSON.stringify({ pfade, nach_after_noch_da: da, tmpdir: os.tmpdir(), vorher, nachher })}`);
  assert.deepEqual(da, { arr: false, zaehler: false, wurzel: false }, 'nichts davon bleibt nach t.after');
  assert.deepEqual(nachher, vorher, 'unter TMPDIR kein djk-arr-* und keine .zaehler mehr als vorher (nur dieser Lauf)');
});

test('G8 Negativ-Kontrolle: ein ausdrücklich übergebener Arbeitsordner gehört dem Aufrufer und bleibt stehen', { timeout: 60_000 }, async () => {
  const eigen = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-g8eigen-'));
  const afters = [];
  try {
    const { url } = await stapel({ after: (f) => afters.push(f) }, { proj: { arbeitsordner: path.join(eigen, 'arr') } });
    assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Eigen' })).code, 200);
  } finally { for (const f of afters.reverse()) await f(); }
  const bleibt = { arr: fs.existsSync(path.join(eigen, 'arr', 'wiedergabe-1.json')), zaehler: fs.existsSync(path.join(eigen, 'arr.zaehler')) };
  fs.rmSync(eigen, { recursive: true, force: true });                // was dieser Test selbst angelegt hat
  assert.deepEqual(bleibt, { arr: true, zaehler: true });
});
