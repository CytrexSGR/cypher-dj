// Session view M6: the routes /session/*, the scene tempo and the session event of SessionBereich. The core side is a double (every command is
// recorded and answered by the test); the live container is the real proj session of support/live_modul.mjs. Fixture pattern of loopdeck_route.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { liveAufbau } from './support/live_module.mjs';
import { loopdeckBereich } from '../areas/live/loopdeck.ts';
import { sessionBereich } from '../areas/live/session.ts';
import { sessionStand } from '../areas/live/session_state.ts';
import { neuesProjekt, sessionSzenen, sessionRaster } from '../project/model.ts';

const SHA = 'a'.repeat(64), SHB = 'b'.repeat(64);
const Z = (extra = {}) => ({ name: 'Loop', farbe: 3, art: 'loop', sha256: SHA, beats: 4, bpm: 120, gain_db: 0, ...extra });
const frames = (sha) => (sha === SHA ? 96000 : null);   // SHB is in the model but not decoded: zelle_laedt

// two decks (8 columns); row 1: columns 1, 2 (deck 1) and 5 (deck 2) hold a cell, column 6 a hold slot; row 2: column 3 and 7; row 3: only column 8 (not decoded)
async function aufbau(t, { projekt = true } = {}) {
  const z = await liveAufbau(t);
  const kern = { status: () => ({ status: 1, grund: '' }), gesendet: [], id: 1000, ki: false, quelle: 'andreas' };
  const ctx = { ...z.ctx,
    sende(adresse, felder) { const id = ++kern.id; kern.gesendet.push({ id, adresse, felder: { ...felder } }); return id; },
    async warteQuittung(id) { return kern.status(kern.gesendet.find((g) => g.id === id)); },
    kiGestoppt: () => kern.ki, quelle: () => kern.quelle };
  const verteilt = [];
  ctx.verteile = (e) => verteilt.push(e);
  const sperre = { an: false };
  const ld = loopdeckBereich(ctx, z.zugang, { jetzt: () => 5000, frames });
  const zugang = projekt ? z.zugang : { ...z.zugang, offen: () => ({ ...z.zugang.offen(), projekt: neuesProjekt('prod') }) };
  const bereich = sessionBereich(ctx, zugang, ld, { frames, ladenGesperrt: () => sperre.an });
  await z.aendern([{ befehl: 'loopdeck_neu', platz: 1 }, { befehl: 'loopdeck_neu', platz: 2 }]);
  const sp = () => z.projekt().spuren.filter((s) => s.zellen);
  const s = sp();
  await z.aendern([
    { befehl: 'zelle_setzen', spur_id: s[0].id, index: 1, zelle: Z({ name: 'c1.1' }) }, { befehl: 'zelle_setzen', spur_id: s[1].id, index: 1, zelle: Z({ name: 'c2.1' }) },
    { befehl: 'zelle_setzen', spur_id: s[4].id, index: 1, zelle: Z({ name: 'c5.1' }) }, { befehl: 'zelle_halten', spur_id: s[5].id, index: 1, an: true },
    { befehl: 'zelle_setzen', spur_id: s[2].id, index: 2, zelle: Z({ name: 'c3.2' }) }, { befehl: 'zelle_setzen', spur_id: s[6].id, index: 2, zelle: Z({ name: 'c7.2' }) },
    { befehl: 'zelle_setzen', spur_id: s[7].id, index: 3, zelle: Z({ name: 'c8.3', sha256: SHB }) },
    { befehl: 'zelle_aendern', spur_id: s[4].id, index: 1, raster: '1/2' },
  ]);
  const uhr = (beat, bpm = 120) => ld.ereignis('/uhr', { beat, bpm });
  const zelleEv = (n, f) => ld.ereignis('/zustand/zelle', { spur: sp()[n - 1].id, zelle: 0, verwaist: 0, ab_beat: 0, versatz_beats: 0, wartend: -1, wartend_ab: 0, ...f });
  const gesendet = (a) => kern.gesendet.filter((g) => g.adresse === a);
  return { ...z, bereich, ld, kern, ctx, verteilt, sp, uhr, zelleEv, gesendet, sperre };
}
const grund = (a) => a.j.grund;

