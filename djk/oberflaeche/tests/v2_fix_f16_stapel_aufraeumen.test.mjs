// D1 V2 Fix-Runde F16 (Spec 6.33, Aufräumen in Tests): Alle Ordner, die die Stapel-Hilfe (tests/hilfen/mediathek.mjs) anlegt, liegen im tmp-Ordner
// des Stapels und gehen mit ihm weg: loops, kits, welle, muster, hc, raster, wirt, die Hüllen und (seit Fix-Runde 3 der S2-Integration, G8) proj, arr
// und .zaehler. Was ein Aufrufer ausdrücklich übergibt, bleibt stehen. Vorher blieben je Stapel acht djk-*-Ordner unter TMPDIR liegen.
// Geprüft wird nur, was dieser Prozess unter TMPDIR neu anlegt.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf } from './hilfen/proj_stapel.mjs';

const eintraege = () => new Set(fs.readdirSync(os.tmpdir()));
async function mitStapel(optionen, tu) {
  const afters = [];
  try { const s = await stapel({ after: (f) => afters.push(f) }, optionen); await tu?.(s); } finally { for (const f of afters.reverse()) await f(); }
}

test('F16 Stapel lässt unter TMPDIR nichts liegen (alle tmpd-Ordner und die Hüllen im eigenen tmp-Ordner)', { timeout: 60_000 }, async () => {
  const vorher = eintraege();
  let gesehen = null;
  await mitStapel({}, async ({ o, url }) => {
    assert.equal((await ruf(url, 'POST', '/proj/neu', { name: 'Aufraeumen' })).code, 200);
    gesehen = [...eintraege()].filter((x) => !vorher.has(x));
    assert.ok(o.proj.sitzung.arbeitsordner.startsWith(os.tmpdir()), 'Positiv-Kontrolle: der Stapel legt wirklich unter TMPDIR an');
  });
  const neu = [...eintraege()].filter((x) => !vorher.has(x)).sort();
  console.log(`F16 ${JSON.stringify({ tmpdir: os.tmpdir(), waehrend: gesehen, nach_after: neu })}`);
  assert.ok(gesehen.length >= 1, 'Positiv-Kontrolle: während des Laufs gibt es den tmp-Ordner des Stapels');
  assert.deepEqual(neu, [], 'nach t.after liegt unter TMPDIR nichts Neues');
});

test('F16 Negativ-Kontrolle: ausdrücklich übergebene Ordner (loops, musterOrdner) gehören dem Aufrufer und bleiben stehen', { timeout: 60_000 }, async () => {
  const eigen = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-f16eigen-'));
  const loops = path.join(eigen, 'loops'), muster = path.join(eigen, 'muster');
  fs.mkdirSync(loops); fs.mkdirSync(muster);
  fs.writeFileSync(path.join(loops, 'bleibt.txt'), 'x');
  await mitStapel({ loops, musterOrdner: muster });
  const bleibt = { loops: fs.existsSync(path.join(loops, 'bleibt.txt')), muster: fs.existsSync(muster) };
  fs.rmSync(eigen, { recursive: true, force: true });                 // was dieser Test selbst angelegt hat
  assert.deepEqual(bleibt, { loops: true, muster: true });
});
