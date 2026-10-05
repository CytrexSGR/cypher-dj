// Scheibe 31: bestand, laden, warte als Hub-Methoden (SCHNITTSTELLEN §10, §4.4, §6.4, §6.5, §13.4). Vorher standen
// nur lage, plan_einreichen, plan_abbrechen in leitstand.ts; die drei anderen METHODEN_10-Einträge antworteten mit
// rpc_fehler "form" ("gibt es in diesem Leitstand noch nicht", djk/spieler_cli/tests/spieler.test.ts GAP-Belege).
// Gegen die echte Kern-Attrappe (djk/vertrag/attrappe_kern.mjs), wie djk/spieler_cli/tests/spieler.test.ts.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { WsClient } from '../src/ws_client.ts';
import { beende, freierTcpPort, freierUdpPort, LEITSTAND, ohneInstanz, starte, warte, type Kind } from './hilfen/prozess.ts';

const DJK = path.resolve(LEITSTAND, '..');
const BPM = 128.0;

// Legt eine minimale, gültige Fassung im Bestand an (§13.1, §13.2): fassung.json plus eine basis.f32 aus Nullen
// (keine NaN, damit die Kern-Attrappe die Stichprobe besteht), Größe = frames · 8 Byte (Stereo, float32).
function schreibeFassung(bestand: string, materialId: string, fassungNr: number, opts: { basisBpm?: number; analyseQuelle?: string } = {}): void {
  const basisBpm = opts.basisBpm ?? BPM;
  const dir = path.join(bestand, materialId, 'fassungen', `${Math.round(basisBpm * 1000)}_r${fassungNr}`);
  fs.mkdirSync(dir, { recursive: true });
  const frames = 96000; // 2 s bei 48 kHz
  fs.writeFileSync(path.join(dir, 'basis.f32'), Buffer.alloc(frames * 8));
  fs.writeFileSync(path.join(dir, 'fassung.json'), JSON.stringify({
    schema: 1, material_id: materialId, basis_bpm: basisBpm, fassung: fassungNr,
    korrekturen_bis_zeile: 0, datei: 'basis.f32', frames, sha256: 'x'.repeat(64), erster_schlag_frame: 0,
    beats: (frames * basisBpm) / (60 * 48000), erste_eins_quell_beat: 0, analyse_quelle: opts.analyseQuelle ?? 'basis',
    stems: {}, schuesse: [], headroom_db: -12, stimmung_korrektur_cent: 0,
    lautheit: { lufs_integriert: -14, echtspitze_dbtp: -1, crest_db: 8, lufs_je_takt: [] },
    struktur: { phrasen: [] }, hotcues: [], loops: [],
    tore: { raster: { ok: true }, headroom: { ok: true }, klarheit: { ok: true }, streckfaktor: { ok: true }, eins: { ok: true } },
    nur_fuer_andreas: false, warnungen: [],
  }));
}

