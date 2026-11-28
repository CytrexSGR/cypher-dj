// The facade the areas get from the page server (BereichKontext): send, acknowledgements, source, log, host and baukasten hooks (method of Oberflaeche).
// Moved unchanged out of server.ts (pure move): plain functions bound to the Oberflaeche instance with `this`; the class keeps one-line delegations.
import http from 'node:http';
import path from 'node:path';
import { type Bereich, type BereichKontext } from '../../http/router.ts';
import type { Felder } from '../../../conductor/src/addresses.ts';
import { abBeat } from '../../deck_operation.ts';
import { wirtRuf } from '../../track.ts';
import { leseMusterStand } from '../../../generator/src/pattern_state.mjs';
import { stromVonKanal } from '../../../contract/streams.ts';
import { graphHash, INSTRUMENT_KANAELE } from '../../graphs.ts';
import type { Oberflaeche } from '../../server.ts';

// Spec D1 2.10: dünne Fassade für Bereiche; sende nutzt denselben id-Zähler und zählt gesendet wie die Bestandsrouten
export function bereichKontext(this: Oberflaeche): BereichKontext {
  return {
    // id kommt nur aus dem gemeinsamen Zähler (eine id in felder wirft); quelle ist die der Anfrage, wenn felder keine tragen
    sende: (adresse, felder) => {
      if ('id' in felder) throw new Error('sende: id vergibt der Server, felder darf keine tragen');
      const id = Number(++this.id);
      this.kern.sende(adresse, { id, quelle: this.quelle(), ...felder } as Felder); this.gesendet++; return id;
    },
    warteQuittung: (id, abBeat, bisEnde, maxMs, ersteGenuegt) => this.warteQuittung(id, abBeat, bisEnde, maxMs, ersteGenuegt),
    quelle: () => (this.quelle() === 'cypher' ? 'cypher' : 'andreas'),
    kiGestoppt: () => this.kiGestoppt,
    verteile: (ereignis) => this.verteile(ereignis),
    log: (zeile) => { this.opt.log?.(zeile); },
    host: {   // host learn: the wirt sockets of the instrument hosts and the control rows
      art: (gruppe) => { const a = (this.leseWirtMeldungen()[gruppe] as { art?: unknown } | null)?.art; return typeof a === 'string' ? a : null; },
      ruf: (gruppe, befehl) => wirtRuf(this.wirtSock(gruppe), befehl),
      setzeRegler: async (pfad, nach) => {   // the path of POST /regler, in the running request (source andreas)
        let code = 0;
        const stub = { writeHead: (c: number) => { code = c; }, end: () => undefined } as unknown as http.ServerResponse;
        await this.regler({ pfad, nach, ab: 'jetzt' }, stub);
        return code === 200;
      },
    },
    projekt: () => this.proj.zugang.offen()?.projekt ?? null,
    baukasten: {   // S17: the proj Bereich restores and captures graphs through the same checks as POST /graph
      geladen: () => ({ ...this.stand.graphen_geladen }),
      setzeGraph: (kanal, name, quelle, opt) => this.graphSetzen({ kanal, name, ...(opt?.vorgaben === false ? { vorgaben: false } : {}) }, quelle),
      autoAus: (kanal) => { const st = stromVonKanal(kanal); return INSTRUMENT_KANAELE.includes(kanal) && typeof st === 'number' && !leseMusterStand(this.musterOrdner(st)).autonom; },   // S17+S18: stream from the shared table (pad/N is stream 8+N)
      graphHash: (name) => graphHash(name),
      kernDa: () => this.kern.zustand === 'verbunden',   // S17: without a kern the restore sends nothing and answers kein_kern at once
    },
  };
}
