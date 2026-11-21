// Loop deck M5: the write routes neu, zelle, bewegen, raster, spur and leeren of LoopdeckBereich. Each is one undo step through the session's command
// path; the live container is the real proj session, the core is not involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ladeZelle } from '../areas/live/loopdeck.ts';
import { ldAufbau } from './support/loopdeck_write.mjs';

const SHA = 'a'.repeat(64);
const Z = (n) => ({ name: n, farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0 });
const fuell = (z, zellen) => z.aendern(zellen.map(([sp, zl, n]) => ({ befehl: 'zelle_setzen', spur_id: z.spuren()[sp - 1].id, index: zl, zelle: Z(n) })));

// the write is one revision and one undo brings the state back
async function einSchritt(z, f, merkmal) {
  const vor = merkmal(), rev = z.projekt().rev;
  const a = await f();
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.ok, true);
  assert.equal(z.projekt().rev, rev + 1, 'one revision');
  const nach = merkmal();
  assert.notDeepEqual(nach, vor, 'the write changed something');
  assert.equal((await z.undo()).code, 200);
  assert.deepEqual(merkmal(), vor, 'one undo restores the state');
  return a;
}

test('neu creates the deck once and is idempotent; the container is opened when there is none', async (t) => {
  const z = await ldAufbau(t, { container: false });
  const rev = z.projekt().rev;
  const a = await z.bereich.neu({ deck: 1, raster: '1' }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(z.o.geoeffnet, 1);
  const g = z.projekt().gruppen.find((x) => x.loopdeck);
  assert.deepEqual([a.j.ok, a.j.gruppe_id, g.loopdeck], [true, g.id, { platz: 1, raster: '1' }]);
  assert.equal(z.projekt().rev, rev + 1);
  const b = await z.bereich.neu({ deck: 1, raster: '4takte' }, 'andreas');
  assert.deepEqual([b.code, b.j.gruppe_id, z.projekt().rev, z.projekt().gruppen.find((x) => x.loopdeck).loopdeck.raster], [200, g.id, rev + 1, '1'], 'idempotent: nothing changes');
  assert.equal((await z.undo()).code, 200);
  assert.equal(z.projekt().gruppen.some((x) => x.loopdeck), false, 'one undo step');
  assert.equal((await z.bereich.neu({ deck: 3 }, 'andreas')).code, 400);
  assert.equal((await z.bereich.neu({ deck: 1, raster: 'x' }, 'andreas')).code, 400);
});

test('neu leaves a module alone: the module keeps its place and the deck takes another one', async (t) => {
  const z = await ldAufbau(t);
  await z.exportiere('A');
  const modul = z.projekt().gruppen.find((g) => g.modul);
  const ort = z.projekt().plaetze.findIndex((e) => e.typ === 'stems' && e.gruppe === modul.id);
  assert.equal(ort, 0, 'the module sits in place A (slot A)');
  const a = await z.bereich.neu({ deck: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.ok(z.projekt().gruppen.some((g) => g.modul), 'the module stays');
  assert.equal(z.projekt().plaetze[ort].typ, 'stems');
  assert.equal(z.projekt().plaetze.filter((e) => e.typ === 'loops').length, 1, 'the deck takes another place');
  assert.equal(z.zelle(1, 1), null);
});

test('zelle renames and changes a cell, leeren clears it; one undo step each', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  await fuell(z, [[2, 4, 'old']]);
  const sicht = () => JSON.stringify(z.zelle(2, 4));
  const a = await einSchritt(z, () => z.bereich.zelle({ deck: 1, spur: 2, zelle: 4, name: 'new', farbe: 9, art: 'einmal', gain_db: -6, beats: 2 }, 'andreas'), sicht);
  assert.deepEqual(a.j, { ok: true });
  await z.bereich.zelle({ deck: 1, spur: 2, zelle: 4, name: 'new', gain_db: -6 }, 'andreas');
  assert.deepEqual([z.zelle(2, 4).name, z.zelle(2, 4).gain_db, z.zelle(2, 4).sha256], ['new', -6, SHA]);
  await einSchritt(z, () => z.bereich.zelle({ deck: 1, spur: 2, zelle: 4, leeren: true }, 'andreas'), sicht);
  await z.bereich.zelle({ deck: 1, spur: 2, zelle: 4, leeren: true }, 'andreas');
  assert.equal(z.zelle(2, 4), null);
  const e = await z.bereich.zelle({ deck: 1, spur: 2, zelle: 4, name: 'x' }, 'andreas');
  assert.deepEqual([e.code, e.j.ok, e.j.grund], [409, false, 'zelle_leer']);
  for (const d of [{ deck: 1, spur: 2, zelle: 4 }, { deck: 1, spur: 2, zelle: 4, leeren: true, name: 'x' }, { deck: 1, spur: 9, zelle: 1, name: 'x' }, { deck: 1, spur: 1, zelle: 1, name: 'x', q: 1 }]) {
    assert.equal((await z.bereich.zelle(d, 'andreas')).code, 400, JSON.stringify(d));
  }
  assert.equal((await z.bereich.zelle({ deck: 2, spur: 1, zelle: 1, name: 'x' }, 'andreas')).j.grund, 'kein_loopdeck');
});

test('bewegen moves a cell within a deck and across decks, swapping with a filled target', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  assert.equal((await z.bereich.neu({ deck: 2 }, 'andreas')).code, 200);
  const alle = () => z.projekt().spuren.filter((s) => s.zellen);
  const stelle = (i, zl) => alle()[i].zellen[zl - 1]?.name ?? null;   // i 0..3 deck 1, 4..7 deck 2
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: alle()[0].id, index: 1, zelle: Z('a') }, { befehl: 'zelle_setzen', spur_id: alle()[4].id, index: 2, zelle: Z('b') }]);
  const sicht = () => [stelle(0, 1), stelle(0, 3), stelle(4, 2), stelle(5, 6)];
  await einSchritt(z, () => z.bereich.bewegen({ von: { deck: 1, spur: 1, zelle: 1 }, nach: { deck: 1, spur: 1, zelle: 3 } }, 'andreas'), sicht);
  await einSchritt(z, () => z.bereich.bewegen({ von: { deck: 1, spur: 1, zelle: 1 }, nach: { deck: 2, spur: 2, zelle: 6 } }, 'andreas'), sicht);
  await z.bereich.bewegen({ von: { deck: 1, spur: 1, zelle: 1 }, nach: { deck: 2, spur: 1, zelle: 2 } }, 'andreas');
  assert.deepEqual([stelle(0, 1), stelle(4, 2)], ['b', 'a'], 'swap with a filled target');
  const e = await z.bereich.bewegen({ von: { deck: 1, spur: 3, zelle: 1 }, nach: { deck: 1, spur: 3, zelle: 2 } }, 'andreas');
  assert.deepEqual([e.code, e.j.grund], [409, 'zelle_leer']);
  assert.equal((await z.bereich.bewegen({ von: { deck: 1, spur: 1, zelle: 1 } }, 'andreas')).code, 400);
});

