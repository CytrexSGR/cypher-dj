// Abnahme der Scheibe 21 gegen die Kern-Attrappe (Scheibe 13), stumm (die Attrappe öffnet keinen Port und schreibt keinen
// Ton), mit Fehlerfall vorher und Negativ-Kontrolle je Punkt. Zählt am Ziel: was die Attrappe an das Abo des Läufers
// meldet (/q, /e/regler, /e/invariante, /zustand/deck) und was im Journal des Leitstands steht.
// Aufruf: node pruef/abnahme_21.ts <ausgabe-ordner>
// Ergebnis: <ordner>/bericht.json, bericht.md und beleg_neustart.jsonl (eingecheckt), je Lauf <name>.journal.jsonl
// (nicht eingecheckt, .gitignore); Rückgabe 0 alle Punkte erfüllt, 1 sonst.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fahre, type Lauf } from './laeufer.ts';
import { subDoppelt } from './sub_doppelt.ts';

const HIER = path.dirname(fileURLToPath(import.meta.url));
const LS = path.resolve(HIER, '..');
const FOLGEN = path.join(HIER, 'folgen');
const GOLDEN = path.resolve(LS, '..', 'vertrag', 'folgen');
const aus = path.resolve(process.argv[2] ?? path.join(HIER, 'ergebnisse', new Date().toISOString().slice(0, 16).replace(/[-:]/g, '')));
fs.mkdirSync(aus, { recursive: true });

const last = () => fs.readFileSync('/proc/loadavg', 'utf8').split(' ')[0];
const punkte: Array<{ punkt: string; ok: boolean; zahl: string; beleg: string; last: string }> = [];
const laeufe: Record<string, unknown> = {};
const qCypher = (l: Lauf, status?: number) => l.beobachtet.filter((b) => b.osc && b.osc[0] === '/q' && b.osc[3] === 'cypher'
  && (status === undefined || b.osc[4] === status)).length;
const invariante = (l: Lauf, art: string) => l.beobachtet.filter((b) => b.osc && b.osc[0] === '/e/invariante' && b.osc[2] === art).length;
const journal = (l: Lauf, typ: string) => l.journal.filter((z) => z.typ === typ);

async function lauf(schluessel: string, datei: string, opt: Parameters<typeof fahre>[1] = {}): Promise<Lauf> {
  const vor = last();
  const l = await fahre(datei, { ...opt, name: schluessel });
  const nach = last();
  laeufe[schluessel] = { datei: path.relative(LS, datei), befunde: l.befunde, verzug: l.verzug, mutationen: l.mutationen,
    leitstand_start_ms: l.leitstandStartMs, last: `${vor}/${nach}` };
  fs.writeFileSync(path.join(aus, `${schluessel}.journal.jsonl`), l.journal.map((z) => JSON.stringify(z)).join('\n') + '\n');
  process.stdout.write(`abnahme_21: ${schluessel} ${l.befunde.length ? 'ROT' : 'GRÜN'} (${l.befunde.length} Befunde, Verzug ${l.verzug}, Last ${vor}/${nach})\n`);
  return l;
}
const punkt = (p: string, ok: boolean, zahl: string, beleg: string, l?: Lauf) => {
  punkte.push({ punkt: p, ok, zahl, beleg, last: l ? String((laeufe[l.name] as { last: string }).last) : '' });
};

// 1. autonomie_1_eq: grün, 0 /k/teil am Ziel; Fehlerfall vorher: ohne Positivliste (Mutation autonomie_aus) rot
const a1 = await lauf('autonomie_1_eq', path.join(GOLDEN, 'autonomie_1_eq.jsonl'));
const a1f = await lauf('autonomie_1_eq_ohne_liste', path.join(GOLDEN, 'autonomie_1_eq.jsonl'), { mutationLeitstand: ['autonomie_aus'] });
punkt('autonomie_1_eq grün, 0 /k/teil an der Attrappe', !a1.befunde.length && qCypher(a1) === 0 && a1f.befunde.length > 0 && qCypher(a1f) > 0,
  `/q cypher am Ziel: ${qCypher(a1)} (Fehlerfall ohne Positivliste: ${qCypher(a1f)}, Befunde ${a1f.befunde.length})`, 'autonomie_1_eq.journal.jsonl', a1);

