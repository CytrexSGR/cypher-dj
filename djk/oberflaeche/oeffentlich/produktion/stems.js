// Paket 1.13 Slice 6 (D13): Stems an der Seite, nur reine Funktionen (kein Import: Texte und Messer kommen als Parameter).
// Bereich ganzer Clip oder die Loop-Klammer, wenn sie gesetzt ist und ganz im Clip liegt; Menüpunkte; Fortschrittsbalken am unteren Rand
// des Clips, solange der Lauf dieses Clips läuft. Ein Stand gehört zu einem Projekt (stems.slug): nur der des offenen Projekts zählt (P6).
const EPS = 1e-9;
export function stemsBereich(projekt, clip) {
  const l = projekt?.loop, a = clip.start_beat, b = clip.start_beat + clip.laenge_beats;
  if (l?.an === true && l.von_beat >= a - EPS && l.bis_beat <= b + EPS && l.bis_beat > l.von_beat) return { von_beat: l.von_beat, bis_beat: l.bis_beat };
  return { von_beat: a, bis_beat: b };
}
// Nachzug F6: in der Stufe schreiben meldet der Server keinen Prozentwert (die Trennung ist fertig): voll statt 0
const prozentVon = (stand) => (stand.prozent == null && stand.stufe === 'schreiben' ? 100 : stand.prozent);
export function stemsPunkte(projekt, clip, stand) {
  if (clip.art !== 'audio') return [];
  const laeuft = stand?.zustand === 'laeuft';
  if (laeuft && stand.clip_id === clip.id) {
    const p = prozentVon(stand);
    return [{ id: 'stems_abbrechen', text: `Cancel Stems${p == null ? '' : ` (${Math.round(p)} %)`}`, auftrag_id: stand.auftrag_id }];
  }
  const aus = laeuft || clip.loop_beats != null || clip.dekodiert !== 'fertig';
  const b = stemsBereich(projekt, clip), z = (x) => String(Math.round(x * 100) / 100);
  return [{ id: 'stems', text: `Separate Stems (beats ${z(b.von_beat)}–${z(b.bis_beat)})`, aus, koerper: { clip_id: clip.id, ...b } }];
}
export function stemsBalken(kasten, stand, clipId) {
  if (stand?.zustand !== 'laeuft' || stand.clip_id !== clipId) return null;
  const h = 4;
  return { x: kasten.x, y: kasten.y + kasten.h - h, w: Math.round(kasten.w * Math.max(0, Math.min(100, prozentVon(stand) ?? 0)) / 100), h };
}
// Alle Balken des Bildes: nur der Clip des Laufs wird gemessen. kasten(spurIndex, clip) → {x,y,w,h} (layout.js clipKasten, vom Zeichner gereicht)
export function stemsBalkenListe(projekt, stand, kasten) {
  const aus = [];
  if (stand?.zustand !== 'laeuft' || !projekt) return aus;
  projekt.spuren.forEach((spur, i) => {
    for (const c of spur.clips) {
      if (c.id !== stand.clip_id) continue;
      const b = stemsBalken(kasten(i, c), stand, c.id);
      if (b) aus.push(b);
    }
  });
  return aus;
}
// Stumme Clips liegen abgedunkelt (D12/D13)
export const stummDecke = (k, c) => (c?.stumm ? { x: k.x, y: k.y, w: k.w, h: k.h, farbe: 'rgba(11,13,17,0.62)' } : null);
// Der Stand gilt nur im Projekt, in dem er lief (Clip-ids sind je Projekt durchnummeriert: c1 gibt es überall)
export const stemsFuerProjekt = (stand, slug) => (stand && slug != null && stand.slug === slug ? stand : null);
// Endmeldung eines Stems-Laufs (laeuft = Tick, keine Meldung). texte = FEHLER_TEXT der Seite; unbekannter Grund → Text des Servers.
// Der gewollte Abbruch ist neutral, jeder andere Abbruch und Fehler im Fehler-Stil.
export function stemsEndeMeldung(s, texte = {}) {
  if (!s || s.zustand === 'laeuft') return null;
  if (s.zustand === 'fertig') {
    return { text: `Stems ready: four tracks under the clip${s.hinweis === 'stems_ohne_gruppe' ? ' (no free group)' : ''}`, fehler: false };
  }
  if (s.zustand === 'abgebrochen' && s.grund === 'abbruch') return { text: 'Stems cancelled', fehler: false };
  return { text: texte[s.grund] ?? s.text ?? `Rejected: ${s.grund ?? s.zustand}`, fehler: true };
}
// Soll die Seite den Projektstand neu laden? Stems-Meldungen tragen {stems:{slug,…}} und kein f.slug: vorher lief die allgemeine Regel bei JEDEM
// Fortschritts-Tick auf „anderes Projekt“. Jetzt entscheidet für Stems nur das Ende im offenen Projekt: fertig hat es geändert, alles andere nicht.
export function nachladenNoetig(a, f, { sichtbar, slug, rev, eigene }) {
  if (a !== 'proj' || !sichtbar) return false;
  if (f?.stems) return f.stems.slug === slug && f.stems.zustand === 'fertig';
  return !eigene(f?.slug, f?.rev) && !!(f?.clip_id || f?.slug !== slug || f?.rev > (rev ?? -1));
}
// Eine SSE-Meldung {stems}: was die Seite tut. behandelt=false → keine Stems-Meldung, der allgemeine Weg gilt. Fremdes Projekt → nichts.
export function stemsEreignis(f, { slug, sichtbar }, texte) {
  if (!f?.stems) return { behandelt: false };
  const s = stemsFuerProjekt(f.stems, slug);
  if (!s) return { behandelt: true, uebernimm: false, stand: null, meldung: null, nachladen: false };
  const meldung = stemsEndeMeldung(s, texte);
  return { behandelt: true, uebernimm: true, stand: s, meldung, nachladen: !!sichtbar && nachladenNoetig('proj', f, { sichtbar, slug }) };
}
// Menüpunkt gewählt: Start oder Abbruch an den Server; ohne Erfolg der Text des Grunds (fehlerText), nie „Rejected: …“
export async function stemsAktion(p, { holeJson, melde, fehlerText }) {
  const r = p.id === 'stems' ? await holeJson('/proj/stems', p.koerper) : await holeJson('/proj/stems/abbrechen', { auftrag_id: p.auftrag_id });
  if (r.status !== 200) melde(fehlerText(r), true);
}
