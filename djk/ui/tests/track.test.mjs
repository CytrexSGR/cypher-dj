// Studio S6 Task 1: Automationsspur prüfen und planen (reine Funktionen)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pruefeSpur, plane, oeffnetKanal, beatZuMono, wirtRuf } from '../track.ts';
import { oeffnet } from '../hand_operation.ts';
import { pruefeWirtOrdner } from './support/host_sock.mjs';

const FAHRBAR = new Set(['a_filter1_cutoff', 'a_filter1_resonance']);
const ok = (fahrten, name = 'probe') => pruefeSpur({ name, fahrten }, FAHRBAR);

test('pruefeSpur: gültige Spur mit allen drei Zielarten', () => {
  const r = ok([
    { ziel: 'erz/2/filter', ab_takt: 1, takte: 8, nach: -0.6 },
    { ziel: 'erz/2/fader', ab_takt: 9, takte: 4, nach: -200, form: 'linear' },
    { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 4, nach: -15, von: -45 },
    { ziel: 'strom:2', ab_takt: 13, muster: 'silence' },
  ]);
  assert.ok('spur' in r, JSON.stringify(r));
  assert.equal(r.spur.fahrten.length, 4);
});

test('pruefeSpur: Formfehler mit Ort', () => {
  assert.match(pruefeSpur({ name: 'X', fahrten: [] }, FAHRBAR).fehler, /^name/);
  assert.match(pruefeSpur({ name: 'a', fahrten: [] }, FAHRBAR).fehler, /^fahrten/);
  assert.match(ok([{ ziel: 'erz/2/filter', ab_takt: 0, nach: 0 }]).fehler, /fahrten\[0\]\.ab_takt/);
  assert.match(ok([{ ziel: 'erz/9/filter', ab_takt: 1, nach: 0 }]).fehler, /fahrten\[0\]\.ziel/);
  assert.match(ok([{ ziel: 'wirt:bass/a_filter1_type', ab_takt: 1, nach: 2 }]).fehler, /not a continuous Surge parameter/);
  assert.match(ok([{ ziel: 'erz/2/filter', ab_takt: 1, takte: 65, nach: 0 }]).fehler, /takte/);
  assert.match(ok([{ ziel: 'erz/2/filter', ab_takt: 1 }]).fehler, /nach/);
  assert.match(ok([{ ziel: 'erz/2/filter', ab_takt: 1, nach: 0, von: 1 }]).fehler, /von/);
  assert.match(ok([{ ziel: 'erz/2/filter', ab_takt: 1, nach: 0, form: 'kurve' }]).fehler, /form/);
  assert.match(ok([{ ziel: 'strom:2', ab_takt: 1, muster: 'silence', takte: 2 }]).fehler, /no takte\/nach/);
  assert.match(ok([{ ziel: 'strom:4', ab_takt: 1, muster: 'silence' }]).fehler, /ziel/);
  assert.match(ok([{ ziel: 'erz/2/filter', ab_takt: 1, nach: 0, muster: 'x' }]).fehler, /muster/);
});

test('pruefeSpur: Überlappung je Ziel abgewiesen, Folge und fremde Ziele erlaubt', () => {
  assert.match(ok([{ ziel: 'erz/2/filter', ab_takt: 1, takte: 8, nach: 0.5 }, { ziel: 'erz/2/filter', ab_takt: 5, takte: 2, nach: 0 }]).fehler,
    /fahrten\[1\]: overlaps/);
  assert.match(ok([{ ziel: 'strom:2', ab_takt: 3, muster: 'a' }, { ziel: 'strom:2', ab_takt: 3, muster: 'b' }]).fehler, /overlaps/);
  assert.ok('spur' in ok([{ ziel: 'erz/2/filter', ab_takt: 1, takte: 4, nach: 0.5 }, { ziel: 'erz/2/filter', ab_takt: 5, takte: 4, nach: 0 }]));
  assert.ok('spur' in ok([{ ziel: 'erz/2/filter', ab_takt: 1, takte: 8, nach: 0.5 }, { ziel: 'erz/3/filter', ab_takt: 1, takte: 8, nach: 0 }]));
});

