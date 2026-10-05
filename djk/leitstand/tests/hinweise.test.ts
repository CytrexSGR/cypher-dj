// Jede Verriegelungs-Ansage an den Spieler sagt, was zu ändern ist (M15, Stand 03, 2026-09-26: ohne Hinweis wiederholte
// das Modell bei hoerschein_nicht_sync dieselbe Wahl, mit Material und Ausweg 0 Fehlreparaturen).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { ansageVerriegelt, HINWEISE } from '../src/hinweise.ts';
import type { Hoerschein } from '../src/hoerscheine.ts';
import { ausMenschenform } from '../src/plan.ts';
import { B2, H2 } from './hilfen/faelle.ts';
import { annahme, welt } from './hilfen/welt.ts';

const OEFFNE_B = { hoerschein: 'h2', grund: 'B rein', teile: [{ regler: 'deck/2/fader', art: 'setze' as const, ab_takt: 9, nach: 0 }] };

test('H01 hoerschein_nicht_sync: die Ansage nennt Hörschein, Material und dass ein anderes Material zu wählen ist', () => {
  const w = welt(); const a = annahme(w, 1);
  a.hoerschein({ ...H2, urteil: 'nicht_sync', sync_ms: 14 } as Hoerschein);
  const e = a.einreichen(OEFFNE_B);
  assert.equal(e.status, 'verriegelt');
  assert.deepEqual(e.gruende.map((g) => g.grund), ['hoerschein_nicht_sync']);
  assert.match(e.ansage, /hoerschein_nicht_sync/);
  assert.ok(e.ansage.includes('h2') && e.ansage.includes(B2), e.ansage);
  assert.match(e.ansage, /gesperrt, wähle ein anderes Material/);
});

test('H01 zu_spaet: die Ansage nennt den frühesten Takt und dass der Start dorthin zu legen ist', () => {
  const w = welt(); const a = annahme(w, 1);
  w.beat.jetzt = 70.5;
  const e = a.einreichen({ grund: 'EQ', teile: [{ regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 17, nach: -6 }] });
  assert.equal(e.status, 'verriegelt');
  assert.match(e.ansage, /Teil 0 zu_spaet: frühestens Takt 18 Schlag 4; setze den Start auf Takt 18 oder später/);
});

test('H01 autonomie auf Stufe 0: die Ansage sagt, dass nur Zuhören geht', () => {
  const w = welt(); const a = annahme(w, 0);
  const e = a.einreichen({ grund: 'x', teile: [{ regler: 'deck/3/fader', art: 'setze', ab_takt: 9, nach: -20 }] });
  assert.equal(e.status, 'abgelehnt');
  assert.match(e.ansage, /autonomie: Stufe 0 erlaubt plan_einreichen nicht, nur zuhören/);
});

test('H02 Negativ-Kontrolle: ein angenommener Plan und ein Vorschlag tragen keine Verriegelungs-Ansage', () => {
  const w = welt(); const a = annahme(w, 1);
  const e = a.einreichen(OEFFNE_B);
  assert.equal(e.status, 'vorgeschlagen');
  assert.doesNotMatch(e.ansage, /verriegelt|wähle/);
});

test('H01 jeder Code, den Vorprüfung und Annahme melden, hat einen Hinweis mit Ausweg (nach dem Semikolon)', () => {
  // die Codes stehen in verriegelung.ts als Rückgabe; dazu autonomie und ki_gestoppt aus annahme.ts
  const quelle = fs.readFileSync(new URL('../src/verriegelung.ts', import.meta.url), 'utf8');
  const codes = new Set([...quelle.matchAll(/(?:return|grund:) '([a-z_]+)'/g)].map((m) => m[1]));
  for (const c of ['autonomie', 'ki_gestoppt']) codes.add(c);
  assert.ok(codes.size >= 20, `nur ${codes.size} Codes gefunden: das Muster ist blind`); // Positiv-Gegenprobe
  const plan = ausMenschenform({ grund: 'x', teile: [{ regler: 'deck/2/fader', art: 'setze', ab_takt: 9, nach: 0 }] }, 'p1', 'cypher');
  plan.teile[0].art === 'regler' && (plan.teile[0].hoerschein = 'h2');
  for (const c of codes) {
    assert.ok(HINWEISE[c], `kein Hinweis für ${c}`);
    const t = ansageVerriegelt('verriegelt', [{ teil: 0, grund: c, fruehestens_beat: 70 }],
      { plan, hoerschein: () => H2, stufe: 1, methode: 'plan_einreichen' });
    assert.match(t, new RegExp(`Teil 0 ${c}: [^;]+; \\S`), `${c}: ${t}`);
  }
});

test('H02 gleiche Codes an mehreren Teilen: ein Satz mit allen Teilnummern', () => {
  const plan = ausMenschenform({ grund: 'x', teile: [
    { regler: 'deck/1/eq/hoch', art: 'setze', ab_takt: 2, nach: -6 }, { regler: 'deck/1/eq/mitte', art: 'setze', ab_takt: 2, nach: -6 }] }, 'p7', 'cypher');
  const t = ansageVerriegelt('verriegelt', [{ teil: 0, grund: 'zu_spaet', fruehestens_beat: 30 }, { teil: 1, grund: 'zu_spaet', fruehestens_beat: 30 }],
    { plan, hoerschein: () => undefined, stufe: 1, methode: 'plan_einreichen' });
  assert.match(t, /^Plan p7 verriegelt\. Teile 0, 1 zu_spaet: frühestens Takt 8 Schlag 3/);
});
