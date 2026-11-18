// Operating side of the lean journal: the production start (djk-start text), and the evaluation tool that must refuse a lean journal.
// djk-start is never run here (a live studio runs on this machine): its text is read, `bash -n` checks the syntax, and the two lines that
// decide the journal mode are cut out of the script and run on their own.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { schlankGrund } from '../check/evaluation.ts';
import { LEITSTAND } from './support/process.ts';

const START = path.join(LEITSTAND, '..', 'start', 'djk-start');
const text = fs.readFileSync(START, 'utf8');
const zeilen = text.split('\n');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-journal-start-'));

test('djk-start still parses', () => {
  execFileSync('bash', ['-n', START]);
});

// The two lines of the journal mode, cut out of the real script and run with a given instance and option.
function leitstandArgs(instanz: string, journal: string): string {
  const wahl = zeilen.filter((z) => /^\[ -z "\$JOURNAL" \] && \[ -z "\$I" \] && JOURNAL=schlank$/.test(z));
  const weiter = zeilen.filter((z) => /^\[ -n "\$JOURNAL" \] && LS_ARGS="\$LS_ARGS --journal \$JOURNAL"$/.test(z));
  assert.equal(wahl.length, 1, 'exactly one line chooses the default mode');
  assert.equal(weiter.length, 1, 'exactly one line hands the mode to the leitstand');
  const skript = `I=${JSON.stringify(instanz)}; JOURNAL=${JSON.stringify(journal)}; LS_ARGS="--kern-port 1"\n${wahl[0]}\n${weiter[0]}\nprintf '%s' "$LS_ARGS"`;
  return execFileSync('bash', ['-c', skript], { encoding: 'utf8' });
}

test('production start (no instance) passes --journal schlank, a test instance passes nothing', () => {
  assert.equal(leitstandArgs('', ''), '--kern-port 1 --journal schlank');
  assert.equal(leitstandArgs('a', ''), '--kern-port 1');
  assert.equal(leitstandArgs('i', ''), '--kern-port 1');
});

test('--journal of djk-start overrides both defaults', () => {
  assert.equal(leitstandArgs('', 'voll'), '--kern-port 1 --journal voll');
  assert.equal(leitstandArgs('c', 'schlank'), '--kern-port 1 --journal schlank');
  assert.equal(leitstandArgs('c', 'voll'), '--kern-port 1 --journal voll');
});

test('--journal is a known option with a value and another value is a usage error (return 2) naming the allowed values', () => {
  const werte = zeilen.find((z) => /^\s+--master\|--cue\|/.test(z));
  assert.ok(werte && /\|--journal[|)]/.test(werte), 'the option is in the list of options that need a value');
  assert.match(text, /--journal\) JOURNAL=\$2; shift 2;;/);
  const pruefung = zeilen.find((z) => /case "\$JOURNAL" in/.test(z));
  assert.ok(pruefung, 'the value is checked');
  assert.match(pruefung, /""\|voll\|schlank\) ;;/);
  assert.match(pruefung, /--journal '\$JOURNAL' invalid, use voll or schlank/);
  assert.match(pruefung, /exit 2/);
});

test('usage text and option list name --journal', () => {
  const kopf = zeilen.slice(0, zeilen.findIndex((z) => z.startsWith('set -uo')));
  assert.ok(kopf.some((z) => z.startsWith('#') && z.includes('[--journal voll|schlank]')), 'usage line');
  const eintrag = kopf.findIndex((z) => /^#   --journal /.test(z));
  assert.ok(eintrag >= 0, 'option list entry');
  const beschreibung = kopf.slice(eintrag, eintrag + 4).join(' ');
  assert.match(beschreibung, /schlank/);
  assert.match(beschreibung, /voll/);
});

test('the leitstand port is waited for 30 s (not 10 s), the comment names the measured 11 s for a 2 GB journal', () => {
  const i = zeilen.findIndex((z) => /^warte \d+ "\$U_LS" lauscht t "\$P_WS"/.test(z));
  assert.ok(i > 0, 'the wait line exists');
  assert.match(zeilen[i], /^warte 30 "\$U_LS" lauscht t "\$P_WS"/);
  const kommentar = zeilen.slice(Math.max(0, i - 4), i).filter((z) => z.startsWith('#')).join(' ');
  assert.match(kommentar, /11 s/);
  assert.match(kommentar, /2 GB/);
  // the other waits stay as they were
  assert.match(text, /^warte 10 "\$U_OF" lauscht t "\$P_OF"/m);
});

// --- the evaluation refuses a lean journal ---

const START_ZEILE = (daten: Record<string, unknown>, typ = 'set_start') => ({ sample: 0, beat: 0, takt: 1, mono_ns: 1, von: 'leitstand', typ, daten });
const schreibeJournal = (name: string, zs: unknown[]) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, zs.map((z) => JSON.stringify(z)).join('\n') + '\n');
  return p;
};

test('schlankGrund: a lean set_start or fortsetzung is a reason, full, absent or foreign lines are not', () => {
  const basis = { set_id: '2026-11-18_1200', generation: 1, vertrag: 1, konfiguration: {} };
  assert.match(schlankGrund([START_ZEILE({ ...basis, journal: 'schlank' })]) ?? '', /full journal/);
  assert.equal(schlankGrund([START_ZEILE({ ...basis, journal: 'voll' })]), null);
  assert.equal(schlankGrund([START_ZEILE(basis)]), null, 'a journal without the field is a full one');
  assert.equal(schlankGrund([]), null);
  // a full set continued by a lean process is lean from there on
  assert.match(schlankGrund([START_ZEILE({ ...basis, journal: 'voll' }), START_ZEILE({ ...basis, journal: 'schlank' }, 'fortsetzung')]) ?? '', /full journal/);
  assert.equal(schlankGrund([START_ZEILE({ ...basis, journal: 'voll' }), START_ZEILE({ ...basis, journal: 'voll' }, 'fortsetzung')]), null);
  // the word "schlank" inside another line is no reason
  assert.equal(schlankGrund([START_ZEILE(basis), { ...START_ZEILE({ journal: 'schlank' }, '/q') }]), null);
});

test('evaluation.ts refuses a lean journal with a clear message and a non-zero exit, before it reads the result file', () => {
  const basis = { set_id: '2026-11-18_1200', generation: 1, vertrag: 1, konfiguration: {} };
  const j = schreibeJournal('schlank.jsonl', [START_ZEILE({ ...basis, journal: 'schlank' })]);
  const r = spawnSync(process.execPath, [path.join(LEITSTAND, 'check', 'evaluation.ts'), '--ergebnis', path.join(tmp, 'gibtsnicht.json'), '--journal', j],
    { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /full journal/);
  assert.match(r.stderr, /schlank/);
  assert.doesNotMatch(r.stderr, /ENOENT/, 'the refusal comes first');
  assert.doesNotMatch(r.stdout, /^OK |^FEHL /m, 'no check ran');
});

test('negative control: a full journal is not refused for its mode (the tool goes on and fails later on the missing result file)', () => {
  const basis = { set_id: '2026-11-18_1200', generation: 1, vertrag: 1, konfiguration: {} };
  const j = schreibeJournal('voll.jsonl', [START_ZEILE({ ...basis, journal: 'voll' })]);
  const r = spawnSync(process.execPath, [path.join(LEITSTAND, 'check', 'evaluation.ts'), '--ergebnis', path.join(tmp, 'gibtsnicht.json'), '--journal', j],
    { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stderr, /full journal/);
  assert.match(r.stderr, /ENOENT/);
});
