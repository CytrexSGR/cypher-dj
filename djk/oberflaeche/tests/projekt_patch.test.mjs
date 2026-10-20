// D1 S2-Kern, Patch: eigenes JSON-Patch (add/remove/replace/move), Pfade über IDs (Spec 3.3), Umkehrung, Erzeugung aus zwei Ständen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { wende, kehreUm, unterschied, PatchFehler } from '../projekt/patch.ts';
import { kanonisch } from '../projekt/modell.ts';
import { specProjekt, kopie, zufall, ohneAbgeleitetes } from './hilfen/projekt.mjs';

const gleich = (a, b, text) => assert.equal(kanonisch(a), kanonisch(b), text);

test('replace über ID-Pfad: /spuren/s2/clips/c2/noten/n1/ton (das Beispiel aus Spec 3.3)', () => {
  const p = specProjekt();
  const q = wende(p, [{ op: 'replace', pfad: '/spuren/s2/clips/c2/noten/n1/ton', wert: 40 }]);
  assert.equal(q.spuren[1].clips[0].noten[0].ton, 40);
  assert.equal(p.spuren[1].clips[0].noten[0].ton, 36, 'Eingabe bleibt unberührt');
});

test('add und remove: Objekt in ID-Liste (mit und ohne Position), Schlüssel in Objekt', () => {
  const p = specProjekt();
  const n = { id: 'n7', beat: 2, laenge: 1, ton: 40, vel: 90 };
  let q = wende(p, [{ op: 'add', pfad: '/spuren/s2/clips/c2/noten/n7', wert: n }]);
  assert.deepEqual(q.spuren[1].clips[0].noten.map((x) => x.id), ['n1', 'n7']);
  q = wende(q, [{ op: 'add', pfad: '/spuren/s2/clips/c2/noten/n0', wert: { ...n, id: 'n0' }, index: 0 }]);
  assert.deepEqual(q.spuren[1].clips[0].noten.map((x) => x.id), ['n0', 'n1', 'n7']);
  q = wende(q, [{ op: 'remove', pfad: '/spuren/s2/clips/c2/noten/n1' }]);
  assert.deepEqual(q.spuren[1].clips[0].noten.map((x) => x.id), ['n0', 'n7']);
  q = wende(q, [{ op: 'add', pfad: '/spuren/s2/geraet/parameter/cutoff', wert: 0.5 }]);
  assert.equal(q.spuren[1].geraet.parameter.cutoff, 0.5);
  q = wende(q, [{ op: 'remove', pfad: '/spuren/s2/geraet/parameter/cutoff' }]);
  assert.deepEqual(q.spuren[1].geraet.parameter, {});
});

const FEHLER = [
  ['unbekannte Spur-ID', { op: 'replace', pfad: '/spuren/s99/name', wert: 'x' }, 'pfad_unbekannt'],
  ['unbekannter Clip', { op: 'remove', pfad: '/spuren/s2/clips/c99' }, 'pfad_unbekannt'],
  ['Array-Index statt ID', { op: 'replace', pfad: '/spuren/0/name', wert: 'x' }, 'pfad_unbekannt'],
  ['Array-Index am Ende', { op: 'remove', pfad: '/spuren/1' }, 'pfad_unbekannt'],
  ['add auf vorhandenen Schlüssel', { op: 'add', pfad: '/spuren/s1/name', wert: 'x' }, 'existiert_schon'],
  ['add mit vorhandener ID', { op: 'add', pfad: '/spuren/s1', wert: { id: 's1' } }, 'existiert_schon'],
  ['add mit anderer ID im Wert', { op: 'add', pfad: '/spuren/s9', wert: { id: 's8' } }, 'id_passt_nicht'],
  ['remove eines fehlenden Schlüssels', { op: 'remove', pfad: '/spuren/s1/gibtsnicht' }, 'pfad_unbekannt'],
  ['replace eines fehlenden Schlüssels', { op: 'replace', pfad: '/spuren/s1/gibtsnicht', wert: 1 }, 'pfad_unbekannt'],
  ['unbekannte Operation', { op: 'copy', pfad: '/name', wert: 1 }, 'op_unbekannt'],
  ['Pfad ohne Anfangsstrich', { op: 'replace', pfad: 'name', wert: 'x' }, 'pfad_ungueltig'],
  ['leerer Pfadteil', { op: 'replace', pfad: '/spuren//name', wert: 'x' }, 'pfad_ungueltig'],
  ['Wurzel', { op: 'replace', pfad: '', wert: {} }, 'pfad_ungueltig'],
  ['__proto__', { op: 'add', pfad: '/__proto__/x', wert: 1 }, 'pfad_ungueltig'],
  ['index hinter dem Ende', { op: 'add', pfad: '/spuren/s9', wert: { id: 's9' }, index: 7 }, 'index_bereich'],
];
for (const [name, op, grund] of FEHLER) {
  test(`wende lehnt ab: ${name}`, () => {
    const p = specProjekt(); const vorher = kanonisch(p);
    assert.throws(() => wende(p, [op]), (e) => e instanceof PatchFehler && e.grund === grund, `erwartet ${grund}`);
    assert.equal(kanonisch(p), vorher, 'Eingabe unverändert');
  });
}

