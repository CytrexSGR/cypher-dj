#!/usr/bin/env node
// djk-spiel: Cyphers Leitstand-Werkzeug für die CLI-Hauptinstanz (Auftrag "spieler-cli", MVP.md Korrektur 2026-09-26).
// Eine Zeile rein, JSON raus: verbindet sich mit dem Leitstand-Hub (SCHNITTSTELLEN §9), meldet sich an, schickt EIN
// Kommando als rpc (oder wartet auf eine gepushte takt-Nachricht), gibt den vollen daten-Teil der Antwort auf stdout
// aus und beendet sich. Details, Rollen-Befund und fünf geprüfte Beispiel-Pläne: docs/architektur/stand/spieler-cli.md
//
// Aufruf: node djk/spieler_cli/spieler.ts <kommando> [...args] [--ws-port <n>] [--timeout-ms <n>] [--max-s <n>]
// Port: --ws-port ODER Umgebungsvariable DJK_WS_PORT (kein Hardcoding); genau einer von beiden muss den fertigen,
// tatsächlichen Zielport tragen (keine automatische CYPHERDJ_INSTANZ-Verschiebung hier, siehe Handbuch).
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { Spielerverbindung, type Umschlag } from './src/client.ts';

const KOMMANDOS = ['zustand', 'takt', 'bestand', 'laden', 'plan', 'abbrechen', 'vorschlaege', 'warte-takt'];

function ausgeben(daten: unknown): void {
  process.stdout.write(`${JSON.stringify(daten)}\n`);
}

function fehlerAus(text: string, code = 2): never {
  ausgeben({ fehler: text });
  process.exit(code);
}

// rpc_antwort -> der volle daten-Teil ({id, ergebnis:{...}}), Exit 0. rpc_fehler -> der volle daten-Teil
// ({id, code, text}), Exit 1 (Wahl dieses CLI, siehe Handbuch). Der Wortlaut (auch ein ansage-Feld in ergebnis)
// kommt so oder so unverändert durch.
function ausgebenRpc(n: Umschlag): number {
  ausgeben(n.daten);
  return n.typ === 'rpc_fehler' ? 1 : 0;
}

