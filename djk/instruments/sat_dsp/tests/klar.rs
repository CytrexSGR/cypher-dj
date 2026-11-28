//! Clean clipper (strand 13, task 2.1): the pool object `Saett::neu_pool` clips Soft and Hard at 8x and has a knee on the
//! hard curve; `Saett::neu` (the VST) stays bit-identical. Own test binary: the allocation counter is global.
use saett_dsp::{hart_knie, knie_breite, Einstellung, Kurve, Saett, DC_ECKE_HZ, LATENZ_POOL};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::f64::consts::PI;

// Per-thread counter: the other tests of this file run in parallel threads and allocate freely.
thread_local! {
    static ANFORDERUNGEN: Cell<usize> = const { Cell::new(0) };
}
struct Zaehler;
unsafe impl GlobalAlloc for Zaehler {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        ANFORDERUNGEN.with(|c| c.set(c.get() + 1));
        System.alloc(l)
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        System.dealloc(p, l)
    }
}
#[global_allocator]
static A: Zaehler = Zaehler;

const FS: f64 = 48000.0;
/// Latency of `Saett::neu` below 88 kHz.
const LATENZ_NEU: usize = 69;

fn lauf(s: &mut Saett, x: &[f32]) -> Vec<f32> {
    let (mut l, mut r) = (x.to_vec(), x.to_vec());
    for (cl, cr) in l.chunks_mut(256).zip(r.chunks_mut(256)) {
        s.block(cl, cr);
    }
    l
}

fn sinus(f: f64, a: f64, n: usize) -> Vec<f32> {
    (0..n).map(|i| (a * (2.0 * PI * f * i as f64 / FS).sin()) as f32).collect()
}

fn rausch(n: usize) -> Vec<f32> {
    let mut z: u32 = 4242;
    (0..n)
        .map(|_| {
            z = z.wrapping_mul(1664525).wrapping_add(1013904223);
            ((z >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 1.6
        })
        .collect()
}

fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut b = n >> 1;
        while j & b != 0 {
            j ^= b;
            b >>= 1;
        }
        j |= b;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let w = -2.0 * PI / len as f64;
        for s in (0..n).step_by(len) {
            for k in 0..len / 2 {
                let (c, si) = ((w * k as f64).cos(), (w * k as f64).sin());
                let (a, b) = (s + k, s + k + len / 2);
                let (tr, ti) = (re[b] * c - im[b] * si, re[b] * si + im[b] * c);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
            }
        }
        len <<= 1;
    }
}