function schreibeIndex(bestand: string, eintraege: Array<{
  material_id: string; titel: string; quelle_bpm: number; camelot: string; tore_ok: boolean; erzeugt_am: string | null;
  fassungen: Array<{ basis_bpm: number; fassung: number; stems: boolean }>;
}>): void {
  const db = new DatabaseSync(path.join(bestand, 'index.sqlite'));
  db.exec(`CREATE TABLE material (material_id TEXT PRIMARY KEY, titel TEXT, herkunft_art TEXT, erzeugt_am TEXT,
    quelle_bpm REAL, dauer_s REAL, lufs REAL, camelot TEXT, stimmung_cent REAL, tore_ok INTEGER, nur_fuer_andreas INTEGER, pfad TEXT)`);
  db.exec(`CREATE TABLE fassung (material_id TEXT, basis_bpm REAL, fassung INTEGER, frames INTEGER, stems INTEGER,
    schuesse INTEGER, lufs REAL, tore_ok INTEGER)`);
  const im = db.prepare('INSERT INTO material VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  const ifz = db.prepare('INSERT INTO fassung VALUES (?,?,?,?,?,?,?,?)');
  for (const e of eintraege) {
    im.run(e.material_id, e.titel, 'datei', e.erzeugt_am, e.quelle_bpm, 200, -14, e.camelot, 0, e.tore_ok ? 1 : 0, 0, '');
    for (const f of e.fassungen) ifz.run(e.material_id, f.basis_bpm, f.fassung, 96000, f.stems ? 1 : 0, 0, -14, 1);
  }
  db.close();
}

let tmp: string;
let kp: Kind | undefined;
let lp: Kind | undefined;
let wsPort: number;
let aboL: number;
let bestand: string;
let arbeitsbestand: string;
let kernPort: number;

// Zwei bekannte Materialien im Bestand: m1 (8A, tore_ok) mit einer Fassung 128 BPM (ohne Stems), m2 (3A, nicht
// tore_ok) ohne Fassung zur Set-Basis (nur 140 BPM) — für den Fehlerfall "keine Fassung zur Set-Basis".
const M1 = '1111111111111111';
const M2 = '2222222222222222';
const UNBEKANNT = 'abcdefabcdefabcd';

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ls-scheibe31-'));
  bestand = path.join(tmp, 'bestand');
  arbeitsbestand = path.join(tmp, 'arbeitsbestand');
  fs.mkdirSync(bestand, { recursive: true });
  schreibeFassung(bestand, M1, 1, { basisBpm: BPM });
  schreibeFassung(bestand, M2, 1, { basisBpm: 140.0 });
  schreibeIndex(bestand, [
    { material_id: M1, titel: 'eins', quelle_bpm: BPM, camelot: '8A', tore_ok: true, erzeugt_am: new Date().toISOString(), fassungen: [{ basis_bpm: BPM, fassung: 1, stems: false }] },
    { material_id: M2, titel: 'zwei', quelle_bpm: 140.0, camelot: '3A', tore_ok: false, erzeugt_am: null, fassungen: [{ basis_bpm: 140.0, fassung: 1, stems: false }] },
  ]);

  kernPort = await freierUdpPort();
  aboL = await freierUdpPort();
  wsPort = await freierTcpPort();
  const konfig = path.join(tmp, 'leitstand.toml');
  fs.writeFileSync(konfig, `version = 1\nws_port = ${wsPort}\nabo_port = ${aboL}\nbestand = "${bestand}"\nsets = "${tmp}/sets"\nset_basis_bpm = ${BPM}\n`);
  const kernKonfig = path.join(tmp, 'kern.toml');
  fs.writeFileSync(kernKonfig, `version = 1\narbeitsbestand = "${arbeitsbestand}"\n`);
  kp = await starte(path.join(DJK, 'vertrag', 'attrappe_kern.mjs'),
    ['--udp-port', String(kernPort), '--arbeitsbestand', arbeitsbestand], 'attrappe_kern:');
  lp = await starte('src/leitstand.ts',
    ['--konfig', konfig, '--kern-port', String(kernPort), '--set-id', '2026-09-26_2000', '--kern-konfig', kernKonfig],
    'leitstand:', ohneInstanz());
  await warte(400); // Kern-Handshake
});

after(async () => {
  await beende(lp); await beende(kp);
  fs.rmSync(tmp, { recursive: true, force: true });
});

let rpcId = 100;
async function rpc(c: WsClient, methode: string, parameter: Record<string, unknown>): Promise<{ typ: string; daten: Record<string, unknown> }> {
  const id = ++rpcId;
  c.sende('rpc', { id, methode, parameter });
  const n = await c.warteAuf((x) => (x.typ === 'rpc_antwort' || x.typ === 'rpc_fehler') && x.daten.id === id, 8000);
  return { typ: n.typ, daten: n.daten };
}

test('bestand: Positivliste jetzt registriert, nicht mehr "gibt es noch nicht" (Befund GAP-Beleg geschlossen)', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'b1');
  const r = await rpc(m, 'bestand', { max: 20 });
  assert.equal(r.typ, 'rpc_antwort', JSON.stringify(r));
  m.schliesse();
});

test('bestand: liefert beide Materialien mit Kurz-Fingerabdruck (material_id, camelot, fassungen)', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'b2');
  const r = await rpc(m, 'bestand', { max: 20 });
  const eintraege = (r.daten.ergebnis as { eintraege: Array<{ material_id: string; camelot: string; fassungen: unknown[] }> }).eintraege;
  const ids = eintraege.map((e) => e.material_id).sort();
  assert.deepEqual(ids, [M1, M2].sort());
  const e1 = eintraege.find((e) => e.material_id === M1)!;
  assert.equal(e1.camelot, '8A');
  assert.deepEqual(e1.fassungen, [{ basis_bpm: BPM, fassung: 1, stems: false }]);
  m.schliesse();
});

