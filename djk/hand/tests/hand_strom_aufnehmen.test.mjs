// Baukasten S15 task 4: proj_strom_aufnehmen, a stream bounce in one call, composed of existing page routes only.
// djk-hand over stdio against a stateful page fake: /lage beat rises by one per call, the project keeps tracks and clips.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HAND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hand.ts');
const DATEI = '/p/aufnahmen/take-3-1.wav';
const E = (o = {}) => ({ spur: 'Pad', strom: 3, graph: 'juno-pad', code: 'note("c3 e3 g3 c4")', takte: 1, ...o });

// One fake page per test. st is the mutable state; opt overrides single behaviours.
async function aufbau(t, opt = {}) {
  const st = {
    beat: 0, lageNachArm: 0, rev: 5, gestoppt: false, kein_projekt: false, lauf: null, gestartet: false, beatBeiStart: null, beatBeiStopp: null,
    stroeme: [{ strom: 1, autonom: true }, { strom: 2, autonom: true }, { strom: 3, autonom: true }],
    regler: { 'erz/3/bk/2': 0.7 },
    projekt: { tempo_bpm: 128, spuren: [
      { id: 's1', nr: 1, name: 'Pad', art: 'audio', clips: [] },
      { id: 's2', nr: 2, name: 'Keys', art: 'instrument', clips: [] }] },
    ...opt,
  };
  const gesehen = [];
  const antwort = (m, u, b) => {
    if (m === 'GET' && u === '/lage') {
      if (st.lageFehlerNachStart && st.gestartet) return [500, { fehler: 'kaputt', text: 'lage failed' }];
      if (st.lageFehlerNachArm && st.projekt.spuren.some((x) => x.aufnahme?.scharf) && st.lageNachArm++ >= 1) return [500, { fehler: 'kaputt', text: 'lage failed' }];
      st.beat += st.schritt ?? 1;
      return [200, { uhr: { beat: st.beat, takt: 1, schlag: 1, bpm: 128 }, ki: { gestoppt: st.gestoppt }, studio: { stroeme: st.stroeme }, regler: st.regler }];
    }
    if (m === 'GET' && u === '/proj/aktuell?nur=rev') return [200, st.kein_projekt ? { slug: null, rev: null } : { slug: 'p', rev: st.rev }];
    if (m === 'GET' && u === '/proj/aktuell?noten=zahl') return [200, st.kein_projekt ? { slug: null, projekt: null, kern: null } : { slug: 'p', projekt: st.projekt, kern: {} }];
    if (m === 'GET' && u === '/graphen') return [200, { graphen: [{ name: 'juno-pad', art: 'instrument' }, { name: 'fx-bandecho', art: 'effekt' }], uebersprungen: [], geladen: {} }];
    if (m === 'GET' && u === '/proj/aufnahme') return [200, { lauf: st.lauf, letzte: null }];
    if (m === 'POST' && u === '/graph' && st.graphAntwort) return st.graphAntwort;
    if (m === 'POST' && u === '/graph') return [200, { ok: true, kanal: b.kanal, name: b.name, quittung: { status: st.graphStatus ?? 3, grund: st.graphGrund ?? '' } }];
    if (m === 'POST' && u === '/strudel') return [200, { ok: true }];
    if (m === 'POST' && u === '/proj/aendern?antwort=kurz') {
      const c = b.befehle[0];
      if (st.disarmFehler && c.befehl === 'spur_aendern' && c.arm === false) return [409, { fehler: 'rev_veraltet', text: 'disarm failed' }];
      if (c.befehl === 'spur_neu') st.projekt.spuren.push({ id: 's3', nr: 3, name: c.name, art: 'audio', clips: [] });
      if (c.befehl === 'spur_aendern') st.projekt.spuren.find((s) => s.id === c.spur_id).aufnahme = { scharf: c.arm, eingang: c.eingang };
      if (c.befehl === 'clip_aendern') for (const s of st.projekt.spuren) for (const k of s.clips) if (k.id === c.clip_id) k.entstehung = c.entstehung;
      st.rev += 1;
      return [200, { rev: st.rev, kern: {} }];
    }
    if (m === 'POST' && u === '/proj/aufnahme' && b.aktion === 'start') {
      if (st.startAntwort) return st.startAntwort;
      st.gestartet = true; st.beatBeiStart = st.beat; st.lauf = { kennung: 3 };
      return [200, { aufnahme: 'laeuft', kennung: 3, spuren: [] }];
    }
    if (m === 'POST' && u === '/proj/aufnahme' && b.aktion === 'stopp') {
      if (st.stoppAntwort) return st.stoppAntwort;
      st.beatBeiStopp = st.beat; st.lauf = null;
      const s = st.projekt.spuren.find((x) => x.aufnahme?.scharf);
      if (st.takeFehler) return [200, { takes: [{ spur_id: s.id, fehler: 'leer', text: 'the take contains no audio; the file is kept', datei: DATEI }], rev: st.rev }];
      s.clips.push({ id: 'c7', art: 'audio', name: 'Take 3', start_beat: 0, laenge_beats: 4, quelle: { sha256: 'a'.repeat(64), pfad_hinweis: DATEI } });
      st.rev += 1;
      return [200, { takes: [{ spur_id: s.id, frames: 96000, luecken: 0, status: 0, datei: DATEI }], rev: st.rev }];
    }
    return null;
  };
  const server = http.createServer((q, a) => {
    let b = ''; q.on('data', (c) => { b += c; }); q.on('end', () => {
      const k = b ? JSON.parse(b) : null;
      gesehen.push({ methode: q.method, pfad: q.url, quelle: q.headers['x-djk-quelle'], koerper: k });
      const [code, j] = antwort(q.method, q.url, k) ?? [404, { fehler: 'unbekannt', text: q.url }];
      a.writeHead(code, { 'content-type': 'application/json' }); a.end(JSON.stringify(j));
    });
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const c = new Client({ name: 'test', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [HAND, '--seite', `http://127.0.0.1:${server.address().port}`],
    env: { ...process.env, DJK_HAND_STROM_POLL_MS: '5' } }));
  t.after(async () => { await c.close(); server.close(); });
  const ruf = async (a) => { const r = await c.callTool({ name: 'proj_strom_aufnehmen', arguments: a }); let j; try { j = JSON.parse(r.content[0].text); } catch { j = r.content[0].text; } return { fehler: !!r.isError, j }; };
  const posts = () => gesehen.filter((x) => x.methode === 'POST');
  return { st, gesehen, ruf, posts };
}

const kurz = (x) => (x.pfad === '/proj/aendern?antwort=kurz' ? `aendern:${x.koerper.befehle[0].befehl}` : x.pfad + (x.koerper?.aktion ? `:${x.koerper.aktion}` : ''));

test('happy path on an existing unarmed audio track: the POSTs arrive in the safe order, the take gets its provenance', async (t) => {
  const { st, gesehen, ruf, posts } = await aufbau(t);
  const r = await ruf(E({ takte: 2 }));
  assert.equal(r.fehler, false, JSON.stringify(r.j));
  assert.deepEqual(posts().map(kurz), ['/graph', '/strudel', 'aendern:spur_aendern', '/proj/aufnahme:start', '/proj/aufnahme:stopp', 'aendern:clip_aendern', 'aendern:spur_aendern']);
  const p = posts();
  assert.deepEqual(p[0].koerper, { kanal: 'erz/3', name: 'juno-pad' });
  assert.deepEqual(p[1].koerper, { strom: 3, text: 'note("c3 e3 g3 c4")' });
  assert.deepEqual(p[2].koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's1', arm: true, eingang: { art: 'intern', name: 'erz/3' } }]);
  assert.deepEqual(p[3].koerper, { aktion: 'start', von_beat: 0 });
  const entstehung = { art: 'strom', strom: 3, graph: 'juno-pad', regler: [0.5, 0.7, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], code: 'note("c3 e3 g3 c4")', bpm: 128 };
  assert.deepEqual(p[5].koerper.befehle, [{ befehl: 'clip_aendern', clip_id: 'c7', entstehung }]);
  assert.deepEqual(p[6].koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's1', arm: false }], 'the track is disarmed again');
  assert.equal(st.projekt.spuren[0].aufnahme.scharf, false);
  assert.ok(st.beatBeiStopp >= st.beatBeiStart + 4 * 2, `waited ${st.beatBeiStopp - st.beatBeiStart} beats for 2 bars`);
  assert.deepEqual({ spur_id: r.j.spur_id, clip_id: r.j.clip_id, spur_neu: r.j.spur_neu, entstehung: r.j.entstehung }, { spur_id: 's1', clip_id: 'c7', spur_neu: false, entstehung });
  assert.equal(r.j.take.datei, DATEI);
  assert.equal(r.j.graph_quittung.status, 3);
  assert.ok(gesehen.every((x) => x.quelle === 'cypher'), 'every call with x-djk-quelle cypher');
});

