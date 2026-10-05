// Kern-Anbindung (SCHNITTSTELLEN §4.1, §16.3): Abo per /k/hallo, Herzschlag, Kern-weg-Wächter.
// Regel §4.1: 100 ms ohne /uhr → /k/hallo sofort, dann alle 50 ms bis /k/willkommen.
// Herzschlag 1 500 ms (Festlegung dieser Scheibe; Vertrag: spätestens alle 2 s, Kern streicht nach 5 s).
import dgram from 'node:dgram';
import { baue, liesUndDekodiere, type Dekodiert, type Felder } from './adressen.ts';
import { jetztNs, type Uhrstand } from './zeit.ts';

export type KernZustand = 'suche' | 'verbunden';

export interface WaechterEinstellung { wegNs: number; suchNs: number; herzNs: number }
export const WAECHTER: WaechterEinstellung = { wegNs: 100e6, suchNs: 50e6, herzNs: 1500e6 };

export interface Schritt { hallo: boolean; weg: boolean }

// Reine Zustandsmaschine, mit erfundenen Zeiten testbar (tests/kern.test.ts).
export class HalloWaechter {
  zustand: KernZustand = 'suche';
  private letzteUhr = -Infinity;
  private letzterHallo = -Infinity;
  private readonly e: WaechterEinstellung;

  constructor(e: WaechterEinstellung = WAECHTER) { this.e = e; }

  uhr(jetzt: number): void { this.letzteUhr = jetzt; }

  // true, wenn der Kern damit wieder da ist (Wechsel suche → verbunden)
  willkommen(jetzt: number): boolean {
    const war = this.zustand;
    this.zustand = 'verbunden';
    this.letzteUhr = Math.max(this.letzteUhr, jetzt);
    return war === 'suche';
  }

  schritt(jetzt: number): Schritt {
    let weg = false;
    let hallo = false;
    if (this.zustand === 'verbunden' && jetzt - this.letzteUhr >= this.e.wegNs) {
      this.zustand = 'suche';
      weg = true;
      hallo = true;
    } else if (this.zustand === 'suche' && jetzt - this.letzterHallo >= this.e.suchNs) {
      hallo = true;
    } else if (this.zustand === 'verbunden' && jetzt - this.letzterHallo >= this.e.herzNs) {
      hallo = true;
    }
    if (hallo) {
      // Raster halten: der nächste hallo zählt vom geplanten, nicht vom tatsächlichen Zeitpunkt (Tick 5 ms)
      const takt = this.zustand === 'suche' ? this.e.suchNs : this.e.herzNs;
      const frisch = weg || !Number.isFinite(this.letzterHallo) || jetzt - this.letzterHallo >= 2 * takt;
      this.letzterHallo = frisch ? jetzt : this.letzterHallo + takt;
    }
    return { hallo, weg };
  }
}

export interface KernEreignisse {
  nachricht(d: Dekodiert, empfangenNs: number): void;
  gesendet(adresse: string, felder: Felder, jetzt: number): void;
  zustand(neu: KernZustand, jetzt: number): void;
  unlesbar(grund: string, laenge: number, jetzt: number): void;
}

export interface KernOptionen {
  kernPort: number;
  aboPort: number;
  name: string;         // Abonnenten-Name beim Kern, z. B. "leitstand"
  tickMs?: number;      // Takt des Wächters, Vorgabe 5 ms
  frischAnmelden?: boolean; // Scheibe 21: /k/tschuess vor dem ersten /k/hallo (Neuanmeldung, damit /q/stand kommen kann)
  waechter?: WaechterEinstellung;
}

export class KernAnbindung {
  uhr: Uhrstand | null = null;
  generation: number | null = null;
  readonly waechter: HalloWaechter;
  private readonly sock = dgram.createSocket('udp4');
  private tick: NodeJS.Timeout | null = null;
  private ersterHallo = true;
  private readonly opt: KernOptionen;
  private readonly ev: KernEreignisse;

  constructor(opt: KernOptionen, ev: KernEreignisse) {
    this.opt = opt;
    this.ev = ev;
    this.waechter = new HalloWaechter(opt.waechter ?? WAECHTER);
  }

  get zustand(): KernZustand { return this.waechter.zustand; }

  starte(): Promise<void> {
    this.sock.on('message', (buf) => this.empfange(buf));
    return new Promise((ok, fehler) => {
      this.sock.once('error', fehler);
      this.sock.bind(this.opt.aboPort, '127.0.0.1', () => {
        this.sock.off('error', fehler);
        // ein UDP-Fehler nach dem Binden (etwa ENOBUFS) darf den Leitstand nicht beenden: Journal, weiter
        this.sock.on('error', (e) => this.ev.unlesbar(`UDP-Fehler: ${e.message}`, 0, jetztNs()));
        this.tick = setInterval(() => this.takt(), this.opt.tickMs ?? 5);
        this.takt();
        ok();
      });
    });
  }

  // öffentlich seit Scheibe 21: Befehle der Annahme (§4) gehen über denselben Socket
  sende(adresse: string, felder: Felder): void {
    this.sock.send(baue(adresse, felder), this.opt.kernPort, '127.0.0.1');
    this.ev.gesendet(adresse, felder, jetztNs());
  }

  private takt(): void {
    const jetzt = jetztNs();
    const s = this.waechter.schritt(jetzt);
    if (s.weg) this.ev.zustand('suche', jetzt);
    if (s.hallo) {
      if (this.ersterHallo && this.opt.frischAnmelden) this.sende('/k/tschuess', { name: this.opt.name });
      this.ersterHallo = false;
      this.sende('/k/hallo', { name: this.opt.name, port: this.opt.aboPort, protokoll: 1 });
    }
  }

  private empfange(buf: Buffer): void {
    const jetzt = jetztNs();
    let d: Dekodiert;
    try {
      d = liesUndDekodiere(buf);
    } catch (e) {
      this.ev.unlesbar((e as Error).message, buf.length, jetzt);
      return;
    }
    if (d.adresse === '/uhr') {
      this.uhr = d.felder as unknown as Uhrstand;
      this.waechter.uhr(jetzt);
    } else if (d.adresse === '/k/willkommen') {
      this.generation = d.felder.generation as number;
      if (this.waechter.willkommen(jetzt)) this.ev.zustand('verbunden', jetzt);
    } else if (d.adresse === '/e/neustart') {
      this.generation = d.felder.generation as number;
    }
    this.ev.nachricht(d, jetzt);
  }

  stoppe(): Promise<void> {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    return new Promise((ok) => {
      this.sock.send(baue('/k/tschuess', { name: this.opt.name }), this.opt.kernPort, '127.0.0.1', () => {
        this.ev.gesendet('/k/tschuess', { name: this.opt.name }, jetztNs());
        this.sock.close(() => ok());
      });
    });
  }
}