test('plane: Beats ab Anker, Form, Politik, Aufteilung nach Ziel, Ende', () => {
  const { spur } = ok([
    { ziel: 'erz/2/fader', ab_takt: 9, takte: 4, nach: -200 },
    { ziel: 'erz/2/filter', ab_takt: 1, takte: 8, nach: -0.6, form: 'linear' },
    { ziel: 'erz/2/kill/tief', ab_takt: 3, nach: 1 },
    { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 2, takte: 2, nach: -15 },
    { ziel: 'strom:2', ab_takt: 13, muster: 'silence' },
  ]);
  const g = plane(spur, 64);
  assert.deepEqual(g.teile, [
    { pfad: 'erz/2/filter', ab_beat: 64, dauer_beats: 32, nach: -0.6, form: 0, politik: 0 },
    { pfad: 'erz/2/kill/tief', ab_beat: 72, dauer_beats: 0, nach: 1, form: 1, politik: 1 },
    { pfad: 'erz/2/fader', ab_beat: 96, dauer_beats: 16, nach: -200, form: 1, politik: 1 },
  ]);
  assert.deepEqual(g.wirt, [{ gruppe: 'bass', name: 'a_filter1_cutoff', ab_beat: 68, dauer_beats: 8, bis: -15, form: 'linear' }]);
  assert.deepEqual(g.muster, [{ strom: 2, text: 'silence', ab_beat: 112 }]);
  assert.equal(g.ende_beat, 112);
});

test('oeffnetKanal: Cyphers Spur darf ein Deck ausblenden, aber nicht wieder aufziehen; Strudel-Kanäle sind frei', () => {
  const zu = (f) => plane(ok(f).spur, 0).teile;
  const offen = { 'deck/1/fader': 0 };
  assert.equal(oeffnetKanal(offen, zu([{ ziel: 'deck/1/fader', ab_takt: 1, takte: 4, nach: -200 }])), null);
  assert.equal(oeffnetKanal(offen, zu([{ ziel: 'deck/1/fader', ab_takt: 1, takte: 4, nach: -200 }, { ziel: 'deck/1/fader', ab_takt: 6, nach: 0 }])),
    'deck/1/fader');
  assert.equal(oeffnetKanal({}, zu([{ ziel: 'deck/1/filter', ab_takt: 1, takte: 8, nach: 1 }])), null);   // Filter öffnet keinen Kanal
  assert.equal(oeffnetKanal({}, zu([{ ziel: 'deck/1/trim', ab_takt: 1, nach: 0 }, { ziel: 'deck/1/fader', ab_takt: 2, nach: -3 }])), 'deck/1/fader');
  // Andreas 2026-09-29: „ja sperre kann für strudel kanäle fallen" → erz/* öffnet ohne Hörschein
  assert.equal(oeffnetKanal({}, zu([{ ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: 0 }])), null);
  assert.deepEqual(offen, { 'deck/1/fader': 0 }, 'Eingabe bleibt unverändert');
});

test('oeffnet (hand_bedienung, gilt auch für /regler): erz frei, Deck und Pad gesperrt', () => {
  assert.equal(oeffnet({}, 'erz/3/fader', 0), false);
  assert.equal(oeffnet({}, 'deck/2/fader', 0), true);
  assert.equal(oeffnet({}, 'pad/1/fader', 0), true);
});

test('beatZuMono: Gerade durch (beat, mono_ns) mit bpm', () => {
  assert.equal(beatZuMono({ beat: 100, mono_ns: 5e9, bpm: 120 }, 104), 7);
  assert.equal(beatZuMono({ beat: 100, mono_ns: 5e9, bpm: 120 }, 100), 5);
  assert.equal(beatZuMono({ beat: 100, mono_ns: 5000000000n, bpm: 120 }, 96), 3);   // mono_ns darf bigint sein
});

