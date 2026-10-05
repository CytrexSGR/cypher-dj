// Tests des CLI-Werkzeugs djk-spiel gegen ECHTE Prozesse: die Kern-Attrappe (djk/vertrag/attrappe_kern.mjs) und der
// echte Leitstand (djk/leitstand/src/leitstand.ts, nur gelesen, nie verändert). Kein Mock des Leitstand-Protokolls:
// das CLI läuft als eigener Kindprozess, genau wie ein Aufruf von Cypher aus der CLI-Hauptinstanz.
//
// Zwei Sitzungen:
//  1) HAUPTSITZUNG (before/after): ein Leitstand direkt gegen die Kern-Attrappe, für die sieben Kommandos.
//  2) SPIEGEL-SITZUNG (im eigenen Test): ein zweiter Leitstand über einen "Vermittler" (UDP-Relais nach dem Muster
//     von djk/leitstand/pruef/pruefclient.ts Abschnitt 1) zur Kern-Attrappe, damit die Negativ-Kontrolle wirklich
//     mitzählen kann, wie viele Leitstand→Kern-Nachrichten (/k/...) ein CLI-Aufruf auslöst.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { liesUndDekodiere } from '../../leitstand/src/adressen.ts';
import { beende, freierTcpPort, freierUdpPort, ohneInstanz, starte, warte, type Kind } from '../../leitstand/tests/hilfen/prozess.ts';
import { Spielerverbindung } from '../src/client.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(HIER, '..', 'spieler.ts');
const DJK = path.resolve(HIER, '..', '..');

interface Ausgabe { code: number | null; stdout: string; stderr: string }

function cli(args: string[], wsPort: number, env: NodeJS.ProcessEnv = ohneInstanz(), timeoutMs = 20000): Promise<Ausgabe> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CLI, ...args, '--ws-port', String(wsPort)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    const wecker = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.once('exit', (code) => { clearTimeout(wecker); ok({ code, stdout, stderr }); });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// HAUPTSITZUNG: attrappe_kern + leitstand, direkt verbunden (keine Prüfinstanz nötig, freie Ports wie einbindung.test.ts)
// ---------------------------------------------------------------------------------------------------------------
let tmp: string;
let kp: Kind | undefined;
let lp: Kind | undefined;
let wsPort: number;

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spieler-cli-'));
  const kernPort = await freierUdpPort();
  const abo = await freierUdpPort();
  wsPort = await freierTcpPort();
  const konfig = path.join(tmp, 'leitstand.toml');
  fs.writeFileSync(konfig, `version = 1\nws_port = ${wsPort}\nabo_port = ${abo}\nsets = "${tmp}/sets"\n`);
  kp = await starte(
    path.join(DJK, 'vertrag', 'attrappe_kern.mjs'),
    ['--udp-port', String(kernPort), '--arbeitsbestand', path.join(tmp, 'arbeitsbestand')],
    'attrappe_kern:',
  );
  lp = await starte(
    path.join(DJK, 'leitstand', 'src', 'leitstand.ts'),
    ['--konfig', konfig, '--kern-port', String(kernPort), '--set-id', '2026-09-26_1000'],
    'leitstand:',
  );
  await warte(400); // Kern-Handshake (/k/hallo -> /k/willkommen -> /uhr) über echte Zeit absetzen lassen
});

