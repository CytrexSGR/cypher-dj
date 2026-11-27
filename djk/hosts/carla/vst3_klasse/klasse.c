/*
 * klasse.c: a one-class VST3 module (Linux) in front of a real multi-class VST3 module.
 *
 * Carla 2.5.8 loads only the first class of a VST3 bundle. This module shows exactly one class of the real module:
 * its bundle holds Contents/Resources/klasse.txt with line 1 the absolute path of the real module .so and line 2 the
 * class index k. k counts the classes with category "Audio Module Class" and cardinality kManyInstances, in factory
 * order, which is the position carla-discovery-native lists them in (it skips every other class).
 *
 * No SDK is used. The binary interface is taken from these primary sources (Carla 2.5.8 source tree):
 *   - source/includes/travesty/base.h      v3_funknown vtable, V3_ID byte order for non-COM (Linux), result codes
 *   - source/includes/travesty/factory.h   v3_plugin_factory / _2 / _3 vtables, v3_class_info layout, factory iids
 *   - source/includes/vst3sdk/pluginterfaces/base/ipluginbase.h and funknown.h  (the same iids, cross-checked)
 *   - source/utils/CarlaVst3Utils.hpp      entry points ModuleEntry(void*), ModuleExit(void), GetPluginFactory
 * On Linux the SDK is not COM compatible: a TUID is the four 32-bit words of DECLARE_CLASS_IID, each big-endian.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <limits.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

typedef int32_t tresult;
typedef uint8_t tuid[16];

/* travesty/base.h, non-COM enum */
enum { K_NO_INTERFACE = -1, K_RESULT_OK = 0, K_RESULT_FALSE = 1, K_INVALID_ARGUMENT = 2, K_NOT_IMPLEMENTED = 3 };

#define UID(a, b, c, d) { \
    ((a) >> 24) & 0xFF, ((a) >> 16) & 0xFF, ((a) >> 8) & 0xFF, (a) & 0xFF, \
    ((b) >> 24) & 0xFF, ((b) >> 16) & 0xFF, ((b) >> 8) & 0xFF, (b) & 0xFF, \
    ((c) >> 24) & 0xFF, ((c) >> 16) & 0xFF, ((c) >> 8) & 0xFF, (c) & 0xFF, \
    ((d) >> 24) & 0xFF, ((d) >> 16) & 0xFF, ((d) >> 8) & 0xFF, (d) & 0xFF }

/* FUnknown: funknown.h DECLARE_CLASS_IID (FUnknown, ...), travesty v3_funknown_iid */
static const tuid IID_FUNKNOWN = UID(0x00000000u, 0x00000000u, 0xC0000000u, 0x00000046u);
/* IPluginFactory: ipluginbase.h:179, travesty v3_plugin_factory_iid */
static const tuid IID_FACTORY = UID(0x7A4D811Cu, 0x52114A1Fu, 0xAED9D2EEu, 0x0B43BF9Fu);
/* IPluginFactory2: ipluginbase.h:264, travesty v3_plugin_factory_2_iid */
static const tuid IID_FACTORY2 = UID(0x0007B650u, 0xF24B4C0Bu, 0xA464EDB9u, 0xF00B2ABBu);
/* IPluginFactory3: ipluginbase.h:364, travesty v3_plugin_factory_3_iid */
static const tuid IID_FACTORY3 = UID(0x4555A2ABu, 0xC1234E57u, 0x9B122910u, 0x36878931u);

/* travesty/factory.h v3_class_info (PClassInfo): only read to count the audio classes */
struct class_info {
    tuid cid;
    int32_t cardinality;
    char category[32];
    char name[64];
};

#define MANY_INSTANCES 0x7FFFFFFF

/* One flat vtable for IPluginFactory3: FUnknown (3), IPluginFactory (4), IPluginFactory2 (1), IPluginFactory3 (2).
 * Single inheritance, so a real IPluginFactory2/3 object has exactly this prefix. Slot order from travesty/factory.h. */