/// Output bits of today's `Saett::neu` (before strand 13), 48 kHz: 256 samples left and 256 right of a hard clip
/// (drive 18, out -2, mix 0.8, ceiling -3), then 256 samples of the default tanh switching to soft at -1 dB after 64.
const NEU_VORHER: [u32; 768] = [
    0x2a978c33, 0x2b8017f6, 0xacd34284, 0x2db20f23, 0xae661210, 0x2f03f9a1, 0xaf8c08ed, 0x300d80a5, 0xb0890efe, 0x31000315,
    0xb167336f, 0x31caa94d, 0xb22ce06b, 0x328fe33b, 0xb2ea2efa, 0x333ab322, 0xb3920fa0, 0x33e09972, 0xb429edc0, 0x347d53ab,
    0xb4ba3a61, 0x3507257a, 0xb541ce48, 0x35896946, 0xb5c0d237, 0x3605f859, 0xb6387888, 0x367bdbd0, 0xb6aa948b, 0x36e5624a,
    0xb7193386, 0x374b67f4, 0xb7865031, 0x37b096f1, 0xb7e73c84, 0x381ab076, 0xb8447167, 0x38802974, 0xb8a4af68, 0x38d610f0,
    0xb907c199, 0x392c9a19, 0xb95597a5, 0x398487eb, 0xb9a1cab2, 0x39c5be41, 0xb9ed27ce, 0x3a0deb88, 0xba276ddd, 0x3a44cd85,
    0xba64109b, 0x3a83784e, 0xba95eec6, 0x3aaa2737, 0xbabf18cd, 0x3ad58fc8, 0xbaec6fd9, 0x3b021ef5, 0xbb0dda53, 0x3b197ee5,
    0xbb245d38, 0x3b2e6e85, 0xbb36e5f7, 0x3b3da6ee, 0xbb4210ac, 0x3b44de6d, 0xbb48baa9, 0x3b5a6f65, 0xbb9d43fa, 0x3da48dc0,
    0x3ef885a0, 0x3f037a8b, 0x3eef2142, 0x3ec0bd69, 0x3f07d33e, 0x3ef834bf, 0x3f08e02b, 0x3f11d115, 0x3f04c024, 0x3f09040e,
    0x3f1b48f6, 0x3f15a676, 0x3f1204b1, 0x3f1178f2, 0x3f1a8db8, 0x3f1bd50a, 0x3f0a4844, 0x3f1213e6, 0x3f1aa5a6, 0x3f14ac24,
    0x3f1eacaf, 0x3f088045, 0x3f1f1f20, 0x3f072f05, 0x3f0e9c66, 0x3f1052ab, 0x3f0c3385, 0x3f0cf758, 0x3f0b5614, 0x3f0ddb3d,
    0x3efb37c1, 0x3f0748a7, 0x3ee99459, 0x3f033530, 0x3e9506ea, 0xbf0a5dbd, 0x3b9446bf, 0xbeea72c3, 0xbf0b786e, 0xbf05fdf4,
    0xbf0f6a84, 0xbf0ca340, 0xbf154aa1, 0xbf1381c4, 0xbf13017d, 0xbf10cdda, 0xbf084f48, 0xbf0e26d6, 0xbf133ed8, 0xbf14f7eb,
    0xbf20ca23, 0xbf2434f9, 0xbf107fce, 0xbf079af2, 0xbf255bd6, 0xbf195e72, 0xbf21f2b0, 0xbf14340f, 0xbf0b9260, 0xbf015c61,
    0xbf02b8fb, 0xbefacba1, 0xbf18ae13, 0xbeee8b55, 0xbf0b68c3, 0xbe13973d, 0x3ed32e58, 0xbef61a86, 0xbeec9051, 0xbf0648d1,
    0xbeee734f, 0xbef48b56, 0x3dcfce64, 0x3f004502, 0x3f09e2cb, 0x3f053c0d, 0x3f10b9cc, 0x3efb894f, 0x3f0571f0, 0x3f008101,
    0x3f1c468e, 0x3f085c5c, 0x3f07ee23, 0x3f205763, 0x3f23007c, 0x3f091664, 0x3f250d97, 0x3f180eb1, 0x3f1ecfa1, 0x3f2322e7,
    0x3f081c80, 0x3f085661, 0x3f17841e, 0x3f0d034c, 0x3f0c9979, 0x3f03aa40, 0x3f16e2f3, 0x3f0b565e, 0x3f01e2cd, 0x3ede9bba,
    0x3efed34b, 0x3f04217e, 0x3e8e012d, 0xbee3cce8, 0x3e0904aa, 0x3ee426c2, 0xbed71143, 0xbefb8905, 0xbefbfe4d, 0xbeff8d23,
    0xbf003a62, 0xbf06a3ed, 0xbf07556b, 0xbf03f673, 0xbf0aae39, 0xbf2211ae, 0xbf185edc, 0xbf07bb65, 0xbf1ed8e5, 0xbf1eb54f,
    0xbf0e7e4d, 0xbf245e26, 0xbf14944e, 0xbf0c81a5, 0xbf072f79, 0xbf0ee9d6, 0xbf104e6e, 0xbf249baa, 0xbf02c86d, 0xbf0f5fd6,
    0xbf09247f, 0xbf037da7, 0xbeec42de, 0xbf1e1773, 0xbe9f8d05, 0xbc954e1c, 0x3e09ed36, 0xbec0a210, 0xbed18b2b, 0xbe90e0e3,
    0xbedcd25d, 0xbe951c93, 0xbeb69f23, 0x3f0e7aba, 0x3ecd3a4a, 0x3f0e50f6, 0x3ef0847c, 0x3f1f3e8d, 0x3f063df3, 0x3f178dd8,
    0x3f05b074, 0x3f146ee7, 0x3f1b4d5d, 0x3f1398d8, 0x3f0a23bf, 0x3f0df863, 0x3f109fd6, 0x3f1f922b, 0x3f1ec445, 0x3f112bb3,
    0x3f04fa6c, 0x3f1292bf, 0x3f037d2a, 0x3f054e2c, 0x3f13339f, 0x3f162747, 0x3eff44d5, 0x3f056c43, 0x3efb1867, 0x3f0349d5,
    0x3dfa1d55, 0x3f0c74ef, 0xbe1d51cb, 0x3e3b8fd3, 0x3f0bd997, 0xbec3a504, 0xbde0c26a, 0xbed4aa96, 0xbf17bf07, 0xbeff3a54,
    0xbf09c527, 0xbf08000b, 0xbf16d123, 0xbf093918, 0xbf1f24f5, 0xbf0484bf, 0xaa178c33, 0xab0017f6, 0x2c534284, 0xad320f23,
    0x2de61210, 0xae83f9a1, 0x2f0c08ed, 0xaf8d80a5, 0x30090efe, 0xb0800315, 0x30e7336f, 0xb14aa94d, 0x31ace06b, 0xb20fe33b,
    0x326a2efa, 0xb2bab322, 0x33120fa0, 0xb3609972, 0x33a9edc0, 0xb3fd53ab, 0x343a3a61, 0xb487257a, 0x34c1ce48, 0xb5096946,
    0x3540d237, 0xb585f859, 0x35b87888, 0xb5fbdbd0, 0x362a948b, 0xb665624a, 0x36993386, 0xb6cb67f4, 0x37065031, 0xb73096f1,
    0x37673c84, 0xb79ac4fe, 0x37c1c765, 0xb7fa9c92, 0x381f48e7, 0xb84dcc80, 0x38812928, 0xb8a32d44, 0x38c8054e, 0xb8f6a90e,
    0x39155a05, 0xb9358c82, 0x39583491, 0xb980b823, 0x3996e910, 0xb9b0863e, 0x39cb562e, 0xb9e936b5, 0x3a042a31, 0xba1521de,
    0x3a26524b, 0xba388d97, 0x3a4a8254, 0xba5ca5bf, 0x3a6d5bf9, 0xba7c8a86, 0x3a841406, 0xba87ac68, 0x3a8776e2, 0xba821df3,
    0x3a695173, 0xba36da3a, 0x39be511b, 0x39479633, 0xba8057ee, 0xbd05ea15, 0xbec10128, 0xbf02fda3, 0xbec8e5e5, 0xbe657e21,
    0xbef79462, 0xbeee5aac, 0xbefc6209, 0xbf0202a6, 0xbef7d956, 0xbefb4b3b, 0xbf070618, 0xbf03f815, 0xbf023e46, 0xbf01dfc7,
    0xbf065e1d, 0xbf070cbf, 0xbefc2a36, 0xbf022dd2, 0xbf0619d1, 0xbf03806b, 0xbf07ed59, 0xbefaf0fd, 0xbf07ed37, 0xbef9d3a5,
    0xbefec618, 0xbf01aa58, 0xbefb91f9, 0xbf005599, 0xbef965bd, 0xbf019055, 0xbee8ac58, 0xbf011e3a, 0xbec77997, 0xbecae9c4,
    0xbe8ceb28, 0x3ef81879, 0x3c056a64, 0x3ed1518e, 0x3f02dd01, 0x3ef994e9, 0x3f02c4a1, 0x3f00b8e7, 0x3f055871, 0x3f043341,
    0x3f04157d, 0x3f02c5ca, 0x3efd5e2b, 0x3f015411, 0x3f042161, 0x3f0497d0, 0x3f0ae801, 0x3f0c0aa2, 0x3f02cbca, 0x3efb1103,
    0x3f0d4e3e, 0x3f0626f6, 0x3f0bc026, 0x3f0336f8, 0x3f00d678, 0x3ef284e8, 0x3ef9ef16, 0x3eec83ad, 0x3f098e8d, 0x3edba187,
    0x3ed5b0d3, 0x3df7b62a, 0xbeaf939a, 0x3edb9d4a, 0x3ee42e3e, 0x3ef18873, 0x3ef29697, 0x3eb432f8, 0xbd43d537, 0xbec0ed4c,
    0xbf03c637, 0xbef1fd9d, 0xbf041b81, 0xbeed406d, 0xbefb0a1a, 0xbef10677, 0xbf086d85, 0xbef96264, 0xbefbdbc3, 0xbf08cd17,
    0xbf0b3e0f, 0xbefa6aba, 0xbf0c1e2d, 0xbf04a9bd, 0xbf08e83e, 0xbf0a1d00, 0xbefb0e9c, 0xbef91dab, 0xbf0547f2, 0xbefd4721,
    0xbf0003ab, 0xbef2fafa, 0xbf05ba1e, 0xbef82e1f, 0xbefb8c1b, 0xbe9da388, 0xbecb9a78, 0xbf020982, 0xbe3b668a, 0x3e75818e,
    0xbdbf3ca7, 0xbeb2175b, 0x3eb56659, 0x3edc3b6f, 0x3ec28ea6, 0x3efa7406, 0x3ef1b88e, 0x3efe16dc, 0x3efa5d9a, 0x3efa417b,
    0x3efe3552, 0x3f0be24a, 0x3f0606a1, 0x3efd11b6, 0x3f09411a, 0x3f09e9a5, 0x3f01016c, 0x3f0cb0a7, 0x3f03ebd5, 0x3f00c30d,
    0x3efa160d, 0x3f0204f9, 0x3f0160fd, 0x3f0cf195, 0x3ef4d950, 0x3f0236c3, 0x3efc5d27, 0x3eedbacb, 0x3ec2abb4, 0x3f129f68,
    0x3e89e17a, 0x3caa1338, 0xbdc6b388, 0x3ea9e47b, 0x3eaf055f, 0x3e3e592c, 0x3eba847c, 0x3e34b5a6, 0x3ea98844, 0xbf04b108,
    0xbe94983a, 0xbefb01d7, 0xbee9f5f1, 0xbf0a4dd7, 0xbef70176, 0xbf064399, 0xbef6c36f, 0xbf046329, 0xbf06554b, 0xbf03b4a7,
    0xbefba93b, 0xbf00b2eb, 0xbf0114e9, 0xbf095fe0, 0xbf081843, 0xbf021d8d, 0xbef6279e, 0xbf02d2cf, 0xbef448fe, 0xbef88843,
    0xbf01bc6a, 0xbf04d737, 0xbeef413e, 0xbef93cfd, 0xbeed4af9, 0xbeee63f5, 0xbda3d14d, 0xbef24b8c, 0x3db31937, 0xbe3d0987,
    0xbef2bfc1, 0x3e6f926c, 0x3ce670af, 0x3eb6c891, 0x3f07f266, 0x3ef42439, 0x3efe7295, 0x3efd4d08, 0x3f0589c5, 0x3efe6780,
    0x3f09a6bd, 0x3ef97861, 0xac6b6bba, 0x2d9f7358, 0xae8d1916, 0x2f44fbb7, 0xafee342f, 0x3081e565, 0xb10332ce, 0x317965c3,
    0xb1e1a92b, 0x3243efe3, 0xb2a443d1, 0x330595b0, 0xb3538a6b, 0x33a39093, 0xb3f79db7, 0x3437dd1b, 0xb48629a2, 0x34c0b1b7,
    0xb5085e96, 0x353e6e76, 0xb5835128, 0x35b307ed, 0xb5f17da7, 0x36214523, 0xb655708a, 0x368c1009, 0xb6b66b84, 0x36ebf37e,
    0xb717aad9, 0x3741f8f4, 0xb77711b2, 0x379cf175, 0xb7c75461, 0x37fe4633, 0xb825f78a, 0x384d9cc8, 0xb8814978, 0x389c8fbc,
    0xb8bfa986, 0x38e39a82, 0xb907dec5, 0x391e94f4, 0xb9395483, 0x39547592, 0xb973fed1, 0x398a258c, 0xb99cace4, 0x39b0786a,
    0xb9c752d7, 0x39e02fa7, 0xb9fd47ae, 0x3a0f4c4d, 0xba23099e, 0x3a3a06ef, 0xba559dab, 0x3a767b3c, 0xba8f27b9, 0x3aa71ebb,
    0xbac3dd13, 0x3ae6811b, 0xbb08000c, 0x3b20c1fd, 0xbb3ddecd, 0x3b5f83b5, 0xbb821c43, 0x3b934862, 0xbb989b9a, 0x3b479d41,
    0x3c314078, 0xbee90cb1, 0xbefd2190, 0xbef65acd, 0xbefddd7b, 0xbefefbc6, 0xbefdd6c1, 0xbeff31f2, 0xbefc5d11, 0xbeff2f3a,
    0xbefd3c72, 0xbeffb8d5, 0xbefc8e56, 0xbefcbbd4, 0xbee8aa6a, 0xbefefa24, 0xbef6e09e, 0xbef52258, 0xbea0e984, 0xbed215e5,
    0xbef321ef, 0xbea610f3, 0xbec574b2, 0xbee025e2, 0x3ca32805, 0x3ee000b3, 0x3e6a593b, 0x3dbfa1c8, 0x3ea931b4, 0x3ee94562,
    0x3ef3d5bf, 0x3f0183f3, 0x3ef7db9c, 0x3f018b5a, 0x3f0031fb, 0x3f00916d, 0x3eff6ef7, 0x3f00d1ee, 0x3ef0baa9, 0x3f001f0f,
    0x3efd948b, 0x3efef6bd, 0x3ef6b6f2, 0x3efd39e1, 0x3ef91314, 0x3efac75c, 0x3f005bf6, 0x3ef7480c, 0x3eed4b34, 0x3ef9f98d,
    0x3efec94c, 0x3ef02bef, 0x3efcd1fd, 0x3ef292c9, 0x3eeb6710, 0x3ee72144, 0x3ed5e038, 0x3e904984, 0x3cfb59e4, 0xbe0ca16a,
    0xbe9bd7ed, 0xbe014e69, 0x3e30fe55, 0xbeb56357, 0xbefcb819, 0xbee6a49d, 0xbef68dee, 0xbefb8f5a, 0xbefa9090, 0xbefe95b4,
    0xbef8bbd6, 0xbef60889, 0xbefdae22, 0xbef6eddb, 0xbef3d913, 0xbefb5fe8, 0xbefb2267, 0xbef82cc9, 0xbefa81e4, 0xbefaf457,
    0xbef66033, 0xbef971d2, 0xbef194e7, 0xbef4aa00, 0xbefd23cc, 0xbef5bee1, 0xbefd5e72, 0xbeef001a, 0xbeee4ca3, 0xbed5bd82,
    0xbed37351, 0xbed4bab3, 0xbed09f94, 0xbe3366ed, 0xbe578c23, 0x3e5903e0, 0x3ee8c83a, 0x3efce19f, 0x3e795d49, 0x3e564d85,
    0x3f08587e, 0x3eaa7020, 0x3ef73cc0, 0x3ef98635, 0x3f012f3c, 0x3ef19793, 0x3ef414f3, 0x3ef1c60b, 0x3f0015c0, 0x3efadff2,
    0x3eff3a4d, 0x3ef5d49d, 0x3efb5f03, 0x3efa6f60, 0x3efb63ae, 0x3ef91a6d, 0x3effe5f3, 0x3ef3cabf, 0x3efcdb1e, 0x3ef24c06,
    0x3f013856, 0x3ed859ad, 0x3e9b9cbb, 0x3eb56ff2, 0x3f01de4f, 0x3cd80e18, 0x3ef67ff3, 0x3d1c1618, 0x3e647b0a, 0xbc8dff49,
    0xbebf5a07, 0xbe313349, 0xbe5f2f4f, 0xbe9198c9, 0xbeec63f0, 0xbec50601, 0xbf066749, 0xbee63a0e, 0xbefc0237, 0xbede449c,
    0xbefff212, 0xbeeed33d, 0xbefb3f2f, 0xbef7cf30, 0xbefb1b14, 0xbef92035, 0xbef2ab06, 0xbefaa77c, 0xbef48b82, 0xbefd8193,
    0xbef14530, 0xbf00a8bd, 0xbeec1c8d, 0xbefd58d0, 0xbeb43eec, 0xbf2ee0a0, 0xbf2fcbdc, 0xbe8ae662, 0xbea8357d, 0xbea0f73c,
    0xbe8a2978, 0xbee4ed23, 0x3cce19bf, 0x3e234f48, 0x3dc473bc, 0xbe64fc71, 0xbd790e70, 0x3dc4030c, 0x3dba0682, 0x3effb786,
    0x3eea9329, 0x3ef47285, 0x3ed07279, 0x3f02ca28, 0x3eee3ec7, 0x3eff43af, 0x3ef1522a, 0x3ef7b4bf, 0x3ef849a8, 0x3efb8a66,
    0x3ef8e9ae, 0x3ef6b5ef, 0x3ef10e35, 0x3efd5fdf, 0x3ef6fcf6, 0x3ef6488e, 0x3eebd12a, 0x3efc3ca4,
];

