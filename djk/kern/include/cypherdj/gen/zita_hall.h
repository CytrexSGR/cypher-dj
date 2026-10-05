/* ------------------------------------------------------------
name: "zita_hall"
Code generated with Faust 2.70.3 (https://faust.grame.fr)
Compilation options: -lang cpp -ct 1 -cn ZitaHall -scn FaustBasis -es 1 -mcd 16 -mdd 1024 -mdy 33 -single -ftz 0
------------------------------------------------------------ */

#ifndef  __ZitaHall_H__
#define  __ZitaHall_H__

#ifndef FAUSTFLOAT
#define FAUSTFLOAT float
#endif 

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <math.h>

namespace cdjfaust {

#ifndef FAUSTCLASS 
#define FAUSTCLASS ZitaHall
#endif

#ifdef __APPLE__ 
#define exp10f __exp10f
#define exp10 __exp10
#endif

#if defined(_WIN32)
#define RESTRICT __restrict
#else
#define RESTRICT __restrict__
#endif

static float ZitaHall_faustpower2_f(float value) {
	return value * value;
}

class ZitaHall : public FaustBasis {
	
 private:
	
	int fSampleRate;
	float fConst10;
	float fConst12;
	float fConst13;
	float fRec11[2];
	float fConst14;
	float fConst15;
	float fRec10[2];
	int IOTA0;
	float fVec0[16384];
	int iConst17;
	float fVec1[4096];
	int iConst18;
	float fVec2[4096];
	int iConst19;
	float fRec8[2];
	float fConst28;
	float fRec15[2];
	float fConst29;
	float fConst30;
	float fRec14[2];
	float fVec3[16384];
	int iConst32;
	float fVec4[2048];
	int iConst33;
	float fRec12[2];
	float fConst42;
	float fRec19[2];
	float fConst43;
	float fConst44;
	float fRec18[2];
	float fVec5[16384];
	int iConst46;
	float fVec6[4096];
	int iConst47;
	float fRec16[2];
	float fConst56;
	float fRec23[2];
	float fConst57;
	float fConst58;
	float fRec22[2];
	float fVec7[16384];
	int iConst60;
	float fVec8[2048];
	int iConst61;
	float fRec20[2];
	float fConst70;
	float fRec27[2];
	float fConst71;
	float fConst72;
	float fRec26[2];
	float fVec9[32768];
	int iConst74;
	float fVec10[4096];
	float fVec11[4096];
	int iConst75;
	float fRec24[2];
	float fConst84;
	float fRec31[2];
	float fConst85;
	float fConst86;
	float fRec30[2];
	float fVec12[16384];
	int iConst88;
	float fVec13[4096];
	int iConst89;
	float fRec28[2];
	float fConst98;
	float fRec35[2];
	float fConst99;
	float fConst100;
	float fRec34[2];
	float fVec14[32768];
	int iConst102;
	float fVec15[4096];
	int iConst103;
	float fRec32[2];
	float fConst112;
	float fRec39[2];
	float fConst113;
	float fConst114;
	float fRec38[2];
	float fVec16[32768];
	int iConst116;
	float fVec17[2048];
	int iConst117;
	float fRec36[2];
	float fRec0[3];
	float fRec1[3];
	float fRec2[3];
	float fRec3[3];
	float fRec4[3];
	float fRec5[3];
	float fRec6[3];
	float fRec7[3];
	
 public:
	ZitaHall() {}

