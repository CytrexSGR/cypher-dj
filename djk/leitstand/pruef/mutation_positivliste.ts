// Mutationsprobe der Autonomie-Positivliste (§10), der Verriegelungs-Hinweise (M15) und der doppelten gestartet beim
// Abgleich (Plan 18 B3): je Regel eine Mutante im Quelltext; sie muss genau den Test ihrer Regel rot machen, danach
// wird die Datei zurückgelegt. Jede Mutante findet ihren alten Text genau einmal, sonst zählt sie als Fehler der Probe.
// Zum Schluss läuft die ganze Datei unmutiert und muss grün sein.
//
// Aufruf: node pruef/mutation_positivliste.ts [--nur P07,P22] [--bericht <datei>]
// Nicht gleichzeitig mit Läufen dieses Ordners fahren (Läufer und Leitstand lesen dieselben Quellen).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface Mutante { regel: string; test: string; datei: string; alt: string; neu: string; was: string }

const A = 'src/autonomie.ts';
const R = 'src/regler_info.ts';
const N = 'src/annahme.ts';
const PL = 'tests/positivliste.test.ts';
const STUFE0 = "if (stufe <= 0) return methode === 'plan_abbrechen' ? 'direkt' : 'abgelehnt';";
const stufe0Frei = (m: string) => `if (stufe <= 0) return (methode === 'plan_abbrechen' || methode === '${m}') ? 'direkt' : 'abgelehnt';`;
const LEER = '  if (plan.teile.length === 0) return false;\n';
const lassDurch = (bed: string) => `${LEER}  if (plan.teile.every((t) => ${bed})) return true;\n`;
const EVERY = "return plan.teile.every((t) => t.art === 'regler' && kiSpur.has(kanalVon(t.pfad) ?? '')";