test('wirtRuf: eine JSON-Zeile hin und zurück; fehlender Socket ist eine Antwort, kein Wurf', async (t) => {
  const ordner = pruefeWirtOrdner(fs.mkdtempSync(path.join(os.tmpdir(), 'djk-spur-')));   // V2 Fix-Runde 2 H4: Länge gegen sun_path
  const sock = path.join(ordner, 'wirt-bass.sock');
  const gesehen = [];
  const srv = net.createServer((c) => {
    let d = '';
    c.on('data', (b) => { d += b; if (d.endsWith('\n')) { gesehen.push(JSON.parse(d)); c.end('{"ok":true,"gehalten":2}\n'); } });
  });
  await new Promise((r) => srv.listen(sock, r));
  t.after(() => srv.close());
  assert.deepEqual(await wirtRuf(sock, { befehl: 'halte', spur: 'x' }), { ok: true, gehalten: 2 });
  assert.deepEqual(gesehen, [{ befehl: 'halte', spur: 'x' }]);
  const weg = await wirtRuf(path.join(ordner, 'gibtsnicht.sock'), { befehl: 'halte' });
  assert.equal(weg.ok, false); assert.match(weg.fehler, /ENOENT/);
});

test('Final-Review F5: faelligeMuster nach Beat, nicht nach Zeit (rein)', async () => {
  const { faelligeMuster, MUSTER_VORLAUF_BEATS } = await import('../track.ts');
  const m = [{ strom: 2, text: 'a', ab_beat: 36 }, { strom: 3, text: 'b', ab_beat: 44 }, { strom: 2, text: 'c', ab_beat: 36 }];
  const V = MUSTER_VORLAUF_BEATS;
  assert.deepEqual(faelligeMuster(m, 36 - V - 0.01), []);
  assert.deepEqual(faelligeMuster(m, 36 - V).map((x) => x.text), ['a', 'c']);
  assert.deepEqual(faelligeMuster(m, 100).map((x) => x.text), ['a', 'b', 'c']);
  assert.deepEqual(faelligeMuster([], 100), []);
});

test('S7 T1: Setzen vor Rampe am selben Takt erlaubt (wie Kern I4), umgekehrt und zwei Setzen abgewiesen', () => {
  const setzen = { ziel: 'erz/2/fader', ab_takt: 1, nach: -60 };
  const rampe = { ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: 0, form: 'linear' };
  assert.ok('spur' in ok([setzen, rampe]), 'Setzen zuerst: erlaubt');
  assert.match(ok([rampe, setzen]).fehler, /overlaps/, 'Setzen nach der Rampe am selben Beat: abgewiesen');
  assert.match(ok([setzen, { ...setzen, nach: 0 }]).fehler, /overlaps/, 'zwei Setzen am selben Beat');
  assert.match(ok([rampe, { ziel: 'erz/2/fader', ab_takt: 3, nach: 0 }]).fehler, /overlaps/, 'Setzen mitten in der Rampe');
  assert.ok('spur' in ok([rampe, { ziel: 'erz/2/fader', ab_takt: 5, nach: -200 }]), 'Setzen am Rampen-Ende (exklusiv)');
  // Wirt: dort ersetzt die Rampe das Setzen (host_control.py:90), also bleibt es abgewiesen
  const w = { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1 };
  assert.match(ok([{ ...w, nach: -40 }, { ...w, takte: 4, nach: 0 }]).fehler, /overlaps/, 'Wirt: Setzen + Rampe am selben Takt');
});

test('S7 T9: plane gibt form an den Wirt-Plan weiter (Vorgabe linear)', () => {
  const g = plane({ name: 'w', fahrten: [
    { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 2, nach: 0, von: -40, form: 's' },
    { ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 3, takte: 2, nach: -40 },
  ] }, 100);
  assert.deepEqual(g.wirt.map((w) => w.form), ['s', 'linear']);
});

