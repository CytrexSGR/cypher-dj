// strand 1 task 2.1: ArrMaske<N>, the multi-word strip and slot masks of the insert pool (arr_maske.h).
// The set-bit walk must visit the set bits in ascending order and over a copy of each word: the insert slot loops of the
// callback depend on both (the order keeps the mix bit-identical, the copy lets a callback clear its own bit).
#include <vector>

#include "cypherdj/arr_maske.h"
#include "check.h"

using cdj::ArrMaske;

int main() {
  // 1. N = 130: three words, bits at the word seams
  {
    static_assert(ArrMaske<130>::W == 3, "130 bits are three words");
    ArrMaske<130> m;
    PRUEF(m.leer());
    for (int i : {0, 63, 64, 127, 129}) m.setze(i);
    PRUEF(!m.leer());
    std::vector<int> gesehen;
    m.je_bit([&](int i) { gesehen.push_back(i); });
    PRUEF((gesehen == std::vector<int>{0, 63, 64, 127, 129}));
    for (int i : {0, 63, 64, 127, 129}) PRUEF(m.test(i));
    PRUEF(!m.test(1) && !m.test(62) && !m.test(65) && !m.test(128));

    m.loesche(64);
    PRUEF(!m.test(64));
    PRUEF(m.test(63) && m.test(127));

    ArrMaske<130> weg;
    weg.setze(0);
    weg.setze(129);
    m.ohne(weg);
    gesehen.clear();
    m.je_bit([&](int i) { gesehen.push_back(i); });
    PRUEF((gesehen == std::vector<int>{63, 127}));

    m.loesche(63);
    m.loesche(127);
    PRUEF(m.leer());

    ArrMaske<130> o;
    o.setze(5);
    o.setze(100);
    m |= o;
    PRUEF(m == o);
    m.leeren();
    PRUEF(m.leer());
    PRUEF(!(m == o));
  }
  // 2. eins(): the test seam
  {
    PRUEF(ArrMaske<130>::eins(70) == ArrMaske<130>::eins(70));
    PRUEF(!(ArrMaske<130>::eins(70) == ArrMaske<130>::eins(71)));
    PRUEF(ArrMaske<130>::eins(70).test(70));
    PRUEF(!ArrMaske<130>::eins(70).test(6));   // 70 & 63 = 6: the word index matters
  }
  // 3. copy semantics: a callback that clears the NEXT set bit in the walked mask still sees that bit in the same word walk,
  //    and a callback that clears a bit in a later word: that word is copied when the walk reaches it, so the cleared bit is skipped.
  {
    ArrMaske<130> m;
    for (int i : {3, 9, 70, 80}) m.setze(i);
    std::vector<int> gesehen;
    m.je_bit([&](int i) {
      gesehen.push_back(i);
      if (i == 3) m.loesche(9);    // same word: already copied, 9 is still visited
      if (i == 9) m.loesche(80);   // later word: copied when reached, 80 is not visited
    });
    PRUEF((gesehen == std::vector<int>{3, 9, 70}));
    PRUEF(m.test(3) && !m.test(9) && m.test(70) && !m.test(80));
  }
  // 4. a callback that clears its own bit (the tail end of the slot loops) does not disturb the walk
  {
    ArrMaske<64> m;
    for (int i : {0, 1, 2, 63}) m.setze(i);
    std::vector<int> gesehen;
    m.je_bit([&](int i) {
      gesehen.push_back(i);
      m.loesche(i);
    });
    PRUEF((gesehen == std::vector<int>{0, 1, 2, 63}));
    PRUEF(m.leer());
  }
  // 5. N <= 64 is one word
  {
    static_assert(ArrMaske<57>::W == 1, "57 bits are one word");
    static_assert(ArrMaske<64>::W == 1, "64 bits are one word");
    static_assert(ArrMaske<65>::W == 2, "65 bits are two words");
    static_assert(sizeof(ArrMaske<57>) == sizeof(uint64_t), "one word, no overhead");
    ArrMaske<57> m;
    m.setze(56);
    PRUEF(m.test(56) && m == ArrMaske<57>::eins(56));
    std::vector<int> gesehen;
    m.je_bit([&](int i) { gesehen.push_back(i); });
    PRUEF((gesehen == std::vector<int>{56}));
  }
  // 6. anzahl(): set bits over all words (strand 1 task 6.2: the MIDI arm count)
  {
    ArrMaske<130> m;
    PRUEF(m.anzahl() == 0);
    for (int i : {0, 63, 64, 127, 129}) m.setze(i);
    PRUEF(m.anzahl() == 5);
    m.loesche(64);
    PRUEF(m.anzahl() == 4);
  }
  // 7. the pool aliases cover the pool
  {
    static_assert(cdj::ArrSlotMaske::W * 64 >= cdj::ARR_INS_ALLE, "the slot mask holds every slot");
    static_assert(cdj::ArrStreifenMaske::W * 64 >= cdj::ARR_KETTEN, "the strip mask holds every strip");
  }
  PRUEF_ENDE();
}
