// Gründe des Servers aus dem Code dieses Baums (aus tests/produktion_gruende.test.mjs herausgezogen, Paket S3 Task 1.4, damit auch
// tests/proj_gruende_text.test.mjs sie lesen kann, ohne die V2-Tests ein zweites Mal zu laden). Inhalt unverändert.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEREICH_GRUENDE } from '../../bereiche/proj/abbildung.ts';

const W = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lies = (d) => fs.readFileSync(path.join(W, d), 'utf8');
const ts = (ordner) => fs.readdirSync(path.join(W, ordner)).filter((f) => f.endsWith('.ts')).map((f) => `${ordner}/${f}`);
export const KLASSEN = 'BefehlFehler|AblageFehler|VerlaufFehler|DekodierFehler|PatchFehler|ProjFehler|KatalogFehler|WiedergabeFehler|AusgabeFehler|FreezeFehler|StandFehler|GeraeteFehler';
export const S3_QUELLE = /^(AusgabeFehler|FreezeFehler|StandFehler|fehl|grund-Feld) /;   // Fundstellen, die nur über /proj/freeze und /proj/export kommen

// Gründe einer Datei d mit Inhalt t (Muster je Ort); dazu(grund, fundstelle)
export function gruendeAusDatei(d, t, dazu) {
  for (const m of t.matchAll(new RegExp(`new (${KLASSEN})\\(\\s*(?:\\d+\\s*,\\s*)?'([a-z_]+)'`, 'g'))) dazu(m[2], `${m[1]} ${d}`);
  if (d === 'projekt/befehle.ts') for (const m of t.matchAll(/\bab\(\s*'([a-z_]+)'/g)) dazu(m[1], `ab ${d}`);
  // Gründe-Literale {fehler|grund: '…'} in bereiche/ und (V2 Fix F9) http/, auch als Zweige eines Ternärs (http/transport.ts:
  // { fehler: abweisung === 415 ? 'nur_json' : 'fremde_herkunft' }); gezählt werden der ganze Wert und die Zweige nach ? und :
  if (d.startsWith('bereiche/') || d.startsWith('http/')) {
    for (const m of t.matchAll(/\b(?:fehler|grund):\s*((?:'[^']*'|[^,}'\n])*)/g)) {
      for (const l of m[1].matchAll(/(?:^|[?:]\s*)'([a-z_]+)'/g)) dazu(l[1], `literal ${d}`);
    }
  }
  if (d.startsWith('bereiche/')) for (const m of t.matchAll(/\bfehl\(\s*'([a-z_]+)'/g)) dazu(m[1], `fehl ${d}`);
  // I08 Task 8: bereiche/geraete wirft GeraeteFehler und reicht den Grund von nurAndreas(quelle[, 'grund']) durch (Vorgabe im Kopf: grund = 'nur_andreas')
  if (d.startsWith('bereiche/geraete/')) {
    for (const m of t.matchAll(/\bnurAndreas\([^,)]*,\s*'([a-z_]+)'/g)) dazu(m[1], `nurAndreas ${d}`);
    for (const m of t.matchAll(/\bnurAndreas = \([^)]*\bgrund = '([a-z_]+)'/g)) dazu(m[1], `nurAndreas ${d}`);
  }
  if (d.startsWith('projekt/')) for (const m of t.matchAll(/\breadonly grund = '([a-z_]+)'/g)) dazu(m[1], `grund-Feld ${d}`);
}

// Grund → Menge der Fundstellen (Klasse bzw. Muster und Datei)
export function gruendeAusDemCode() {
  const g = new Map();
  const dazu = (grund, wo) => { if (!g.has(grund)) g.set(grund, new Set()); g.get(grund).add(wo); };
  for (const d of [...ts('projekt'), ...ts('bereiche/proj'), ...ts('http'), 'katalog.ts']) gruendeAusDatei(d, lies(d), dazu);
  for (const x of BEREICH_GRUENDE) dazu(x, 'BEREICH_GRUENDE');
  // ausdrücklich genannt; jede nur, wenn sie im Code dieses Baums wirklich steht
  for (const [x, d] of [['intern', 'bereiche/proj/bereich.ts'], ['slot_belegt', 'projekt/befehle.ts'], ['ueber_projekt', 'server.ts']]) {
    if (lies(d).includes(`'${x}'`)) dazu(x, `genannt ${d}`);
  }
  return g;
}