test('GET /session/stand equals sessionStand of the open live project; with a production project open it is 409 kein_projekt', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  const a = z.bereich.stand();
  assert.equal(a.code, 200);
  const erwartet = sessionStand(z.projekt(), (id) => z.ld.spalten(z.projekt()).find((x) => x.spur.id === id).lauf, frames, { beat: 10.3, bpm: 120 });
  assert.deepEqual(a.j, erwartet);
  assert.equal(a.j.container[2].spalten.length, 4);
  const y = await aufbau(t, { projekt: false });
  const b = y.bereich.stand();
  assert.deepEqual([b.code, b.j.ok, b.j.grund, typeof b.j.text], [409, false, 'kein_projekt', 'string']);
  for (const f of [() => y.bereich.start({ spur_id: 'x', zelle: 1 }, 'andreas'), () => y.bereich.stopp({}, 'andreas'), () => y.bereich.szene({ zeile: 1 }, 'andreas'),
    () => y.bereich.raster({ raster: '1' }, 'andreas'), () => y.bereich.szeneNeu({}, 'andreas')]) assert.equal(grund(await f()), 'kein_projekt');
  assert.equal(y.kern.gesendet.length, 0);
});

test('POST /session/szene { zeile: 1 }: one ab_beat on the global grid for every column; an empty slot stops its column; a halten slot is in gehalten', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  const a = await z.bereich.szene({ zeile: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  const id = (...n) => n.map((i) => z.sp()[i - 1].id);
  assert.deepEqual(a.j, { ok: true, ab_beat: 12, gestartet: id(1, 2, 5), gestoppt: id(3, 7, 8), gehalten: id(6) });
  assert.equal(z.gesendet('/k/arr/zelle_start').length, 3);
  assert.equal(z.gesendet('/k/arr/zelle_stopp').length, 3);
  assert.deepEqual([...new Set(z.kern.gesendet.map((g) => g.felder.ab_beat))], [12], 'one grid point for all: a per-cell grid does not split a scene');
  assert.ok(!z.kern.gesendet.some((g) => g.felder.spur === id(6)[0]), 'the hold column gets nothing');
  assert.equal(z.gesendet('/k/tempo/rampe').length, 0);
});

test('a row without any cell: ok, nothing started; the columns that hold cells elsewhere stop', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  const a = await z.bereich.szene({ zeile: 8 }, 'andreas');
  assert.equal(a.code, 200);
  assert.deepEqual(a.j.gestartet, []);
  assert.deepEqual(a.j.gehalten, []);
  assert.equal(a.j.gestoppt.length, 6, 'the columns that hold cells in other rows stop');
  assert.equal(z.gesendet('/k/arr/zelle_start').length, 0);
  assert.equal((await z.bereich.szene({ zeile: 9 }, 'andreas')).code, 400);
});

test('POST /session/start: the cell raster when set, the request raster over both, the global grid otherwise; refusals', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  const a = await z.bereich.start({ spur_id: z.sp()[0].id, zelle: 1 }, 'andreas');   // no cell grid: global takt -> 12
  assert.deepEqual(a.j, { ok: true, ab_beat: 12 });
  const b = await z.bereich.start({ spur_id: z.sp()[4].id, zelle: 1 }, 'andreas');   // cell grid 1/2 -> 10.5
  assert.equal(b.j.ab_beat, 10.5);
  const c = await z.bereich.start({ spur_id: z.sp()[4].id, zelle: 1, raster: '1' }, 'andreas');   // request grid wins -> 11
  assert.equal(c.j.ab_beat, 11);
  assert.deepEqual(z.gesendet('/k/arr/zelle_start').at(-1).felder, { quelle: 'andreas', spur: z.sp()[4].id, zelle: 1, ab_beat: 11, versatz_beats: 0 });
  const x = await z.bereich.start({ spur_id: 'nope', zelle: 1 }, 'andreas');
  assert.deepEqual([x.code, grund(x)], [404, 'spur_unbekannt']);
  assert.equal(grund(await z.bereich.start({ spur_id: z.sp()[0].id, zelle: 5 }, 'andreas')), 'zelle_leer');
  assert.equal(grund(await z.bereich.start({ spur_id: z.sp()[5].id, zelle: 1 }, 'andreas')), 'zelle_leer', 'a hold slot is empty');
  assert.equal(grund(await z.bereich.start({ spur_id: z.sp()[7].id, zelle: 3 }, 'andreas')), 'zelle_laedt');
  for (const d of [{ spur_id: z.sp()[0].id, zelle: 9 }, { spur_id: z.sp()[0].id, zelle: 1, raster: 'x' }, { zelle: 1 }, { spur_id: z.sp()[0].id, zelle: 1, y: 1 }]) {
    assert.equal((await z.bereich.start(d, 'andreas')).code, 400, JSON.stringify(d));
  }
  const y = await aufbau(t);   // no /uhr yet
  const k = await y.bereich.start({ spur_id: y.sp()[0].id, zelle: 1 }, 'andreas');
  assert.deepEqual([k.code, grund(k)], [409, 'keine_uhr']);
  assert.equal(y.kern.gesendet.length, 0);
});

