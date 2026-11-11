/* Test stub: sleeps forever in its module entry, like a plugin that hangs while loading. */
#include <unistd.h>
int ModuleEntry(void *h) { (void)h; for (;;) sleep(1000); return 1; }
int ModuleExit(void) { return 1; }
void *GetPluginFactory(void) { return 0; }