test('von_beat is passed to the recording; an already armed track on the same input is not armed again', async (t) => {
  const { st, ruf, posts } = await aufbau(t);
  st.projekt.spuren[0].aufnahme = { scharf: true, eingang: { art: 'intern', name: 'erz/3' } };
  const r = await ruf(E({ von_beat: 16 }));
  assert.equal(r.fehler, false, JSON.stringify(r.j));
  assert.deepEqual(posts().map(kurz), ['/graph', '/strudel', '/proj/aufnahme:start', '/proj/aufnahme:stopp', 'aendern:clip_aendern', 'aendern:spur_aendern']);
  assert.deepEqual(posts()[2].koerper, { aktion: 'start', von_beat: 16 });
});

test('a track name that does not exist is created before the arm: spur_neu audio, then the same chain', async (t) => {
  const { ruf, posts } = await aufbau(t);
  const r = await ruf(E({ spur: 'Bounce' }));
  assert.equal(r.fehler, false, JSON.stringify(r.j));
  assert.deepEqual(posts().map(kurz), ['/graph', '/strudel', 'aendern:spur_neu', 'aendern:spur_aendern', '/proj/aufnahme:start', '/proj/aufnahme:stopp', 'aendern:clip_aendern', 'aendern:spur_aendern']);
  assert.deepEqual(posts()[2].koerper.befehle, [{ befehl: 'spur_neu', art: 'audio', name: 'Bounce' }]);
  assert.equal(posts()[3].koerper.befehle[0].spur_id, 's3');
  assert.deepEqual(posts()[7].koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's3', arm: false }]);
  assert.equal(r.j.spur_neu, true);
  assert.equal(r.j.spur_id, 's3');
});

