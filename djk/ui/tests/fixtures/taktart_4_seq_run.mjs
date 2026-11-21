// Plan studio-taktart T3, golden run: the SEQ pattern bar maths with NO project meter changed (a fresh project is 4/4).
// Used by the recorder (nimm_taktart_4_seq.mjs, run once on the unchanged code) and by taktart_4_seq.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { liveAufbau } from '../support/live_module.mjs';
import { alsAntwort } from '../../areas/proj/area.ts';
import { SeqBereich } from '../../areas/live/seq.ts';
import { neuesProjekt } from '../../project/model.ts';
import { fuehreListeAus } from '../../project/commands.ts';
import { seqFolgen, seqGruppe } from '../../project/seq.ts';
import { leseFolgeText, folgeBefehle, schreibeFolgeText, laengeText } from '../../project/seq_text.ts';

const INFO_BK = { art: 'bk', regler: [{ nr: 3, name: 'Cutoff', vorgabe: 0.5 }, { nr: 4, name: 'Resonance', vorgabe: 0.3 }], klaenge: [] };
const INFO_KIT = { art: 'kit', regler: [], klaenge: [{ ton: 36, name: 'kick' }, { ton: 38, name: 'snare' }, { ton: 42, name: 'hat' }] };
const info = (g) => (g?.name === 'bk' ? INFO_BK : g?.name === 'kit' ? INFO_KIT : { art: 'rb338', regler: [], klaenge: [] });
const TEXT = `folge bass  bk:bassmusik  2bar
noten bass       1/16  c1 ~ . c1 . . d#1 ~ . . c1 . g0 ~ ~ . | c1 ~ . c2 . . d#1 ~ . . f1 . g1 ~ . a#0
werte vel        1/16  120 . . 64 . . 100 . . . 70 . 115 . . . | 120 . . 90 . . 100 . . . 76 . 108 . . 64
kurve k4         sinus .08 .92 je 3/4bar   ; Resonance

folge drums  kit:909  1bar
noten kick 36   1/16  x...x...x.o.x...
noten hat  42   1/32  x...o...x...o...x...o...x.o.oxxX`;

// the pure part: new deck, pattern text plan, round trip, length text, editierbar of clips of 64, 48 and 32 beats
export function rein() {
  const lauf = (p, ...b) => fuehreListeAus(p, b).projekt;
  const p0 = lauf(Object.assign(neuesProjekt('x'), { live: true, plaetze: [{ typ: 'track' }, { typ: 'track' }, { typ: 'track' }, { typ: 'track' }] }), { befehl: 'seq_anlegen', platz: 2 });
  const gid = seqGruppe(p0, 2).id;
  const folgen = leseFolgeText(TEXT);
  const befehle = folgeBefehle(p0, gid, folgen, { stumm: false, geraetInfo: info });
  const p1 = lauf(p0, ...befehle);
  const texte = p1.spuren.map((s) => schreibeFolgeText(s, s.clips[0] ?? null, info(s.geraet)));
  const vorgabe = lauf(p0, { befehl: 'seq_folge_neu', gruppe_id: gid, name: 'Plain', geraet: { art: 'intern', name: 'kit', kit: '909' } });
  const laengen = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 32, 48, 64].map((b) => [b, laengeText(b)]);
  const editierbar = {};
  for (const L of [64, 48, 32, 50]) {
    const p = lauf(vorgabe, { befehl: 'clip_loeschen', clip_id: vorgabe.spuren[0].clips[0].id });
    const q = lauf(p, { befehl: 'clip_neu', spur_id: p.spuren[0].id, art: 'midi', start_beat: 0, laenge_beats: L, name: 'c' });
    editierbar[L] = seqFolgen(q, seqGruppe(q, 2)).map((f) => f.editierbar);
  }
  return { befehle, texte, laenge_plain: vorgabe.spuren[0].clips[0].laenge_beats, laengen, editierbar,
    fehlerText: leseFolgeText('folge x kit:909 65b'), fehlerText2: leseFolgeText('folge x kit:909 17bar') };
}

// the route guard: clip_neu over 64, 48, 32 and 50 beats on the deck
export async function wache(t) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'djk-taktart-seq-'));
  const bkO = path.join(tmp, 'bk'), kitO = path.join(tmp, 'kits');
  fs.mkdirSync(bkO); fs.mkdirSync(path.join(kitO, '909'), { recursive: true });
  fs.writeFileSync(path.join(bkO, 'bassmusik.json'), JSON.stringify({ knoten: [{ id: 1, art: 'regler', nr: 3, min: 0, max: 1 }] }));
  fs.writeFileSync(path.join(kitO, '909', 'kit.json'), JSON.stringify({ schema: 1, klaenge: [{ note: 36, name: 'kick', datei: 'k.wav' }] }));
  const vorher = { bk: process.env.CYPHERDJ_BK_ORDNER, kit: process.env.CYPHERDJ_KIT_ORDNER };
  process.env.CYPHERDJ_BK_ORDNER = bkO; process.env.CYPHERDJ_KIT_ORDNER = kitO;
  t.after(() => {
    for (const [k, v] of [['CYPHERDJ_BK_ORDNER', vorher.bk], ['CYPHERDJ_KIT_ORDNER', vorher.kit]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const z = await liveAufbau(t);
  const seq = new SeqBereich(z.ctx, z.zugang, { deckLaeuft: () => false, geraetInfo: info, kanalOffen: () => false });
  await seq.anlege({ platz: 2 }, 'andreas');
  const f = await seq.folge({ platz: 2, name: 'Drums', geraet: 'kit:909', loop_beats: 4 }, 'andreas');
  const spur = z.projekt().spuren.find((s) => s.name === 'Drums');
  const aus = { neuerClip: z.projekt().spuren.find((s) => s.name === 'Drums').clips[0].laenge_beats, folge: f.code, verdikte: {} };
  for (const L of [64, 48, 32, 50]) {
    const rev = z.projekt().rev;
    try {
      const a = await seq.befehle({ platz: 2, befehle: [{ befehl: 'clip_neu', spur_id: spur.id, art: 'midi', start_beat: 0, laenge_beats: L }] }, 'andreas');
      aus.verdikte[L] = { code: a.code };
    } catch (e) {
      const a = alsAntwort(e, z.ctx);
      aus.verdikte[L] = { code: a.code, fehler: a.j.fehler, text: a.j.text, detail: a.j.detail };
    }
    aus.verdikte[L].revGeaendert = z.projekt().rev !== rev;
  }
  return aus;
}

export async function lauf(t) { return JSON.parse(JSON.stringify({ rein: rein(), wache: await wache(t) })); }