// 2. kill -9 auf den Leitstand mitten in teil_rampe (Generation 1: /q/stand nach §4.1); Fehlerfall: ohne Wiederaufnahme
const n1 = await lauf('leitstand_neustart_gen1', path.join(FOLGEN, 'leitstand_neustart_gen1.jsonl'));
const n1f = await lauf('leitstand_neustart_ohne_wiederaufnahme', path.join(FOLGEN, 'leitstand_neustart_gen1.jsonl'), { mutationLeitstand: ['wiederaufnahme_aus'] });
const ab1 = journal(n1, 'abgleich').find((z) => z.daten.grund === 'leitstand_neustart');
const teil1 = (ab1?.daten.teile as Array<Record<string, unknown>> | undefined)?.find((t) => t.teil === 1);
punkt('Leitstand-Abschuss in teil_rampe: Attrappe fährt zu Ende, neuer Leitstand übernimmt über /q/stand',
  !n1.befunde.length && journal(n1, 'fortsetzung').length === 1 && (ab1?.daten.q_stand as number) >= 1 && teil1?.bestaetigt === true
  && n1f.befunde.length > 0,
  `Journal: fortsetzung ${journal(n1, 'fortsetzung').length}, abgleich q_stand ${ab1?.daten.q_stand}, Teil 1 ${teil1?.status} bestätigt ${teil1?.bestaetigt}; neuer Leitstand bereit nach ${n1.leitstandStartMs.slice(1).join(', ')} ms; ohne Wiederaufnahme ${n1f.befunde.length} Befunde`,
  'leitstand_neustart_gen1.journal.jsonl', n1);
const n0 = await lauf('leitstand_neustart_gen0', path.join(FOLGEN, 'leitstand_neustart_gen0.jsonl'));
const ab0 = journal(n0, 'abgleich').find((z) => z.daten.grund === 'leitstand_neustart');
punkt('Befund Vertrag §4.1: in Generation 0 kommt kein /q/stand, der Stand kommt aus dem Journal', !n0.befunde.length,
  `abgleich q_stand ${ab0?.daten.q_stand} (erwartet 0 nach §4.1 wörtlich), Folge ${n0.befunde.length ? 'rot' : 'grün'}`, 'leitstand_neustart_gen0.journal.jsonl', n0);

// 3. Je Verriegelungsgrund ein Fall: am Prozess (was plan_einreichen ausdrücken kann) und in den Einheitstests (Deck- und Tempo-Teile)
const v = await lauf('verriegelung_gruende', path.join(FOLGEN, 'verriegelung_gruende.jsonl'));
const gesehen = new Set<string>();
for (const b of v.beobachtet) {
  const d = b.ws?.daten as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (b.ws?.typ === 'rpc_antwort') for (const g of d?.ergebnis?.gruende ?? []) gesehen.add(g.grund);
  if (b.ws?.typ === 'rpc_fehler') gesehen.add(d?.code);
}
const einheit = spawnSync(process.execPath, ['--test', 'tests/verriegelung.test.ts', 'tests/annahme.test.ts'], { cwd: LS, encoding: 'utf8' });
const einheitGruen = einheit.status === 0;
const NUR_EINHEIT = ['deck_beruehrt', 'ziel_ungehoert', 'budget_stretcher', 'unbekannter_regler'];
const LEITSTAND_CODES = ['form', 'zu_spaet', 'regler_beim_menschen', 'ueberlappung', 'regler_verplant', 'kein_hoerschein',
  'hoerschein_anderer_kanal', 'hoerschein_nicht_sync', 'hoerschein_pegel', 'hoerschein_anderer_inhalt',
  'hoerschein_anderes_tempo', 'hoerschein_abgelaufen', 'hoerschein_anderer_abschnitt', 'autonomie', 'ki_gestoppt',
  'nur_hand', 'ausserhalb_bereich', ...NUR_EINHEIT];
