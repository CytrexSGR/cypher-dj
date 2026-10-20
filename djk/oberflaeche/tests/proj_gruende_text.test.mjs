// D1 S3 Task 1.4 (Auftrag Punkt 14 b, Spec 6.34): jede Antwort einer /proj-Route mit Grund trägt einen ENGLISCHEN text, auch die Router-Gründe
// nur_json und fremde_herkunft. Zwei Linien: (1) jeder Grund, den die Extraktion aus bereiche/, projekt/, http/ und katalog.ts zieht
// (tests/hilfen/gruende.mjs, dieselbe wie im V2-Gründe-Test), hat in http/gruende.ts einen englischen Text; (2) die Antwortbauer (bereiche/proj
// bereich.ts alsAntwort, ausgabe.ts alsAntwort, http/transport.ts postAbgewiesen) setzen text immer, deutsche Prüfmeldungen nur als detail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GRUND_TEXT } from '../http/gruende.ts';
import { postAbgewiesen } from '../http/transport.ts';
import { alsAntwort as projAntwort } from '../bereiche/proj/bereich.ts';
import { alsAntwort as ausgabeAntwort } from '../bereiche/proj/ausgabe.ts';
import { ProjFehler } from '../bereiche/proj/sitzung.ts';
import { BefehlFehler, fuehreListeAus } from '../projekt/befehle.ts';
import { VerlaufFehler } from '../projekt/verlauf.ts';
import { AblageFehler } from '../projekt/ablage.ts';
import { PatchFehler } from '../projekt/patch.ts';
import { KatalogFehler } from '../katalog.ts';
import { gruendeAusDemCode, gruendeOhneText, texteAusDatei, texteAusDemCode, texteAusVariable, variablenAusDatei } from './hilfen/gruende.mjs';
import { specProjekt } from './hilfen/projekt.mjs';

// Englisch heißt hier: druckbares ASCII (dazu × und –), keine Umlaute, keines der häufigen deutschen Wörter der Server-Meldungen
const DEUTSCH = /\b(der|die|das|den|dem|und|nicht|kein|keine|keinen|ist|sind|erwartet|fehlt|mit|ohne|oder|noch|nur|wird|bitte|spur|datei|zahl|zeichen|höchstens|hoechstens|ausgerollt|läuft|laeuft|gibt|schon|unbekannt|ungültig|ungueltig)\b/i;
export const englisch = (t) => typeof t === 'string' && t.trim().length > 3 && /^[\x20-\x7e×–−]+$/.test(t) && !DEUTSCH.test(t);
const ctx = { log: () => {} };

test('Positiv- und Negativ-Kontrolle des Englisch-Prüfers', () => {
  for (const t of ['a freeze is running', 'the core has not reported its state yet; try again in a moment', 'Stop Cypher is set']) assert.ok(englisch(t), t);
  for (const t of ['ausgerollt 5000 Clips, 70000 Noten (höchstens 4096, 65536)', 'spur_id: ID erwartet', 'kein Projekt geöffnet', 'Spur s9 fehlt', '', undefined]) {
    assert.equal(englisch(t), false, String(t));
  }
});

test('jeder Grund aus bereiche/, projekt/, http/ und katalog.ts hat in http/gruende.ts einen englischen Text', () => {
  const g = gruendeAusDemCode();
  assert.ok(g.size >= 70, `Extraktion fand ${g.size} Gründe`);
  for (const x of ['nur_json', 'fremde_herkunft', 'zu_gross', 'beschaeftigt', 'veraltet', 'spur_leer']) assert.ok(g.has(x), `Positiv-Kontrolle: ${x} gefunden`);
  const ohne = [...g.keys()].filter((x) => !englisch(GRUND_TEXT[x])).map((x) => `${x}: ${JSON.stringify(GRUND_TEXT[x])} (${[...g.get(x)].join(' | ')})`);
  assert.deepEqual(ohne, [], 'Gründe ohne englischen Text');
});

test('Router-Gründe: 415 nur_json und 403 fremde_herkunft tragen einen englischen text', () => {
  for (const [kopf, code, fehler] of [[{}, 415, 'nur_json'], [{ 'content-type': 'application/json', origin: 'https://boese.example' }, 403, 'fremde_herkunft']]) {
    let status = 0, koerper = '';
    const a = { writeHead: (c) => { status = c; }, end: (b) => { koerper = b; } };
    assert.equal(postAbgewiesen({ headers: kopf }, a, 47300), true);
    const j = JSON.parse(koerper);
    assert.deepEqual([status, j.fehler], [code, fehler]);
    assert.ok(englisch(j.text), `${fehler}: ${j.text}`);
  }
});