test('POST /session/stopp {} stops all columns that hold cells; { spur_id } one', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  const a = await z.bereich.stopp({}, 'andreas');
  assert.equal(a.code, 200);
  assert.equal(a.j.ab_beat, 12);
  assert.equal(a.j.gestoppt.length, 6, 'columns 1, 2, 3, 5, 7, 8 hold cells; 4 has none, 6 only a hold slot');
  assert.equal(z.gesendet('/k/arr/zelle_stopp').length, 6);
  const b = await z.bereich.stopp({ spur_id: z.sp()[2].id }, 'andreas');
  assert.deepEqual(b.j.gestoppt, [z.sp()[2].id]);
  assert.equal(grund(await z.bereich.stopp({ spur_id: 'nope' }, 'andreas')), 'spur_unbekannt');
});

test('cypher under Stop Cypher is refused 409 ki_gestoppt before anything is sent; andreas is not', async (t) => {
  const z = await aufbau(t);
  z.uhr(10);
  z.kern.ki = true;
  for (const f of [(q) => z.bereich.start({ spur_id: z.sp()[0].id, zelle: 1 }, q), (q) => z.bereich.stopp({}, q), (q) => z.bereich.szene({ zeile: 1 }, q),
    (q) => z.bereich.raster({ raster: '1' }, q), (q) => z.bereich.szeneNeu({}, q), (q) => z.bereich.szeneFangen({}, q), (q) => z.bereich.szeneLoeschen({ zeile: 1 }, q)]) {
    const a = await f('cypher');
    assert.deepEqual([a.code, a.j.ok, grund(a)], [409, false, 'ki_gestoppt']);
  }
  assert.equal(z.kern.gesendet.length, 0);
  assert.equal((await z.bereich.szene({ zeile: 1 }, 'andreas')).code, 200);
});

test('the write routes go through the commands: one undo step each; szene_neu without nach inserts after the last row with content', async (t) => {
  const z = await aufbau(t);
  const rev = () => z.projekt().rev;
  let r0 = rev();
  assert.equal((await z.bereich.raster({ raster: '1' }, 'andreas')).code, 200);
  assert.equal(sessionRaster(z.projekt()), '1');
  assert.equal(rev(), r0 + 1, 'one step');
  const a = await z.bereich.szeneAendern({ zeile: 2, name: 'Drop', farbe: 5, bpm: 130 }, 'andreas');
  assert.deepEqual(a.j, { ok: true });
  assert.deepEqual([sessionSzenen(z.projekt())[1].name, sessionSzenen(z.projekt())[1].bpm], ['Drop', 130]);
  assert.equal((await z.bereich.szeneAendern({ zeile: 2, bpm: null }, 'andreas')).code, 200);
  assert.equal(sessionSzenen(z.projekt())[1].bpm, undefined);
  assert.equal((await z.bereich.szeneAendern({ zeile: 2, x: 1 }, 'andreas')).code, 400);
  assert.equal((await z.bereich.szeneAendern({ zeile: 2 }, 'andreas')).code, 400);
  // content is in rows 1..3 (row 3 on column 8): the new row is row 4
  const n = await z.bereich.szeneNeu({}, 'andreas');
  assert.deepEqual(n.j, { ok: true, zeile: 4 });
  assert.equal(z.sp()[7].zellen[2].name, 'c8.3', 'rows above stay');
  const m = await z.bereich.szeneNeu({ nach: 0 }, 'andreas');
  assert.deepEqual(m.j, { ok: true, zeile: 1 });
  assert.equal(z.sp()[0].zellen[1].name, 'c1.1', 'rows moved down');
  const d = await z.bereich.szeneDoppeln({ zeile: 2 }, 'andreas');
  assert.deepEqual(d.j, { ok: true });
  assert.equal(z.sp()[0].zellen[2].name, 'c1.1');
  r0 = rev();
  const l = await z.bereich.szeneLoeschen({ zeile: 1 }, 'andreas');
  assert.deepEqual(l.j, { ok: true });
  assert.equal(rev(), r0 + 1);
  assert.equal(z.sp()[0].zellen[0].name, 'c1.1');
  assert.equal(grund(await z.bereich.szeneLoeschen({ zeile: 0 }, 'andreas')), 'argument_ungueltig');
});