after(async () => {
  await beende(lp); await beende(kp);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('zustand (RPC lage): jetzt.seq = seq des Antwort-Umschlags, ereignisse als Feld (§10)', async () => {
  const r = await cli(['zustand'], wsPort);
  assert.equal(r.code, 0, r.stderr);
  const d = JSON.parse(r.stdout) as { id: number; ergebnis: { jetzt: { seq: number; takt: number }; ereignisse: unknown[] } };
  assert.ok(d.ergebnis.jetzt.seq >= 1, JSON.stringify(d));
  assert.ok(Array.isArray(d.ergebnis.ereignisse), JSON.stringify(d));
  assert.equal(typeof d.ergebnis.jetzt.takt, 'number');
});

test('takt: wartet auf die naechste gepushte takt-Nachricht (§14.7 Takt-Zustand direkt in daten)', async () => {
  const r = await cli(['takt', '--timeout-ms', '8000'], wsPort);
  assert.equal(r.code, 0, r.stderr);
  const d = JSON.parse(r.stdout) as { takt: number; autonomie: number; plaene: unknown[]; vorschlaege: unknown[] };
  assert.equal(typeof d.takt, 'number', JSON.stringify(d));
  assert.equal(typeof d.autonomie, 'number', JSON.stringify(d));
  assert.ok(Array.isArray(d.plaene), JSON.stringify(d));
  assert.ok(Array.isArray(d.vorschlaege), JSON.stringify(d));
});

test('vorschlaege: liest das vorschlaege-Feld der Lage (kein eigenes RPC-Werkzeug in §10)', async () => {
  const r = await cli(['vorschlaege'], wsPort);
  assert.equal(r.code, 0, r.stderr);
  const d = JSON.parse(r.stdout) as { vorschlaege: unknown[] };
  assert.ok(Array.isArray(d.vorschlaege), JSON.stringify(d));
});

// Rollen-Befund direkt am echten Hub gemessen (nicht behauptet): die Aufgabe verlangt wörtlich Rolle "spieler" für
// Cyphers Leitstand-Werkzeug; djk/leitstand/src/hub.ts DARF_SENDEN (Zeile ~14-21) erlaubt dieser Rolle nur
// "zug_status", kein "rpc". Eine Verbindung mit Rolle "spieler" bekommt bei jedem RPC-Versuch rpc_fehler "form".
test('Rollen-Befund: Rolle "spieler" darf laut hub.ts DARF_SENDEN kein rpc senden (gemessen am echten Hub)', async () => {
  const c = await Spielerverbindung.angemeldet(wsPort, 'spieler', 'rollen-befund');
  try {
    const n = await c.rpc('lage', {});
    assert.equal(n.typ, 'rpc_fehler', JSON.stringify(n));
    assert.equal((n.daten as { code: string }).code, 'form', JSON.stringify(n.daten));
    assert.match((n.daten as { text: string }).text, /Rolle spieler darf rpc nicht senden/, JSON.stringify(n.daten));
  } finally {
    c.schliesse();
  }
});

// Negativ-Kontrolle zum Rollen-Befund: Rolle "mcp" (die Rolle, mit der djk-spiel sich tatsächlich anmeldet) darf
// rpc senden und bekommt eine echte Antwort, kein rpc_fehler "form" wegen der Rolle.
test('Negativ-Kontrolle zum Rollen-Befund: Rolle "mcp" darf rpc senden', async () => {
  const c = await Spielerverbindung.angemeldet(wsPort, 'mcp', 'rollen-negativ');
  try {
    const n = await c.rpc('lage', {});
    assert.equal(n.typ, 'rpc_antwort', JSON.stringify(n));
  } finally {
    c.schliesse();
  }
});

// Früher GAP-Belege (bestand/laden/warte fehlten im Leitstand), seit djk 31-Leitstand registriert. Jetzt: echte
// Antwort bzw. fachlicher Fehler statt "gibt es noch nicht". Die Attrappe hat keinen Bestand mit dieser ID.
test('bestand: Leitstand antwortet mit Liste', async () => {
  const r = await cli(['bestand'], wsPort);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.doesNotMatch(r.stdout, /gibt es in diesem Leitstand noch nicht/);
});

test('laden: unbekannte Fassung gibt material_fehlt, nicht mehr "form"', async () => {
  const r = await cli(['laden', '1', 'abcdef0123456789'], wsPort);
  assert.equal(r.code, 1, r.stderr);
  const d = JSON.parse(r.stdout) as { code: string; text: string };
  assert.equal(d.code, 'material_fehlt', JSON.stringify(d));
});

test('warte-takt: Frist läuft ab, Antwort mit Lage statt Fehler', async () => {
  const r = await cli(['warte-takt', '999999', '--max-s', '1'], wsPort);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.doesNotMatch(r.stdout, /gibt es in diesem Leitstand noch nicht/);
});

// FEHLERFALL vorher/nachher am selben Fall: ein Plan bei Autonomie-Stufe 1 (Vorgabe der leitstand.toml, kein
// --ki-spur gesetzt) wird KEIN direkter Kern-Befehl, sondern ein Vorschlag mit Ansage (§10 Stufe 1). Vorher: kein
// Plan eingereicht (vorschlaege/plaene leer, siehe obiger Test). Nachher: status "vorgeschlagen" plus wörtliche
// Ansage im JSON, danach ein plan_abbrechen auf denselben Plan.
test('plan + abbrechen: Autonomie Stufe 1 macht aus einem EQ-Teil einen Vorschlag, Ansage kommt woertlich durch', async () => {
  const z = JSON.parse((await cli(['zustand'], wsPort)).stdout) as { ergebnis: { jetzt: { takt: number } } };
  const abTakt = z.ergebnis.jetzt.takt + 40;
  const planDatei = path.join(tmp, 'plan_eq.json');
  fs.writeFileSync(planDatei, JSON.stringify({
    grund: 'spieler-cli Test: EQ-Teil an hoerbarem Deck',
    teile: [{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: abTakt, nach: -6 }],
  }));
  const r = await cli(['plan', planDatei], wsPort);
  const d = JSON.parse(r.stdout) as {
    id: number; ergebnis?: { status: string; plan_id: string; ansage: string };
    code?: string; text?: string;
  };
  assert.ok(d.ergebnis, `erwartet ergebnis, bekam ${JSON.stringify(d)}`);
  const erg = d.ergebnis!;
  assert.equal(erg.status, 'vorgeschlagen', JSON.stringify(erg)); // §10 Stufe 1, gemessen
  assert.equal(r.code, 0, r.stderr);
  assert.ok(erg.ansage.length > 0, 'ansage-Feld leer');
  // Gemessene Form eines Vorschlags (§14.3 Vorschlag.text): "T <Takt>: <Grund>", nicht die Verriegelungs-Form
  // "Plan <id> <status>. ..." aus hinweise.ts ansageVerriegelt (die gilt nur bei Ablehnung/Verriegelung).
  assert.match(erg.ansage, /^T \d+: spieler-cli Test/, erg.ansage);

  const a = await cli(['abbrechen', erg.plan_id], wsPort);
  const ad = JSON.parse(a.stdout) as { ergebnis?: Record<string, unknown>; code?: string; text?: string };
  // Negativ-Kontrolle zum selben Fall: ein FRISCH ERFUNDENER plan_id (harmloser Input) muss scheitern, ein
  // ECHTER (der eben eingereichte) darf nicht denselben "unbekannter Plan"-Fehler zeigen.
  const b = await cli(['abbrechen', 'plan-gibt-es-nicht-' + Date.now()], wsPort);
  const bd = JSON.parse(b.stdout) as { code?: string; text?: string };
  assert.notDeepEqual(ad, bd, 'abbrechen des echten Plans und eines erfundenen liefern dasselbe Ergebnis');
});

// ---------------------------------------------------------------------------------------------------------------
// SPIEGEL-SITZUNG: eigener Leitstand über einen UDP-Vermittler (Muster pruefclient.ts §1), zaehlt jede
// Leitstand→Kern-Nachricht. Negativ-Kontrolle (zustand: 0 Nachrichten) UND Positiv-Kontrolle (ein direkt
// angenommener Plan auf einem KI-Spur-Kanal sendet mindestens eine /k/teil-Nachricht), am selben Zaehler.
// ---------------------------------------------------------------------------------------------------------------
test('Negativ-Kontrolle: zustand (RPC lage) sendet 0 Nachrichten an den Kern; Positiv-Kontrolle zeigt, dass der Zaehler etwas faengt', async () => {
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'spieler-cli-spiegel-'));
  const kernPort = await freierUdpPort();
  const vermPort = await freierUdpPort();
  const abo = await freierUdpPort();
  const ws2 = await freierTcpPort();
  const konfig = path.join(tmp2, 'leitstand.toml');
  fs.writeFileSync(konfig, `version = 1\nws_port = ${ws2}\nabo_port = ${abo}\nsets = "${tmp2}/sets"\n`);

  const gezaehlt: string[] = [];
  const verm = dgram.createSocket('udp4');
  verm.on('message', (buf) => {
    let adresse = '?';
    try { adresse = liesUndDekodiere(buf).adresse; } catch { /* trotzdem zaehlen */ }
    gezaehlt.push(adresse);
    verm.send(buf, kernPort, '127.0.0.1'); // an die echte Attrappe weiterreichen (§4.1 muss funktionieren)
  });
  await new Promise<void>((ok) => verm.bind(vermPort, '127.0.0.1', () => ok()));

  const kp2 = await starte(
    path.join(DJK, 'vertrag', 'attrappe_kern.mjs'),
    ['--udp-port', String(kernPort), '--arbeitsbestand', path.join(tmp2, 'arbeitsbestand')],
    'attrappe_kern:',
  );
  // --ki-spur deck/1: macht einen Plan, der ausschliesslich deck/1 leiser stellt (Kill an), zur DIREKTEN Annahme
  // (§10 Stufe 1 Ausnahme), damit die Positiv-Kontrolle wirklich einen Kern-Befehl ausloest.
  const lp2 = await starte(
    path.join(DJK, 'leitstand', 'src', 'leitstand.ts'),
    ['--konfig', konfig, '--kern-port', String(vermPort), '--set-id', '2026-09-26_1001', '--ki-spur', 'deck/1'],
    'leitstand:',
  );
  await warte(400);

  try {
    const vorZustand = gezaehlt.length;
    const r = await cli(['zustand'], ws2);
    assert.equal(r.code, 0, r.stderr);
    await warte(150); // Nachlauf: eine evtl. verzoegerte Nachricht noch einsammeln, bevor gezaehlt wird
    // /k/hallo ist der Verbindungs-Handshake des Leitstands (§4.1: 100 ms ohne /uhr → hallo, dann alle 50 ms bis willkommen),
    // keine Folge von zustand; auf einem belasteten Rechner feuert er sporadisch (gemessen 4-5 Stück). Gezählt werden
    // darum die Befehle ohne ihn; die Positiv-Kontrolle unten zählt weiter ungefiltert (/k/teil).
    const befehle = gezaehlt.slice(vorZustand).filter((a) => a !== '/k/hallo');
    assert.equal(befehle.length, 0,
      `zustand sollte 0 Kern-Befehle ausloesen, gemessen ${befehle.length} (${JSON.stringify(befehle)})`);

    // Positiv-Kontrolle, gleicher Zaehler, gleiche Sitzung: ein Plan, der NUR deck/1 (KI-Spur) per Kill leiser macht.
    const z = JSON.parse((await cli(['zustand'], ws2)).stdout) as { ergebnis: { jetzt: { takt: number } } };
    const abTakt = z.ergebnis.jetzt.takt + 40;
    const planDatei = path.join(tmp2, 'plan_kispur.json');
    fs.writeFileSync(planDatei, JSON.stringify({
      grund: 'spieler-cli Positiv-Kontrolle: KI-Spur leiser',
      teile: [{ regler: 'deck/1/kill/tief', art: 'setze', ab_takt: abTakt, nach: 1 }],
    }));
    const vorPlan = gezaehlt.length;
    const rp = await cli(['plan', planDatei], ws2);
    const dp = JSON.parse(rp.stdout) as { ergebnis?: { status: string; ansage: string }; code?: string; text?: string };
    await warte(150);
    const nachPlan = gezaehlt.length;
    assert.ok(dp.ergebnis, `Positiv-Kontrolle: erwartet ergebnis, bekam ${JSON.stringify(dp)}`);
    assert.equal(dp.ergebnis!.status, 'angenommen', JSON.stringify(dp.ergebnis)); // §10 Stufe 1 Ausnahme, gemessen
    assert.ok(nachPlan - vorPlan > 0,
      `Positiv-Kontrolle: ein angenommener Plan sollte mindestens eine Kern-Nachricht ausloesen, gemessen ${nachPlan - vorPlan}`);
    assert.ok(gezaehlt.slice(vorPlan).some((a) => a === '/k/teil'), JSON.stringify(gezaehlt.slice(vorPlan)));
  } finally {
    await beende(lp2); await beende(kp2);
    verm.close();
    fs.rmSync(tmp2, { recursive: true, force: true });
  }
});