const fehlt = LEITSTAND_CODES.filter((c) => !gesehen.has(c) && !(NUR_EINHEIT.includes(c) && einheitGruen));
punkt('je Verriegelungsgrund ein Fall mit dem Code aus §16.2', !v.befunde.length && einheitGruen && fehlt.length === 0,
  `am Prozess ${[...gesehen].filter((c) => LEITSTAND_CODES.includes(c)).length} Codes, in Einheitstests ${NUR_EINHEIT.length}, fehlend: ${fehlt.join(', ') || 'keiner'} (rechner_fehlt gehört zu waehle, Scheibe 41)`,
  'verriegelung_gruende.journal.jsonl, tests/verriegelung.test.ts', v);

// 4. Fehlerfall 09 NP K1: ohne Kopplung Takte Sub doppelt (I1 der Attrappe aus, sonst fängt I1 es), mit Kopplung 0
const kv = await lauf('k1_vorher', path.join(FOLGEN, 'k1_kopplung.jsonl'), { mutationLeitstand: ['kopplung_aus'], mutationAttrappe: ['i1_aus'] });
const kn = await lauf('k1_nachher', path.join(FOLGEN, 'k1_kopplung.jsonl'), { mutationAttrappe: ['i1_aus'] });
const kk = await lauf('k1_kopplung', path.join(FOLGEN, 'k1_kopplung.jsonl'));
const ki = await lauf('k1_ohne_kopplung_mit_i1', path.join(FOLGEN, 'k1_kopplung.jsonl'), { mutationLeitstand: ['kopplung_aus'] });
const kh = await lauf('k1_ohne_hand', path.join(FOLGEN, 'k1_ohne_hand.jsonl'));
const [dv, dn, dk, dh] = [kv, kn, kk, kh].map((l) => subDoppelt(l, [1, 2], 13, 37));
punkt('Fehlerfall 09 NP K1: ohne Kopplung Takte Sub doppelt, nach Kopplung durch den Leitstand 0',
  dv.takte.length > 0 && dn.takte.length === 0 && dk.takte.length === 0 && !kk.befunde.length && invariante(kk, 'sub_doppelt') === 0,
  `vorher ${dv.takte.length} Takte (${dv.takte.join(',')}; ${dv.samples} Samples), nachher ${dn.takte.length}, mit I1 und Kopplung ${dk.takte.length} Takte und ${invariante(kk, 'sub_doppelt')} /e/invariante; ohne Kopplung fängt I1 es ab: ${invariante(ki, 'sub_doppelt')} /e/invariante sub_doppelt`,
  'k1_vorher.journal.jsonl, k1_nachher.journal.jsonl', kn);
punkt('Negativ-Kontrolle K1: ohne Griff läuft der Basstausch durch, 0 Takte Sub doppelt', !kh.befunde.length && dh.takte.length === 0,
  `${dh.takte.length} Takte, Befunde ${kh.befunde.length}`, 'k1_ohne_hand.journal.jsonl', kh);

// 5. Negativ-Kontrolle: Stufe 1, Plan macht ausschließlich KI-Spur-Kanäle leiser → direkt angenommen
const kl = await lauf('ki_spur_leiser', path.join(FOLGEN, 'ki_spur_leiser.jsonl'));
punkt('Negativ-Kontrolle: KI-Spur leiser geht auf Stufe 1 direkt', !kl.befunde.length && qCypher(kl, 1) === 1 && qCypher(kl, 3) === 1,
  `/q cypher angenommen ${qCypher(kl, 1)}, fertig ${qCypher(kl, 3)}; lauter und EQ an derselben Spur: Vorschlag`, 'ki_spur_leiser.journal.jsonl', kl);