	void metadata(Meta* m) { 
		m->declare("basics.lib/name", "Faust Basic Element Library");
		m->declare("basics.lib/tabulateNd", "Copyright (C) 2023 Bart Brouns <bart@magnetophon.nl>");
		m->declare("basics.lib/version", "1.12.0");
		m->declare("compile_options", "-lang cpp -ct 1 -cn ZitaHall -scn FaustBasis -es 1 -mcd 16 -mdd 1024 -mdy 33 -single -ftz 0");
		m->declare("delays.lib/name", "Faust Delay Library");
		m->declare("delays.lib/version", "1.1.0");
		m->declare("filename", "zita_hall.dsp");
		m->declare("filters.lib/allpass_comb:author", "Julius O. Smith III");
		m->declare("filters.lib/allpass_comb:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/allpass_comb:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/lowpass0_highpass1", "MIT-style STK-4.3 license");
		m->declare("filters.lib/lowpass0_highpass1:author", "Julius O. Smith III");
		m->declare("filters.lib/lowpass:author", "Julius O. Smith III");
		m->declare("filters.lib/lowpass:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/lowpass:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/name", "Faust Filters Library");
		m->declare("filters.lib/tf1:author", "Julius O. Smith III");
		m->declare("filters.lib/tf1:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/tf1:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/tf1s:author", "Julius O. Smith III");
		m->declare("filters.lib/tf1s:copyright", "Copyright (C) 2003-2019 by Julius O. Smith III <jos@ccrma.stanford.edu>");
		m->declare("filters.lib/tf1s:license", "MIT-style STK-4.3 license");
		m->declare("filters.lib/version", "1.3.0");
		m->declare("maths.lib/author", "GRAME");
		m->declare("maths.lib/copyright", "GRAME");
		m->declare("maths.lib/license", "LGPL with exception");
		m->declare("maths.lib/name", "Faust Math Library");
		m->declare("maths.lib/version", "2.7.0");
		m->declare("name", "zita_hall");
		m->declare("platform.lib/name", "Generic Platform Library");
		m->declare("platform.lib/version", "1.3.0");
		m->declare("reverbs.lib/name", "Faust Reverb Library");
		m->declare("reverbs.lib/version", "1.2.1");
		m->declare("routes.lib/hadamard:author", "Remy Muller, revised by Romain Michon");
		m->declare("routes.lib/name", "Faust Signal Routing Library");
		m->declare("routes.lib/version", "1.2.0");
		m->declare("signals.lib/name", "Faust Signal Routing Library");
		m->declare("signals.lib/version", "1.5.0");
	}

	virtual int getNumInputs() {
		return 2;
	}
	virtual int getNumOutputs() {
		return 2;
	}
	
	static void classInit(int sample_rate) {
	}
	