test('raster sets the grid; spur sets fader, mute and filter; leeren clears the deck; one undo step each', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  await fuell(z, [[1, 1, 'a'], [4, 8, 'b']]);
  const deck = () => z.projekt().gruppen.find((g) => g.loopdeck);
  await einSchritt(z, () => z.bereich.raster({ deck: 1, raster: '1/2' }, 'andreas'), () => deck().loopdeck.raster);
  const sp = (n) => () => { const s = z.spuren()[n - 1]; return [s.fader_db, s.mute, s.filter]; };
  await einSchritt(z, () => z.bereich.spurAendern({ deck: 1, spur: 3, fader_db: -9 }, 'andreas'), sp(3));
  await einSchritt(z, () => z.bereich.spurAendern({ deck: 1, spur: 3, mute: true }, 'andreas'), sp(3));
  await einSchritt(z, () => z.bereich.spurAendern({ deck: 1, spur: 3, filter: -0.5 }, 'andreas'), sp(3));
  await z.bereich.spurAendern({ deck: 1, spur: 3, fader_db: -9, mute: true, filter: 0.25 }, 'andreas');
  assert.deepEqual(sp(3)(), [-9, true, 0.25]);
  await einSchritt(z, () => z.bereich.leeren({ deck: 1 }, 'andreas'), () => JSON.stringify(z.spuren().map((s) => s.zellen)));
  await z.bereich.leeren({ deck: 1 }, 'andreas');
  assert.deepEqual(z.spuren().flatMap((s) => s.zellen).filter(Boolean), []);
  for (const f of [() => z.bereich.raster({ deck: 1 }, 'andreas'), () => z.bereich.raster({ deck: 1, raster: 'x' }, 'andreas'),
    () => z.bereich.spurAendern({ deck: 1, spur: 1 }, 'andreas'), () => z.bereich.spurAendern({ deck: 1, spur: 1, filter: 2 }, 'andreas'), () => z.bereich.leeren({}, 'andreas')]) {
    assert.equal((await f()).code, 400);
  }
  for (const f of [() => z.bereich.raster({ deck: 2, raster: '1' }, 'andreas'), () => z.bereich.leeren({ deck: 2 }, 'andreas'), () => z.bereich.spurAendern({ deck: 2, spur: 1, mute: true }, 'andreas')]) {
    assert.equal((await f()).j.grund, 'kein_loopdeck');
  }
});