function wsPort(werte: Record<string, string | boolean | undefined>): number {
  const roh = (werte['ws-port'] as string | undefined) ?? process.env.DJK_WS_PORT;
  if (!roh) fehlerAus('ws-port fehlt: --ws-port <n> oder Umgebungsvariable DJK_WS_PORT setzen');
  const n = Number(roh);
  if (!Number.isInteger(n) || n <= 0) fehlerAus(`ws-port ungültig: ${roh}`);
  return n;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const kommando = argv[0];
  if (!kommando) fehlerAus(`Kommando fehlt: ${KOMMANDOS.join('|')}`);
  if (!KOMMANDOS.includes(kommando)) fehlerAus(`unbekanntes Kommando ${kommando}: ${KOMMANDOS.join('|')}`);

  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    options: {
      'ws-port': { type: 'string' },
      'timeout-ms': { type: 'string' },
      'max-s': { type: 'string' },
    },
    allowPositionals: true,
  });
  const port = wsPort(values);

  // takt: der Leitstand hat kein RPC-Werkzeug dafür (§10-Tabelle nennt keins); der Takt-Zustand kommt als
  // gepushte "takt"-Nachricht an alle Clients (§9.3). Entscheidung dieses CLI: auf die NÄCHSTE nach dem Verbinden
  // warten (nicht den zuletzt bekannten zurückgeben), weil ein frischer Prozess sonst nie einen Wert hätte, bevor
  // der erste Takt beginnt, und "der letzte bekannte" bei einem Einzeiler-Aufruf keinen Unterschied zu "der
  // nächste" macht außer bei einem eben erst gestarteten Leitstand. Siehe Handbuch für die Alternative.
  if (kommando === 'takt') {
    const c = await Spielerverbindung.angemeldet(port, 'mcp', 'djk-spiel');
    try {
      const ms = values['timeout-ms'] ? Number(values['timeout-ms']) : 15000;
      const n = await c.warteAuf((x) => x.typ === 'takt', ms);
      ausgeben(n.daten);
      process.exit(0);
    } catch (e) {
      fehlerAus(`kein Takt in der Frist: ${(e as Error).message}`);
    } finally {
      c.schliesse();
    }
    return;
  }

  const c = await Spielerverbindung.angemeldet(port, 'mcp', 'djk-spiel');
  let code = 0;
  try {
    switch (kommando) {
      case 'zustand': {
        code = ausgebenRpc(await c.rpc('lage', {}));
        break;
      }
      case 'bestand': {
        // §10-Tabelle nennt max optional; das echte Schema (djk/vertrag/schemas/mcp.schema.json bestand_eingabe,
        // Zeile ~44) verlangt es (1..20) — gemessen am echten Leitstand (rpc_fehler "form", "missingProperty":"max"
        // ohne dieses Feld). Dieses CLI folgt dem gemessenen Schema: Vorgabe 20 (die Obergrenze), wenn nicht gesetzt.
        const parameter: Record<string, unknown> = { max: 20 };
        if (positionals[0]) {
          try { parameter.filter = JSON.parse(positionals[0]); } catch { fehlerAus(`filter ist kein JSON: ${positionals[0]}`); }
        }
        if (positionals[1]) parameter.max = Number(positionals[1]);
        code = ausgebenRpc(await c.rpc('bestand', parameter));
        break;
      }
      case 'laden': {
        const [deck, materialId] = positionals;
        if (!deck || !materialId) fehlerAus('Aufruf: djk-spiel laden <deck> <material_id>');
        // §10-Tabelle nennt das RPC-Werkzeug "laden" mit Parametern {deck:int, material_id:str} (nicht "fassung"
        // wie in der Vorgabe-Wortwahl der MVP-Zeile "laden, plan einreichen, abbrechen"); siehe Handbuch.
        code = ausgebenRpc(await c.rpc('laden', { deck: Number(deck), material_id: materialId }));
        break;
      }
      case 'plan': {
        const quelle = positionals[0];
        if (!quelle) fehlerAus('Aufruf: djk-spiel plan <datei.json|->');
        const text = quelle === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(quelle, 'utf8');
        let plan: Record<string, unknown>;
        try { plan = JSON.parse(text); } catch (e) { fehlerAus(`Plan ist kein JSON: ${(e as Error).message}`); }
        code = ausgebenRpc(await c.rpc('plan_einreichen', plan));
        break;
      }
      case 'abbrechen': {
        const planId = positionals[0];
        if (!planId) fehlerAus('Aufruf: djk-spiel abbrechen <plan_id>');
        code = ausgebenRpc(await c.rpc('plan_abbrechen', { plan_id: planId }));
        break;
      }
      case 'vorschlaege': {
        // Kein eigenes RPC-Werkzeug in §10; die Vorschläge stehen im vorschlaege-Feld der Lage (djk/leitstand/src/
        // takt.ts TaktZustand.vorschlaege, geliefert über RPC "lage" -> ergebnis.lage.vorschlaege). Diese Ausgabe
        // ({"vorschlaege":[...]}) ist eine eigene, kleine Form dieses CLI, kein wörtliches Leitstand-Feld.
        const antwort = await c.rpc('lage', {});
        if (antwort.typ === 'rpc_fehler') { code = ausgebenRpc(antwort); break; }
        const ergebnis = (antwort.daten as { ergebnis?: { lage?: { vorschlaege?: unknown[] } | null } }).ergebnis;
        ausgeben({ vorschlaege: ergebnis?.lage?.vorschlaege ?? [] });
        code = 0;
        break;
      }
      case 'warte-takt': {
        const bis = positionals[0];
        if (!bis || !Number.isFinite(Number(bis))) fehlerAus('Aufruf: djk-spiel warte-takt <n>');
        const maxS = values['max-s'] ? Number(values['max-s']) : 20;
        code = ausgebenRpc(await c.rpc('warte', { bis_takt: Number(bis), max_s: maxS }, (maxS + 5) * 1000));
        break;
      }
      default:
        fehlerAus(`unbekanntes Kommando: ${kommando}`);
    }
  } finally {
    c.schliesse();
  }
  process.exit(code);
}

main().catch((e: Error) => fehlerAus(`unerwarteter Fehler: ${e.message}`, 3));