test('bereich.ts alsAntwort: jede Fehlerklasse bekommt einen englischen text, deutsche Meldungen gehen als detail', () => {
  const faelle = [
    new ProjFehler(409, 'kein_projekt'),
    new ProjFehler(409, 'beschaeftigt', { text: 'a freeze is running; changes to the playback wait until it is done' }),
    new BefehlFehler('argument_ungueltig', 'spur_id: ID erwartet'),
    new VerlaufFehler('nichts_zu_tun', 'nichts zum Rückgängigmachen'),
    new AblageFehler(404, 'unbekannt'),
    new KatalogFehler(503, 'katalog_fehlt'),
    new PatchFehler('op_unbekannt', 'unbekannte Operation'),
    new Error('kaputt'),
  ];
  for (const e of faelle) {
    const r = projAntwort(e, ctx);
    assert.ok(englisch(r.j.text), `${r.j.fehler}: ${JSON.stringify(r.j)}`);
  }
  const b = projAntwort(new BefehlFehler('argument_ungueltig', 'spur_id: ID erwartet'), ctx);
  assert.equal(b.j.detail, 'spur_id: ID erwartet', 'die Prüfmeldung bleibt als detail');
  assert.equal(projAntwort(new ProjFehler(409, 'beschaeftigt', { text: 'a project is being opened; a freeze waits until it is open' }), ctx).j.text,
    'a project is being opened; a freeze waits until it is open', 'ein eigener englischer Text (Ursache) gewinnt vor der Tabelle');
});

test('ausgabe.ts alsAntwort (S3): dieselben Fehlerklassen, text englisch', () => {
  for (const e of [new ProjFehler(409, 'deck_laeuft', { tempo: {} }), new BefehlFehler('label_ungueltig', '1 bis 200 Zeichen erwartet'),
    new VerlaufFehler('rev_nicht_steigend', '5 nach 7'), new AblageFehler(409, 'projekt_busy'), new Error('kaputt')]) {
    const r = ausgabeAntwort(e);
    assert.ok(englisch(r.body.text), `${r.body.fehler}: ${JSON.stringify(r.body)}`);
  }
});

test('projekt/befehle.ts zu_gross (Spec 6.17, früher deutscher Text): englischer text in der Antwort', () => {
  const p = specProjekt();
  p.spuren[1].clips[0].laenge_beats = 1024; p.spuren[1].clips[0].loop_beats = 0.0625;   // 16 Kopien je Beat: 16384 Noten-Kopien
  const noten = Array.from({ length: 4 }, (_, i) => ({ beat: i * 0.01, laenge: 0.005, ton: 36, vel: 100 }));
  let fehler = null;
  try { fuehreListeAus(p, [{ befehl: 'noten_neu', clip_id: 'c2', noten }]); } catch (e) { fehler = e; }
  assert.ok(fehler instanceof BefehlFehler && fehler.grund === 'zu_gross', String(fehler));
  assert.ok(englisch(fehler.detail), `detail englisch: ${fehler.detail}`);
  const r = projAntwort(fehler, ctx);
  assert.ok(englisch(r.j.text), r.j.text);
});

// Fix-Runde S3, R2: nicht nur die Tabelle, auch jeder eigene text der Routen ist englisch; keiner kommt aus einer (deutschen) Variablen; verschachtelte
// Gründe tragen ihren text mit. Positiv-Kontrollen: die Extraktion findet bekannte Texte jeder Art.
test('R2: jedes Text-Literal der Routen (ProjFehler, AusgabeFehler, FreezeFehler, StandFehler, RenderFehler, fehl) ist englisch', () => {
  const t = texteAusDemCode();
  const gefunden = new Set(t.map((x) => x.text));
  for (const x of ['a freeze is running; transport start waits until it is done', 'stop the transport first', 'the render gave no readable answer',
    'the render ran out of memory', 'the new project state is invalid; nothing was saved', 'the freeze file x is missing']) {
    assert.ok(gefunden.has(x), `Positiv-Kontrolle: ${x}`);
  }
  assert.ok(t.length >= 60, `Extraktion fand ${t.length} Texte`);
  const deutsch = t.filter((x) => !englisch(x.text)).map((x) => `${x.wo}: ${JSON.stringify(x.text)}`);
  assert.deepEqual(deutsch, [], 'Texte, die nicht englisch sind');
});