test('bestand: Filter camelot trifft nur das gesuchte Material (Positiv- und Negativkontrolle am selben Aufruf)', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'b3');
  const r = await rpc(m, 'bestand', { filter: { camelot: '8A' }, max: 20 });
  const eintraege = (r.daten.ergebnis as { eintraege: Array<{ material_id: string }> }).eintraege;
  assert.deepEqual(eintraege.map((e) => e.material_id), [M1]); // Positivkontrolle: M1 (8A) drin
  assert.ok(!eintraege.some((e) => e.material_id === M2), 'M2 (3A) haette camelot 8A nicht treffen duerfen'); // Negativkontrolle
  m.schliesse();
});

test('bestand: Filter nur_tore_ok schließt M2 (tore_ok=false) aus', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'b4');
  const r = await rpc(m, 'bestand', { filter: { nur_tore_ok: true }, max: 20 });
  const eintraege = (r.daten.ergebnis as { eintraege: Array<{ material_id: string }> }).eintraege;
  assert.deepEqual(eintraege.map((e) => e.material_id), [M1]);
  m.schliesse();
});

test('Fehlerfall bestand: max fehlt (Pflicht laut Schema) → rpc_fehler code form', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'b5');
  const r = await rpc(m, 'bestand', {});
  assert.equal(r.typ, 'rpc_fehler', JSON.stringify(r));
  assert.equal(r.daten.code, 'form', JSON.stringify(r.daten));
  m.schliesse();
});

test('laden: bekannte Fassung zur Set-Basis wird kopiert und geladen, Status fertig, /e/geladen kommt als Ereignis', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'l1');
  const r = await rpc(m, 'laden', { deck: 1, material_id: M1 });
  assert.equal(r.typ, 'rpc_antwort', JSON.stringify(r));
  const erg = r.daten.ergebnis as { status: string; deck: number; material_id: string; basis_bpm: number; fassung: number };
  assert.equal(erg.status, 'fertig', JSON.stringify(erg));
  assert.equal(erg.deck, 1);
  assert.equal(erg.material_id, M1);
  assert.equal(erg.fassung, 1);
  // §6.4: Kopie liegt jetzt im Arbeitsbestand
  assert.ok(fs.existsSync(path.join(arbeitsbestand, M1, 'fassungen', `${Math.round(BPM * 1000)}_r1`, 'fassung.json')));
  const lage = await rpc(m, 'lage', {});
  const ereignisse = (lage.daten.ergebnis as { ereignisse: Array<{ art: string; deck?: number }> }).ereignisse;
  assert.ok(ereignisse.some((e) => e.art === 'geladen' && e.deck === 1), JSON.stringify(ereignisse));
  m.schliesse();
});

test('Fehlerfall laden: unbekannte material_id → material_fehlt', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'l2');
  const r = await rpc(m, 'laden', { deck: 2, material_id: UNBEKANNT });
  assert.equal(r.typ, 'rpc_fehler', JSON.stringify(r));
  assert.equal(r.daten.code, 'material_fehlt', JSON.stringify(r.daten));
  m.schliesse();
});

test('Negativkontrolle zu material_fehlt: dieselbe material_id, aber bekannt, laedt ohne material_fehlt', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'l2b');
  const r = await rpc(m, 'laden', { deck: 2, material_id: M1 });
  assert.notEqual(r.typ === 'rpc_fehler' ? (r.daten as { code: string }).code : 'ok', 'material_fehlt', JSON.stringify(r));
  assert.equal(r.typ, 'rpc_antwort', JSON.stringify(r));
  m.schliesse();
});

test('Fehlerfall laden: Material im Bestand, aber keine Fassung zur Set-Basis 128 BPM (nur 140 BPM vorhanden) → material_fehlt', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'l3');
  const r = await rpc(m, 'laden', { deck: 3, material_id: M2 });
  assert.equal(r.typ, 'rpc_fehler', JSON.stringify(r));
  assert.equal(r.daten.code, 'material_fehlt', JSON.stringify(r.daten));
  m.schliesse();
});

test('Fehlerfall laden: deck außerhalb 1..4 → rpc_fehler code form (Eingabeform vor jedem Kern-Kontakt geprüft)', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'l4');
  const r = await rpc(m, 'laden', { deck: 9, material_id: M1 });
  assert.equal(r.typ, 'rpc_fehler', JSON.stringify(r));
  assert.equal(r.daten.code, 'form', JSON.stringify(r.daten));
  m.schliesse();
});