test('refusals come before the first write: not one POST for any of them', async (t) => {
  const falle = [
    ['ki_gestoppt', E(), (st) => { st.gestoppt = true; }],
    ['auto_aus', E(), (st) => { st.stroeme[2].autonom = false; }],
    ['kein_projekt', E(), (st) => { st.kein_projekt = true; }],
    ['falsche_art', E({ graph: 'fx-bandecho' })],
    ['unbekannt', E({ graph: 'nix' })],
    ['aufnahme_laeuft', E(), (st) => { st.lauf = { kennung: 9 }; }],
    ['andere_scharf', E(), (st) => { st.projekt.spuren.push({ id: 's9', nr: 9, name: 'Andreas', art: 'audio', clips: [], aufnahme: { scharf: true, eingang: { art: 'intern', name: 'erz/1' } } }); }, /s9/],
    ['spur_belegt', E(), (st) => { st.projekt.spuren[0].clips.push({ id: 'c1', art: 'audio', start_beat: 2, laenge_beats: 4 }); }, /c1/],
    ['falsche_art', E({ spur: 'Keys' })],
    ['strom', E({ strom: 1 })],
    ['takte', E({ takte: 0 })], ['takte', E({ takte: 65 })], ['takte', E({ takte: 1.5 })],
    ['code_zu_lang', E({ code: 'a'.repeat(20001) })],
    ['code', E({ code: '' })],
    ['graph', E({ graph: 'Juno Pad' })],
    ['spur', E({ spur: '' })],
    ['von_beat', E({ von_beat: -1 })],
  ];
  for (const [fehler, args, vorbereite, muster] of falle) {
    const { st, ruf, posts } = await aufbau(t);
    vorbereite?.(st);
    const r = await ruf(args);
    assert.equal(r.fehler, true, `${fehler}: expected a tool error, got ${JSON.stringify(r.j)}`);
    assert.equal(r.j.fehler, fehler, JSON.stringify(r.j));
    if (muster) assert.match(JSON.stringify(r.j), muster);
    assert.equal(posts().length, 0, `${fehler}: no POST at all`);
  }
  // negative control: the same arguments against a healthy page do write
  const { ruf, posts } = await aufbau(t);
  assert.equal((await ruf(E())).fehler, false);
  assert.ok(posts().length >= 5);
});

test('a kern refusal of the graph (quittung 6 pruefung) is the tool error; only /graph was posted', async (t) => {
  const { ruf, posts } = await aufbau(t, { graphStatus: 6, graphGrund: 'pruefung' });
  const r = await ruf(E());
  assert.equal(r.fehler, true);
  assert.equal(r.j.fehler, 'pruefung');
  assert.deepEqual(posts().map(kurz), ['/graph']);
});