// 6. Vorschlag verfällt genau 1 Takt vor seinem Start
const vf = await lauf('vorschlag_verfall', path.join(FOLGEN, 'vorschlag_verfall.jsonl'));
const verfallen = vf.beobachtet.filter((b) => b.ws?.typ === 'ereignis' && b.ws.daten.art === 'vorschlag_verfallen' && b.verbindung === 'mcp');
const exakt = verfallen.every((b) => b.ws!.zeit.beat === b.ws!.daten.verfaellt_beat && b.ws!.daten.verfaellt_beat === (b.ws!.daten.plan_id === 'p1' ? 60 : 124));
const verzugBeats = verfallen.map((b) => (b.ws!.daten.erkannt_beat as number) - (b.ws!.daten.verfaellt_beat as number));
punkt('Vorschlag verfällt genau 1 Takt vor seinem Start (Ereignis am richtigen Beat)',
  !vf.befunde.length && verfallen.length === 2 && exakt && verzugBeats.every((x) => x >= 0 && x <= (2 * 256) / 22500),
  `${verfallen.length} Verfälle, Ereignis-Beat = verfaellt_beat: ${exakt}, erkannt nach ${verzugBeats.map((x) => (x * 22500).toFixed(0)).join(' und ')} Samples (Grenze 512); Annahme bei 91,9 angenommen, bei 124,0 nicht`,
  'vorschlag_verfall.journal.jsonl', vf);

// 7. Abgleich nach Kern-Neustart (§16.3)
const kr = await lauf('kern_neustart', path.join(FOLGEN, 'kern_neustart.jsonl'));
const abk = journal(kr, 'abgleich').filter((z) => z.daten.grund === 'kern_neustart').pop();
punkt('Abgleich nach Kern-Neustart über /q/stand', !kr.befunde.length && (abk?.daten.q_stand as number) >= 1,
  `abgleich q_stand ${abk?.daten.q_stand}, Teile ${JSON.stringify(abk?.daten.teile)}`, 'kern_neustart.journal.jsonl', kr);

// 8. Autonomie-Positivliste §10 wörtlich und lückenlos (Auftrag 2026-09-26): je Regel ein Test, der eine Verletzung
// abweist, und eine Mutante, die ihn rot macht (pruef/mutation_positivliste.ts, Tests P01 bis P33, dazu H01 und B03)
const mvor = last();
const mut = spawnSync(process.execPath, ['pruef/mutation_positivliste.ts', '--bericht', path.join(aus, 'mutation_positivliste.txt')],
  { cwd: LS, encoding: 'utf8', timeout: 900_000 });
const mnach = last();
const mz = mut.stdout.split('\n');
const regeln = mz.filter((z) => /^OK +P\d\d /.test(z)).length;
const regelnFehl = mz.filter((z) => /^FEHLER +P\d\d /.test(z)).length;
process.stdout.write(`abnahme_21: mutation_positivliste rc ${mut.status} (${regeln} Regeln ok, ${regelnFehl} Fehler, Last ${mvor}/${mnach})\n`);
punkte.push({ punkt: 'Autonomie-Positivliste §10: je Regel ein Test gegen die Verletzung und eine Mutante, die ihn rot macht',
  ok: mut.status === 0 && regeln >= 33 && regelnFehl === 0,
  zahl: `${regeln} Regeln mit Test grün und Mutante rot, ${regelnFehl} Fehler; ${mz.filter((z) => z.startsWith('mutation_positivliste:')).join('')}`,
  beleg: 'mutation_positivliste.txt, tests/positivliste.test.ts', last: `${mvor}/${mnach}` });