test('Fehlerfall laden: ki_gestoppt lehnt ab; Negativkontrolle nach Freigabe läuft derselbe Aufruf wieder', async () => {
  // Andreas' Stopp-Taste direkt an die Kern-Attrappe (§4.7 /k/ki/stopp), wie annahme.ts es erwartet: die Attrappe
  // haelt K.ki.gestoppt selbst und meldet es fortlaufend in /zustand/kern (20 Hz); ein einmaliges /e/ki von Hand
  // an den Leitstand waere binnen 50 ms vom naechsten echten /zustand/kern (ki_gestoppt=0) wieder ueberschrieben.
  const u = await import('node:dgram');
  const { baue } = await import('../src/adressen.ts');
  const sock = u.default.createSocket('udp4');
  const sendeAnKern = (adresse: string, felder: Record<string, number | string>) =>
    new Promise<void>((ok) => sock.send(baue(adresse, felder), kernPort, '127.0.0.1', () => ok()));
  await sendeAnKern('/k/ki/stopp', { id: 900001, quelle: 'andreas' });
  await warte(100);
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'l5');
  const r = await rpc(m, 'laden', { deck: 4, material_id: M1 });
  assert.equal(r.typ, 'rpc_fehler', JSON.stringify(r));
  assert.equal(r.daten.code, 'ki_gestoppt', JSON.stringify(r.daten));

  await sendeAnKern('/k/ki/frei', { id: 900002, quelle: 'andreas' });
  await warte(100);
  const r2 = await rpc(m, 'laden', { deck: 4, material_id: M1 });
  assert.equal(r2.typ, 'rpc_antwort', JSON.stringify(r2)); // Negativkontrolle: nach Freigabe kein ki_gestoppt mehr
  sock.close();
  m.schliesse();
});

test('warte: bis_takt bereits erreicht löst sofort auf, wie lage (§10)', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'w1');
  const z = await rpc(m, 'lage', {});
  const jetztTakt = (z.daten.ergebnis as { jetzt: { takt: number } }).jetzt.takt;
  const start = Date.now();
  const r = await rpc(m, 'warte', { bis_takt: Math.max(1, jetztTakt - 1), max_s: 5 });
  const dauerMs = Date.now() - start;
  assert.equal(r.typ, 'rpc_antwort', JSON.stringify(r));
  assert.ok(dauerMs < 1000, `warte auf einen vergangenen Takt sollte sofort kommen, brauchte ${dauerMs} ms`);
  const erg = r.daten.ergebnis as { jetzt: { takt: number }; lage: unknown; ereignisse: unknown[] };
  assert.equal(typeof erg.jetzt.takt, 'number');
  m.schliesse();
});

test('warte: löst aus, sobald ein Ereignis aus "auf" eintrifft (laden auf einem zweiten Client parallel ausgelöst)', async () => {
  const m1 = await WsClient.angemeldet(wsPort, 'mcp', 'w2a');
  const m2 = await WsClient.angemeldet(wsPort, 'mcp', 'w2b');
  const wartend = rpc(m1, 'warte', { auf: ['geladen'], max_s: 10 });
  await warte(100);
  await rpc(m2, 'laden', { deck: 1, material_id: M1 });
  const r = await wartend;
  assert.equal(r.typ, 'rpc_antwort', JSON.stringify(r));
  const ereignisse = (r.daten.ergebnis as { ereignisse: Array<{ art: string }> }).ereignisse;
  assert.ok(ereignisse.some((e) => e.art === 'geladen'), JSON.stringify(ereignisse));
  m1.schliesse(); m2.schliesse();
});

test('Negativkontrolle zu warte/auf: ohne passendes Ereignis läuft warte bis max_s und liefert dennoch lage (kein Fehler)', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'w3');
  const start = Date.now();
  const r = await rpc(m, 'warte', { auf: ['notbahn'], max_s: 1 }); // gültige Ereignis-Art, die in diesem Test nicht ausgelöst wird
  const dauerMs = Date.now() - start;
  assert.equal(r.typ, 'rpc_antwort', JSON.stringify(r));
  assert.ok(dauerMs >= 950, `warte sollte die volle Frist ausschöpfen, kam nach ${dauerMs} ms`);
  m.schliesse();
});

test('Fehlerfall warte: max_s fehlt (Pflicht laut Schema) → rpc_fehler code form', async () => {
  const m = await WsClient.angemeldet(wsPort, 'mcp', 'w4');
  const r = await rpc(m, 'warte', {});
  assert.equal(r.typ, 'rpc_fehler', JSON.stringify(r));
  assert.equal(r.daten.code, 'form', JSON.stringify(r.daten));
  m.schliesse();
});