test('recording start refused (409 beschaeftigt): tool error, no stopp, no clip_aendern; the answer lists what was done', async (t) => {
  const { ruf, posts } = await aufbau(t, { startAntwort: [409, { fehler: 'beschaeftigt', text: 'a freeze runs' }] });
  const r = await ruf(E());
  assert.equal(r.fehler, true);
  assert.equal(r.j.fehler, 'beschaeftigt');
  assert.deepEqual(r.j.detail.getan, ['graph', 'strudel', 'arm', 'disarm']);
  assert.deepEqual(posts().map(kurz), ['/graph', '/strudel', 'aendern:spur_aendern', '/proj/aufnahme:start', 'aendern:spur_aendern']);
  assert.deepEqual(posts().at(-1).koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's1', arm: false }], 'the failure path disarms');
  assert.ok(r.j.detail.getan.includes('disarm'));
});

test('/lage fails during the wait: the stopp is still posted, then the tool error', async (t) => {
  const { st, ruf, posts } = await aufbau(t, { lageFehlerNachStart: true });
  const r = await ruf(E());
  assert.equal(r.fehler, true);
  assert.deepEqual(posts().map(kurz).slice(-3), ['/proj/aufnahme:start', '/proj/aufnahme:stopp', 'aendern:spur_aendern']);
  assert.deepEqual(posts().at(-1).koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's1', arm: false }], 'the failed wait ends disarmed');
  assert.equal(st.projekt.spuren[0].aufnahme.scharf, false);
  assert.equal(posts().filter((x) => x.pfad === '/proj/aendern?antwort=kurz' && x.koerper.befehle[0].befehl === 'clip_aendern').length, 0, 'no provenance for a failed wait');
  assert.equal(st.lauf, null, 'the recording is over');
  assert.match(JSON.stringify(r.j), /lage/);
});

test('an empty take (fehler leer): tool error carrying the take entry, no clip_aendern', async (t) => {
  const { ruf, posts } = await aufbau(t, { takeFehler: true });
  const r = await ruf(E());
  assert.equal(r.fehler, true);
  assert.equal(r.j.fehler, 'leer');
  assert.equal(r.j.detail.take.datei, DATEI);
  assert.equal(posts().filter((x) => x.pfad === '/proj/aendern?antwort=kurz' && x.koerper.befehle[0].befehl === 'clip_aendern').length, 0);
  assert.deepEqual(posts().map(kurz).slice(-2), ['/proj/aufnahme:stopp', 'aendern:spur_aendern']);
  assert.deepEqual(posts().at(-1).koerper.befehle, [{ befehl: 'spur_aendern', spur_id: 's1', arm: false }], 'an empty take ends disarmed');
});

// Review round 2 (bk15), MAJOR: the pattern starts at the next bar line AFTER the new-pattern margin (Planer WECHSEL_ABSTAND 0.25 beat plus the
// erzeuger file poll, up to about 0.21 beat). A /strudel that lands just before a bar line therefore starts one bar later than the plain bar
// index says. The recording must open at or after (the bar after b0 + 0.5) + 0.5.
test('the bar wait keeps a margin: a clock read at beat 3.8 waits for 8.5, not 4.5', async (t) => {
  const { st, ruf } = await aufbau(t, { beat: 3.4, schritt: 0.2 });
  const r = await ruf(E());
  assert.equal(r.fehler, false, JSON.stringify(r.j));
  assert.ok(st.beatBeiStart >= 8.5, `the recording started at beat ${st.beatBeiStart}, before the pattern plays (8.5)`);
  // negative control: a clock read in the middle of a bar waits only for the next bar line (beat 4 + 0.5), not one more
  const m = await aufbau(t, { beat: 1.4, schritt: 0.2 });
  assert.equal((await m.ruf(E())).fehler, false);
  assert.ok(m.st.beatBeiStart >= 4.5 && m.st.beatBeiStart < 6, `mid bar: started at ${m.st.beatBeiStart}`);
});

// MINOR: the tool left the track armed (the next call on another track was refused andere_scharf, a later hand recording would record it too).
test('the track is disarmed after the stopp (existing track, new track, already armed track) and the next call on another track is not refused', async (t) => {
  const a = await aufbau(t);
  assert.equal((await a.ruf(E())).fehler, false);
  assert.equal(a.st.projekt.spuren[0].aufnahme.scharf, false, 'existing track');
  a.st.projekt.spuren.push({ id: 's5', nr: 5, name: 'Other', art: 'audio', clips: [] });
  const zweit = await a.ruf(E({ spur: 'Other', von_beat: 32 }));
  assert.equal(zweit.fehler, false, `no andere_scharf after the first call: ${JSON.stringify(zweit.j)}`);
  const n = await aufbau(t);
  assert.equal((await n.ruf(E({ spur: 'Fresh' }))).fehler, false);
  assert.equal(n.st.projekt.spuren.find((s) => s.name === 'Fresh').aufnahme.scharf, false, 'new track');
  const v = await aufbau(t);
  v.st.projekt.spuren[0].aufnahme = { scharf: true, eingang: { art: 'intern', name: 'erz/3' } };
  assert.equal((await v.ruf(E())).fehler, false);
  assert.equal(v.st.projekt.spuren[0].aufnahme.scharf, false, 'already armed track');
});

