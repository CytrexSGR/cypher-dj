// Suchtext des Browsers → FTS5-Ausdruck + Ordner-Filter (Plan 2026-10-10-mediathek-browser, Task 4.1).
// Wörter: Präfix-Suche über alle Spalten. feld:wert sucht in einer Spalte. ordner:/folder: filtert per LIKE auf den Pfad
// (gemessen: FTS über die Pfad-Spalte 363 ms, LIKE 0,7 ms). Jeder Wert wird als FTS-Zeichenkette gequotet: nie Syntax aus
// der Eingabe. `suchTerme` ist die Zerlegung allein; STRUDEL (Muster-Bibliothek im Speicher, kein FTS) nutzt sie für den
// einfachen Textvergleich (S4).
const SPALTE: Record<string, string> = { artist: 'kuenstler', kuenstler: 'kuenstler', title: 'titel', titel: 'titel', mix: 'mix',
  label: 'label', genre: 'genre', pack: 'pack', instrument: 'instrument', year: 'jahr', jahr: 'jahr', name: 'name',
  release: 'release', catalog: 'katalognummer', katalognummer: 'katalognummer', isrc: 'isrc', remixer: 'remixer' };
// Wörter ohne Präfix treffen alle Spalten, darunter `alle` = jede gültige Angabe jeder Quelle (Spec §6, Review M7)
const ORDNER = new Set(['ordner', 'folder']);
const TOKEN = /([A-Za-zäöüÄÖÜ]+):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g;
const term = (w: string): string => `"${w.replace(/"/g, '""')}"*`;
const hatInhalt = (w: string): boolean => /[\p{L}\p{N}]/u.test(w);

export interface Suche { fts: string | null; ordner: string[]; zuviele: boolean }
// Deckel (S4-Review 3): jeder Term ist ein weiterer AND-Zweig der FTS, gemessen 12 Wörter 4 ms, 50 × „a“ 1,2 s, 200 → 4,9 s auf dem einen Event-Loop
export const MAX_TERME = 12;
export interface Terme { terme: { spalte: string | null; wert: string }[]; ordner: string[]; zuviele: boolean }

// Zerlegung: spalte = FTS-Spaltenname (null = alle Spalten). Unbekanntes Präfix bleibt ein Wort samt Doppelpunkt.
// `zusatz`: weitere Feldnamen, die nur der Aufrufer kennt (STRUDEL: rolle); sie bleiben unter ihrem Namen.
export function suchTerme(text: string, zusatz: readonly string[] = []): Terme {
  const terme: Terme['terme'] = [], ordner: string[] = [], gesehen = new Set<string>();
  // Steuerzeichen (NUL, C0, DEL, C1) sind Trenner wie Leerraum: ein NUL im FTS-String ließ SQLite mit „unterminated string“ (500) antworten (S4-Review 1)
  const ein = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ' ');
  const neu = (t: { spalte: string | null; wert: string }): void => {   // gleiche Terme zählen einmal (S4-Review 3)
    const k = `${t.spalte ?? ''}\u0001${t.wert.toLowerCase()}`;
    if (!gesehen.has(k)) { gesehen.add(k); terme.push(t); }
  };
  for (const m of ein.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      const feld = m[1].toLowerCase(), wert = (m[2] ?? m[3] ?? '').trim();
      if (ORDNER.has(feld)) { if (wert && !ordner.includes(wert)) ordner.push(wert); continue; }
      const sp = Object.hasOwn(SPALTE, feld) ? SPALTE[feld] : zusatz.includes(feld) ? feld : undefined;
      if (sp) { if (hatInhalt(wert)) neu({ spalte: sp, wert }); continue; }
      if (hatInhalt(m[0])) neu({ spalte: null, wert: m[0] });   // unbekanntes Präfix: das ganze Token als Wort
      continue;
    }
    const wort = (m[4] ?? m[5] ?? '').trim();
    if (hatInhalt(wort)) neu({ spalte: null, wert: wort });
  }
  return { terme, ordner, zuviele: terme.length + ordner.length > MAX_TERME };
}

export function parseSuche(text: string): Suche {
  const { terme, ordner, zuviele } = suchTerme(text);
  const teile = terme.map((t) => (t.spalte ? `${t.spalte} : ${term(t.wert)}` : term(t.wert)));
  return { fts: teile.length ? teile.join(' AND ') : null, ordner, zuviele };
}