struct factory_vt {
    tresult (*query_interface)(void *self, const tuid iid, void **obj);
    uint32_t (*add_ref)(void *self);
    uint32_t (*release)(void *self);
    tresult (*get_factory_info)(void *self, void *info);
    int32_t (*count_classes)(void *self);
    tresult (*get_class_info)(void *self, int32_t index, void *info);
    tresult (*create_instance)(void *self, const tuid cid, const tuid iid, void **obj);
    tresult (*get_class_info2)(void *self, int32_t index, void *info);
    tresult (*get_class_info_unicode)(void *self, int32_t index, void *info);
    tresult (*set_host_context)(void *self, void *context);
};

typedef struct { const struct factory_vt *vt; } factory;

/* the SDK declares bool ModuleEntry (void*) and bool ModuleExit (void): only the low byte of the result is defined */
typedef bool (*entry_fn)(void *);
typedef bool (*exit_fn)(void);
typedef factory *(*get_fn)(void);

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static void *real_lib;
static exit_fn real_exit;
static factory *real1, *real2, *real3;
static int32_t real_index = -1; /* factory index of class k, -1 when not resolved */
static int entries;

static int same(const tuid a, const tuid b) { return memcmp(a, b, sizeof(tuid)) == 0; }

static tresult p_query_interface(void *self, const tuid iid, void **obj)
{
    if (obj == NULL)
        return K_INVALID_ARGUMENT;
    if (same(iid, IID_FUNKNOWN) || same(iid, IID_FACTORY) || (real2 && same(iid, IID_FACTORY2))
        || (real3 && same(iid, IID_FACTORY3))) {
        *obj = self;
        return K_RESULT_OK;
    }
    *obj = NULL;
    return K_NO_INTERFACE;
}

/* the proxy is static and lives as long as the module: reference counting is a no-op */
static uint32_t p_add_ref(void *self) { (void)self; return 1; }
static uint32_t p_release(void *self) { (void)self; return 1; }

static tresult p_get_factory_info(void *self, void *info)
{
    (void)self;
    return real1 ? real1->vt->get_factory_info(real1, info) : K_NOT_IMPLEMENTED;
}

static int32_t p_count_classes(void *self) { (void)self; return real_index >= 0 ? 1 : 0; }

static tresult p_get_class_info(void *self, int32_t index, void *info)
{
    (void)self;
    if (index != 0 || real_index < 0)
        return K_INVALID_ARGUMENT;
    return real1->vt->get_class_info(real1, real_index, info);
}

/* any class id goes through unchanged: the component asks for its edit controller class by its own id */
static tresult p_create_instance(void *self, const tuid cid, const tuid iid, void **obj)
{
    (void)self;
    if (real1 == NULL) {
        if (obj)
            *obj = NULL;
        return K_NOT_IMPLEMENTED;
    }
    return real1->vt->create_instance(real1, cid, iid, obj);
}

static tresult p_get_class_info2(void *self, int32_t index, void *info)
{
    (void)self;
    if (index != 0 || real_index < 0 || real2 == NULL)
        return K_INVALID_ARGUMENT;
    return real2->vt->get_class_info2(real2, real_index, info);
}

static tresult p_get_class_info_unicode(void *self, int32_t index, void *info)
{
    (void)self;
    if (index != 0 || real_index < 0 || real3 == NULL)
        return K_INVALID_ARGUMENT;
    return real3->vt->get_class_info_unicode(real3, real_index, info);
}

static tresult p_set_host_context(void *self, void *context)
{
    (void)self;
    return real3 ? real3->vt->set_host_context(real3, context) : K_NOT_IMPLEMENTED;
}

static const struct factory_vt proxy_vt = {
    p_query_interface, p_add_ref, p_release,
    p_get_factory_info, p_count_classes, p_get_class_info, p_create_instance,
    p_get_class_info2,
    p_get_class_info_unicode, p_set_host_context,
};

static factory proxy = { &proxy_vt };

static void warn(const char *what, const char *detail)
{
    fprintf(stderr, "vst3_klasse: %s%s%s\n", what, detail ? ": " : "", detail ? detail : "");
}