test('failure paths disarm too: the bar wait fails (no recording started), the stopp is refused', async (t) => {
  const w = await aufbau(t, { lageFehlerNachArm: true });
  const r = await w.ruf(E());
  assert.equal(r.fehler, true);
  assert.equal(r.j.fehler, 'uhr_nicht_lesbar');
  assert.equal(w.st.projekt.spuren[0].aufnahme.scharf, false, 'disarmed after the failed bar wait');
  assert.ok(r.j.detail.getan.includes('disarm'));
  assert.equal(w.posts().filter((x) => x.koerper?.aktion === 'start').length, 0);
  const s = await aufbau(t, { stoppAntwort: [409, { fehler: 'beschaeftigt', text: 'x' }] });
  const r2 = await s.ruf(E());
  assert.equal(r2.fehler, true);
  assert.equal(r2.j.fehler, 'beschaeftigt');
  assert.equal(s.st.projekt.spuren[0].aufnahme.scharf, false, 'disarmed after a refused stopp');
});

test('a refusal before the first write posts no disarm (nothing was armed)', async (t) => {
  const { st, ruf, posts } = await aufbau(t);
  st.gestoppt = true;
  assert.equal((await ruf(E())).fehler, true);
  assert.equal(posts().length, 0);
});

test('a failed disarm is reported, not hidden: the take stays, the answer carries the warning', async (t) => {
  const { st, ruf } = await aufbau(t, { disarmFehler: true });
  const r = await ruf(E());
  assert.equal(r.fehler, false, JSON.stringify(r.j));
  assert.equal(r.j.clip_id, 'c7');
  assert.match(String(r.j.warnung), /disarm/);
  assert.equal(st.projekt.spuren[0].aufnahme.scharf, true);
});

// MINOR: the kern/page refusal of a graph on a kit-mode stream is the tool error; only /graph was posted.
test('the kit-mode refusal of POST /graph (400 kein_midi_strom) is the tool error; only /graph was posted, nothing was done', async (t) => {
  const { ruf, posts } = await aufbau(t, { graphAntwort: [400, { fehler: 'kein_midi_strom', strom: 3, text: 'stream 3 runs in kit mode (notes are kit indices): load the instruments first' }] });
  const r = await ruf(E());
  assert.equal(r.fehler, true);
  assert.equal(r.j.fehler, 'kein_midi_strom');
  assert.match(r.j.text, /kit mode/);
  assert.deepEqual(r.j.detail.getan, []);
  assert.deepEqual(posts().map(kurz), ['/graph']);
});

// MINOR: the spur_belegt range boundaries. Range is von_beat .. von_beat + 4*takte + 1 (the recording runs a little past the wait).
test('spur_belegt boundaries: a clip ending exactly at von_beat or starting exactly at the range end passes, a small overlap is refused', async (t) => {
  const mit = async (clip, args) => {
    const x = await aufbau(t);
    x.st.projekt.spuren[0].clips.push({ id: 'c1', art: 'audio', ...clip });
    return x.ruf(E(args));
  };
  const frei1 = await mit({ start_beat: 12, laenge_beats: 4 }, { von_beat: 16 });
  assert.equal(frei1.fehler, false, `ends exactly at von_beat: ${JSON.stringify(frei1.j)}`);
  const belegt1 = await mit({ start_beat: 12, laenge_beats: 4.01 }, { von_beat: 16 });
  assert.deepEqual([belegt1.fehler, belegt1.j.fehler], [true, 'spur_belegt'], 'overlaps by 0.01 beat');
  const frei2 = await mit({ start_beat: 5, laenge_beats: 4 }, { takte: 1 });
  assert.equal(frei2.fehler, false, `starts exactly at the range end: ${JSON.stringify(frei2.j)}`);
  const belegt2 = await mit({ start_beat: 4.99, laenge_beats: 4 }, { takte: 1 });
  assert.deepEqual([belegt2.fehler, belegt2.j.fehler], [true, 'spur_belegt'], 'starts 0.01 beat inside the range');
});