export const MUTANTEN: Mutante[] = [
  { regel: 'P01', test: PL, datei: A, alt: STUFE0, neu: stufe0Frei('waehle'), was: 'Stufe 0 lässt waehle durch' },
  { regel: 'P02', test: PL, datei: A, alt: STUFE0, neu: stufe0Frei('plan_einreichen'), was: 'Stufe 0 lässt plan_einreichen durch' },
  { regel: 'P03', test: PL, datei: A, alt: STUFE0, neu: stufe0Frei('laden'), was: 'Stufe 0 lässt laden durch' },
  { regel: 'P04', test: PL, datei: A, alt: STUFE0, neu: stufe0Frei('vorhoeren'), was: 'Stufe 0 lässt vorhoeren durch' },
  { regel: 'P05', test: PL, datei: A, alt: STUFE0, neu: stufe0Frei('erzeuge'), was: 'Stufe 0 lässt erzeuge durch' },
  { regel: 'P06', test: PL, datei: A, alt: "['lage', 'warte', 'bestand', 'passung', 'markieren']", neu: "['lage', 'bestand', 'passung', 'markieren']",
    was: 'warte fehlt unter den lesenden Methoden' },
  { regel: 'P07', test: PL, datei: A, alt: STUFE0, neu: "if (stufe <= 0) return 'abgelehnt';", was: 'Stufe 0 verbietet plan_abbrechen' },
  { regel: 'P08', test: PL, datei: A, alt: LEER, neu: lassDurch("t.art === 'regler' && /\\/eq\\//.test(t.pfad)"), was: 'EQ-Pläne gehen direkt' },
  { regel: 'P09', test: PL, datei: A, alt: LEER, neu: lassDurch("t.art === 'regler' && /\\/stem\\//.test(t.pfad)"), was: 'Stem-Pläne gehen direkt' },
  { regel: 'P10', test: PL, datei: A, alt: LEER, neu: lassDurch("t.art === 'regler' && /\\/send\\//.test(t.pfad)"), was: 'Send-Pläne an jedem Kanal gehen direkt' },
  { regel: 'P11', test: PL, datei: A, alt: LEER, neu: lassDurch("t.art === 'deck'"), was: 'Deck-Pläne (Hotcue, Sprung, Loop, Start) gehen direkt' },
  { regel: 'P12', test: PL, datei: A, alt: '  if ((METHODEN_EINREICHEN as readonly string[]).includes(methode)) {\n',
    neu: "  if (methode === 'waehle') return 'direkt';\n  if ((METHODEN_EINREICHEN as readonly string[]).includes(methode)) {\n", was: 'waehle geht auf Stufe 1 direkt' },
  { regel: 'P13', test: PL, datei: N, alt: "      this.plaene.set(plan.id, { plan, status: 'vorgeschlagen', teile: new Map(), vorschlag: v.id, annahme: null });\n",
    neu: "      { const p0: PlanStand = { plan, status: 'vorgeschlagen', teile: new Map(), vorschlag: v.id, annahme: null }; this.plaene.set(plan.id, p0); this.einreichenAnKern(p0); }\n",
    was: 'ein Vorschlag geht schon vor der Annahme an den Kern' },
  { regel: 'P14', test: PL, datei: N, alt: "t.art === 'deck' && ps.annahme ? `annahme:${ps.annahme}` : null", neu: 'null',
    was: 'Deck-Teile eines angenommenen Vorschlags ohne annahme:<id>' },
  { regel: 'P15', test: PL, datei: A, alt: "['laden', 'vorhoeren', 'erzeuge', 'plan_abbrechen']", neu: "['laden', 'vorhoeren', 'plan_abbrechen']",
    was: 'erzeuge fehlt unter den allein erlaubten' },
  { regel: 'P16', test: PL, datei: N, alt: "if (ps.plan.quelle !== 'cypher') throw", neu: 'if (false) throw', was: 'plan_abbrechen bricht fremde Pläne ab' },
  { regel: 'P17', test: PL, datei: A, alt: "  return 'abgelehnt'; // spielzettel und Unbekanntes", neu: "  return 'direkt'; // spielzettel und Unbekanntes",
    was: 'spielzettel und Unbekanntes gehen auf Stufe 1 und 2 direkt' },
  { regel: 'P18', test: PL, datei: A, alt: LEER, neu: '  return false;\n', was: 'die Ausnahme „KI-Spur leiser“ fehlt' },
  { regel: 'P19', test: PL, datei: R, alt: "if (/\\/kill\\/(tief|mitte|hoch)$/.test(pfad)) return nach === 1;", neu: "if (/\\/kill\\/(tief|mitte|hoch)$/.test(pfad)) return false;",
    was: 'Kill an zählt nicht als leiser' },
  { regel: 'P20', test: PL, datei: A, alt: EVERY, neu: "return plan.teile.every((t) => t.art === 'regler' && true", was: 'Kanäle außerhalb der KI-Spur zählen mit' },
  { regel: 'P21', test: PL, datei: R, alt: "if (/\\/(fader|send\\/[1-4])$/.test(pfad)", neu: "if (/\\/(fader|send\\/[1-4]|eq\\/(tief|mitte|hoch))$/.test(pfad)",
    was: 'EQ nach unten zählt als leiser' },
  { regel: 'P22', test: PL, datei: R, alt: 'return nach < von;', neu: 'return nach <= von;', was: 'gleich laut zählt als leiser' },
  { regel: 'P23', test: PL, datei: R, alt: 'return nach === 1;', neu: 'return nach === 0 || nach === 1;', was: 'Kill aus zählt als leiser' },
  { regel: 'P24', test: PL, datei: A, alt: 'machtLeiser(t.pfad, wertVor(plan, t, wert), t.nach)', neu: 'machtLeiser(t.pfad, wert(t.pfad), t.nach)',
    was: 'Teile desselben Plans zählen nicht (nur Ist-Wert)' },
  { regel: 'P25', test: PL, datei: N, alt: 'w = Math.min(w, t.nach);', neu: 'w = w;', was: 'angenommene Pläne am Regler zählen nicht (F9)' },
  { regel: 'P26', test: PL, datei: A, alt: EVERY, neu: "return plan.teile.every((t) => t.art !== 'regler' || kiSpur.has(kanalVon(t.pfad) ?? '')",
    was: 'Deck- und Tempo-Teile zählen als leiser' },
  { regel: 'P27', test: PL, datei: A, alt: LEER, neu: '', was: 'ein leerer Plan gilt als leiser' },
  { regel: 'P28', test: PL, datei: A, alt: "kiSpur.has(kanalVon(t.pfad) ?? '')", neu: "(kiSpur.size === 0 || kiSpur.has(kanalVon(t.pfad) ?? ''))",
    was: 'ohne KI-Spur gilt jeder Kanal als KI-Spur' },
  { regel: 'P29', test: PL, datei: A, alt: "if (stufe >= 3) return 'direkt';", neu: "if (stufe >= 2) return 'direkt';", was: 'Stufe 2 ist lockerer als 1' },
  { regel: 'P30', test: PL, datei: A, alt: "if (stufe >= 3) return 'direkt';", neu: "if (stufe >= 4) return 'direkt';", was: 'Stufe 3 macht Vorschläge' },
  { regel: 'P31', test: PL, datei: A, alt: '  for (const n of Object.keys(m)) if (!(METHODEN_10 as readonly string[]).includes(n)) {\n',
    neu: '  for (const n of Object.keys(m)) if (false) {\n', was: 'eine Methode außerhalb §10 (etwa eine Stufe setzen) wird angenommen' },
  { regel: 'P32', test: PL, datei: N, alt: "    if (this.spiegel.kiGestoppt) return abweisen('abgelehnt', alle('ki_gestoppt'));\n", neu: '',
    was: 'nach Cypher-Stopp gehen Einreichungen durch' },
  { regel: 'P33', test: PL, datei: A, alt: 'return { code: \'autonomie\', text: autonomieText(stufe, methode) };', neu: "return { code: 'autonomie', text: 'autonomie' };",
    was: 'das Tor sagt nur den Code' },
  { regel: 'H01', test: 'tests/hinweise.test.ts', datei: 'src/hinweise.ts', alt: "return `Teil ${g.teil} ${g.grund}${bau ? `: ${bau(t, g, u)}` : ''}`;",
    neu: 'return `Teil ${g.teil} ${g.grund}`;', was: 'Ansage ohne Hinweis (Stand vor M15)' },
  { regel: 'B03', test: 'tests/abgleich_doppelt.test.ts', datei: N, alt: '    if (st.status === neu) { this.journal(\'quittung_doppelt\'',
    neu: '    if (false) { this.journal(\'quittung_doppelt\'', was: 'doppeltes gestartet nach Kern-Neustart meldet teil_gestartet zweimal (Plan 18 B3)' },
];