	virtual void instanceConstants(int sample_rate) {
		fSampleRate = sample_rate;
		float fConst0 = std::min<float>(1.92e+05f, std::max<float>(1.0f, float(fSampleRate)));
		float fConst1 = std::floor(0.174713f * fConst0 + 0.5f);
		float fConst2 = fConst1 / fConst0;
		float fConst3 = std::exp(-(3.4538777f * fConst2));
		float fConst4 = ZitaHall_faustpower2_f(fConst3);
		float fConst5 = 1.0f - fConst4;
		float fConst6 = std::cos(37699.113f / fConst0);
		float fConst7 = 1.0f - fConst6 * fConst4;
		float fConst8 = std::sqrt(std::max<float>(0.0f, ZitaHall_faustpower2_f(fConst7) / ZitaHall_faustpower2_f(fConst5) + -1.0f));
		float fConst9 = fConst7 / fConst5;
		fConst10 = fConst9 - fConst8;
		float fConst11 = 1.0f / std::tan(628.31854f / fConst0);
		fConst12 = 1.0f - fConst11;
		fConst13 = 1.0f / (fConst11 + 1.0f);
		fConst14 = std::exp(-(2.3025851f * fConst2)) / fConst3 + -1.0f;
		fConst15 = fConst3 * (fConst8 + (1.0f - fConst9));
		float fConst16 = std::floor(0.022904f * fConst0 + 0.5f);
		iConst17 = int(std::min<float>(8192.0f, std::max<float>(0.0f, fConst1 - fConst16)));
		iConst18 = int(std::min<float>(8192.0f, std::max<float>(0.0f, 0.02f * fConst0)));
		iConst19 = int(std::min<float>(2048.0f, std::max<float>(0.0f, fConst16 + -1.0f)));
		float fConst20 = std::floor(0.153129f * fConst0 + 0.5f);
		float fConst21 = fConst20 / fConst0;
		float fConst22 = std::exp(-(3.4538777f * fConst21));
		float fConst23 = ZitaHall_faustpower2_f(fConst22);
		float fConst24 = 1.0f - fConst23;
		float fConst25 = 1.0f - fConst6 * fConst23;
		float fConst26 = std::sqrt(std::max<float>(0.0f, ZitaHall_faustpower2_f(fConst25) / ZitaHall_faustpower2_f(fConst24) + -1.0f));
		float fConst27 = fConst25 / fConst24;
		fConst28 = fConst27 - fConst26;
		fConst29 = std::exp(-(2.3025851f * fConst21)) / fConst22 + -1.0f;
		fConst30 = fConst22 * (fConst26 + (1.0f - fConst27));
		float fConst31 = std::floor(0.020346f * fConst0 + 0.5f);
		iConst32 = int(std::min<float>(8192.0f, std::max<float>(0.0f, fConst20 - fConst31)));
		iConst33 = int(std::min<float>(1024.0f, std::max<float>(0.0f, fConst31 + -1.0f)));
		float fConst34 = std::floor(0.127837f * fConst0 + 0.5f);
		float fConst35 = fConst34 / fConst0;
		float fConst36 = std::exp(-(3.4538777f * fConst35));
		float fConst37 = ZitaHall_faustpower2_f(fConst36);
		float fConst38 = 1.0f - fConst37;
		float fConst39 = 1.0f - fConst6 * fConst37;
		float fConst40 = std::sqrt(std::max<float>(0.0f, ZitaHall_faustpower2_f(fConst39) / ZitaHall_faustpower2_f(fConst38) + -1.0f));
		float fConst41 = fConst39 / fConst38;
		fConst42 = fConst41 - fConst40;
		fConst43 = std::exp(-(2.3025851f * fConst35)) / fConst36 + -1.0f;
		fConst44 = fConst36 * (fConst40 + (1.0f - fConst41));
		float fConst45 = std::floor(0.031604f * fConst0 + 0.5f);
		iConst46 = int(std::min<float>(8192.0f, std::max<float>(0.0f, fConst34 - fConst45)));
		iConst47 = int(std::min<float>(2048.0f, std::max<float>(0.0f, fConst45 + -1.0f)));
		float fConst48 = std::floor(0.125f * fConst0 + 0.5f);
		float fConst49 = fConst48 / fConst0;
		float fConst50 = std::exp(-(3.4538777f * fConst49));
		float fConst51 = ZitaHall_faustpower2_f(fConst50);
		float fConst52 = 1.0f - fConst51;
		float fConst53 = 1.0f - fConst6 * fConst51;
		float fConst54 = std::sqrt(std::max<float>(0.0f, ZitaHall_faustpower2_f(fConst53) / ZitaHall_faustpower2_f(fConst52) + -1.0f));
		float fConst55 = fConst53 / fConst52;
		fConst56 = fConst55 - fConst54;
		fConst57 = std::exp(-(2.3025851f * fConst49)) / fConst50 + -1.0f;
		fConst58 = fConst50 * (fConst54 + (1.0f - fConst55));
		float fConst59 = std::floor(0.013458f * fConst0 + 0.5f);
		iConst60 = int(std::min<float>(8192.0f, std::max<float>(0.0f, fConst48 - fConst59)));
		iConst61 = int(std::min<float>(1024.0f, std::max<float>(0.0f, fConst59 + -1.0f)));
		float fConst62 = std::floor(0.210389f * fConst0 + 0.5f);
		float fConst63 = fConst62 / fConst0;
		float fConst64 = std::exp(-(3.4538777f * fConst63));
		float fConst65 = ZitaHall_faustpower2_f(fConst64);
		float fConst66 = 1.0f - fConst65;
		float fConst67 = 1.0f - fConst6 * fConst65;
		float fConst68 = std::sqrt(std::max<float>(0.0f, ZitaHall_faustpower2_f(fConst67) / ZitaHall_faustpower2_f(fConst66) + -1.0f));
		float fConst69 = fConst67 / fConst66;
		fConst70 = fConst69 - fConst68;
		fConst71 = std::exp(-(2.3025851f * fConst63)) / fConst64 + -1.0f;
		fConst72 = fConst64 * (fConst68 + (1.0f - fConst69));
		float fConst73 = std::floor(0.024421f * fConst0 + 0.5f);
		iConst74 = int(std::min<float>(16384.0f, std::max<float>(0.0f, fConst62 - fConst73)));
		iConst75 = int(std::min<float>(2048.0f, std::max<float>(0.0f, fConst73 + -1.0f)));
		float fConst76 = std::floor(0.192303f * fConst0 + 0.5f);
		float fConst77 = fConst76 / fConst0;
		float fConst78 = std::exp(-(3.4538777f * fConst77));
		float fConst79 = ZitaHall_faustpower2_f(fConst78);
		float fConst80 = 1.0f - fConst79;
		float fConst81 = 1.0f - fConst6 * fConst79;
		float fConst82 = std::sqrt(std::max<float>(0.0f, ZitaHall_faustpower2_f(fConst81) / ZitaHall_faustpower2_f(fConst80) + -1.0f));
		float fConst83 = fConst81 / fConst80;
		fConst84 = fConst83 - fConst82;
		fConst85 = std::exp(-(2.3025851f * fConst77)) / fConst78 + -1.0f;
		fConst86 = fConst78 * (fConst82 + (1.0f - fConst83));
		float fConst87 = std::floor(0.029291f * fConst0 + 0.5f);
		iConst88 = int(std::min<float>(8192.0f, std::max<float>(0.0f, fConst76 - fConst87)));
		iConst89 = int(std::min<float>(2048.0f, std::max<float>(0.0f, fConst87 + -1.0f)));
		float fConst90 = std::floor(0.256891f * fConst0 + 0.5f);
		float fConst91 = fConst90 / fConst0;
		float fConst92 = std::exp(-(3.4538777f * fConst91));
		float fConst93 = ZitaHall_faustpower2_f(fConst92);
		float fConst94 = 1.0f - fConst93;
		float fConst95 = 1.0f - fConst6 * fConst93;
		float fConst96 = std::sqrt(std::max<float>(0.0f, ZitaHall_faustpower2_f(fConst95) / ZitaHall_faustpower2_f(fConst94) + -1.0f));
		float fConst97 = fConst95 / fConst94;
		fConst98 = fConst97 - fConst96;
		fConst99 = std::exp(-(2.3025851f * fConst91)) / fConst92 + -1.0f;
		fConst100 = fConst92 * (fConst96 + (1.0f - fConst97));
		float fConst101 = std::floor(0.027333f * fConst0 + 0.5f);
		iConst102 = int(std::min<float>(16384.0f, std::max<float>(0.0f, fConst90 - fConst101)));
		iConst103 = int(std::min<float>(2048.0f, std::max<float>(0.0f, fConst101 + -1.0f)));
		float fConst104 = std::floor(0.219991f * fConst0 + 0.5f);
		float fConst105 = fConst104 / fConst0;
		float fConst106 = std::exp(-(3.4538777f * fConst105));
		float fConst107 = ZitaHall_faustpower2_f(fConst106);
		float fConst108 = 1.0f - fConst107;
		float fConst109 = 1.0f - fConst6 * fConst107;
		float fConst110 = std::sqrt(std::max<float>(0.0f, ZitaHall_faustpower2_f(fConst109) / ZitaHall_faustpower2_f(fConst108) + -1.0f));
		float fConst111 = fConst109 / fConst108;
		fConst112 = fConst111 - fConst110;
		fConst113 = std::exp(-(2.3025851f * fConst105)) / fConst106 + -1.0f;
		fConst114 = fConst106 * (fConst110 + (1.0f - fConst111));
		float fConst115 = std::floor(0.019123f * fConst0 + 0.5f);
		iConst116 = int(std::min<float>(16384.0f, std::max<float>(0.0f, fConst104 - fConst115)));
		iConst117 = int(std::min<float>(1024.0f, std::max<float>(0.0f, fConst115 + -1.0f)));
	}
	
