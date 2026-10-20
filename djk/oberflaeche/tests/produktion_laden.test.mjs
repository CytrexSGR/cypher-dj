// PRODUCTION V1: Laden des Projektstands (laden.js): Server weg behält die Ansicht, die jüngste Ladung gewinnt
import test from 'node:test';
import assert from 'node:assert/strict';
import { ladeErgebnis, neuerLader, nurJuengste } from '../oeffentlich/produktion/laden.js';

const projekt = (rev) => ({ rev, name: 'P' });
const antwort = (rev) => ({ status: 200, j: { slug: 'p', projekt: projekt(rev) } });
function lader(antworten) {
  const protokoll = { uebernommen: [], geleert: 0, weg: [], da: 0 };
  const hole = () => (typeof antworten === 'function' ? antworten() : Promise.resolve(antworten.shift()));
  const lade = neuerLader({ hole, uebernimm: (slug, p) => protokoll.uebernommen.push(p.rev), leere: () => { protokoll.geleert++; },
    beiWeg: (r) => protokoll.weg.push(r.status), beiDa: () => { protokoll.da++; } });
  return { lade, protokoll };
}

test('V1 Laden: Status 0 und 5xx behalten den gezeigten Stand, alles andere ohne Projekt leert', async () => {
  assert.equal(ladeErgebnis({ status: 0, j: { fehler: 'netz' } }), 'behalten');
  assert.equal(ladeErgebnis({ status: 500, j: null }), 'behalten');
  assert.equal(ladeErgebnis({ status: 502, j: { fehler: 'oben_weg' } }), 'behalten');
  assert.equal(ladeErgebnis({ status: 503, j: null }), 'behalten');
  // Negativ-Kontrollen: ein Server, der „kein Projekt“ sagt, leert wirklich; ein Projekt wird übernommen
  assert.equal(ladeErgebnis({ status: 200, j: { slug: null, projekt: null, kern: null } }), 'leeren');
  assert.equal(ladeErgebnis({ status: 404, j: { fehler: 'nicht_gefunden' } }), 'leeren');
  assert.equal(ladeErgebnis({ status: 409, j: { fehler: 'kein_projekt' } }), 'leeren');
  assert.equal(ladeErgebnis({ status: 200, j: { slug: 'p', projekt: projekt(1) } }), 'uebernehmen');
  assert.equal(ladeErgebnis({ status: 499, j: null }), 'leeren', '4xx ist eine Antwort des Servers, kein Ausfall');
});

test('V1 Laden: Server weg und wieder da: der Stand bleibt, danach kommt der neue', async () => {
  const { lade, protokoll } = lader([antwort(3), { status: 0, j: { fehler: 'netz' } }, { status: 503, j: null }, antwort(5)]);
  assert.equal(await lade(), 'uebernehmen');
  assert.equal(await lade(), 'behalten');
  assert.equal(await lade(), 'behalten');
  assert.deepEqual(protokoll.uebernommen, [3], 'während des Ausfalls wird nichts übernommen');
  assert.equal(protokoll.geleert, 0, 'die Ansicht wird nie geleert');
  assert.deepEqual(protokoll.weg, [0, 503]);
  assert.equal(await lade(), 'uebernehmen');
  assert.deepEqual(protokoll.uebernommen, [3, 5]);
  assert.equal(protokoll.da, 2, 'beiDa nur bei Antworten des Servers');
});

test('V1 Laden: ohne Projekt leert die Ansicht (Negativ-Kontrolle zu „behalten“)', async () => {
  const { lade, protokoll } = lader([antwort(3), { status: 200, j: { slug: null, projekt: null, kern: null } }]);
  await lade();
  assert.equal(await lade(), 'leeren');
  assert.equal(protokoll.geleert, 1);
});

test('V1 Laden: zwei überlappende Ladungen, nur die Antwort der jüngsten gilt', async () => {
  for (const reihenfolge of ['alte zuerst', 'alte zuletzt']) {
    const offen = [];
    const { lade, protokoll } = lader(() => new Promise((ok) => offen.push(ok)));
    const a = lade(), b = lade();                        // a ist die ältere Ladung
    assert.equal(offen.length, 2);
    const frei = reihenfolge === 'alte zuerst' ? [[0, 4], [1, 6]] : [[1, 6], [0, 4]];
    for (const [i, rev] of frei) { offen[i](antwort(rev)); await Promise.resolve(); await Promise.resolve(); }
    assert.deepEqual([await a, await b], ['ueberholt', 'uebernehmen'], reihenfolge);
    assert.deepEqual(protokoll.uebernommen, [6], `${reihenfolge}: übernommen wird nur die jüngste, auch wenn die ältere später antwortet`);
  }
  // Negativ-Kontrolle: nacheinander (nicht überlappend) gilt jede
  const { lade, protokoll } = lader([antwort(1), antwort(2)]);
  await lade(); await lade();
  assert.deepEqual(protokoll.uebernommen, [1, 2]);
});

test('V1 Laden: nurJuengste verwirft die Antwort einer überholten Anfrage', async () => {
  const offen = [];
  const holen = nurJuengste(() => new Promise((ok) => offen.push(ok)));
  const a = holen(), b = holen();
  offen[1]('neu'); offen[0]('alt');
  assert.deepEqual(await a, { gilt: false });
  assert.deepEqual(await b, { gilt: true, r: 'neu' });
  const c = holen(); offen[2]('einzeln');
  assert.deepEqual(await c, { gilt: true, r: 'einzeln' });
});
