// Bereich-Kontext (Plan 2026-10-15-d1-s1, Task 9; Spec D1 2.10): ein Bereich, der nur über den Kontext arbeitet, bekommt Schutz,
// Quelle, KI-Stopp, den gemeinsamen id-Zähler, Quittungen, SSE und Log genau wie die Bestandsrouten. Kern-Attrappe, kein Ton.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stapel } from './hilfen/mediathek.mjs';
import { innen } from './hilfen/innen.mjs';
import { json, koerper } from '../http/transport.ts';

const warte = (ms) => new Promise((r) => setTimeout(r, ms));
// KI-Stopp über die Attrappe auslösen (nicht per vomKern einspeisen): sie meldet alle 50 ms /zustand/kern mit ki_gestoppt und würde ein
// eingespeistes /e/ki zurücksetzen (gemessen: 4 von 40 rot). Wie stoppCypher in schutznetz.test.mjs.
const stoppCypher = async (i, an) => {
  i.kern.sende(an ? '/k/ki/stopp' : '/k/ki/frei', { id: i.naechsteId(), quelle: 'andreas' });
  for (let t = 0; t < 2000 && i.kiGestoppt !== an; t += 20) await warte(20);
  assert.equal(i.kiGestoppt, an, `Stop Cypher ${an ? 'gesetzt' : 'gelöst'}: Rückmeldung der Attrappe fehlt`);
};
function pruefBereich(ctx) {
  return { name: 'pruef', routen: () => [
    { methode: 'GET', pfad: '/pruef/quelle', schutz: 'offen', handler: (_q, a) => json(a, 200, { quelle: ctx.quelle(), ki: ctx.kiGestoppt() }) },
    { methode: 'POST', pfad: '/pruef/tempo', schutz: 'fremdePost', handler: async (q, a) => {
      const d = await koerper(q);
      const id = ctx.sende('/k/tempo/rampe', { quelle: ctx.quelle(), ab_beat: 0, ziel_bpm: Number(d.bpm ?? 128), dauer_beats: 4 });
      json(a, 200, { id, quittung: await ctx.warteQuittung(id) });
    } },
  ] };
}