	virtual void instanceResetUserInterface() {
	}
	
	virtual void instanceClear() {
		for (int l0 = 0; l0 < 2; l0 = l0 + 1) {
			fRec11[l0] = 0.0f;
		}
		for (int l1 = 0; l1 < 2; l1 = l1 + 1) {
			fRec10[l1] = 0.0f;
		}
		IOTA0 = 0;
		for (int l2 = 0; l2 < 16384; l2 = l2 + 1) {
			fVec0[l2] = 0.0f;
		}
		for (int l3 = 0; l3 < 4096; l3 = l3 + 1) {
			fVec1[l3] = 0.0f;
		}
		for (int l4 = 0; l4 < 4096; l4 = l4 + 1) {
			fVec2[l4] = 0.0f;
		}
		for (int l5 = 0; l5 < 2; l5 = l5 + 1) {
			fRec8[l5] = 0.0f;
		}
		for (int l6 = 0; l6 < 2; l6 = l6 + 1) {
			fRec15[l6] = 0.0f;
		}
		for (int l7 = 0; l7 < 2; l7 = l7 + 1) {
			fRec14[l7] = 0.0f;
		}
		for (int l8 = 0; l8 < 16384; l8 = l8 + 1) {
			fVec3[l8] = 0.0f;
		}
		for (int l9 = 0; l9 < 2048; l9 = l9 + 1) {
			fVec4[l9] = 0.0f;
		}
		for (int l10 = 0; l10 < 2; l10 = l10 + 1) {
			fRec12[l10] = 0.0f;
		}
		for (int l11 = 0; l11 < 2; l11 = l11 + 1) {
			fRec19[l11] = 0.0f;
		}
		for (int l12 = 0; l12 < 2; l12 = l12 + 1) {
			fRec18[l12] = 0.0f;
		}
		for (int l13 = 0; l13 < 16384; l13 = l13 + 1) {
			fVec5[l13] = 0.0f;
		}
		for (int l14 = 0; l14 < 4096; l14 = l14 + 1) {
			fVec6[l14] = 0.0f;
		}
		for (int l15 = 0; l15 < 2; l15 = l15 + 1) {
			fRec16[l15] = 0.0f;
		}
		for (int l16 = 0; l16 < 2; l16 = l16 + 1) {
			fRec23[l16] = 0.0f;
		}
		for (int l17 = 0; l17 < 2; l17 = l17 + 1) {
			fRec22[l17] = 0.0f;
		}
		for (int l18 = 0; l18 < 16384; l18 = l18 + 1) {
			fVec7[l18] = 0.0f;
		}
		for (int l19 = 0; l19 < 2048; l19 = l19 + 1) {
			fVec8[l19] = 0.0f;
		}
		for (int l20 = 0; l20 < 2; l20 = l20 + 1) {
			fRec20[l20] = 0.0f;
		}
		for (int l21 = 0; l21 < 2; l21 = l21 + 1) {
			fRec27[l21] = 0.0f;
		}
		for (int l22 = 0; l22 < 2; l22 = l22 + 1) {
			fRec26[l22] = 0.0f;
		}
		for (int l23 = 0; l23 < 32768; l23 = l23 + 1) {
			fVec9[l23] = 0.0f;
		}
		for (int l24 = 0; l24 < 4096; l24 = l24 + 1) {
			fVec10[l24] = 0.0f;
		}
		for (int l25 = 0; l25 < 4096; l25 = l25 + 1) {
			fVec11[l25] = 0.0f;
		}
		for (int l26 = 0; l26 < 2; l26 = l26 + 1) {
			fRec24[l26] = 0.0f;
		}
		for (int l27 = 0; l27 < 2; l27 = l27 + 1) {
			fRec31[l27] = 0.0f;
		}
		for (int l28 = 0; l28 < 2; l28 = l28 + 1) {
			fRec30[l28] = 0.0f;
		}
		for (int l29 = 0; l29 < 16384; l29 = l29 + 1) {
			fVec12[l29] = 0.0f;
		}
		for (int l30 = 0; l30 < 4096; l30 = l30 + 1) {
			fVec13[l30] = 0.0f;
		}
		for (int l31 = 0; l31 < 2; l31 = l31 + 1) {
			fRec28[l31] = 0.0f;
		}
		for (int l32 = 0; l32 < 2; l32 = l32 + 1) {
			fRec35[l32] = 0.0f;
		}
		for (int l33 = 0; l33 < 2; l33 = l33 + 1) {
			fRec34[l33] = 0.0f;
		}
		for (int l34 = 0; l34 < 32768; l34 = l34 + 1) {
			fVec14[l34] = 0.0f;
		}
		for (int l35 = 0; l35 < 4096; l35 = l35 + 1) {
			fVec15[l35] = 0.0f;
		}
		for (int l36 = 0; l36 < 2; l36 = l36 + 1) {
			fRec32[l36] = 0.0f;
		}
		for (int l37 = 0; l37 < 2; l37 = l37 + 1) {
			fRec39[l37] = 0.0f;
		}
		for (int l38 = 0; l38 < 2; l38 = l38 + 1) {
			fRec38[l38] = 0.0f;
		}
		for (int l39 = 0; l39 < 32768; l39 = l39 + 1) {
			fVec16[l39] = 0.0f;
		}
		for (int l40 = 0; l40 < 2048; l40 = l40 + 1) {
			fVec17[l40] = 0.0f;
		}
		for (int l41 = 0; l41 < 2; l41 = l41 + 1) {
			fRec36[l41] = 0.0f;
		}
		for (int l42 = 0; l42 < 3; l42 = l42 + 1) {
			fRec0[l42] = 0.0f;
		}
		for (int l43 = 0; l43 < 3; l43 = l43 + 1) {
			fRec1[l43] = 0.0f;
		}
		for (int l44 = 0; l44 < 3; l44 = l44 + 1) {
			fRec2[l44] = 0.0f;
		}
		for (int l45 = 0; l45 < 3; l45 = l45 + 1) {
			fRec3[l45] = 0.0f;
		}
		for (int l46 = 0; l46 < 3; l46 = l46 + 1) {
			fRec4[l46] = 0.0f;
		}
		for (int l47 = 0; l47 < 3; l47 = l47 + 1) {
			fRec5[l47] = 0.0f;
		}
		for (int l48 = 0; l48 < 3; l48 = l48 + 1) {
			fRec6[l48] = 0.0f;
		}
		for (int l49 = 0; l49 < 3; l49 = l49 + 1) {
			fRec7[l49] = 0.0f;
		}
	}
	