test('szene_neu with row 8 in use is zeilen_voll', async (t) => {
  const z = await aufbau(t);
  await z.aendern([{ befehl: 'zelle_setzen', spur_id: z.sp()[0].id, index: 8, zelle: Z({ name: 'last' }) }]);
  const a = await z.bereich.szeneNeu({}, 'andreas');
  assert.deepEqual([a.code, grund(a)], [409, 'zeilen_voll']);
  const b = await z.bereich.szeneNeu({ nach: 2 }, 'andreas');
  assert.equal(grund(b), 'zeilen_voll');
  assert.equal(z.sp()[0].zellen[7].name, 'last', 'nothing shifted');
});

test('POST /session/szene_fangen {}: the playing cells become the new row; pending launches are ignored (acceptance k)', async (t) => {
  const z = await aufbau(t);
  z.uhr(10);
  z.zelleEv(1, { zelle: 1, ab_beat: 8 });                    // L1.1 plays cell 1
  z.zelleEv(7, { zelle: 2, ab_beat: 8 });                    // column 7 plays cell 2
  z.zelleEv(2, { zelle: 0, wartend: 1, wartend_ab: 16 });    // L1.2 only has a launch pending
  const a = await z.bereich.szeneFangen({}, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.deepEqual(a.j, { ok: true, zeile: 4 });
  const sp = z.sp();
  assert.equal(sp[0].zellen[3].name, 'c1.1');
  assert.equal(sp[6].zellen[3].name, 'c7.2');
  assert.equal(sp[1].zellen[3], null, 'the pending column is empty');
  assert.equal(sp.filter((s) => s.zellen[3]).length, 2);
  assert.notEqual(sp[0].zellen[3].id, sp[0].zellen[0].id, 'a copy: new id');
  // the command got zellen with null elsewhere
  const b = await z.bereich.szeneFangen({ nach: 0 }, 'andreas');
  assert.deepEqual(b.j, { ok: true, zeile: 1 });
  assert.equal(z.sp()[0].zellen[0].name, 'c1.1');
});

test('a scene with bpm sends /k/tempo/rampe at the same ab_beat once; none without bpm; Stop Cypher and a running freeze refuse (acceptance j)', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  await z.bereich.szeneAendern({ zeile: 1, bpm: 130 }, 'andreas');
  const a = await z.bereich.szene({ zeile: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.tempo, 130);
  const r = z.gesendet('/k/tempo/rampe');
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].felder, { quelle: 'andreas', ab_beat: a.j.ab_beat, ziel_bpm: 130, dauer_beats: 1 });
  assert.equal(z.gesendet('/k/arr/zelle_start').length, 3);
  // without bpm
  const n0 = z.gesendet('/k/tempo/rampe').length;
  await z.bereich.szene({ zeile: 2 }, 'andreas');
  assert.equal(z.gesendet('/k/tempo/rampe').length, n0);
  // a freeze runs: the scene is all or nothing
  const vorher = z.kern.gesendet.length;
  z.sperre.an = true;
  const b = await z.bereich.szene({ zeile: 1 }, 'andreas');
  assert.deepEqual([b.code, grund(b)], [409, 'beschaeftigt']);
  assert.equal(z.kern.gesendet.length, vorher, 'no start either');
  assert.equal((await z.bereich.szene({ zeile: 2 }, 'andreas')).code, 200, 'a scene without tempo is not held by the freeze');
  z.sperre.an = false;
  z.kern.ki = true;
  const c = await z.bereich.szene({ zeile: 1 }, 'cypher');
  assert.deepEqual([c.code, grund(c)], [409, 'ki_gestoppt']);
  assert.equal(z.gesendet('/k/tempo/rampe').length, 1);
});