fn eingabe() -> Vec<f32> {
    let mut z: u32 = 777;
    (0..512)
        .map(|i| {
            z = z.wrapping_mul(1664525).wrapping_add(1013904223);
            let r = ((z >> 8) as f32 / (1u32 << 24) as f32 - 0.5) * 0.6;
            r + 0.7 * ((i as f32) * 0.09).sin()
        })
        .collect()
}

#[test]
fn a_neu_bleibt_bitgleich() {
    let x = eingabe();
    let mut out = Vec::new();
    let mut s = Saett::neu(FS);
    s.setze(&Einstellung { drive_db: 18.0, ausgang_db: -2.0, mix: 0.8, kurve: Kurve::Hart, decke_db: -3.0, ..Einstellung::default() });
    s.leeren();
    let (mut l, mut r) = (x[..256].to_vec(), x[..256].iter().map(|v| -v * 0.5).collect::<Vec<_>>());
    s.block(&mut l, &mut r);
    out.extend_from_slice(&l);
    out.extend_from_slice(&r);
    let mut s = Saett::neu(FS);
    let (mut l, mut r) = (x[256..].to_vec(), x[256..].to_vec());
    s.block(&mut l[..64], &mut r[..64]);
    s.setze_form(Kurve::Weich, -1.0);
    s.block(&mut l[64..], &mut r[64..]);
    out.extend_from_slice(&l);
    assert_eq!(s.latenz(), LATENZ_NEU);
    for (i, (v, b)) in out.iter().zip(NEU_VORHER.iter()).enumerate() {
        assert_eq!(v.to_bits(), *b, "sample {i}: {v} vs {}", f32::from_bits(*b));
    }
}