test('Cypher under Stop Cypher is refused on every write route and nothing changes', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  await fuell(z, [[1, 1, 'a']]);
  const rev = z.projekt().rev;
  z.zustand.ki = true;
  const b = z.bereich;
  const aufrufe = [() => b.neu({ deck: 2 }, 'cypher'), () => b.zelle({ deck: 1, spur: 1, zelle: 1, name: 'x' }, 'cypher'),
    () => b.bewegen({ von: { deck: 1, spur: 1, zelle: 1 }, nach: { deck: 1, spur: 1, zelle: 2 } }, 'cypher'), () => b.raster({ deck: 1, raster: '1' }, 'cypher'),
    () => b.spurAendern({ deck: 1, spur: 1, mute: true }, 'cypher'), () => b.leeren({ deck: 1 }, 'cypher')];
  for (const f of aufrufe) {
    const r = await f();
    assert.deepEqual([r.code, r.j.ok, r.j.grund], [409, false, 'ki_gestoppt']);
  }
  assert.equal(z.projekt().rev, rev);
  assert.equal((await b.raster({ deck: 1, raster: '1' }, 'andreas')).code, 200, 'Andreas is not stopped');
});

test('a project that is not the live container is open: every write route and ladeZelle answer 409 projekt_offen and change nothing', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  z.o.fremd = true;
  const vor = JSON.stringify(z.projekt());
  const rev = z.projekt().rev;
  const routen = [() => z.bereich.neu({ deck: 2 }, 'andreas'), () => z.bereich.laden({ deck: 1, quelle: { loop: 'x' } }, 'andreas'),
    () => z.bereich.zelle({ deck: 1, spur: 1, zelle: 1, name: 'n' }, 'andreas'), () => z.bereich.bewegen({ von: { deck: 1, spur: 1, zelle: 1 }, nach: { deck: 1, spur: 2, zelle: 1 } }, 'andreas'),
    () => z.bereich.raster({ deck: 1, raster: '1' }, 'andreas'), () => z.bereich.spurAendern({ deck: 1, spur: 1, mute: true }, 'andreas'), () => z.bereich.leeren({ deck: 1 }, 'andreas')];
  for (const f of routen) {
    const a = await f();
    assert.deepEqual([a.code, a.j.ok, a.j.grund, typeof a.j.text], [409, false, 'projekt_offen', 'string'], JSON.stringify(a.j));
    assert.match(a.j.text, /open the live container first/i);
  }
  await assert.rejects(() => ladeZelle(z.bereich, 1, {}, { loop: 'x' }, 'andreas'), (e) => e.grund === 'projekt_offen');
  assert.equal(z.o.geoeffnet, 0, 'the container was not opened');
  assert.equal(z.projekt().rev, rev);
  assert.equal(JSON.stringify(z.projekt()), vor, 'the project is unchanged');
});