test('Kontext: Quelle je Anfrage, KI-Stopp, Schutz fremdePost vor dem Handler, gemeinsamer id-Zähler, Quittung, SSE, Log', async (t) => {
  const { o, url, log } = await stapel(t);
  const i = innen(o);
  const ctx = o.bereichKontext();
  o.meldeBereich(pruefBereich(ctx));
  assert.throws(() => o.meldeBereich(pruefBereich(ctx)), /Bereich pruef ist schon gemeldet/);
  const quelle = async (kopf = {}) => (await fetch(`${url}/pruef/quelle`, { headers: kopf })).json();
  assert.deepEqual(await quelle(), { quelle: 'andreas', ki: false });
  assert.deepEqual(await quelle({ 'x-djk-quelle': 'cypher' }), { quelle: 'cypher', ki: false });
  assert.equal(ctx.quelle(), 'andreas', 'außerhalb einer Anfrage andreas');
  await stoppCypher(i, true);
  assert.equal((await quelle()).ki, true);
  await stoppCypher(i, false);

  const n0 = i.gesendet;
  const roh = await fetch(`${url}/pruef/tempo`, { method: 'POST', body: '{}' });
  assert.deepEqual([roh.status, (await roh.json()).fehler], [415, 'nur_json'], 'Schutz des Routers gilt auch für Bereiche');
  const fremd = await fetch(`${url}/pruef/tempo`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://boese.example' }, body: '{}' });
  assert.equal(fremd.status, 403);
  assert.equal(i.gesendet, n0, 'abgewiesen: nichts an den Kern');
  const r = await (await fetch(`${url}/pruef/tempo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"bpm":126}' })).json();
  assert.equal(i.gesendet, n0 + 1, 'sende zählt gesendet');
  assert.equal(typeof r.id, 'number');
  assert.equal(i.naechsteId(), r.id + 1, 'derselbe id-Zähler wie die Bestandsrouten');
  const an = log.find((z) => z.typ === 'an_kern' && z.adresse === '/k/tempo/rampe');
  assert.deepEqual(an.felder, { id: r.id, quelle: 'andreas', ab_beat: 0, ziel_bpm: 126, dauer_beats: 4 }, 'id steht vorn, Felder unverändert');
  assert.notEqual(r.quittung, null, 'die Attrappe quittiert, warteQuittung reicht sie durch');

  const ereignisse = [];
  const ac = new AbortController(); t.after(() => ac.abort());
  (async () => { const s = await fetch(`${url}/strom`, { signal: ac.signal }); for await (const teil of s.body) ereignisse.push(new TextDecoder().decode(teil)); })().catch(() => {});
  for (let n = 0; n < 50 && ereignisse.length === 0; n++) await warte(20);
  ctx.verteile({ a: 'proj', f: { slug: 'pruef', rev: 1 } });
  for (let n = 0; n < 50 && !ereignisse.join('').includes('"a":"proj"'); n++) await warte(20);
  assert.ok(ereignisse.join('').includes('data: {"a":"proj","f":{"slug":"pruef","rev":1}}'), 'verteile geht an /strom');
  ctx.log({ typ: 'pruef_log', x: 1 });
  assert.ok(log.some((z) => z.typ === 'pruef_log' && z.x === 1));
});

// Spec D1 2.10, Haken ereignis?: ein Bereich bekommt jedes Kern-Ereignis, das vomKern verarbeitet, auch die, die nicht an /strom
// durchgereicht werden. Echter Weg: POST /regler → Attrappe → /e/regler → vomKern → Haken. Kein Ton.
test('Haken ereignis: /e/regler über die Attrappe kommt an; nicht durchgereichte Adressen auch; werfender Haken stört den Kern nicht', async (t) => {
  const { o, url, log } = await stapel(t);
  const i = innen(o);
  const gesehen = [];
  // Reihenfolge im Haken selbst festhalten: ist stand.regler zu diesem Zeitpunkt schon nachgezogen? (nach der Warteschleife wäre es immer so)
  o.meldeBereich({ name: 'lauscher', routen: () => [], ereignis: (adresse, felder) => gesehen.push({ adresse, felder,
    nachgezogen: adresse !== '/e/regler' || i.stand.regler[felder.pfad] === felder.wert }) });
  o.meldeBereich({ name: 'kaputt', routen: () => [], ereignis: () => { throw new Error('boese'); } });
  o.meldeBereich({ name: 'ohne-haken', routen: () => [] });
  const r = await fetch(`${url}/regler`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pfad: 'color/art', nach: 1, ab: 'jetzt' }) });
  assert.equal(r.status, 200);
  for (let n = 0; n < 100 && !gesehen.some((e) => e.adresse === '/e/regler' && e.felder.pfad === 'color/art'); n++) await warte(20);
  const e = gesehen.find((x) => x.adresse === '/e/regler' && x.felder.pfad === 'color/art');
  assert.ok(e, `der Bereich hat /e/regler color/art nie gesehen: ${JSON.stringify(gesehen.slice(0, 5))}`);
  assert.equal(typeof e.felder.wert, 'number');
  assert.equal(e.nachgezogen, true, 'der Haken kommt nach der Zustandsführung: stand.regler war im Haken schon nachgezogen');
  assert.equal(i.stand.regler['color/art'], e.felder.wert);
  // nicht durchgereicht (Negativ-Kontrolle für „am Ende, vor dem Durchreichen-Rückkehr“): /zustand/box erreicht /strom nie, den Haken schon
  i.vomKern('/zustand/box', { box: 1, belegt: 0 });
  assert.deepEqual(gesehen.filter((x) => x.adresse === '/zustand/box').map((x) => x.felder), [{ box: 1, belegt: 0 }]);
  assert.ok(log.some((z) => z.typ === 'bereich_ereignis_fehler' && z.bereich === 'kaputt' && z.adresse === '/e/regler'), 'der Wurf steht im Log');
});

// Der Haken bekommt eine eingefrorene Kopie, nicht das lebende Objekt: vomKern legt dieselben felder in stand.* ab und verteilt sie an /strom.
// Ein schreibender Haken (auch verschachtelt) darf weder Stand noch SSE verändern. Ohne Haken entsteht keine Kopie (Router.ereignis kehrt bei this.haken.length === 0 zurück; getestet in router.test.mjs).
// Eingefroren wird die KOPIE: das lebende Objekt in stand.loops bleibt beschreibbar und ist nicht dasselbe Objekt wie im Haken.
test('Haken ereignis: bekommt eine eingefrorene Kopie; ein schreibender Haken lässt Stand und SSE unverändert', async (t) => {
  const { o, url } = await stapel(t);
  const i = innen(o);
  const versuche = [];
  let imHaken = null;
  o.meldeBereich({ name: 'schreiber', routen: () => [], ereignis: (adresse, felder) => {
    if (adresse !== '/e/loop') return;
    imHaken = felder;
    versuche.push(Object.isFrozen(felder) && Object.isFrozen(felder.tags));
    for (const schreib of [() => { felder.name = 'boese'; }, () => { felder.tags.push('boese'); }, () => { delete felder.box; }]) {
      try { schreib(); } catch { /* eingefroren: Wurf ist erwünscht, der Kern wird davon nicht gestört */ }
    }
  } });
  const ereignisse = [];
  const ac = new AbortController(); t.after(() => ac.abort());
  (async () => { const s = await fetch(`${url}/strom`, { signal: ac.signal }); for await (const teil of s.body) ereignisse.push(new TextDecoder().decode(teil)); })().catch(() => {});
  for (let n = 0; n < 50 && ereignisse.length === 0; n++) await warte(20);
  i.vomKern('/e/loop', { box: 7, name: 'original', tags: ['a'] });
  for (let n = 0; n < 50 && !ereignisse.join('').includes('"a":"/e/loop"'); n++) await warte(20);
  assert.deepEqual(versuche, [true], 'der Haken lief und bekam eine tief eingefrorene Kopie');
  assert.deepEqual(i.stand.loops['7'], { box: 7, name: 'original', tags: ['a'] }, 'stand.loops unverändert');
  const lebend = i.stand.loops['7'];
  assert.notEqual(imHaken, lebend, 'der Haken bekommt eine Kopie, nicht das lebende Objekt aus stand.loops');
  assert.notEqual(imHaken.tags, lebend.tags, 'auch verschachtelt eine Kopie');
  assert.equal(Object.isFrozen(lebend), false, 'das lebende Objekt in stand.loops ist nicht eingefroren');
  assert.equal(Object.isFrozen(lebend.tags), false, 'auch verschachtelt nicht');
  const sse = ereignisse.join('');
  assert.ok(sse.includes('"a":"/e/loop","f":{"box":7,"name":"original","tags":["a"]}'), `SSE unverändert: ${sse.slice(-200)}`);
  assert.ok(!sse.includes('boese'));
});

// sende: id kommt immer aus dem gemeinsamen Zähler. Bringt felder eine id mit, wirft sende (statt still zu überschreiben oder zu übernehmen).
// Die gesendete id wird direkt am Log geprüft: deepEqual ignoriert die Schlüsselreihenfolge, `{ ...felder, id }` sähe dort gleich aus.
test('Kontext.sende: eine id in felder wirft und sendet nichts; die gesendete id ist die aus dem Zähler', async (t) => {
  const { o, log } = await stapel(t);
  const i = innen(o);
  const ctx = o.bereichKontext();
  const n0 = i.gesendet, id0 = i.id;
  assert.throws(() => ctx.sende('/k/tempo/rampe', { id: 4711, ab_beat: 0, ziel_bpm: 120, dauer_beats: 4 }), /id/);
  assert.equal(i.gesendet, n0, 'abgelehnt: nichts gezählt');
  assert.equal(i.id, id0, 'abgelehnt: der Zähler läuft nicht weiter');
  assert.ok(!log.some((z) => z.typ === 'an_kern' && z.felder?.id === 4711), 'abgelehnt: nichts an den Kern');
  const id = ctx.sende('/k/tempo/rampe', { ab_beat: 0, ziel_bpm: 120, dauer_beats: 4 });   // Negativ-Kontrolle: ohne id geht es
  const an = log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/tempo/rampe').at(-1);
  assert.equal(an.felder.id, id);
  assert.equal(Number(id0) + 1, id, 'die id stammt aus dem gemeinsamen Zähler');
});

// sende setzt quelle aus der laufenden Anfrage, wenn felder keine tragen; eine ausdrücklich mitgegebene bleibt.
test('Kontext.sende: quelle kommt aus der Anfrage, wenn felder keine tragen; eine ausdrückliche bleibt', async (t) => {
  const { o, url, log } = await stapel(t);
  const ctx = o.bereichKontext();
  o.meldeBereich({ name: 'q', routen: () => [
    { methode: 'POST', pfad: '/q/ohne', schutz: 'fremdePost', handler: async (_q, a) => { ctx.sende('/k/tempo/rampe', { ab_beat: 1, ziel_bpm: 120, dauer_beats: 4 }); json(a, 200, {}); } },
    { methode: 'POST', pfad: '/q/mit', schutz: 'fremdePost', handler: async (_q, a) => { ctx.sende('/k/tempo/rampe', { quelle: 'andreas', ab_beat: 2, ziel_bpm: 120, dauer_beats: 4 }); json(a, 200, {}); } },
  ] });
  const post = (pfad, kopf) => fetch(`${url}${pfad}`, { method: 'POST', headers: { 'content-type': 'application/json', ...kopf }, body: '{}' });
  const quelleVon = (beat) => log.filter((z) => z.typ === 'an_kern' && z.adresse === '/k/tempo/rampe' && z.felder.ab_beat === beat).at(-1)?.felder.quelle;
  await post('/q/ohne', { 'x-djk-quelle': 'cypher' });
  assert.equal(quelleVon(1), 'cypher', 'ohne quelle in felder: die der Anfrage');
  await post('/q/ohne');
  assert.equal(log.filter((z) => z.typ === 'an_kern' && z.felder?.ab_beat === 1).at(-1).felder.quelle, 'andreas', 'Negativ-Kontrolle: Anfrage ohne Kopf = andreas');
  await post('/q/mit', { 'x-djk-quelle': 'cypher' });
  assert.equal(quelleVon(2), 'andreas', 'ausdrücklich mitgegebene quelle bleibt, auch gegen den Kopf');
});

// Gemessen (nicht geraten): was liefert ctx.quelle() im Haken ereignis, also außerhalb der Anfrage? Der Haken läuft aus dem Kern-Socket;
// auch wenn die auslösende Anfrage cypher war, ist die Quelle dort andreas (Kern-Ereignisse laufen außerhalb, vgl. Kommentar bei qs).
test('Kontext.quelle im Haken: außerhalb der Anfrage andreas, auch wenn die auslösende Anfrage cypher war', async (t) => {
  const { o, url } = await stapel(t);
  const ctx = o.bereichKontext();
  const q = [];
  o.meldeBereich({ name: 'hq', routen: () => [], ereignis: (adresse) => { if (adresse === '/e/regler') q.push(ctx.quelle()); } });
  const r = await fetch(`${url}/regler`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-djk-quelle': 'cypher' }, body: JSON.stringify({ pfad: 'color/art', nach: 1, ab: 'jetzt' }) });
  assert.equal(r.status, 200);
  for (let n = 0; n < 100 && q.length === 0; n++) await warte(20);
  assert.deepEqual(q.slice(0, 1), ['andreas']);
});

// Belegt (Fix 5): heute braucht keine Route offenErlaubt. Alle gemeldeten POST- und *-Routen (oberflaeche und proj) sind fremdePost.
test('Routentabelle: keine POST- oder *-Route ist offen', async (t) => {
  const { o } = await stapel(t);
  const liste = o.routen();
  assert.ok(liste.filter((e) => e.methode === 'POST').length >= 19, 'Kontrolle: die POST-Routen sind in der Liste');
  assert.deepEqual(liste.filter((e) => (e.methode === 'POST' || e.methode === '*') && e.schutz === 'offen'), []);
});