test('wende ist atomar: scheitert die zweite Operation, bleibt auch das Ergebnis der ersten unsichtbar (Eingabe unberührt)', () => {
  const p = specProjekt(); const vorher = kanonisch(p);
  assert.throws(() => wende(p, [{ op: 'replace', pfad: '/name', wert: 'neu' }, { op: 'remove', pfad: '/spuren/s99' }]), PatchFehler);
  assert.equal(kanonisch(p), vorher);
});

test('kehreUm: add ↔ remove, replace ↔ replace; Reihenfolge umgekehrt; Rundlauf auf einer Operationsfolge', () => {
  const p = specProjekt();
  const ops = [
    { op: 'replace', pfad: '/tempo_bpm', wert: 100 },
    { op: 'add', pfad: '/spuren/s2/clips/c2/noten/n5', wert: { id: 'n5', beat: 1, laenge: 1, ton: 41, vel: 80 }, index: 0 },
    { op: 'remove', pfad: '/spuren/s2/clips/c2/noten/n1' },
    { op: 'replace', pfad: '/spuren/s3/freeze', wert: { datei: 'freeze/s3-1.f32', frames: 10, kennung: 1, sha256: 'a'.repeat(64) } },
  ];
  const zurueck = kehreUm(ops, p);
  assert.deepEqual(zurueck.map((o) => o.op), ['replace', 'add', 'remove', 'replace']);
  assert.equal(zurueck[0].pfad, '/spuren/s3/freeze'); assert.equal(zurueck[0].wert, null);
  assert.equal(zurueck[1].pfad, '/spuren/s2/clips/c2/noten/n1'); assert.equal(zurueck[1].index, 0 + 1, 'n1 stand nach dem Einfügen von n5 an Position 1');
  gleich(wende(wende(p, ops), zurueck), p, 'vor, dann zurück ergibt den Ausgang');
});

test('kehreUm kopiert die Werte: spätere Änderung am Patch ändert das Projekt nicht und umgekehrt', () => {
  const p = specProjekt();
  const ops = [{ op: 'remove', pfad: '/spuren/s1' }];
  const z = kehreUm(ops, p);
  z[0].wert.name = 'Verändert';
  assert.equal(p.spuren[0].name, 'Kick');
  const q = wende(p, ops); const r = wende(q, kehreUm(ops, p));
  r.spuren[0].name = 'x'; assert.equal(p.spuren[0].name, 'Kick');
});

test('unterschied: gleiche Stände → leer; Rev und Wiedergabe-Rev zählen nicht; Änderung genau eine Operation mit ID-Pfad', () => {
  const p = specProjekt();
  assert.deepEqual(unterschied(p, kopie(p)), []);
  const q = kopie(p); q.rev = 99; q.wiedergabe_rev = 98;
  assert.deepEqual(unterschied(p, q), []);
  const r = kopie(p); r.spuren[1].clips[0].noten[0].ton = 40;
  assert.deepEqual(unterschied(p, r), [{ op: 'replace', pfad: '/spuren/s2/clips/c2/noten/n1/ton', wert: 40 }]);
});

test('unterschied: Hinzufügen/Entfernen mit Position, Umordnen ist ein move auf der ID (Spec 6.6), freeze null ↔ Objekt, Typwechsel', () => {
  const p = specProjekt();
  const a = kopie(p); a.spuren[1].clips[0].noten.unshift({ id: 'n0', beat: 3, laenge: 1, ton: 50, vel: 100 });
  assert.deepEqual(unterschied(p, a), [{ op: 'add', pfad: '/spuren/s2/clips/c2/noten/n0', wert: a.spuren[1].clips[0].noten[0], index: 0 }]);
  const b = kopie(p); b.spuren.splice(0, 1);
  assert.deepEqual(unterschied(p, b), [{ op: 'remove', pfad: '/spuren/s1' }]);
  const c = kopie(p); c.spuren.reverse();
  const oc = unterschied(p, c); assert.ok(oc.length >= 1 && oc.length <= 2 && oc.every((o) => o.op === 'move' && /^\/spuren\/s\d$/.test(o.pfad)), JSON.stringify(oc));
  assert.ok(!oc.some((o) => /\/\d+(\/|$)/.test(o.pfad)), 'nie ein Index im Pfad');
  const d = kopie(p); d.spuren[2].freeze = { datei: 'f', frames: 1, kennung: 1, sha256: 'a'.repeat(64) };
  assert.deepEqual(unterschied(p, d), [{ op: 'replace', pfad: '/spuren/s3/freeze', wert: d.spuren[2].freeze }]);
  for (const [x, y] of [[p, a], [p, b], [p, c], [p, d], [d, p]]) gleich(wende(x, unterschied(x, y)), y);
});