// The pool latency fits the core's insert latency limit (INS_LAT_MAX 128) and lies above the 2x object's.
const _: () = assert!(LATENZ_POOL <= 128 && LATENZ_POOL > LATENZ_NEU);

#[test]
fn latenz_pool_ist_konstant_und_klein() {
    println!("LATENZ_POOL = {LATENZ_POOL}");
    for kurve in [Kurve::Tanh, Kurve::Weich, Kurve::Hart] {
        let mut s = Saett::neu_pool(FS);
        s.setze(&Einstellung { kurve, knie_db: 6.0, ..Einstellung::default() });
        assert_eq!(s.latenz(), LATENZ_POOL, "{kurve:?}");
    }
    assert_eq!(Saett::neu_pool(44100.0).latenz(), LATENZ_POOL);
    assert_eq!(Saett::neu_pool(96000.0).latenz(), 0, "from 88 kHz no oversampling, like neu");
}

/// Hann-windowed spectrum magnitude of the last `n` samples.
fn spektrum(y: &[f32]) -> Vec<f64> {
    let n = y.len();
    let mut re: Vec<f64> = y.iter().enumerate().map(|(i, v)| *v as f64 * (0.5 - 0.5 * (2.0 * PI * i as f64 / n as f64).cos())).collect();
    let mut im = vec![0.0; n];
    fft(&mut re, &mut im);
    (0..n / 2).map(|b| (re[b] * re[b] + im[b] * im[b]).sqrt()).collect()
}

