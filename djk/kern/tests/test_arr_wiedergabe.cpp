// D1 K1 Slice 3: Wiedergabe lesen und laden (Spec D1 2.1, 3.2; arr_wiedergabe.h). Felder, Sortierung, Noten-ID-Index,
// Gain aus dB; Audio geteilt über Schnappschüsse (sha256, Referenzzähler), gesperrt wird nur Neues; Gründe datei_fehlt,
// format, audio_fehlt, zu_gross, spur_bereich, ohne verlorene Referenzen; gemeinsames Konto mit dem Deck-Lader.
// Ohne mlock (sperren = false): der Test misst die Buchführung, nicht die Sperre.
// Mutationen: ARR_CACHE_OHNE_REF (Fall 2), ARR_OHNE_KONTO (Fall 4), ARR_GAIN_ALT (Fall 8: der alte Bereich −200..+24
// ohne Toleranz bei den Blenden), ARR_OHNE_ENDLICH (Fall 9: Audio ohne NaN/Inf-Prüfung), ARR_SCHNAPPSCHUSS_OFFEN (Fall 10: Schnappschuss
// weder gesperrt noch gebucht), ARR_AUDIO_KOPF_OFFEN (Fall 10: ArrAudio nicht gesperrt) machen den Test rot.
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <fstream>
#include <string>
#include <utility>
#include <vector>

#include "arr_datei.h"
#include "cypherdj/arr_wiedergabe.h"
#include "pruef.h"

using cdj::ArrArt;

static const int64_t F = 48000;   // Frames je Test-Audio: 1 s, 384 000 Bytes