	virtual void init(int sample_rate) {
		classInit(sample_rate);
		instanceInit(sample_rate);
	}
	
	virtual void instanceInit(int sample_rate) {
		instanceConstants(sample_rate);
		instanceResetUserInterface();
		instanceClear();
	}
	
	virtual ZitaHall* clone() {
		return new ZitaHall();
	}
	
	virtual int getSampleRate() {
		return fSampleRate;
	}
	
	virtual void buildUserInterface(UI* ui_interface) {
		ui_interface->openVerticalBox("zita_hall");
		ui_interface->closeBox();
	}
	
	virtual void compute(int count, FAUSTFLOAT** RESTRICT inputs, FAUSTFLOAT** RESTRICT outputs) {
		FAUSTFLOAT* input0 = inputs[0];
		FAUSTFLOAT* input1 = inputs[1];
		FAUSTFLOAT* output0 = outputs[0];
		FAUSTFLOAT* output1 = outputs[1];
		for (int i0 = 0; i0 < count; i0 = i0 + 1) {
			fRec11[0] = -(fConst13 * (fConst12 * fRec11[1] - (fRec4[1] + fRec4[2])));
			fRec10[0] = fConst15 * (fRec4[1] + fConst14 * fRec11[0]) + fConst10 * fRec10[1];
			fVec0[IOTA0 & 16383] = 0.35355338f * fRec10[0] + 1e-20f;
			fVec1[IOTA0 & 4095] = float(input0[i0]);
			float fTemp0 = 0.3f * fVec1[(IOTA0 - iConst18) & 4095];
			float fTemp1 = fTemp0 + fVec0[(IOTA0 - iConst17) & 16383] - 0.6f * fRec8[1];
			fVec2[IOTA0 & 4095] = fTemp1;
			fRec8[0] = fVec2[(IOTA0 - iConst19) & 4095];
			float fRec9 = 0.6f * fTemp1;
			fRec15[0] = -(fConst13 * (fConst12 * fRec15[1] - (fRec0[1] + fRec0[2])));
			fRec14[0] = fConst30 * (fRec0[1] + fConst29 * fRec15[0]) + fConst28 * fRec14[1];
			fVec3[IOTA0 & 16383] = 0.35355338f * fRec14[0] + 1e-20f;
			float fTemp2 = fVec3[(IOTA0 - iConst32) & 16383] + fTemp0 - 0.6f * fRec12[1];
			fVec4[IOTA0 & 2047] = fTemp2;
			fRec12[0] = fVec4[(IOTA0 - iConst33) & 2047];
			float fRec13 = 0.6f * fTemp2;
			float fTemp3 = fRec13 + fRec9;
			fRec19[0] = -(fConst13 * (fConst12 * fRec19[1] - (fRec2[1] + fRec2[2])));
			fRec18[0] = fConst44 * (fRec2[1] + fConst43 * fRec19[0]) + fConst42 * fRec18[1];
			fVec5[IOTA0 & 16383] = 0.35355338f * fRec18[0] + 1e-20f;
			float fTemp4 = fVec5[(IOTA0 - iConst46) & 16383] - (fTemp0 + 0.6f * fRec16[1]);
			fVec6[IOTA0 & 4095] = fTemp4;
			fRec16[0] = fVec6[(IOTA0 - iConst47) & 4095];
			float fRec17 = 0.6f * fTemp4;
			fRec23[0] = -(fConst13 * (fConst12 * fRec23[1] - (fRec6[1] + fRec6[2])));
			fRec22[0] = fConst58 * (fRec6[1] + fConst57 * fRec23[0]) + fConst56 * fRec22[1];
			fVec7[IOTA0 & 16383] = 0.35355338f * fRec22[0] + 1e-20f;
			float fTemp5 = fVec7[(IOTA0 - iConst60) & 16383] - (fTemp0 + 0.6f * fRec20[1]);
			fVec8[IOTA0 & 2047] = fTemp5;
			fRec20[0] = fVec8[(IOTA0 - iConst61) & 2047];
			float fRec21 = 0.6f * fTemp5;
			float fTemp6 = fRec21 + fRec17 + fTemp3;
			fRec27[0] = -(fConst13 * (fConst12 * fRec27[1] - (fRec1[1] + fRec1[2])));
			fRec26[0] = fConst72 * (fRec1[1] + fConst71 * fRec27[0]) + fConst70 * fRec26[1];
			fVec9[IOTA0 & 32767] = 0.35355338f * fRec26[0] + 1e-20f;
			fVec10[IOTA0 & 4095] = float(input1[i0]);
			float fTemp7 = 0.3f * fVec10[(IOTA0 - iConst18) & 4095];
			float fTemp8 = fTemp7 + 0.6f * fRec24[1] + fVec9[(IOTA0 - iConst74) & 32767];
			fVec11[IOTA0 & 4095] = fTemp8;
			fRec24[0] = fVec11[(IOTA0 - iConst75) & 4095];
			float fRec25 = -(0.6f * fTemp8);
			fRec31[0] = -(fConst13 * (fConst12 * fRec31[1] - (fRec5[1] + fRec5[2])));
			fRec30[0] = fConst86 * (fRec5[1] + fConst85 * fRec31[0]) + fConst84 * fRec30[1];
			fVec12[IOTA0 & 16383] = 0.35355338f * fRec30[0] + 1e-20f;
			float fTemp9 = fVec12[(IOTA0 - iConst88) & 16383] + fTemp7 + 0.6f * fRec28[1];
			fVec13[IOTA0 & 4095] = fTemp9;
			fRec28[0] = fVec13[(IOTA0 - iConst89) & 4095];
			float fRec29 = -(0.6f * fTemp9);
			fRec35[0] = -(fConst13 * (fConst12 * fRec35[1] - (fRec3[1] + fRec3[2])));
			fRec34[0] = fConst100 * (fRec3[1] + fConst99 * fRec35[0]) + fConst98 * fRec34[1];
			fVec14[IOTA0 & 32767] = 0.35355338f * fRec34[0] + 1e-20f;
			float fTemp10 = 0.6f * fRec32[1] + fVec14[(IOTA0 - iConst102) & 32767];
			fVec15[IOTA0 & 4095] = fTemp10 - fTemp7;
			fRec32[0] = fVec15[(IOTA0 - iConst103) & 4095];
			float fRec33 = 0.6f * (fTemp7 - fTemp10);
			fRec39[0] = -(fConst13 * (fConst12 * fRec39[1] - (fRec7[1] + fRec7[2])));
			fRec38[0] = fConst114 * (fRec7[1] + fConst113 * fRec39[0]) + fConst112 * fRec38[1];
			fVec16[IOTA0 & 32767] = 0.35355338f * fRec38[0] + 1e-20f;
			float fTemp11 = 0.6f * fRec36[1] + fVec16[(IOTA0 - iConst116) & 32767];
			fVec17[IOTA0 & 2047] = fTemp11 - fTemp7;
			fRec36[0] = fVec17[(IOTA0 - iConst117) & 2047];
			float fRec37 = 0.6f * (fTemp7 - fTemp11);
			fRec0[0] = fRec36[1] + fRec32[1] + fRec28[1] + fRec24[1] + fRec20[1] + fRec16[1] + fRec8[1] + fRec12[1] + fRec37 + fRec33 + fRec29 + fRec25 + fTemp6;
			fRec1[0] = fRec20[1] + fRec16[1] + fRec8[1] + fRec12[1] + fTemp6 - (fRec36[1] + fRec32[1] + fRec28[1] + fRec24[1] + fRec37 + fRec33 + fRec25 + fRec29);
			float fTemp12 = fRec17 + fRec21;
			fRec2[0] = fRec28[1] + fRec24[1] + fRec8[1] + fRec12[1] + fRec29 + fRec25 + fTemp3 - (fRec36[1] + fRec32[1] + fRec20[1] + fRec16[1] + fRec37 + fRec33 + fTemp12);
			fRec3[0] = fRec36[1] + fRec32[1] + fRec8[1] + fRec12[1] + fRec37 + fRec33 + fTemp3 - (fRec28[1] + fRec24[1] + fRec20[1] + fRec16[1] + fRec29 + fRec25 + fTemp12);
			float fTemp13 = fRec9 + fRec21;
			float fTemp14 = fRec13 + fRec17;
			fRec4[0] = fRec32[1] + fRec24[1] + fRec16[1] + fRec12[1] + fRec33 + fRec25 + fTemp14 - (fRec36[1] + fRec28[1] + fRec20[1] + fRec8[1] + fRec37 + fRec29 + fTemp13);
			fRec5[0] = fRec36[1] + fRec28[1] + fRec16[1] + fRec12[1] + fRec37 + fRec29 + fTemp14 - (fRec32[1] + fRec24[1] + fRec20[1] + fRec8[1] + fRec33 + fRec25 + fTemp13);
			float fTemp15 = fRec9 + fRec17;
			float fTemp16 = fRec13 + fRec21;
			fRec6[0] = fRec36[1] + fRec24[1] + fRec20[1] + fRec12[1] + fRec37 + fRec25 + fTemp16 - (fRec32[1] + fRec28[1] + fRec16[1] + fRec8[1] + fRec33 + fRec29 + fTemp15);
			fRec7[0] = fRec32[1] + fRec28[1] + fRec20[1] + fRec12[1] + fRec33 + fRec29 + fTemp16 - (fRec36[1] + fRec24[1] + fRec16[1] + fRec8[1] + fRec37 + fRec25 + fTemp15);
			output0[i0] = FAUSTFLOAT(0.37f * (fRec1[0] + fRec2[0]));
			output1[i0] = FAUSTFLOAT(0.37f * (fRec1[0] - fRec2[0]));
			fRec11[1] = fRec11[0];
			fRec10[1] = fRec10[0];
			IOTA0 = IOTA0 + 1;
			fRec8[1] = fRec8[0];
			fRec15[1] = fRec15[0];
			fRec14[1] = fRec14[0];
			fRec12[1] = fRec12[0];
			fRec19[1] = fRec19[0];
			fRec18[1] = fRec18[0];
			fRec16[1] = fRec16[0];
			fRec23[1] = fRec23[0];
			fRec22[1] = fRec22[0];
			fRec20[1] = fRec20[0];
			fRec27[1] = fRec27[0];
			fRec26[1] = fRec26[0];
			fRec24[1] = fRec24[0];
			fRec31[1] = fRec31[0];
			fRec30[1] = fRec30[0];
			fRec28[1] = fRec28[0];
			fRec35[1] = fRec35[0];
			fRec34[1] = fRec34[0];
			fRec32[1] = fRec32[0];
			fRec39[1] = fRec39[0];
			fRec38[1] = fRec38[0];
			fRec36[1] = fRec36[0];
			fRec0[2] = fRec0[1];
			fRec0[1] = fRec0[0];
			fRec1[2] = fRec1[1];
			fRec1[1] = fRec1[0];
			fRec2[2] = fRec2[1];
			fRec2[1] = fRec2[0];
			fRec3[2] = fRec3[1];
			fRec3[1] = fRec3[0];
			fRec4[2] = fRec4[1];
			fRec4[1] = fRec4[0];
			fRec5[2] = fRec5[1];
			fRec5[1] = fRec5[0];
			fRec6[2] = fRec6[1];
			fRec6[1] = fRec6[0];
			fRec7[2] = fRec7[1];
			fRec7[1] = fRec7[0];
		}
	}

};

} // namespace cdjfaust

#endif