/// Largest bin below 20 kHz that is not within 2 bins of a harmonic (or DC), in dB re the fundamental.
fn schlimmster_alias(s: &mut Saett) -> f64 {
    const N: usize = 8192;
    const BIN: usize = 853; // 4998 Hz, a whole number of periods in N: no leakage of the harmonics
    let f = BIN as f64 * FS / N as f64;
    s.setze(&Einstellung { drive_db: 12.0, ausgang_db: 0.0, mix: 1.0, kurve: Kurve::Hart, ..Einstellung::default() });
    s.leeren();
    let x = sinus(f, 0.9, 3 * N);
    let y = lauf(s, &x);
    let m = spektrum(&y[2 * N..]);
    let grund = m[BIN];
    let grenze = (20000.0 / FS * N as f64) as usize;
    let mut schlimmst = f64::MIN;
    for (b, v) in m.iter().enumerate().take(grenze).skip(3) {
        let naechste = ((b as f64 / BIN as f64).round() as usize) * BIN;
        if naechste > 0 && b.abs_diff(naechste) <= 2 {
            continue;
        }
        schlimmst = schlimmst.max(20.0 * (v / grund).log10());
    }
    schlimmst
}

#[test]
fn b_hartes_clippen_bei_8x_aliast_nicht() {
    let zweifach = schlimmster_alias(&mut Saett::neu(FS));
    let achtfach = schlimmster_alias(&mut Saett::neu_pool(FS));
    println!("worst alias bin below 20 kHz, 5 kHz sine, Hard, drive 12 dB: 2x (neu) {zweifach:.1} dB, 8x (neu_pool) {achtfach:.1} dB");
    assert!(achtfach < -75.0, "8x: {achtfach:.1} dB");
}