// Fix-Runde 2 S3, F2 (Re-Review): die Sprachwache sah keine Texte in doppelten Anführungszeichen und keine Variable als text von fehl(),
// AusgabeFehler, FreezeFehler, StandFehler. Kontrollen an einem ausgedachten Quelltext: was sie finden muss, findet sie; was erlaubt ist, nicht.
// Re-Review Fix-Runde 2 (RR2): Grund in doppelten Anführungszeichen, Einschübe mit .message oder einer Konstanten, { text } in Kurzschreibweise.
test('F2: doppelte Anführungszeichen und Variablen als text von fehl/AusgabeFehler/FreezeFehler/StandFehler werden gesehen', () => {
  const q = [
    `if (x) fehl('transport_laeuft', "zuerst den Transport stoppen");`,
    `const UEB = 'der Kern spielt schon';`,
    `if (y) fehl('transport_laeuft', UEB);`,
    `throw new FreezeFehler('freeze_fehler', e.message);`,
    `throw new StandFehler('veraltet', grundText('veraltet'), detail);`,
    `throw new AusgabeFehler('beschaeftigt', a ? 'a freeze is running' : b ? "an export is running" : 'the server is shutting down');`,
    `fehl('freeze_fehler', s === 1 ? 'the core aborted' : meldung);`,
    `fehl('beschaeftigt', \`\${l.art === 'freeze' ? 'a freeze' : 'an export'} is running\`);`,
    `fehl('kein_projekt');`,
    `fehl("transport_laeuft", 'erst stoppen');`,
    `fehl('argument_ungueltig', \`unreadable request body (\${(e as Error).message})\`);`,
    `fehl('argument_ungueltig', \`\${UEB} now\`);`,
    `throw new ProjFehler(409, 'transport_laeuft', { text });`,
  ].join('\n');
  const texte = texteAusDatei('probe.ts', q).map((x) => `${x.wo} ${x.text}`);
  assert.deepEqual(texte, ['probe.ts:1 zuerst den Transport stoppen', 'probe.ts:6 a freeze is running', 'probe.ts:6 an export is running',
    'probe.ts:6 the server is shutting down', 'probe.ts:8 x is running', 'probe.ts:10 erst stoppen',
    'probe.ts:11 unreadable request body (x)', 'probe.ts:12 x now']);
  assert.equal(englisch('zuerst den Transport stoppen'), false, 'der Text in doppelten Anführungszeichen fällt beim Englisch-Prüfer durch');
  assert.deepEqual(variablenAusDatei('probe.ts', q), ['probe.ts:13: text: { text }', 'probe.ts:3: text: UEB', 'probe.ts:4: text: e.message',
    "probe.ts:5: text: grundText('veraltet')", "probe.ts:7: text: s === 1 ? 'the core aborted' : meldung",
    'probe.ts:11: text: Einschub (e as Error).message', 'probe.ts:12: text: Einschub UEB']);
});

test('R2, F2: kein text (ProjFehler, fehl, AusgabeFehler, FreezeFehler, StandFehler) kommt aus einer Variablen; verschachtelte Gründe tragen text', () => {
  assert.deepEqual(texteAusVariable(), [], 'text aus Variable (gehört in detail)');
  assert.deepEqual(gruendeOhneText(), [], 'Gründe-Literal ohne text daneben');
});

test('R2: /proj/aendern mit leerer Befehlsliste (Spec-Review R5) antwortet mit englischem text, die Prüfmeldung höchstens als detail', async (t) => {
  const { sitzung } = await import('./hilfen/proj_kontext.mjs');
  const { s } = sitzung(t);
  assert.equal((await s.neu('Gruende', 'andreas')).code, 200);
  for (const befehle of [[], undefined, 'x']) {
    let r;
    try { r = await s.aendern({ rev: s.aktuell().j.projekt.rev, label: 'leer', befehle }, 'andreas'); } catch (e) { r = projAntwort(e, ctx); }
    assert.deepEqual([r.code, r.j.fehler], [400, 'argument_ungueltig'], JSON.stringify(r.j));
    assert.ok(englisch(r.j.text), `text englisch: ${JSON.stringify(r.j)}`);
  }
});