function lauf(test: string, muster: string | null): { rc: number; text: string } {
  const args = ['--test', ...(muster ? [`--test-name-pattern=^${muster} `] : []), test];
  const r = spawnSync(process.execPath, args, { cwd: WURZEL, encoding: 'utf8', timeout: 120_000 });
  return { rc: r.status ?? 99, text: `${r.stdout}${r.stderr}` };
}

function main(): void {
  const argv = process.argv.slice(2);
  const nur = argv.includes('--nur') ? argv[argv.indexOf('--nur') + 1].split(',') : null;
  const bericht = argv.includes('--bericht') ? argv[argv.indexOf('--bericht') + 1] : null;
  const zeilen: string[] = [];
  const sag = (z: string) => { zeilen.push(z); process.stdout.write(`${z}\n`); };
  let fehler = 0;
  for (const m of MUTANTEN.filter((x) => !nur || nur.includes(x.regel))) {
    const pfad = path.join(WURZEL, m.datei);
    const vorher = fs.readFileSync(pfad, 'utf8');
    const n = vorher.split(m.alt).length - 1;
    if (n !== 1) { sag(`FEHLER ${m.regel}: alter Text ${n}-mal in ${m.datei} (erwartet 1)`); fehler++; continue; }
    const gruen = lauf(m.test, m.regel);
    // grün heißt: der Test der Regel lief (nicht übersprungen) und bestand
    const gruenOk = gruen.rc === 0 && new RegExp(`^ok \\d+ - ${m.regel} (?!.*# SKIP)`, 'm').test(gruen.text) && /# fail 0/.test(gruen.text);
    fs.writeFileSync(pfad, vorher.replace(m.alt, m.neu));
    let rot: { rc: number; text: string };
    try { rot = lauf(m.test, m.regel); } finally { fs.writeFileSync(pfad, vorher); }
    const rotOk = rot.rc !== 0 && new RegExp(`not ok \\d+ - ${m.regel} `).test(rot.text);
    const ok = gruenOk && rotOk;
    if (!ok) fehler++;
    sag(`${ok ? 'OK    ' : 'FEHLER'} ${m.regel} ohne Mutante ${gruenOk ? 'grün' : 'ROT'}, mit Mutante ${rotOk ? 'rot' : 'GRÜN'}: ${m.was} (${m.datei})`);
  }
  for (const t of [PL, 'tests/hinweise.test.ts', 'tests/abgleich_doppelt.test.ts']) {
    const r = lauf(t, null);
    const p = /# pass (\d+)/.exec(r.text)?.[1];
    const f = /# fail (\d+)/.exec(r.text)?.[1];
    if (r.rc !== 0) fehler++;
    sag(`${r.rc === 0 ? 'OK    ' : 'FEHLER'} unmutiert ${t}: pass ${p}, fail ${f}`);
  }
  const summe = `mutation_positivliste: ${MUTANTEN.filter((x) => !nur || nur.includes(x.regel)).length} Mutanten, Fehler ${fehler}`;
  sag(summe);
  if (bericht) fs.writeFileSync(bericht, `${zeilen.join('\n')}\n`);
  process.exit(fehler ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
