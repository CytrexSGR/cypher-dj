// Container core M8: POST /regler resolves the stream aliases erz/<n>/<suffix> onto the strom track of the strudel module (stream_alias.ts):
// the /k/teil carries the resolved row, inserts go through the project, refusals name the reason, the carve-out for strom rows is narrow.
// Real in-process page server on its own project folders, the core is a log: acks come from the test (pattern of container_source.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { echterServer } from './support/echter_server.mjs';
import { belegeTestInstanz } from './support/instance.mjs';
import { stromSpur } from '../project/model.ts';
import { RUECKWEG_MS } from '../areas/proj/session.ts';

belegeTestInstanz();
const CYPHER = { 'x-djk-quelle': 'cypher' };
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
const bis = async (f, ms = 3000) => { for (let i = 0; i < ms / 20 && !(await f()); i++) await warte(20); return f(); };
const teile = (s) => s.log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/teil');
const ack = (o, f) => o.vomKern({ adresse: '/q', felder: { id: f.id, quelle: f.quelle, status: 2, ist_sample: 0, ist_beat: 0, grund: '' } });

// POST /regler; the core double acks every part that arrives while the call waits
async function regler(s, body, kopf = CYPHER) {
  const n0 = teile(s).length;
  const p = s.post('/regler', body, kopf);
  let fertig = false;
  void p.then(() => { fertig = true; });
  for (let i = 0; i < 250 && !fertig; i++) {
    if (teile(s).length > n0) { ack(s.o, teile(s).at(-1).felder); break; }
    await warte(20);
  }
  return p;
}
const aendere = async (s, befehle) => {
  const r = await s.o.proj.sitzung.aendern({ rev: s.projekt().rev, label: 'test', befehle }, 'andreas');
  assert.equal(r.code, 200, JSON.stringify(r.j));
};

// live project (strudel module at place 3) with strom tracks 2 and 5, hall and delay returns, a compressor insert on stream 2
async function aufbau(t, versatz = 0, mitModul = true) {
  const s = await echterServer(t, 'ra', versatz);
  assert.equal((await s.post('/live/oeffnen', {})).code, 200);
  if (mitModul) {
    await aendere(s, [{ befehl: 'strom_spur_neu', strom: 2 }, { befehl: 'strom_spur_neu', strom: 5 }]);
    const spur = stromSpur(s.projekt(), 2);
    await aendere(s, [{ befehl: 'strom_send', spur_id: spur.id, ziel: 'hall', db: -6 }, { befehl: 'insert_setzen', strang_id: spur.id, pos: 0, art: 'komp' }]);
  }
  s.log.length = 0;   // the project setup sends its own parts to the core; the tests count only what /regler sends
  return s;
}

test('erz/2/fader without a strudel module placed: 409 kein_strudel_modul with the stream, the core saw nothing', async (t) => {
  const s = await aufbau(t, 0, false);
  await aendere(s, [{ befehl: 'platz_setzen', platz: 3, typ: 'leer' }]);
  const r = await regler(s, { pfad: 'erz/2/fader', nach: -6 });
  assert.deepEqual([r.code, r.j.fehler, r.j.strom], [409, 'kein_strudel_modul', 2], JSON.stringify(r.j));
  assert.equal(teile(s).length, 0);
});

test('without a live project: 409 kein_liveprojekt', async (t) => {
  const s = await echterServer(t, 'ra', 1);
  const r = await regler(s, { pfad: 'erz/2/fader', nach: -6 });
  assert.deepEqual([r.code, r.j.fehler], [409, 'kein_liveprojekt']);
  assert.equal(teile(s).length, 0);
});