/* reads <own dir>/../Resources/klasse.txt into path and index; 0 on success */
static int read_config(char *path, size_t len, long *index)
{
    Dl_info info;
    if (dladdr((void *)&read_config, &info) == 0 || info.dli_fname == NULL)
        return -1;
    char cfg[PATH_MAX];
    const char *slash = strrchr(info.dli_fname, '/');
    int dir = slash ? (int)(slash - info.dli_fname) : 1;
    const char *base = slash ? info.dli_fname : ".";
    if (snprintf(cfg, sizeof cfg, "%.*s/../Resources/klasse.txt", dir, base) >= (int)sizeof cfg)
        return -1;
    FILE *f = fopen(cfg, "r");
    if (f == NULL) {
        warn("cannot open", cfg);
        return -1;
    }
    int ok = fgets(path, (int)len, f) != NULL && fscanf(f, "%ld", index) == 1;
    fclose(f);
    if (!ok || *index < 0)
        return -1;
    path[strcspn(path, "\r\n")] = '\0';
    return path[0] == '/' ? 0 : -1;
}

static void resolve_index(long k)
{
    int32_t n = real1->vt->count_classes(real1);
    long seen = 0;
    for (int32_t i = 0; i < n; ++i) {
        struct class_info ci;
        memset(&ci, 0, sizeof ci);
        if (real1->vt->get_class_info(real1, i, &ci) != K_RESULT_OK)
            continue;
        if (ci.cardinality != MANY_INSTANCES || strncmp(ci.category, "Audio Module Class", sizeof ci.category) != 0)
            continue;
        if (seen++ == k) {
            real_index = i;
            return;
        }
    }
    warn("class index beyond the audio classes of the real module", NULL);
}

static void release_real(void)
{
    if (real3)
        real3->vt->release(real3);
    if (real2)
        real2->vt->release(real2);
    if (real1)
        real1->vt->release(real1);
    real1 = real2 = real3 = NULL;
    real_index = -1;
}

static int open_real(void)
{
    char path[PATH_MAX];
    long k = -1;
    if (read_config(path, sizeof path, &k) != 0) {
        warn("klasse.txt missing or malformed", NULL);
        return 0;
    }
    void *lib = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (lib == NULL) {
        warn("dlopen failed", dlerror());
        return 0;
    }
    entry_fn entry = (entry_fn)dlsym(lib, "ModuleEntry");
    exit_fn exit_ = (exit_fn)dlsym(lib, "ModuleExit");
    get_fn get = (get_fn)dlsym(lib, "GetPluginFactory");
    if (entry == NULL || exit_ == NULL || get == NULL) {
        warn("not a VST3 module", path);
        dlclose(lib);
        return 0;
    }
    if (!entry(lib)) {
        warn("ModuleEntry of the real module failed", path);
        dlclose(lib);
        return 0;
    }
    real_lib = lib;
    real_exit = exit_;
    real1 = get();
    if (real1 == NULL) {
        warn("real module has no factory", path);
        return 1;
    }
    void *o = NULL;
    if (real1->vt->query_interface(real1, IID_FACTORY2, &o) == K_RESULT_OK && o != NULL) {
        real2 = (factory *)o;
        o = NULL;
        if (real2->vt->query_interface(real2, IID_FACTORY3, &o) == K_RESULT_OK && o != NULL)
            real3 = (factory *)o;
    }
    resolve_index(k);
    return 1;
}

static void close_real(void)
{
    release_real();
    if (real_exit)
        real_exit();
    if (real_lib)
        dlclose(real_lib);
    real_lib = NULL;
    real_exit = NULL;
}

__attribute__((visibility("default"))) bool ModuleEntry(void *handle)
{
    (void)handle;
    pthread_mutex_lock(&lock);
    int ok = 1;
    if (entries == 0)
        ok = open_real();
    if (ok)
        ++entries;
    pthread_mutex_unlock(&lock);
    return ok != 0;
}

__attribute__((visibility("default"))) bool ModuleExit(void)
{
    pthread_mutex_lock(&lock);
    if (entries > 0 && --entries == 0)
        close_real();
    pthread_mutex_unlock(&lock);
    return true;
}

__attribute__((visibility("default"))) factory *GetPluginFactory(void)
{
    pthread_mutex_lock(&lock);
    factory *f = real1 ? &proxy : NULL;
    pthread_mutex_unlock(&lock);
    return f;
}