int main() {
  arrdatei::Ordner o("test_arr_wiedergabe");
  const std::string a = o.audio('a', F), b = o.audio('b', F);
  {  // 1: Felder, Sortierung, Index
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    o.wiedergabe(17, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c2", 4.0, 1.0, a, F) + "," +
                         o.clip("c1", 0.0, 1.0, a, F, 100, -6.0) + "]},"
                     "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.5},\"noten\":["
                     "{\"id\":\"c3/n2\",\"beat\":1.0,\"laenge\":0.5,\"ton\":38,\"vel\":90},"
                     "{\"id\":\"c3/n1\",\"beat\":0.0,\"laenge\":0.5,\"ton\":36,\"vel\":100}]},"
                     "{\"nr\":5,\"art\":\"wirt\",\"slot\":2,\"noten\":[{\"id\":\"c4/n1\",\"beat\":2.0,\"laenge\":1.0,\"ton\":60,\"vel\":80}]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 17, cache);
    PRUEF(e.snap && e.grund.empty());
    if (e.snap) {
      const cdj::ArrSnapshot& s = *e.snap;
      PRUEF(s.nr == 17);
      PRUEF(s.spur[0].art == ArrArt::audio && s.spur[0].nr == 1 && s.spur[0].n_clips == 2);
      PRUEF(s.spur[0].clips[0].start_beat == 0.0 && s.spur[0].clips[1].start_beat == 4.0);   // nach start_beat sortiert
      PRUEF(s.spur[0].clips[0].id == cdj::arr_id("c1") && s.spur[0].clips[0].offset_frames == 100);
      PRUEF_NAH(s.spur[0].clips[0].gain, 0.50118723, 1e-6);
      PRUEF(s.spur[0].clips[0].audio == s.spur[0].clips[1].audio && s.spur[0].clips[0].audio->frames == F);
      PRUEF(s.spur[1].art == ArrArt::intern && std::string(s.spur[1].geraet) == "rb338" && s.spur[1].n_param == 1);
      PRUEF(std::string(s.spur[1].param[0].name) == "cutoff" && s.spur[1].param[0].wert == 0.5f);
      PRUEF(s.spur[1].n_noten == 2 && s.spur[1].noten[0].ton == 36 && s.spur[1].noten[1].ton == 38);   // nach beat
      PRUEF(s.spur[1].noten_id[0] < s.spur[1].noten_id[1]);
      for (int i = 0; i < 2; ++i) PRUEF(s.spur[1].noten[s.spur[1].noten_id_index[i]].id == s.spur[1].noten_id[i]);
      PRUEF(s.spur[4].art == ArrArt::wirt && s.spur[4].slot == 2 && s.spur[4].n_noten == 1);
      PRUEF(s.spur[2].art == ArrArt::leer && s.spur[7].art == ArrArt::leer);
      PRUEF(s.audios.size() == 1 && cache.eintraege() == 1);
      PRUEF(cache.gesperrt() == F * 8 && konto.gesperrt() == F * 8 + cdj::arr_audio_kopf() + s.gesperrt_bytes);   // Audio (Daten, Kopf) und Schnappschuss
      PRUEF(s.gesperrt_bytes >= 4096);
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 2: Teilen über Schnappschüsse: nur Neues wird gesperrt; das geteilte Audio lebt, bis der letzte es freigibt
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    o.wiedergabe(1, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, F) + "]}");
    o.wiedergabe(2, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, F) + "," +
                        o.clip("c2", 1.0, 1.0, b, F) + "]}");
    cdj::ArrLadeErgebnis e1 = cdj::lade_wiedergabe(o.pfad, 1, cache);
    cdj::ArrLadeErgebnis e2 = cdj::lade_wiedergabe(o.pfad, 2, cache);
    PRUEF(e1.snap && e2.snap);
    PRUEF(cache.eintraege() == 2 && konto.gesperrt() == 2 * (F * 8 + cdj::arr_audio_kopf()) + e1.snap->gesperrt_bytes + e2.snap->gesperrt_bytes);   // a nur einmal
    const int64_t s2 = e2.snap->gesperrt_bytes;
    cdj::gib_wiedergabe(e1.snap.release(), cache);
    const bool a_lebt = cache.eintraege() == 2;
    PRUEF(a_lebt && konto.gesperrt() == 2 * (F * 8 + cdj::arr_audio_kopf()) + s2);   // a lebt im zweiten weiter
    if (a_lebt) {
      cdj::gib_wiedergabe(e2.snap.release(), cache);
      PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    } else {   // Fehlerfall (ARR_CACHE_OHNE_REF): a ist schon frei, sein Kopf (eigene Seite) abgebildet aus; nicht anfassen
      (void)e2.snap.release();
    }
  }
  {  // 3: Gründe; nach jedem Fehler ist nichts gesperrt
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    auto grund = [&](int64_t nr) {
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
      return e.grund;
    };
    const std::string gut = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, F) + "]}";
    PRUEF(grund(99) == "datei_fehlt");
    o.roh(20, "{\"format\":\"cypherdj-arr/3\",\"nr\":20,\"spuren\":[]}");   // 1.10: /2 ist seit Task 5 gültig, unbekannt ist jetzt /3
    PRUEF(grund(20) == "format");
    o.roh(21, "{\"format\":\"cypherdj-arr/1\",\"nr\":7,\"spuren\":[]}");
    PRUEF(grund(21) == "format");   // nr der Datei weicht ab
    o.roh(34, "{\"format\":\"cypherdj-arr/1\",\"rev\":34,\"spuren\":[]}");
    PRUEF(grund(34) == "format");   // Fassung 2 (Schlüssel nr statt nr) gilt nicht mehr
    o.roh(22, "kein json");
    PRUEF(grund(22) == "format");
    o.wiedergabe(23, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 0.0, a, F) + "]}");
    PRUEF(grund(23) == "format");   // laenge_beats 0
    o.wiedergabe(24, "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[{\"id\":\"x/1\",\"beat\":0.0,\"laenge\":1.0,\"ton\":128,\"vel\":100}]}");
    PRUEF(grund(24) == "format");   // ton 128
    o.wiedergabe(25, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, F) + "," + o.clip("c1", 2.0, 1.0, a, F) + "]}");
    PRUEF(grund(25) == "format");   // Clip-ID doppelt
    o.wiedergabe(26, "{\"nr\":1,\"art\":\"audio\",\"clips\":[{\"id\":\"c1\",\"start_beat\":0.0,\"laenge_beats\":1.0,\"sha256\":\"" + a +
                         "\",\"datei\":\"/etc/passwd\",\"frames\":48000,\"offset_frames\":0,\"gain_db\":0.0,\"ein_beats\":0.0,\"aus_beats\":0.0}]}");
    PRUEF(grund(26) == "format");   // Datei außerhalb des Arbeitsordners
    o.wiedergabe(27, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, std::string(64, 'c'), F) + "]}");
    PRUEF(grund(27) == "audio_fehlt");
    o.wiedergabe(28, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, F + 1) + "]}");
    PRUEF(grund(28) == "format");   // Größe passt nicht zu frames
    o.wiedergabe(29, "{\"nr\":" + std::to_string(cdj::ARR_SPUREN + 1) + ",\"art\":\"audio\",\"clips\":[]}");   // n+1: abgelehnt (T02)
    PRUEF(grund(29) == "spur_bereich");
    {  // Fehlertexte nennen die Konstante, nicht eine feste Zahl (E3: Texte aus ARR_SPUREN)
      const std::string bis = "1 bis " + std::to_string(cdj::ARR_SPUREN);
      o.wiedergabe(35, "{\"nr\":" + std::to_string(cdj::ARR_SPUREN + 1) + ",\"art\":\"audio\",\"clips\":[]}");
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 35, cache);
      PRUEF(!e.snap && e.grund == "spur_bereich");
      PRUEF(e.meldung.find(bis) != std::string::npos);
      std::string viele;   // ARR_SPUREN + 1 Spuren, jede gültig nummeriert 1..N+1 (die Zahl der Spuren schlägt zuerst an)
      for (int i = 1; i <= cdj::ARR_SPUREN + 1; ++i)
        viele += (i > 1 ? "," : "") + std::string("{\"nr\":") + std::to_string(i) + ",\"art\":\"audio\",\"clips\":[]}";
      o.wiedergabe(36, viele);
      e = cdj::lade_wiedergabe(o.pfad, 36, cache);
      PRUEF(!e.snap && e.grund == "spur_bereich");
      // Meldung trägt den Dateipfad davor, darum find statt ==
      PRUEF(e.meldung.find("mehr als " + std::to_string(cdj::ARR_SPUREN) + " Spuren") != std::string::npos);
    }
    o.wiedergabe(30, gut + "," + gut);
    PRUEF(grund(30) == "spur_bereich");   // nr doppelt
    o.wiedergabe(31, "{\"nr\":3,\"art\":\"wirt\",\"slot\":3,\"noten\":[]}");
    PRUEF(grund(31) == "spur_bereich");
    o.wiedergabe(32, "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[{\"id\":\"x/1\",\"beat\":0.0,\"laenge\":1.0,\"ton\":36,\"vel\":1},"
                     "{\"id\":\"x/1\",\"beat\":1.0,\"laenge\":1.0,\"ton\":37,\"vel\":1}]}");
    PRUEF(grund(32) == "format");   // Noten-ID doppelt
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
    o.wiedergabe(33, gut);
    PRUEF(grund(33).empty());   // Negativ-Kontrolle: dieselbe Spur gültig
  }
  {  // 4: Budget: Teilbetrag arr_budget und das gemeinsame Konto
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache klein(&konto, F * 8 - 1, false);   // ein Byte zu wenig
    o.wiedergabe(40, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, F) + "]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 40, klein);
    PRUEF(!e.snap && e.grund == "zu_gross");
    cdj::SpeicherKonto voll(2 * F * 8);
    PRUEF(voll.belaste(F * 8 + 1));   // der Deck-Lader hält schon mehr als die Hälfte
    cdj::ArrAudioCache cache(&voll, 50LL << 20, false);
    cdj::ArrLadeErgebnis e2 = cdj::lade_wiedergabe(o.pfad, 40, cache);
    PRUEF(!e2.snap && e2.grund == "zu_gross");
    PRUEF(voll.gesperrt() == F * 8 + 1 && cache.eintraege() == 0);
    if (e2.snap) cdj::gib_wiedergabe(e2.snap.release(), cache);
  }
  {  // 5: Grenze 4096 Clips
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    std::string clips;
    for (int i = 0; i <= cdj::ARR_CLIPS_MAX; ++i) clips += (i ? "," : "") + o.clip(("c" + std::to_string(i)).c_str(), i, 1.0, a, F);
    o.wiedergabe(50, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + clips + "]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 50, cache);
    PRUEF(!e.snap && e.grund == "zu_gross");
  }
  {  // 6: Wiedergabe in der Form, die S2 schreibt (d1-projekt djk/oberflaeche/projekt/wiedergabe.ts, JSON.stringify):
     // Schlüssel "nr" (Spec 3.2, 6.1), ganze Zahlen ohne Dezimalpunkt, Feldreihenfolge des Übersetzers
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    o.roh(42, "{\"format\":\"cypherdj-arr/1\",\"nr\":42,\"spuren\":[{\"nr\":1,\"art\":\"audio\",\"clips\":[{\"id\":\"c1\","
              "\"start_beat\":0,\"laenge_beats\":1,\"sha256\":\"" + a + "\",\"datei\":\"" + o.pfad + "/audio/" + a + ".f32\","
              "\"frames\":48000,\"offset_frames\":0,\"gain_db\":0,\"ein_beats\":0,\"aus_beats\":0}]},"
              "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"parameter\":{\"cutoff\":0.5},\"noten\":[{\"id\":\"c2/n1\","
              "\"beat\":0,\"laenge\":0.5,\"ton\":36,\"vel\":100}]},{\"nr\":3,\"art\":\"wirt\",\"slot\":1,\"noten\":[]}]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 42, cache);
    PRUEF(e.snap && e.grund.empty());
    if (!e.grund.empty()) std::fprintf(stderr, "S2-Form: %s (%s)\n", e.grund.c_str(), e.meldung.c_str());
    if (e.snap) {
      PRUEF(e.snap->nr == 42);
      PRUEF(e.snap->spur[0].n_clips == 1 && e.snap->spur[1].n_noten == 1 && e.snap->spur[2].slot == 1);
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 7: Spec 6.14: Audio nur unterhalb von arr_ordner, beides normalisiert; Freeze-Dateien freeze-<spur>-<kennung>.f32
     // liegen im Arbeitsordner selbst und sind erlaubt
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    const std::string fz = o.pfad + "/freeze-3-7.f32";
    {
      std::vector<float> d(static_cast<size_t>(F) * 2, 0.5f);
      std::ofstream(fz, std::ios::binary).write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * 4));
    }
    auto mit_datei = [&](int64_t nr, const std::string& datei, const std::string& sha) {
      o.wiedergabe(nr, "{\"nr\":3,\"art\":\"audio\",\"clips\":[{\"id\":\"s3/freeze\",\"start_beat\":0.0,\"laenge_beats\":4.0,"
                       "\"sha256\":\"" + sha + "\",\"datei\":\"" + datei + "\",\"frames\":48000,\"offset_frames\":0,"
                       "\"gain_db\":0.0,\"ein_beats\":0.0,\"aus_beats\":0.0}]}");
    };
    auto grund = [&](const std::string& ordner, int64_t nr) {
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(ordner, nr, cache);
      if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
      return e.grund;
    };
    const std::string fsha(64, 'f');
    mit_datei(70, fz, fsha);
    PRUEF(grund(o.pfad, 70).empty());                       // Freeze-Datei im Arbeitsordner
    PRUEF(grund(o.pfad + "/", 70).empty());                 // arr_ordner mit abschließendem Schrägstrich
    PRUEF(grund(o.pfad + "/./", 70).empty());
    mit_datei(71, o.pfad + "/audio//" + a + ".f32", a);
    PRUEF(grund(o.pfad, 71).empty());                       // doppelter Schrägstrich in der Datei
    mit_datei(72, o.pfad + "/x/../audio/" + a + ".f32", a);
    PRUEF(grund(o.pfad, 72).empty());                       // .. bleibt unterhalb: erlaubt
    mit_datei(73, o.pfad + "/audio/../../" + a + ".f32", a);
    PRUEF(grund(o.pfad, 73) == "format");                   // .. führt hinaus
    mit_datei(74, o.pfad + "-anders/audio/" + a + ".f32", a);
    PRUEF(grund(o.pfad, 74) == "format");                   // nur gleicher Anfang, anderer Ordner
    mit_datei(75, "audio/" + a + ".f32", a);
    PRUEF(grund(o.pfad, 75) == "format");                   // relativ: nicht erlaubt
    mit_datei(76, o.pfad, a);
    PRUEF(grund(o.pfad, 76) == "format");                   // der Ordner selbst ist keine Datei darunter
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 8: Spec 6.27 (K1-Fix 3): ein Wertebereich mit S2. gain_db −96..+24, Blenden ≥ 0 und zusammen höchstens
     // laenge_beats (Toleranz 1e-9 wie S2s Prüfer, modell.ts: 0,1 + 0,2 auf 0,3 Beats ist gültig)
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    auto grund = [&](int64_t nr, double laenge, double gain_db, double ein, double aus) {
      char b[512];
      std::snprintf(b, sizeof b,
                    "{\"nr\":1,\"art\":\"audio\",\"clips\":[{\"id\":\"c1\",\"start_beat\":0,\"laenge_beats\":%.17g,"
                    "\"sha256\":\"%s\",\"datei\":\"%s/audio/%s.f32\",\"frames\":48000,\"offset_frames\":0,"
                    "\"gain_db\":%.17g,\"ein_beats\":%.17g,\"aus_beats\":%.17g}]}",
                    laenge, a.c_str(), o.pfad.c_str(), a.c_str(), gain_db, ein, aus);
      o.wiedergabe(nr, b);
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      float g = -1.0f;
      if (e.snap) {
        g = e.snap->spur[0].clips[0].gain;
        cdj::gib_wiedergabe(e.snap.release(), cache);
      }
      return std::make_pair(e.grund, g);
    };
    auto gr = [&](int64_t nr, double laenge, double gain_db, double ein, double aus) {
      const std::string g = grund(nr, laenge, gain_db, ein, aus).first;
      if (!g.empty()) std::printf("Fall 8 nr %lld: %s\n", static_cast<long long>(nr), g.c_str());
      return g;
    };
    const auto unten = grund(80, 1.0, -96.0, 0.0, 0.0);
    PRUEF(unten.first.empty());
    PRUEF_NAH(unten.second, 1.5848932e-5, 1e-10);                // −96 dB
    PRUEF(gr(81, 1.0, 24.0, 0.0, 0.0).empty());                   // +24 dB
    PRUEF(gr(82, 1.0, -96.000001, 0.0, 0.0) == "format");         // knapp unter −96
    PRUEF(gr(83, 1.0, -200.0, 0.0, 0.0) == "format");             // alter Kern-Bereich, gilt nicht mehr
    PRUEF(gr(84, 1.0, 24.000001, 0.0, 0.0) == "format");
    PRUEF(gr(85, 1.0, 48.0, 0.0, 0.0) == "format");               // S2 erlaubte bis +48
    PRUEF(gr(86, 0.3, 0.0, 0.1, 0.2).empty());                    // zusammen genau die Länge (0,1 + 0,2 > 0,3 in double)
    PRUEF(gr(87, 1.0, 0.0, 1.0, 0.0).empty());                    // eine Blende über den ganzen Clip
    PRUEF(gr(88, 0.3, 0.0, 0.1, 0.2000001) == "format");          // länger als der Clip
    PRUEF(gr(89, 1.0, 0.0, -0.000001, 0.0) == "format");          // negativ
    PRUEF(gr(90, 1.0, 0.0, 0.0, -0.000001) == "format");
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 9: K1-Fix 5: NaN oder Inf im Arrangement-Audio lehnt der Lader mit format ab (wie der Deck-Lader, §13.2), die
     // ganze Datei geprüft (nicht nur eine Stichprobe); danach ist nichts gesperrt und nichts im Cache.
     // Negativ-Kontrolle: große, endliche Werte (±3e38) laden.
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);
    auto mit_wert = [&](char z, int64_t frame, int kanal, float wert) {
      const std::string sha(64, z);
      std::vector<float> d(static_cast<size_t>(F) * 2, 0.25f);
      d[static_cast<size_t>(2 * frame + kanal)] = wert;
      std::ofstream(o.pfad + "/audio/" + sha + ".f32", std::ios::binary)
          .write(reinterpret_cast<const char*>(d.data()), static_cast<std::streamsize>(d.size() * sizeof(float)));
      return sha;
    };
    auto grund = [&](int64_t nr, const std::string& sha) {
      o.wiedergabe(nr, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, sha, F) + "]}");
      cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, nr, cache);
      if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
      else std::printf("Fall 9 nr %lld: %s (%s)\n", static_cast<long long>(nr), e.grund.c_str(), e.meldung.c_str());
      return e.grund;
    };
    PRUEF(grund(91, mit_wert('1', 0, 0, NAN)) == "format");               // Frame 0 links
    PRUEF(grund(92, mit_wert('2', 1, 1, NAN)) == "format");               // Frame 1 rechts (außerhalb jeder Stichprobe)
    PRUEF(grund(93, mit_wert('3', F / 2 + 7, 0, INFINITY)) == "format");  // mitten drin
    PRUEF(grund(94, mit_wert('4', F - 1, 1, -INFINITY)) == "format");     // letzter Frame
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0 && cache.gesperrt() == 0);
    PRUEF(grund(95, mit_wert('5', F / 3, 0, 3e38f)).empty());             // Negativ-Kontrolle: endlich
    PRUEF(grund(96, mit_wert('6', F - 1, 1, -3e38f)).empty());
    PRUEF(cache.eintraege() == 0 && konto.gesperrt() == 0);
  }
  {  // 10: K1-Fix 8: der Schnappschuss (Kopf und die Felder, die der Callback liest: clips, noten, noten_id,
     // noten_id_index) liegt gesperrt in eigenen Seiten und ist auf dem Konto gebucht; nach der Freigabe ist beides weg.
     // K1-Fix-2 Punkt 3: ebenso der Kopf des Audios (ArrAudio: daten, frames), den der Callback je Sample liest.
     // Der Kern sperrt beim Start nur MCL_CURRENT, später angelegter Speicher wäre sonst auslagerbar.
    auto vm_lck = [] {
      std::ifstream f("/proc/self/status");
      std::string z;
      while (std::getline(f, z))
        if (z.rfind("VmLck:", 0) == 0) return std::atol(z.c_str() + 6) * 1024L;
      return -1L;
    };
    auto vma_gesperrt = [](const void* p) {   // Locked der Abbildung, die p enthält, in Bytes (smaps)
      const auto a = reinterpret_cast<uintptr_t>(p);
      std::ifstream f("/proc/self/smaps");
      std::string z;
      bool drin = false;
      while (std::getline(f, z)) {
        unsigned long von = 0, bis = 0;
        if (std::sscanf(z.c_str(), "%lx-%lx ", &von, &bis) == 2 && z.find(':') > z.find(' ')) drin = a >= von && a < bis;
        else if (drin && z.rfind("Locked:", 0) == 0) return std::atol(z.c_str() + 7) * 1024L;
      }
      return -1L;
    };
    const long basis = vm_lck();
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, true);
    std::string noten;
    for (int i = 0; i < 100; ++i)
      noten += (i ? "," : "") + std::string("{\"id\":\"m/n") + std::to_string(i) + "\",\"beat\":" + std::to_string(i) +
               ",\"laenge\":0.5,\"ton\":60,\"vel\":100}";
    o.wiedergabe(100, "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + o.clip("c1", 0.0, 1.0, a, F) + "]},"
                      "{\"nr\":2,\"art\":\"intern\",\"geraet\":\"rb338\",\"noten\":[" + noten + "]}");
    cdj::ArrLadeErgebnis e = cdj::lade_wiedergabe(o.pfad, 100, cache);
    PRUEF(e.snap != nullptr);
    if (e.snap) {
      const cdj::ArrSnapshot& sn = *e.snap;
      // K1-Fix-2 Punkt 3: auch das ArrAudio (der Callback liest daten und frames je Sample über ArrClip::audio)
      const void* teile[] = {&sn, sn.clips.data(), sn.noten.data(), sn.noten_id.data(), sn.noten_id_index.data(),
                             sn.clips.empty() ? nullptr : sn.clips[0].audio};
      const char* namen[] = {"Kopf", "clips", "noten", "noten_id", "noten_id_index", "ArrAudio"};
      for (int i = 0; i < 6; ++i) {
        const long g = vma_gesperrt(teile[i]);
        if (g <= 0) std::printf("Fall 10: %s nicht gesperrt (Locked %ld)\n", namen[i], g);
        PRUEF(g > 0);
      }
      const long lck = vm_lck() - basis;
      std::printf("Fall 10: Konto %lld, davon Audio %lld, VmLck-Zuwachs %ld\n", static_cast<long long>(konto.gesperrt()),
                  static_cast<long long>(cache.gesperrt()), lck);
      PRUEF(konto.gesperrt() > cache.gesperrt());                              // der Schnappschuss ist gebucht
      PRUEF(std::labs(lck - static_cast<long>(konto.gesperrt())) < 4096);     // gebucht = gesperrt (bis auf den Rest
                                                                               // der letzten Audio-Seite)
    }
    cdj::gib_wiedergabe(e.snap.release(), cache);
    PRUEF(konto.gesperrt() == 0 && vm_lck() == basis);
  }
  {  // 1.10 Slice 1: Wiedergabe /2 mit Gruppen (AK7 Kern-Teil, AK1: /1 ohne Routing lädt wie bisher)
    cdj::SpeicherKonto konto(100LL << 20);
    cdj::ArrAudioCache cache(&konto, 50LL << 20, false);   // wie Fall 1 der Datei; F ist die Frame-Zahl des Test-Audios
    const std::string a = o.audio('e', F, 0.25f);   // sha ist Hex: 'g' wäre nicht 64 Hex-Zeichen (Plan-Tippfehler)
    const std::string clip = o.clip("c1", 0.0, 1.0, a, F);
    const std::string s1 = "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":2},\"clips\":[" + clip + "]}";
    const std::string s2 = "{\"nr\":2,\"art\":\"audio\",\"clips\":[" + clip + "]}";
    const std::string g = "{\"nr\":2,\"ausgang\":{\"art\":\"master\"}}";
    auto lade = [&](int64_t nr) { return cdj::lade_wiedergabe(o.pfad, nr, cache); };
    // gültig: Spur 1 in Gruppe 2, Spur 2 ohne ausgang = master
    o.wiedergabe2(40, s1 + "," + s2, g);
    cdj::ArrLadeErgebnis e = lade(40);
    PRUEF(e.snap != nullptr);
    if (e.snap) {
      PRUEF(e.snap->spur[0].ausgang == 2 && e.snap->spur[1].ausgang == 0);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    // /1 ohne Routing: wie bisher, ausgang 0
    o.wiedergabe(41, s2);
    e = lade(41);
    PRUEF(e.snap != nullptr && e.snap->spur[1].ausgang == 0);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    // abgelehnt mit Grund format: ausgang in /1; Spur zeigt auf Gruppe ohne Eintrag; Gruppe in sich selbst; Gruppe in anderer Gruppe;
    // Gruppen-Nummer 9; doppelte Gruppen-Nummer; ausgang.art unbekannt; ausgang.nr 0
    o.wiedergabe2(42, s1, g, "cypherdj-arr/1");
    PRUEF(lade(42).grund == "format");
    o.wiedergabe2(43, s1, "");                                                     // Gruppe 2 fehlt in der Liste
    PRUEF(lade(43).grund == "format");
    o.wiedergabe2(44, s2, "{\"nr\":1,\"ausgang\":{\"art\":\"gruppe\",\"nr\":1}}");   // Zyklus: Gruppe 1 in Gruppe 1
    PRUEF(lade(44).grund == "format");
    o.wiedergabe2(45, s2, "{\"nr\":1,\"ausgang\":{\"art\":\"gruppe\",\"nr\":2}}," + g);   // Gruppen verschachteln nicht
    PRUEF(lade(45).grund == "format");
    o.wiedergabe2(46, s2, "{\"nr\":9,\"ausgang\":{\"art\":\"master\"}}");
    PRUEF(lade(46).grund == "format");
    o.wiedergabe2(47, s2, g + "," + g);
    PRUEF(lade(47).grund == "format");
    o.wiedergabe2(48, "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"return\",\"nr\":1},\"clips\":[]}", g);
    PRUEF(lade(48).grund == "format");
    o.wiedergabe2(49, "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":0},\"clips\":[]}", g);
    PRUEF(lade(49).grund == "format");
    // Negativ-Kontrolle: ein azyklisches Projekt gleicher Größe (acht Gruppen, 32 Spuren auf sie verteilt) wird angenommen
    std::string viele, gr;
    for (int n = 1; n <= 8; ++n) gr += std::string(n > 1 ? "," : "") + "{\"nr\":" + std::to_string(n) + ",\"ausgang\":{\"art\":\"master\"}}";
    for (int n = 1; n <= 32; ++n)
      viele += std::string(n > 1 ? "," : "") + "{\"nr\":" + std::to_string(n) + ",\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":" +
               std::to_string((n - 1) % 8 + 1) + "},\"clips\":[]}";
    o.wiedergabe2(50, viele, gr);
    e = lade(50);
    PRUEF(e.snap != nullptr);
    if (e.snap) {
      PRUEF(e.snap->spur[0].ausgang == 1 && e.snap->spur[31].ausgang == 8);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    // Paket 1.13: Routing und Warp in derselben /2-Datei (ein Format für beide Nachbarn); der Warp ändert den Ausgang nicht
    const std::string cw = o.clip_warp("c1", 0.0, 1.0, a, F, {{0.0, 0.0}, {1.0, 24000.0}});
    const std::string sw = "{\"nr\":1,\"art\":\"audio\",\"ausgang\":{\"art\":\"gruppe\",\"nr\":2},\"clips\":[" + cw + "]}";
    o.wiedergabe2(51, sw + "," + s2, g);
    e = lade(51);
    PRUEF(e.snap != nullptr);
    if (e.snap) {
      PRUEF(e.snap->spur[0].ausgang == 2 && e.snap->spur[1].ausgang == 0);
      PRUEF(e.snap->spur[0].clips[0].warp != nullptr && e.snap->spur[0].clips[0].warp->n == 2);
      PRUEF(e.snap->spur[1].clips[0].warp == nullptr);
      cdj::gib_wiedergabe(e.snap.release(), cache);
    }
    // Nr. 52 (Nachbesserung 4, N4-2): NUR der Warp, ohne Gruppen-Liste und ohne ausgang, als /1. Mit Gruppe bräche der Lader schon an
    // "gruppen gibt es erst in cypherdj-arr/2" ab, bevor er das Clip-Feld liest; so trägt allein der Warp den Grund format.
    // Nr. 53 ist die Positivkontrolle: dieselbe Spur als /2 lädt.
    const std::string sn = "{\"nr\":1,\"art\":\"audio\",\"clips\":[" + cw + "]}";
    o.wiedergabe(52, sn);
    e = lade(52);
    PRUEF(e.snap == nullptr && e.grund == "format");
    PRUEF(e.meldung.find("warp gibt es erst in cypherdj-arr/2") != std::string::npos);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
    o.wiedergabe2(53, sn, "");
    e = lade(53);
    PRUEF(e.snap != nullptr && e.snap->spur[0].clips[0].warp != nullptr);
    if (e.snap) cdj::gib_wiedergabe(e.snap.release(), cache);
  }
  PRUEF_ENDE();
}