test('with the module and strom track 2: /k/teil goes to spur/<nr>/fader, the answer is 200; a stream without a track gets one (R9), a stream outside the alias set is keine_strom_spur', async (t) => {
  const s = await aufbau(t, 2);
  const nr = stromSpur(s.projekt(), 2).nr;
  const r = await regler(s, { pfad: 'erz/2/fader', nach: -6 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(teile(s).at(-1).felder.pfad, `spur/${nr}/fader`);
  assert.equal(teile(s).at(-1).felder.nach, -6);
  assert.ok(!stromSpur(s.projekt(), 3), 'stream 3 has no track before the first alias write');
  const k = await regler(s, { pfad: 'erz/3/fader', nach: -6 });
  assert.equal(k.code, 200, JSON.stringify(k.j));
  const neu = stromSpur(s.projekt(), 3);
  assert.ok(neu, 'the alias write created the strom track of stream 3');
  assert.equal(teile(s).at(-1).felder.pfad, `spur/${neu.nr}/fader`);
  assert.equal(teile(s).at(-1).felder.nach, -6);
  const nr0 = s.projekt().spuren.length;
  assert.equal((await regler(s, { pfad: 'erz/3/mute', nach: 0 })).code, 200);
  assert.equal(s.projekt().spuren.length, nr0, 'a second write finds the track and creates none');
  const aus = await regler(s, { pfad: 'erz/4/fader', nach: -6 });
  assert.deepEqual([aus.code, aus.j.fehler], [409, 'keine_strom_spur']);
  assert.ok(!stromSpur(s.projekt(), 4), 'a stream outside the alias set gets no track');
});

test('ramp: takte 4 keeps the D8 shift logic on the alias key (a second overlapping call is shifted), the part carries the resolved row', async (t) => {
  const s = await aufbau(t, 3);
  const nr = stromSpur(s.projekt(), 2).nr;
  const a = await regler(s, { pfad: 'erz/2/fader', nach: -20, takte: 4, ab: 'takt' });
  assert.equal(a.code, 200, JSON.stringify(a.j));
  assert.equal(a.j.verschoben_auf, undefined);
  const b = await regler(s, { pfad: 'erz/2/fader', nach: -3, takte: 2, ab: 'takt' });
  assert.equal(b.code, 200, JSON.stringify(b.j));
  assert.ok(b.j.verschoben_auf > a.j.felder.ab_beat, 'the second ramp starts behind the first');
  assert.deepEqual(teile(s).map((z) => z.felder.pfad), [`spur/${nr}/fader`, `spur/${nr}/fader`]);
});

test('auto_aus for cypher on erz/2/fader when AUTO is off for stream 2; Andreas passes', async (t) => {
  const s = await aufbau(t, 4);
  assert.equal((await s.post('/strudel/autonom', { an: false, strom: 2 })).code, 200);
  const r = await regler(s, { pfad: 'erz/2/fader', nach: -6 });
  assert.deepEqual([r.code, r.j.fehler, r.j.strom], [409, 'auto_aus', 2], JSON.stringify(r.j));
  assert.equal(teile(s).length, 0);
  assert.equal((await regler(s, { pfad: 'erz/2/fader', nach: -6 }, {})).code, 200);
});

test('auto_aus also holds the direct row form: spur/<nr>/fader and mute of the strom track of stream 2 and POST /spur on it; Andreas and stream 5 pass', async (t) => {
  const s = await aufbau(t, 14);
  const nr2 = stromSpur(s.projekt(), 2).nr, nr5 = stromSpur(s.projekt(), 5).nr;
  assert.equal((await s.post('/strudel/autonom', { an: false, strom: 2 })).code, 200);
  for (const row of ['fader', 'mute']) {
    const r = await regler(s, { pfad: `spur/${nr2}/${row}`, nach: row === 'mute' ? 1 : -6 });
    assert.deepEqual([r.code, r.j.fehler, r.j.strom], [409, 'auto_aus', 2], `${row}: ${JSON.stringify(r.j)}`);
  }
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };
  const sp = await s.post('/spur', { spur: { name: 'sp', fahrten: [{ ziel: `spur/${nr2}/fader`, ab_takt: 2, nach: -6 }] } }, CYPHER);
  assert.deepEqual([sp.code, sp.j.fehler, sp.j.strom], [409, 'auto_aus', 2], JSON.stringify(sp.j));
  assert.equal(teile(s).length, 0, 'the core saw nothing');
  assert.equal((await regler(s, { pfad: `spur/${nr2}/fader`, nach: -6 }, {})).code, 200, 'Andreas is never held');
  assert.equal((await regler(s, { pfad: `spur/${nr5}/fader`, nach: -6 })).code, 200, 'stream 5 has AUTO on');
});

test('erz/2/komp/mix goes through the project as an insert value, takte > 0 is refused rampe_ueber_projekt, an on-switch is insert_an', async (t) => {
  const s = await aufbau(t, 5);
  const ins = () => stromSpur(s.projekt(), 2).inserts.find((i) => i.art === 'komp');
  const rev0 = s.projekt().rev;
  const r = await regler(s, { pfad: 'erz/2/komp/mix', nach: 0.5, takte: 0 });
  assert.equal(r.code, 200, JSON.stringify(r.j));
  assert.equal(ins().werte.mix, 0.5);
  assert.ok(s.projekt().rev > rev0);
  assert.equal(teile(s).filter((z) => String(z.felder.pfad).startsWith('erz/')).length, 0, 'no erz row reaches the core: the value went through the project');
  const rampe = await regler(s, { pfad: 'erz/2/komp/mix', nach: 0.9, takte: 2 });
  assert.deepEqual([rampe.code, rampe.j.fehler], [409, 'rampe_ueber_projekt']);
  assert.equal(ins().werte.mix, 0.5);
  assert.equal((await regler(s, { pfad: 'erz/2/komp/an', nach: 0 })).code, 200);
  assert.equal(ins().an, false);
  const ohne = await regler(s, { pfad: 'erz/5/komp/mix', nach: 0.5 });
  assert.deepEqual([ohne.code, ohne.j.fehler], [409, 'keine_komp_stufe']);
});

test('erz/2/send/1 resolves to the hall return row; send/3 is kein_modul_send; xseite is kein_alias_ziel', async (t) => {
  const s = await aufbau(t, 6);
  const nr = stromSpur(s.projekt(), 2).nr, hall = s.projekt().returns.find((x) => x.strudel?.art === 'hall');
  assert.equal((await regler(s, { pfad: 'erz/2/send/1', nach: -12 })).code, 200);
  assert.equal(teile(s).at(-1).felder.pfad, `spur/${nr}/send/${hall.nr}`);
  const n0 = teile(s).length;
  const f3 = await regler(s, { pfad: 'erz/2/send/3', nach: -12 });
  assert.deepEqual([f3.code, f3.j.fehler], [409, 'kein_modul_send']);
  for (const suffix of ['xseite']) {
    const r = await regler(s, { pfad: `erz/2/${suffix}`, nach: 1 });
    assert.deepEqual([r.code, r.j.fehler], [409, 'kein_alias_ziel'], suffix);
  }
  assert.equal(teile(s).length, n0, 'refusals send nothing');
});

test('pfl, trim and kill/tief write their own track rows (K7); the project is not asked (strom rows take direct writes)', async (t) => {
  const s = await aufbau(t, 7);
  const nr = stromSpur(s.projekt(), 2).nr;
  for (const [suffix, wert] of [['pfl', 1], ['trim', -3], ['kill/tief', 1]]) {
    const an = await regler(s, { pfad: `erz/2/${suffix}`, nach: wert });
    assert.equal(an.code, 200, `${suffix} ${JSON.stringify(an.j)}`);
    assert.deepEqual([teile(s).at(-1).felder.pfad, teile(s).at(-1).felder.nach], [`spur/${nr}/${suffix}`, wert], suffix);
  }
  s.o.vomKern({ adresse: '/e/regler', felder: { pfad: `spur/${nr}/kill/tief`, wert: 1, halter: 'cypher', sample: 0, beat: 0 } });
  assert.equal((await s.lage()).regler['erz/2/kill/tief'], 1, 'the core row is the state, read back under the alias key');
});

test('/e/regler echo of spur/<nr>/fader sets stand.regler under both keys and /lage shows the alias', async (t) => {
  const s = await aufbau(t, 8);
  const nr = stromSpur(s.projekt(), 2).nr;
  s.o.vomKern({ adresse: '/e/regler', felder: { pfad: `spur/${nr}/fader`, wert: -9, halter: 'frei', sample: 0, beat: 0 } });
  assert.equal(s.o.stand.regler[`spur/${nr}/fader`], -9);
  assert.equal(s.o.stand.regler['erz/2/fader'], -9);
  assert.equal((await s.lage()).regler['erz/2/fader'], -9);
});

test('follow-up: a move of Cypher on a strom row (halter cypher) is written into the project once, coalesced', async (t) => {
  const s = await aufbau(t, 9);
  const spur = stromSpur(s.projekt(), 2);
  const rev0 = s.projekt().rev;
  for (const w of [-30, -20, -10, -8]) s.o.vomKern({ adresse: '/e/regler', felder: { pfad: `spur/${spur.nr}/fader`, wert: w, halter: 'cypher', sample: 0, beat: 0 } });
  assert.ok(await bis(() => stromSpur(s.projekt(), 2).fader_db === -8, RUECKWEG_MS * 8), 'the last value reached the project');
  assert.equal(s.projekt().rev - rev0, 1, 'four events in one tick are one coalesced write (the last value)');
  const rev1 = s.projekt().rev;
  s.o.vomKern({ adresse: '/e/regler', felder: { pfad: `spur/${spur.nr}/fader`, wert: -8, halter: 'cypher', sample: 0, beat: 0 } });
  await warte(RUECKWEG_MS * 2);
  assert.equal(s.projekt().rev, rev1, 'the same value writes nothing');
  // a value that nobody holds (halter frei) is not written
  s.o.vomKern({ adresse: '/e/regler', felder: { pfad: `spur/${spur.nr}/fader`, wert: -40, halter: 'frei', sample: 0, beat: 0 } });
  await warte(RUECKWEG_MS * 2);
  assert.equal(stromSpur(s.projekt(), 2).fader_db, -8);
});

test('follow-up keeps the source of the move: Cypher on a strom row is logged as cypher, the hand as andreas, never mixed in one entry', async (t) => {
  const s = await aufbau(t, 12);
  const nr2 = stromSpur(s.projekt(), 2).nr, nr5 = stromSpur(s.projekt(), 5).nr;
  const verlauf = () => s.o.proj.sitzung.offen.verlauf.liste();
  const n0 = verlauf().length;
  s.o.vomKern({ adresse: '/e/regler', felder: { pfad: `spur/${nr2}/fader`, wert: -12, halter: 'cypher', sample: 0, beat: 0 } });
  assert.ok(await bis(() => stromSpur(s.projekt(), 2).fader_db === -12, RUECKWEG_MS * 8));
  assert.deepEqual(verlauf().slice(n0).map((e) => e.quelle), ['cypher'], 'Cypher moved it: the entry says cypher');
  s.o.vomKern({ adresse: '/e/regler', felder: { pfad: `spur/${nr5}/fader`, wert: -7, halter: 'plan:spur:x', sample: 0, beat: 0 } });
  s.o.vomKern({ adresse: '/e/regler', felder: { pfad: `spur/${nr2}/pan`, wert: 0.5, halter: 'mensch', sample: 0, beat: 0 } });
  assert.ok(await bis(() => stromSpur(s.projekt(), 5).fader_db === -7 && stromSpur(s.projekt(), 2).pan === 0.5, RUECKWEG_MS * 8));
  // the second cypher move coalesces into the first cypher entry of the gesture; the hand move is an entry of its own
  assert.deepEqual(verlauf().slice(n0).map((e) => e.quelle).sort(), ['andreas', 'cypher'], 'two sources are two entries, one per source');
});

test('a non-strom row spur/5/fader still answers 409 ueber_projekt (the carve-out is narrow); a strom row passes directly', async (t) => {
  const s = await aufbau(t, 10);
  const r = await regler(s, { pfad: 'spur/5/fader', nach: -6 });
  assert.deepEqual([r.code, r.j.fehler], [409, 'ueber_projekt'], JSON.stringify(r.j));
  assert.equal(teile(s).length, 0);
  const nr = stromSpur(s.projekt(), 2).nr;
  assert.equal((await regler(s, { pfad: `spur/${nr}/fader`, nach: -6 })).code, 200);
});

test('POST /spur with a move on erz/2/fader is accepted and sends the resolved row; spur/5/fader is refused ueber_projekt; erz/2/send/3 is refused', async (t) => {
  const s = await aufbau(t, 11);
  const nr = stromSpur(s.projekt(), 2).nr;
  const spur = (ziel, nach = -6) => ({ name: 'sp', fahrten: [{ ziel, ab_takt: 2, nach }] });
  const refused = await s.post('/spur', { spur: spur('spur/5/fader') }, CYPHER);
  assert.deepEqual([refused.code, refused.j.fehler], [409, 'ueber_projekt'], JSON.stringify(refused.j));
  const send3 = await s.post('/spur', { spur: spur('erz/2/send/3') }, CYPHER);
  assert.deepEqual([send3.code, send3.j.fehler], [409, 'kein_modul_send'], JSON.stringify(send3.j));
  s.o.kern.uhr = { beat: 16, bpm: 128, mono_ns: 0 };   // the page server reads the clock from its kern connection
  const n0 = teile(s).length;
  const p = s.post('/spur', { spur: spur('erz/2/fader') }, CYPHER);
  assert.ok(await bis(() => teile(s).length > n0), 'the part reaches the core');
  ack(s.o, teile(s).at(-1).felder);
  const ok = await p;
  assert.equal(ok.code, 200, JSON.stringify(ok.j));
  assert.equal(teile(s).at(-1).felder.pfad, `spur/${nr}/fader`, 'the core part carries the resolved row');
  assert.equal(teile(s).at(-1).felder.plan, 'spur:sp');
});