// Fuzz: zufällige strukturelle Änderungen; jeder Schritt muss vor- und zurückgehen (gleiche Folge, fester Seed)
test('Fuzz 300 Änderungen: wende(vor) ergibt den neuen Stand, wende(zurueck) den alten; Patch übersteht JSON', () => {
  const rnd = zufall(20261015); const wahl = (a) => a[Math.floor(rnd() * a.length)];
  let p = specProjekt(); let zaehler = 100; let n = 0;
  const mut = {
    wert: (q) => { const s = wahl(q.spuren); if (!s) return; s.fader_db = Math.round(rnd() * 100) / 10; },
    name: (q) => { if (q.spuren.length) wahl(q.spuren).name = 'S' + Math.floor(rnd() * 1000); },
    noteNeu: (q) => { const c = q.spuren.flatMap((s) => s.clips).filter((c2) => c2.art === 'midi'); if (c.length) { const cl = wahl(c); cl.noten.splice(Math.floor(rnd() * (cl.noten.length + 1)), 0, { id: `n${++zaehler}`, beat: rnd() * 8, laenge: 1, ton: 30 + Math.floor(rnd() * 30), vel: 100 }); } },
    noteWeg: (q) => { const c = q.spuren.flatMap((s) => s.clips).filter((c2) => c2.art === 'midi' && c2.noten.length); if (c.length) { const cl = wahl(c); cl.noten.splice(Math.floor(rnd() * cl.noten.length), 1); } },
    clipNeu: (q) => { const s = wahl(q.spuren.filter((x) => x.art === 'instrument')); if (!s) return; s.clips.push({ id: `c${++zaehler}`, art: 'midi', name: 'm', start_beat: rnd() * 8, laenge_beats: 4, noten: [] }); },
    clipWeg: (q) => { const s = wahl(q.spuren.filter((x) => x.clips.length)); if (s) s.clips.splice(Math.floor(rnd() * s.clips.length), 1); },
    spurWeg: (q) => { if (q.spuren.length > 1) q.spuren.splice(Math.floor(rnd() * q.spuren.length), 1); },
    spurNeu: (q) => { q.spuren.splice(Math.floor(rnd() * (q.spuren.length + 1)), 0, { id: `s${++zaehler}`, nr: 5, name: 'n', farbe: '#000000', art: 'audio', fader_db: 0, pan: 0, mute: false, solo: false, clips: [] }); },
    umordnen: (q) => { q.spuren.reverse(); },
    freeze: (q) => { const s = q.spuren.find((x) => x.art === 'instrument' && x.geraet.art === 'wirt'); if (s) s.freeze = s.freeze ? null : { datei: 'f', frames: 5, kennung: 1, sha256: 'a'.repeat(64) }; },
    param: (q) => { const s = q.spuren.find((x) => x.art === 'instrument' && x.geraet.art === 'intern'); if (s) { if (rnd() < 0.5) s.geraet.parameter.cutoff = rnd(); else delete s.geraet.parameter.cutoff; } },
    taktart: (q) => { q.taktart = rnd() < 0.5 ? [4, 4] : [3, 4]; },
  };
  const namen = Object.keys(mut);
  for (let i = 0; i < 300; i++) {
    const q = kopie(p); for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) mut[wahl(namen)](q);
    const vor = unterschied(p, q);
    const jsonVor = JSON.parse(JSON.stringify(vor));
    const zurueck = kehreUm(jsonVor, p);
    gleich(wende(p, jsonVor), q, `Schritt ${i} vor`);
    assert.equal(ohneAbgeleitetes(wende(q, JSON.parse(JSON.stringify(zurueck)))), ohneAbgeleitetes(p), `Schritt ${i} zurück (dekodiert ist abgeleitet, Spec 6.6)`);
    if (vor.length) n++;
    p = q;
  }
  assert.ok(n > 120, `genug echte Änderungen im Lauf (${n})`);
});