// Gründe der Geräte-Konfiguration (bereiche/geraete, Task 8). Eigene Sicht, nicht in gruendeAusDemCode: die Seite kennt die Geräte-Gründe erst mit
// Task 9 und ff. in FEHLER_TEXT; der V2-Gründe-Test würde sonst heute rot. Geprüft wird gegen GRUND_TEXT (tests/geraete_aendern.test.mjs).
export function gruendeGeraete() {
  const g = new Map();
  const dazu = (grund, wo) => { if (!g.has(grund)) g.set(grund, new Set()); g.get(grund).add(wo); };
  for (const d of ts('bereiche/geraete')) gruendeAusDatei(d, lies(d), dazu);
  return g;
}

// Fix-Runde S3, R2 (Spec 6.34: jede Antwort mit Grund trägt einen ENGLISCHEN text; deutsche Meldungen höchstens als detail). Bisher prüfte der
// Gründe-Test nur die Tabelle in http/gruende.ts; eigene Texte der Routen (ProjFehler extra.text, AusgabeFehler, StandFehler, …) sah er nicht
// (sitzung.ts:531 antwortete „befehle: nicht leere Liste erwartet“). Hier: jedes Text-Literal, das als text einer Antwort gemeint ist.
// Fix-Runde 2 S3, F2: auch Texte in doppelten Anführungszeichen ("…") zählen
const LIT = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\`[^\`]*\`)`;
const NUR_LIT = new RegExp(`^${LIT}$`);
const ohneEinschub = (s) => s.slice(1, -1).replace(/\$\{[^}]*\}/g, 'x');   // ${…} in Vorlagen zählt als Platzhalter
const ORTE = () => [...ts('projekt'), ...ts('bereiche/proj'), ...ts('http')];
const zeile = (t, i) => t.slice(0, i).split('\n').length;
// Fix-Runde 2 S3, F2: das text-Argument von fehl() und new AusgabeFehler|FreezeFehler|StandFehler('grund', …) als Ausdruck bis zum Komma oder
// zur Klammer derselben Tiefe (Zeichenketten und Vorlagen übersprungen). Ein Literal ist ein Text; ein Ternär, dessen Zweige alle Literale (oder
// wieder solche Ternäre) sind, liefert seine Zweige als Texte; alles andere (Variable, Konstante, Aufruf, Verkettung) ist ein Fund wie bei ProjFehler.
// Re-Review Fix-Runde 2 (RR2): der Grund auch in doppelten Anführungszeichen
const AUFRUF = /\b(?:fehl|new (?:AusgabeFehler|FreezeFehler|StandFehler))\(\s*(?:'[a-z_]+'|"[a-z_]+")\s*,\s*/g;
// RR2: ein Einschub ${…} in einer Vorlage, der eine Fehlermeldung (.message) oder eine Text-Konstante derselben Datei (const GROSS = '…') einsetzt,
// bringt fremden Text herein; Zahl-Konstanten (FREEZE_MAX_BEATS) und berechnete Werte bleiben erlaubt
const textKonstante = (x, t) => /^[A-Z][A-Z0-9_]*$/.test(x) && new RegExp(String.raw`\bconst ${x}\s*(?::\s*string\s*)?=\s*['"\x60]`).test(t);
const fremdeEinschuebe = (l, t) => (l.startsWith('`') ? [...l.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim())
  .filter((x) => /\.message\b/.test(x) || textKonstante(x, t)) : []);
function argument(t, i) {
  let tiefe = 0, j = i;
  for (; j < t.length; j++) {
    const c = t[j];
    if (c === "'" || c === '"' || c === '`') {
      for (j++; j < t.length && t[j] !== c; j++) {
        if (t[j] === '\\') j++;
        else if (c === '`' && t[j] === '$' && t[j + 1] === '{') { let k = 1; for (j += 2; j < t.length && k > 0; j++) k += t[j] === '{' ? 1 : t[j] === '}' ? -1 : 0; j--; }
      }
    } else if ('([{'.includes(c)) tiefe++;
    else if (')]}'.includes(c)) { if (tiefe === 0) break; tiefe--; } else if (c === ',' && tiefe === 0) break;
  }
  return t.slice(i, j).trim();
}
// erstes Zeichen c auf oberster Ebene außerhalb von Zeichenketten ab Stelle 0; bei '?' nicht ?. und ??
function oben(x, c) {
  let tiefe = 0;
  for (let j = 0; j < x.length; j++) {
    const z = x[j];
    if (z === "'" || z === '"' || z === '`') { for (j++; j < x.length && x[j] !== z; j++) if (x[j] === '\\') j++; continue; }
    if ('([{'.includes(z)) tiefe++; else if (')]}'.includes(z)) tiefe--;
    else if (tiefe === 0 && z === c && !(c === '?' && (x[j + 1] === '.' || x[j + 1] === '?' || x[j - 1] === '?'))) return j;
  }
  return -1;
}
// Literale eines Ausdrucks (Literal oder Ternär aus Literalen) oder null, wenn ein Zweig keines ist
function zweige(x) {
  x = x.trim();
  if (NUR_LIT.test(x)) return [x];
  const f = oben(x, '?');
  if (f < 0) return null;
  const rest = x.slice(f + 1), d = oben(rest, ':');
  if (d < 0) return null;
  const a = zweige(rest.slice(0, d)), b = zweige(rest.slice(d + 1));
  return a && b ? [...a, ...b] : null;
}
// Aufrufe in einer Datei d mit Inhalt t: {texte: [{text, wo}], variablen: [Fundstelle]}
export function aufrufTexte(d, t) {
  const texte = [], variablen = [];
  for (const x of t.matchAll(AUFRUF)) {
    const arg = argument(t, x.index + x[0].length), wo = `${d}:${zeile(t, x.index)}`;
    if (arg === '') continue;                                       // kein text: der Rückfall aus http/gruende.ts
    const z = zweige(arg);
    if (!z) { variablen.push(`${wo}: text: ${arg.slice(0, 80)}`); continue; }
    for (const l of z) {
      texte.push({ text: ohneEinschub(l), wo });
      for (const e of fremdeEinschuebe(l, t)) variablen.push(`${wo}: text: Einschub ${e}`);
    }
  }
  return { texte, variablen };
}
// [{text, wo}] einer Datei: text: '…', fehl('grund', '…'), new AusgabeFehler|FreezeFehler|StandFehler('grund', '…') (auch Ternär aus Literalen),
// new RenderFehler(…, rc|null, '…'), und die englischen Texte der Render-Rückgaben (RC_TEXT [deutsch, englisch])
export function texteAusDatei(d, t) {
  const aus = [];
  const muster = [
    new RegExp(String.raw`\btext:\s*` + LIT, 'g'),
    new RegExp(String.raw`new RenderFehler\([\s\S]{0,240}?,\s*(?:null|\d+|rc)\s*,\s*` + LIT + String.raw`\s*\)`, 'g'),
    new RegExp(String.raw`\d+:\s*\['[^']*',\s*` + LIT + String.raw`\]`, 'g'),
  ];
  for (const m of muster) for (const x of t.matchAll(m)) aus.push({ text: ohneEinschub(x[1]), wo: `${d}:${zeile(t, x.index)}` });
  return [...aus, ...aufrufTexte(d, t).texte];
}
export function texteAusDemCode() { return ORTE().flatMap((d) => texteAusDatei(d, lies(d))); }
// Fundstellen, an denen ein text aus einer Variablen kommt (etwa e.message einer deutschen Prüfmeldung; die gehört in detail): ProjFehler mit
// text: <Variable>, und (F2) fehl() und new AusgabeFehler|FreezeFehler|StandFehler mit einem text-Argument, das kein Literal und kein Ternär aus
// Literalen ist
export function variablenAusDatei(d, t) {
  const aus = [];
  for (const x of t.matchAll(/new ProjFehler\([^)]*\{[^}]*\btext:\s*([^'"`\s][^,}]*)/g)) aus.push(`${d}:${zeile(t, x.index)}: text: ${x[1].trim()}`);
  // RR2: { text } in Kurzschreibweise ist eine Variable
  for (const x of t.matchAll(/new ProjFehler\([^)]*\{(?:[^}]*,)?\s*text\s*(?:,[^}]*)?\}/g)) aus.push(`${d}:${zeile(t, x.index)}: text: { text }`);
  return [...aus, ...aufrufTexte(d, t).variablen];
}
export function texteAusVariable() { return ORTE().flatMap((d) => variablenAusDatei(d, lies(d))); }
// Verschachtelte Gründe in einer Antwort ({ gesetzt: true, fehler: 'kein_kern' } unter tempo, Listeneinträge): ein Objekt-Literal mit einem
// Grund-Literal braucht daneben text. Log-Zeilen (typ: …) zählen nicht.
export function gruendeOhneText() {
  const aus = [];
  for (const d of ORTE()) {
    const t = lies(d);
    for (const x of t.matchAll(/\{[^{}]*\b(?:fehler|grund):\s*'[a-z_]+'[^{}]*\}/g)) {
      if (!/\btext\b|\btyp:/.test(x[0])) aus.push(`${d}:${zeile(t, x.index)}: ${x[0].slice(0, 120)}`);
    }
  }
  return aus;
}