#[test]
fn c_knie_folgt_der_kennlinie() {
    // drive 0, out 0, ceiling 0: the output is f(x) of D8 delayed by LATENZ_POOL plus half an 8x sample (ADAA1), then the DC
    // blocker. The expected signal goes through the same blocker.
    let (f, amp, n) = (50.0, 1.6, 24000);
    let mut s = Saett::neu_pool(FS);
    s.setze(&Einstellung { drive_db: 0.0, ausgang_db: 0.0, mix: 1.0, kurve: Kurve::Hart, knie_db: 6.0, ..Einstellung::default() });
    s.leeren();
    let x = sinus(f, amp, n);
    let y = lauf(&mut s, &x);
    let k = knie_breite(6.0);
    assert!((k - (1.0 - 10f64.powf(-0.3))).abs() < 1e-15);
    let r = (-2.0 * PI * DC_ECKE_HZ / FS).exp();
    let verz = LATENZ_POOL as f64 + 1.0 / 16.0;
    let (mut xp, mut yp) = (0.0, 0.0);
    let mut fehler: f64 = 0.0;
    let mut im_knie = 0;
    for (i, v) in y.iter().enumerate() {
        let t = i as f64 - verz;
        let e = if t < 0.0 { 0.0 } else { hart_knie(amp * (2.0 * PI * f * t / FS).sin(), k) };
        let ye = e - xp + r * yp;
        xp = e;
        yp = ye;
        if i > 4800 {
            fehler = fehler.max((*v as f64 - ye).abs());
            if e.abs() > 1.0 - k && e.abs() < 0.999 {
                im_knie += 1;
            }
        }
    }
    println!("knee 6 dB: max deviation from D8 {fehler:e}");
    assert!(im_knie > 1000, "the sine runs through the knee");
    assert!(fehler < 1e-3, "{fehler}");
}

