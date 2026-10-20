// D1 S2-Integration, dritte Fix-Runde G6 (Spec 6.32): proj_oeffnen und proj_neu liefern wie proj_aendern eine schmale Antwort. /proj/oeffnen und
// /proj/neu mit ?antwort=kurz: slug, rev, Spuren (Clips ohne Noten, je MIDI-Clip noten_zahl), noten_zahl je Clip und die Kern-Meldungen; ohne Abfrage
// (die Seite) das ganze Projekt wie bisher. Vorher galt die Abfrage dort nicht: das Werkzeug bekam bei 10.000 Noten rund 0,6 MB, bei 60.000 rund
// 3,6 MB (Quality-Re-Review, route_stapel.oeffnen_bytes). Gemessen über die Route (Seiten-Server mit Kern-Attrappe).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { ruf, CYPHER } from './hilfen/proj_stapel.mjs';

const noten = (n, ab = 0) => Array.from({ length: n }, (_, i) => ({ beat: ((ab + i) % 4000) / 8, laenge: 0.1, ton: 36 + ((ab + i) % 48), vel: 90 }));
const bytes = (j) => Buffer.byteLength(JSON.stringify(j));

test('G6 /proj/neu und /proj/oeffnen mit ?antwort=kurz: slug, rev, spuren ohne Noten, noten_zahl, kern; ohne Abfrage das ganze Projekt', { timeout: 60_000 }, async (t) => {
  const { url } = await stapel(t);
  const neu = await ruf(url, 'POST', '/proj/neu?antwort=kurz', { name: 'Kurz' }, CYPHER);
  console.log(`G6 neu kurz ${JSON.stringify(neu)}`);
  assert.equal(neu.code, 200, JSON.stringify(neu.j));
  assert.deepEqual(Object.keys(neu.j).sort(), ['kern', 'noten_zahl', 'rev', 'slug', 'spuren']);
  assert.deepEqual([neu.j.slug, neu.j.rev, neu.j.spuren, neu.j.noten_zahl], ['kurz', 0, [], {}]);
  assert.equal(typeof neu.j.kern.wiedergabe.nr, 'number', 'Kern-Meldungen bleiben');
  const a = await ruf(url, 'POST', '/proj/aendern?antwort=kurz', { rev: 0, label: 'Bass', befehle: [{ befehl: 'spur_neu', art: 'instrument' },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 0, laenge_beats: 4, noten: noten(3) },
    { befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: 4, laenge_beats: 4 }] }, CYPHER);
  assert.equal(a.code, 200);
  const o = await ruf(url, 'POST', '/proj/oeffnen?antwort=kurz', { slug: 'kurz' }, CYPHER);
  console.log(`G6 oeffnen kurz ${JSON.stringify(o)}`);
  assert.equal(o.code, 200, JSON.stringify(o.j));
  assert.equal(o.j.projekt, undefined);
  assert.deepEqual([o.j.slug, o.j.rev], ['kurz', 1]);
  assert.deepEqual(o.j.noten_zahl, { c1: 3, c2: 0 });
  assert.deepEqual(o.j.spuren.map((s) => [s.id, s.nr, s.art, s.clips.map((c) => [c.id, c.noten_zahl, 'noten' in c])]),
    [['s1', 1, 'instrument', [['c1', 3, false], ['c2', 0, false]]]], 'Spuren und Clips mit Zahl, ohne Noten');
  assert.equal(o.j.spuren[0].von, 'cypher');
  // Fehler bleiben Fehler (Grund), auch mit ?antwort=kurz
  const unbekannt = await ruf(url, 'POST', '/proj/oeffnen?antwort=kurz', { slug: 'gibtsnicht' }, CYPHER);
  assert.ok(unbekannt.code >= 400 && typeof unbekannt.j.fehler === 'string', JSON.stringify(unbekannt));
  // Negativ-Kontrolle: die Seite fragt ohne Abfrage und bekommt das ganze Projekt
  const voll = await ruf(url, 'POST', '/proj/oeffnen', { slug: 'kurz' });
  assert.equal(voll.code, 200);
  assert.equal(voll.j.projekt.spuren[0].clips[0].noten.length, 3);
  const vollNeu = await ruf(url, 'POST', '/proj/neu', { name: 'Voll' });
  assert.equal(vollNeu.j.projekt.rev, 0);
});

// Messung (berichtet; Grenze nur für kurz): Antwortgröße von /proj/oeffnen und /proj/neu, voll (die Seite) und kurz (Werkzeug)
for (const zahl of [10_000, 60_000]) {
  test(`G6 Antwortgröße von /proj/oeffnen bei ${zahl} Noten über die Route: voll gegen kurz`, { timeout: 600_000 }, async (t) => {
    const { url } = await stapel(t);
    let rev = (await ruf(url, 'POST', '/proj/neu', { name: `G${zahl}` })).j.projekt.rev;
    const aendere = async (befehle) => {
      const r = await ruf(url, 'POST', '/proj/aendern?antwort=kurz', { rev, label: 'x', befehle });
      assert.equal(r.code, 200, JSON.stringify(r.j).slice(0, 300)); rev = r.j.rev; return r;
    };
    await aendere([{ befehl: 'spur_neu', art: 'instrument' }, { befehl: 'spur_neu', art: 'audio' }]);
    for (let ab = 0, c = 0; ab < zahl; ab += 10_000, c++) {
      await aendere([{ befehl: 'clip_neu', spur_id: 's1', art: 'midi', start_beat: c * 512, laenge_beats: 512, noten: noten(Math.min(10_000, zahl - ab), ab) }]);
    }
    const slug = `g${zahl}`;
    const voll = await ruf(url, 'POST', '/proj/oeffnen', { slug });
    const kurz = await ruf(url, 'POST', '/proj/oeffnen?antwort=kurz', { slug });
    const neuKurz = await ruf(url, 'POST', '/proj/neu?antwort=kurz', { name: `N${zahl}` });
    const m = { noten: zahl, oeffnen_voll_bytes: bytes(voll.j), oeffnen_kurz_bytes: bytes(kurz.j), neu_kurz_bytes: bytes(neuKurz.j),
      noten_zahl: Object.values(kurz.j.noten_zahl ?? {}).reduce((x, y) => x + y, 0) };
    console.log(`G6 GROESSE ${JSON.stringify(m)}`);
    assert.equal(m.noten_zahl, zahl);
    assert.ok(m.oeffnen_kurz_bytes < 4000, JSON.stringify(m));
    assert.ok(m.oeffnen_voll_bytes > 100 * m.oeffnen_kurz_bytes, 'voll trägt die Noten');
  });
}