test('no project open: a write creates the container; the live container open: it is kept', async (t) => {
  const a = await ldAufbau(t, { container: false });
  assert.equal((await a.bereich.neu({ deck: 1 }, 'andreas')).code, 200);
  assert.equal(a.o.geoeffnet, 1);
  const b = await ldAufbau(t, { deck: true });
  assert.equal((await b.bereich.neu({ deck: 1 }, 'andreas')).code, 200);
  assert.equal((await b.bereich.raster({ deck: 1, raster: '1' }, 'andreas')).code, 200);
  assert.equal(b.o.geoeffnet, 0);
});

test('a refused write opens nothing: a malformed body is 400 before the container is touched', async (t) => {
  const z = await ldAufbau(t, { container: false });
  for (const f of [() => z.bereich.neu({ deck: 3 }, 'andreas'), () => z.bereich.zelle({ deck: 1, spur: 9, zelle: 1, name: 'n' }, 'andreas'),
    () => z.bereich.raster({ deck: 1 }, 'andreas'), () => z.bereich.spurAendern({ deck: 1, spur: 1 }, 'andreas'), () => z.bereich.leeren({ deck: 0 }, 'andreas'),
    () => z.bereich.laden({ deck: 1, quelle: { x: 1 } }, 'andreas')]) {
    const a = await f();
    assert.equal(a.code, 400, JSON.stringify(a.j));
  }
  assert.equal(z.o.geoeffnet, 0);
});

test('a project that is being opened (in flight) is not closed by a write: projekt_offen and the project stays open', async (t) => {
  const z = await ldAufbau(t, { echt: true });
  assert.equal((await z.s.schliessen('andreas')).code, 200);
  const offen = z.s.neu('Production', 'andreas');   // queued in the session's chain: zugang.offen() does not show it yet
  assert.equal(z.zugang.offen(), null);
  await assert.rejects(() => ladeZelle(z.bereich, 1, {}, { loop: 'x' }, 'andreas'), (e) => e.grund === 'projekt_offen' && e.code === 409);
  assert.equal((await offen).code, 200);
  const a = z.s.aktuell().j.projekt;
  assert.equal(a.name, 'Production');
  assert.ok(!a.live, 'still the production project, not the live container');
  const b = await z.bereich.neu({ deck: 1 }, 'andreas');
  assert.deepEqual([b.code, b.j.grund], [409, 'projekt_offen']);
  assert.equal(z.s.aktuell().j.projekt.name, 'Production');
});

test('neu places each new deck at the first free place scanning C, D, A, B; platz_setzen moves a deck in one undo step', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  assert.equal((await z.bereich.neu({ deck: 2 }, 'andreas')).code, 200);
  const orte = () => z.projekt().plaetze.map((e) => (e.typ === 'loops' ? e.typ[0] + z.projekt().gruppen.find((g) => g.id === e.gruppe).loopdeck.platz : e.typ[0]));
  assert.deepEqual(orte(), ['t', 't', 'l1', 'l2']);
  const rev = z.projekt().rev;
  await z.aendern([{ befehl: 'platz_setzen', platz: 4, typ: 'track' }, { befehl: 'platz_setzen', platz: 1, typ: 'loops', gruppe_id: z.projekt().plaetze[3].gruppe ?? z.projekt().gruppen.find((g) => g.loopdeck?.platz === 2).id }]);
  assert.deepEqual(orte(), ['l2', 't', 'l1', 't']);
  assert.equal(z.projekt().rev, rev + 1);
  assert.equal((await z.undo()).code, 200);
  assert.deepEqual(orte(), ['t', 't', 'l1', 'l2'], 'one undo restores both places');
});

test('the stand carries ausgang_platz of each deck, derived from the places; a parked deck shows null', async (t) => {
  const z = await ldAufbau(t, { deck: true });
  assert.equal(z.bereich.stand().j.decks[1].ausgang_platz, 3, 'default: the first free place scanning C first');
  await z.aendern([{ befehl: 'platz_setzen', platz: 3, typ: 'track' }]);
  assert.equal(z.bereich.stand().j.decks[1].ausgang_platz, null, 'parked');
  const g = z.projekt().gruppen.find((x) => x.loopdeck);
  await z.aendern([{ befehl: 'platz_setzen', platz: 2, typ: 'loops', gruppe_id: g.id }]);
  assert.equal(z.bereich.stand().j.decks[1].ausgang_platz, 2);
});
