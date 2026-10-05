// Stand der Muster-Ablage, ohne Strudel (Plan 2026-09-27-djk-strudel-feld, Spec E5/E6; Plan-Review M3: der Seiten-Server
// liest den Stand und setzt die Hand, lädt Strudel aber nicht). Ein Text, zwei Schreiber: strom1.js ist die Wahrheit (der
// Erzeuger beobachtet sie), strom1.von.json sagt, wer zuletzt schrieb, status.json schreibt der Erzeuger (ab welchem Beat
// es gilt), autonom.json ist der AUTO-Schalter (an: Cypher darf spielen; aus: Andreas hat übernommen). Geschrieben mit Prüfung wird nur über muster_ablage.mjs bzw. djk-muster.
import fs from 'node:fs';
import path from 'node:path';

export function atomar(ziel, inhalt) {
  const tmp = `${ziel}.${process.pid}.neu`;
  fs.writeFileSync(tmp, inhalt);
  fs.renameSync(tmp, ziel);
}
const lies = (datei) => { try { return fs.readFileSync(datei, 'utf8'); } catch { return null; } };
const liesJson = (datei) => { const t = lies(datei); try { return t === null ? null : JSON.parse(t); } catch { return null; } };

export function leseMusterStand(ordner) {
  const text = lies(path.join(ordner, 'strom1.js'));
  const von = liesJson(path.join(ordner, 'strom1.von.json'));
  return { text: text === null ? '' : text.replace(/\n$/, ''), von: von?.von ?? null, zeit: von?.zeit ?? null,
    status: liesJson(path.join(ordner, 'status.json')), autonom: autonomAn(ordner) };
}

export function schreibeStatus(ordner, stand, zeit = Date.now()) {
  atomar(path.join(ordner, 'status.json'), JSON.stringify({ ...stand, zeit }));
}

// AUTO-Schalter (Andreas 2026-09-28: „ein button der cypher autonom spielen lässt. wenn man ihn ausschaltet wird die
// letzte loop des setups weitergespielt einfach. dann muss ich dann rein“). Ohne Datei an: djk-muster funktioniert wie
// vorher. Aus: djk-muster weist ab, das laufende Muster spielt weiter, bis Andreas eins schickt.
export function setzeAutonom(ordner, an, zeit = Date.now()) {
  fs.mkdirSync(ordner, { recursive: true });
  atomar(path.join(ordner, 'autonom.json'), JSON.stringify({ an: !!an, zeit }));
}

export function autonomAn(ordner) {
  return liesJson(path.join(ordner, 'autonom.json'))?.an !== false;
}
