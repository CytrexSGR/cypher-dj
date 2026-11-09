// Minimaler LV2-Host: Impulsantwort von a-eq (ein Band aktiv). argv: sr band(1-4) freq gain bw n
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <lv2/core/lv2.h>
#include <lv2/urid/urid.h>
#include <lv2/options/options.h>
static char *uris[256]; static int nur=0;
static LV2_URID map(LV2_URID_Map_Handle h,const char*u){for(int i=0;i<nur;i++)if(!strcmp(uris[i],u))return i+1;uris[nur]=strdup(u);return ++nur;}
int main(int c,char**v){
  double sr=atof(v[1]); int band=atoi(v[2]); float fr=atof(v[3]),g=atof(v[4]),bw=atof(v[5]); int n=atoi(v[6]);
  void*so=dlopen("/usr/lib/lv2/a-eq.lv2/a-eq.so",RTLD_NOW); if(!so){fprintf(stderr,"%s\n",dlerror());return 1;}
  LV2_Descriptor_Function df=(LV2_Descriptor_Function)dlsym(so,"lv2_descriptor");
  const LV2_Descriptor*d=NULL; for(int i=0;(d=df(i));i++) if(!strcmp(d->URI,"urn:ardour:a-eq"))break;
  LV2_URID_Map um={NULL,map}; LV2_Options_Option opt[1]; memset(opt,0,sizeof opt);
  LV2_Feature fm={LV2_URID__map,&um}, fo={LV2_OPTIONS__options,opt}; const LV2_Feature*fs[]={&fm,&fo,NULL};
  LV2_Handle h=d->instantiate(d,sr,"/usr/lib/lv2/a-eq.lv2/",fs); if(!h){fprintf(stderr,"inst fail\n");return 1;}
  float ctl[24]={160,0, 300,0,1, 1000,0,1, 2500,0,1, 6000,0,1, 9000,0, 0, 1,1,1,1,1,1, 1};
  int b=2+(band-1)*3; ctl[b]=fr; ctl[b+1]=g; ctl[b+2]=bw;
  for(int i=0;i<24;i++) d->connect_port(h,i,&ctl[i]);
  float*in=calloc(n,4),*out=calloc(n,4);
  d->connect_port(h,24,in); d->connect_port(h,25,out);
  if(d->activate)d->activate(h);
  for(int k=0;k<200;k++) d->run(h,256==0?1:256); // Glättung einschwingen lassen (Puffer n>=256)
  memset(in,0,n*4); for(int k=0;k<50;k++) d->run(h,n); // Stille, Zustand leeren
  in[0]=1; d->run(h,n);
  fwrite(out,4,n,stdout); return 0;
}