#[test]
fn d_tanh_im_pool_ist_neu_verzoegert() {
    let x = rausch(48000);
    let e = Einstellung { mix: 0.7, ..Einstellung::default() };
    let mut a = Saett::neu(FS);
    a.setze(&e);
    a.leeren();
    let mut b = Saett::neu_pool(FS);
    b.setze(&e);
    b.leeren();
    let ya = lauf(&mut a, &x);
    let yb = lauf(&mut b, &x);
    let d = LATENZ_POOL - LATENZ_NEU;
    let mut fehler: f32 = 0.0;
    for i in 0..48000 - d {
        fehler = fehler.max((ya[i] - yb[i + d]).abs());
    }
    for v in &yb[..d] {
        assert!(v.abs() < 1e-6);
    }
    println!("tanh pool vs neu delayed by {d}: {fehler:e}");
    assert!(fehler < 1e-6, "{fehler}");
    assert!(ya.iter().any(|v| v.abs() > 0.1), "not silent");
}

#[test]
fn e_block_allokiert_nicht() {
    let mut s = Saett::neu_pool(FS);
    let (mut l, mut r) = (vec![0f32; 256], vec![0f32; 256]);
    let vor = ANFORDERUNGEN.with(|c| c.get());
    #[allow(clippy::useless_vec)]
    let _positiv = vec![0u8; 16];
    assert!(ANFORDERUNGEN.with(|c| c.get()) > vor, "positive control: the counter sees allocations");
    let start = ANFORDERUNGEN.with(|c| c.get());
    for b in 0..300 {
        for i in 0..256 {
            l[i] = ((b * 256 + i) as f32 * 0.01).sin() * 0.9;
            r[i] = -l[i];
        }
        if b % 20 == 5 {
            let kurve = [Kurve::Tanh, Kurve::Weich, Kurve::Hart][b / 20 % 3];
            s.setze(&Einstellung { kurve, decke_db: -(b as f64) / 20.0, knie_db: (b % 13) as f64, ..Einstellung::default() });
        }
        if b % 7 == 3 {
            s.setze_knie(b as f64 / 30.0);
        }
        s.block(&mut l, &mut r);
        let _ = s.clip_db();
    }
    assert_eq!(ANFORDERUNGEN.with(|c| c.get()), start);
}

#[test]
fn stille_bleibt_null() {
    for kurve in [Kurve::Tanh, Kurve::Weich, Kurve::Hart] {
        let mut s = Saett::neu_pool(FS);
        s.setze(&Einstellung { drive_db: 36.0, kurve, knie_db: 6.0, ..Einstellung::default() });
        let y = lauf(&mut s, &[0f32; 4800]);
        assert!(y.iter().all(|v| *v == 0.0), "{kurve:?}");
    }
}

#[test]
fn mix_null_ist_um_latenz_pool_verzoegert_bitgleich() {
    let mut s = Saett::neu_pool(FS);
    s.setze(&Einstellung { drive_db: 20.0, mix: 0.0, kurve: Kurve::Hart, ..Einstellung::default() });
    s.leeren();
    let x = rausch(4000);
    let y = lauf(&mut s, &x);
    for i in LATENZ_POOL..4000 {
        assert_eq!(y[i].to_bits(), x[i - LATENZ_POOL].to_bits(), "i = {i}");
    }
}

#[test]
fn spitze_bei_drive_36() {
    // The curve ends at c * out; what is left is the filters' overshoot on a near-square wave (measured 1.10).
    let out = 10f64.powf(-6.0 / 20.0);
    let c = 10f64.powf(-6.0 / 20.0);
    let mut s = Saett::neu_pool(FS);
    s.setze(&Einstellung { drive_db: 36.0, ausgang_db: -6.0, kurve: Kurve::Hart, decke_db: -6.0, ..Einstellung::default() });
    s.leeren();
    let y = lauf(&mut s, &sinus(100.0, 0.9, 48000));
    let spitze = y[4800..].iter().fold(0f32, |m, v| m.max(v.abs())) as f64 / (c * out);
    println!("drive 36 dB, Hard: peak {spitze:.3} x c x out");
    assert!(spitze <= 1.12 && spitze > 0.9, "{spitze}");
}

