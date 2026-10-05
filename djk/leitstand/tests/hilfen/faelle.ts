// Gemeinsame Fälle der Tests von Scheibe 21: Hörschein h2 für Deck 2, der Plan aus 09 NP K1 in Vertragseinheiten,
// das Beispiel aus §14.1 (aus dem Vertragstext gelesen, nicht abgeschrieben).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Hoerschein } from '../../src/hoerscheine.ts';
import type { MenschenPlan, Plan } from '../../src/plan.ts';
import { VERTRAG_ORDNER } from '../../src/vertrag.ts';

export const B2 = 'f0000000000000b2';

export const H2: Hoerschein = {
  id: 'h2', kanal: 'deck/2', inhalt: `${B2}/128000_r1`, deck: 2, bpm: 128, gemessen_von_beat: 12, gemessen_bis_beat: 28,
  gueltig_bis_beat: 200, quell_von: 0, quell_bis: 200, erneuerung: 0, sync_ms: 0.5, lufs_kurz: -14, pegel_diff_db: 0,
  urteil: 'ok',
};

// 09 NP K1 (angriff.mjs a1) in Vertragseinheiten, Aufbau wie djk/vertrag/folgen/sub_doppelt.jsonl, als Menschenform
// ohne Gruppe: B unter A, Basstausch in Takt 16, A raus ab Takt 17 über 16 Takte. B's Bass schließt ein Setzen einen Beat
// vor dem Öffnen (FORMAT.md Punkt 22n, 09 NP NK3).
export const K1_PLAN: MenschenPlan = {
  hoerschein: 'h2', grund: 'B unter A, Bass tauschen',
  teile: [
    { regler: 'deck/2/eq/tief', art: 'setze', ab_takt: 8, ab_schlag: 4, nach: -30 },
    { regler: 'deck/2/fader', art: 'setze', ab_takt: 9, nach: -15 },
    { regler: 'deck/2/fader', art: 'rampe', ab_takt: 9, dauer_takte: 8, nach: 0 },
    { regler: 'deck/2/eq/tief', art: 'rampe', ab_takt: 16, dauer_takte: 1, nach: 0 },
    { regler: 'deck/1/eq/tief', art: 'rampe', ab_takt: 16, dauer_takte: 1, nach: -30 },
    { regler: 'deck/1/fader', art: 'rampe', ab_takt: 17, dauer_takte: 16, nach: -200 },
  ],
};

// Das Beispiel §14.1 steht als einziger json-Block zwischen "### 14.1" und "### 14.2" im Vertragstext
export function beispiel141(): Plan {
  const text = fs.readFileSync(path.join(VERTRAG_ORDNER, '..', '..', 'docs', 'architektur', 'SCHNITTSTELLEN.md'), 'utf8');
  const abschnitt = text.slice(text.indexOf('### 14.1'), text.indexOf('### 14.2'));
  const json = /```json\n([\s\S]*?)```/.exec(abschnitt);
  assert.ok(json, 'kein json-Block in §14.1');
  return JSON.parse(json[1]) as Plan;
}