// 9. M15 (Stand 03): jede Verriegelungs-Ansage an den Spieler sagt, was zu ändern ist; am Prozess aus verriegelung_gruende
const antworten = v.beobachtet.filter((b) => b.ws?.typ === 'rpc_antwort').map((b) => b.ws!.daten.ergebnis as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any
const abgewiesen = antworten.filter((e) => e && (e.status === 'verriegelt' || e.status === 'abgelehnt'));
const mitHinweis = abgewiesen.filter((e) => (e.gruende as Array<{ grund: string }>).every((g) => new RegExp(`${g.grund}: [^;]+; \\S`).test(e.ansage as string)));
const sync = abgewiesen.filter((e) => (e.gruende as Array<{ grund: string }>).some((g) => g.grund === 'hoerschein_nicht_sync'));
const syncOk = sync.length > 0 && sync.every((e) => /Material [0-9a-f]{16} .*gesperrt, wähle ein anderes Material/.test(e.ansage as string));
const ohne = antworten.filter((e) => e && (e.status === 'vorgeschlagen' || e.status === 'angenommen'));
const ohneOk = ohne.length > 0 && ohne.every((e) => !/verriegelt|wähle ein anderes/.test(e.ansage as string));
const h01 = mz.find((z) => / H01 /.test(z)) ?? 'H01 fehlt';
punkte.push({ punkt: 'M15: jede Verriegelungs-Ansage an den Spieler sagt, was zu ändern ist',
  ok: abgewiesen.length > 0 && mitHinweis.length === abgewiesen.length && syncOk && ohneOk && /^OK/.test(h01),
  zahl: `${mitHinweis.length} von ${abgewiesen.length} verriegelten oder abgelehnten Antworten mit Ausweg je Code; hoerschein_nicht_sync ${sync.length}-mal mit Material und „wähle ein anderes Material“: ${syncOk}; Negativ-Kontrolle ${ohne.length} angenommene oder vorgeschlagene ohne Verriegelungstext: ${ohneOk}; Fehlerfall ohne Hinweis (Mutante H01): ${h01.startsWith('OK') ? 'Test rot' : 'NICHT rot'}`,
  beleg: 'verriegelung_gruende.journal.jsonl, mutation_positivliste.txt, tests/hinweise.test.ts', last: String((laeufe[v.name] as { last: string }).last) });

// Beleg „Journal belegt es“: die Zeilen der Übernahme aus den Journalen (die ganzen Journale bleiben uneingecheckt)
const BELEG = new Set(['set_start', 'fortsetzung', 'wiederaufnahme', 'abgleich_beginn', 'abgleich', '/q/stand', '/e/neustart',
  '/k/willkommen', 'teil_gesendet', 'ereignis_teil_fertig', 'ereignis_teil_abgebrochen', 'plan_status']);
fs.writeFileSync(path.join(aus, 'beleg_neustart.jsonl'), [n1, n0, kr].flatMap((l) => l.journal.filter((z) => BELEG.has(z.typ))
  .map((z) => JSON.stringify({ lauf: l.name, ...z }))).join('\n') + '\n');

const alle = punkte.every((p) => p.ok);
const unterLast = Object.entries(laeufe).filter(([, x]) => (x as { verzug: number }).verzug > 1200).map(([k]) => k);
fs.writeFileSync(path.join(aus, 'bericht.json'), JSON.stringify({ alle, punkte, laeufe, unter_last: unterLast }, null, 1));
fs.writeFileSync(path.join(aus, 'bericht.md'), [
  `# Abnahme Scheibe 21 (${new Date().toISOString()})`, '',
  `Ergebnis: ${alle ? 'alle Punkte erfüllt' : 'NICHT alle Punkte erfüllt'}${unterLast.length ? `; unter Last (Sendeverzug > 25 ms): ${unterLast.join(', ')}` : ''}`, '',
  '| Punkt | erfüllt | Zahl | Beleg | Last vor/nach |', '|---|---|---|---|---|',
  ...punkte.map((p) => `| ${p.punkt} | ${p.ok ? 'ja' : 'NEIN'} | ${p.zahl} | ${p.beleg} | ${p.last} |`), '',
].join('\n'));
process.stdout.write(`abnahme_21: ${alle ? 'alle Punkte erfüllt' : 'NICHT erfüllt'}, Bericht ${path.join(aus, 'bericht.md')}\n`);
process.exit(alle ? 0 : 1);