// 1.12 S7 (M13) U12 T12.1 = S8 plan task 1: schleife_takte 1..64, every move inside one pass, no set on bar n+1, no pattern targets
test('S7 loop T12.1: schleife_takte 1..64, moves inside the pass, no set on bar n+1, no patterns', () => {
  const f = (fahrten, schleife_takte) => pruefeSpur({ name: 'l', fahrten, schleife_takte }, FAHRBAR);
  const rampe = { ziel: 'erz/2/fader', ab_takt: 1, takte: 4, nach: -30, form: 'linear' };
  assert.ok('spur' in f([{ ziel: 'erz/2/fader', ab_takt: 1, nach: 0 }, rampe], 4));
  assert.equal(f([rampe], 4).spur.schleife_takte, 4);
  assert.ok('spur' in f([rampe]), 'without schleife_takte as before');
  assert.equal('schleife_takte' in f([rampe]).spur, false, 'no key written when absent');
  for (const n of [0, 65, 2.5, '4', null]) assert.match(f([rampe], n).fehler, /schleife_takte/, String(n));
  assert.match(f([rampe], 3).fehler, /beyond the loop/, 'ramp ends behind n+1');
  assert.match(f([rampe, { ziel: 'erz/2/fader', ab_takt: 5, nach: -200 }], 4).fehler, /beyond the loop/, 'set on bar n+1');
  assert.match(f([{ ziel: 'strom:2', ab_takt: 1, muster: 'silence' }], 4).fehler, /pattern/, 'no pattern entry in a loop');
  // negative control: the same set on bar 5 and the same pattern entry are fine without a loop
  assert.ok('spur' in f([rampe, { ziel: 'erz/2/fader', ab_takt: 5, nach: -200 }]));
  assert.ok('spur' in f([{ ziel: 'strom:2', ab_takt: 1, muster: 'silence' }]));
  // a ramp that ends exactly at n+1 is inside (the end is exclusive); a wirt ramp too
  assert.ok('spur' in f([{ ziel: 'wirt:bass/a_filter1_cutoff', ab_takt: 1, takte: 4, nach: 0, von: -40 }], 4));
});

// 1.12 S7 (M13) U12 T12.2 = S8 plan task 2: one pass of a loop, shifted by k·4n beats, part numbers continue from teilNr
import { planeDurchlauf } from '../track.ts';
test('S7 loop T12.2: planeDurchlauf shifts by k·4n beats, part numbers count from teilNr, the end is the next start', () => {
  const spur = { name: 'l', schleife_takte: 2, fahrten: [
    { ziel: 'erz/2/fader', ab_takt: 1, nach: 0 }, { ziel: 'erz/2/fader', ab_takt: 1, takte: 2, nach: -30, form: 'linear' }] };
  const g0 = planeDurchlauf(spur, 100, 0, 0), g2 = planeDurchlauf(spur, 100, 2, 7);
  assert.deepEqual(g0.teile.map((t) => [t.ab_beat, t.nr]), [[100, 0], [100, 1]]);
  assert.deepEqual(g2.teile.map((t) => [t.ab_beat, t.nr]), [[116, 7], [116, 8]]);
  assert.equal(g2.anfang_beat, 116); assert.equal(g2.ende_beat, 124);
  // the end is the start of the next pass even when the last move ends earlier (a short ramp in a long loop)
  const kurz = planeDurchlauf({ ...spur, schleife_takte: 4 }, 0, 1, 0);
  assert.equal(kurz.anfang_beat, 16); assert.equal(kurz.ende_beat, 32);
  // negative control: k = 0 and teilNr 0 give the same parts as plane at that anchor
  assert.deepEqual(g0.teile.map(({ nr, ...t }) => t), plane(spur, 100).teile);
});