fn groesster_schritt(y: &[f32]) -> f32 {
    y.windows(2).fold(0f32, |m, w| m.max((w[1] - w[0]).abs()))
}

#[test]
fn knie_wechsel_beim_clippen_springt_nicht() {
    let mut s = Saett::neu_pool(FS);
    s.setze(&Einstellung { drive_db: 12.0, ausgang_db: 0.0, kurve: Kurve::Hart, ..Einstellung::default() });
    s.leeren();
    let x = sinus(100.0, 0.8, 48000);
    let (mut l, mut r) = (x.clone(), x.clone());
    let mut y = Vec::new();
    for (i, (cl, cr)) in l.chunks_mut(256).zip(r.chunks_mut(256)).enumerate() {
        if i == 60 {
            s.setze_knie(12.0);
        }
        if i == 120 {
            s.setze_knie(0.0);
        }
        s.block(cl, cr);
        y.extend_from_slice(cl);
    }
    let schritt = groesster_schritt(&y[4800..]);
    println!("knee 0 -> 12 -> 0 dB while clipping: max step {schritt}");
    assert!(schritt < 0.05, "{schritt}");
}

#[test]
fn kurvenwechsel_zwischen_den_pfaden_knackt_nicht() {
    for (von, nach) in [(Kurve::Tanh, Kurve::Hart), (Kurve::Hart, Kurve::Tanh), (Kurve::Weich, Kurve::Hart), (Kurve::Tanh, Kurve::Weich)] {
        let mut s = Saett::neu_pool(FS);
        s.setze(&Einstellung { drive_db: 6.0, ausgang_db: 0.0, kurve: von, ..Einstellung::default() });
        s.leeren();
        let x = sinus(100.0, 0.8, 48000);
        let (mut l, mut r) = (x.clone(), x.clone());
        let mut y = Vec::new();
        for (i, (cl, cr)) in l.chunks_mut(256).zip(r.chunks_mut(256)).enumerate() {
            if i == 60 {
                s.setze_form(nach, 0.0);
            }
            if i == 100 {
                s.setze_form(von, 0.0);
            }
            s.block(cl, cr);
            y.extend_from_slice(cl);
        }
        let schritt = groesster_schritt(&y[4800..]);
        assert!(schritt < 0.05, "{von:?} -> {nach:?}: max step {schritt}");
    }
}

#[test]
fn clip_db_misst_ueber_die_8x_samples() {
    let mut s = Saett::neu_pool(FS);
    s.setze(&Einstellung { drive_db: 12.0, ausgang_db: 0.0, kurve: Kurve::Hart, ..Einstellung::default() });
    s.leeren();
    let _ = lauf(&mut s, &sinus(1000.0, 1.0, 9600));
    let c = s.clip_db() as f64;
    assert!((c - 12.0).abs() < 0.5, "clip_db {c}");
    assert_eq!(s.clip_db(), 0.0, "read-and-reset");
}

#[test]
fn nan_wie_bisher_leeren_heilt() {
    let mut s = Saett::neu_pool(FS);
    s.setze(&Einstellung { kurve: Kurve::Hart, knie_db: 3.0, ..Einstellung::default() });
    let mut x = sinus(440.0, 0.5, 2048);
    x[100] = f32::NAN;
    let y = lauf(&mut s, &x);
    assert!(y.iter().any(|v| v.is_nan()), "a NaN propagates as in neu (the core's guard empties the stage)");
    s.leeren();
    let y = lauf(&mut s, &sinus(440.0, 0.5, 2048));
    assert!(y.iter().all(|v| v.is_finite()));
}

#[test]
fn knie_null_ist_der_harte_clip() {
    let x = rausch(9600);
    let mut a = Saett::neu_pool(FS);
    a.setze(&Einstellung { drive_db: 18.0, kurve: Kurve::Hart, ..Einstellung::default() });
    a.leeren();
    let mut b = Saett::neu_pool(FS);
    b.setze(&Einstellung { drive_db: 18.0, kurve: Kurve::Hart, knie_db: 0.0, ..Einstellung::default() });
    b.setze_knie(f64::NAN);
    b.leeren();
    let (ya, yb) = (lauf(&mut a, &x), lauf(&mut b, &x));
    assert!(ya.iter().zip(&yb).all(|(p, q)| p.to_bits() == q.to_bits()));
    assert_eq!(knie_breite(0.0), 0.0);
    assert_eq!(knie_breite(40.0), 0.75);
}