test('a scene tempo without a core receipt answers tempo_abgelehnt kein_kern and no tempo; a core refusal carries its reason; the starts stay', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  await z.bereich.szeneAendern({ zeile: 1, bpm: 130 }, 'andreas');
  const echt = z.ctx.warteQuittung;
  z.ctx.warteQuittung = async (id) => (z.kern.gesendet.find((g) => g.id === id).adresse === '/k/tempo/rampe' ? null : echt(id));
  const a = await z.bereich.szene({ zeile: 1 }, 'andreas');
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.tempo_abgelehnt, 'kein_kern');
  assert.ok(!('tempo' in a.j));
  assert.equal(z.gesendet('/k/arr/zelle_start').length, 3);
  z.ctx.warteQuittung = async (id) => (z.kern.gesendet.find((g) => g.id === id).adresse === '/k/tempo/rampe' ? { status: 6, grund: 'tempo_ausser_bereich' } : echt(id));
  const b = await z.bereich.szene({ zeile: 1 }, 'andreas');
  assert.deepEqual([b.j.tempo, b.j.tempo_abgelehnt], [130, 'tempo_ausser_bereich']);
});

test('a mirror change emits both the loopdeck and the session event, once; an unchanged repeat emits none', async (t) => {
  const z = await aufbau(t);
  z.uhr(10);
  z.zelleEv(2, { zelle: 1, ab_beat: 8 });
  assert.equal(z.verteilt.filter((e) => e.a === 'loopdeck').length, 1);
  const s = z.verteilt.filter((e) => e.a === 'session');
  assert.equal(s.length, 1);
  assert.equal(s[0].f.spur_id, z.sp()[1].id);
  assert.equal(s[0].f.lauf.zelle, 1);
  z.zelleEv(2, { zelle: 1, ab_beat: 8 });
  assert.equal(z.verteilt.filter((e) => e.a === 'session').length, 1);
  z.ld.ereignis('/zustand/zelle', { spur: 'nope', zelle: 1, verwaist: 0, ab_beat: 0, versatz_beats: 0, wartend: -1, wartend_ab: 0 });
  assert.equal(z.verteilt.filter((e) => e.a === 'session').length, 1, 'an id that is no column is no event');
});

test('HTTP: the routes and their guards', async (t) => {
  const z = await aufbau(t);
  z.uhr(10.3);
  const routen = z.bereich.routen();
  assert.deepEqual(routen.map((r) => `${r.methode} ${r.pfad}`), ['GET /session/stand', 'POST /session/start', 'POST /session/stopp', 'POST /session/szene', 'POST /session/scheiben', 'POST /session/neue_zelle', 'POST /session/zum_sampler', 'POST /session/vorhoeren', 'POST /session/zelle', 'POST /session/huelle', 'POST /session/raster',
    'POST /session/szene_aendern', 'POST /session/szene_neu', 'POST /session/szene_fangen', 'POST /session/szene_doppeln', 'POST /session/szene_loeschen']);
  assert.ok(routen.filter((r) => r.methode === 'POST').every((r) => r.schutz === 'fremdePost'));
  const ruf = async (r, body) => {
    const q = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    const aus = { code: 0, text: '', writeHead(c) { this.code = c; }, end(s) { this.text = s; } };
    await r.handler(q, aus, new URL('http://x/'));
    return { code: aus.code, j: JSON.parse(aus.text) };
  };
  assert.equal((await ruf(routen[0])).j.container.length, 4);
  const a = await ruf(routen[3], { zeile: 1 });
  assert.deepEqual([a.code, a.j.ok, a.j.ab_beat], [200, true, 12]);
  const b = await ruf(routen[1], { spur_id: 'nope', zelle: 1 });
  assert.deepEqual([b.code, b.j.grund], [404, 'spur_unbekannt']);
});
