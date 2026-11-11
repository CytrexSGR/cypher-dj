/* Test stub: aborts in its module entry, like a plugin that crashes while loading. */
#include <stdlib.h>
int ModuleEntry(void *h) { (void)h; abort(); return 1; }
int ModuleExit(void) { return 1; }
void *GetPluginFactory(void) { return 0; }
