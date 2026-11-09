import numpy as np, json, subprocess, matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
SR=48000; N=65536
def proto(art,g,q):
    a=10**(g/40);sa=np.sqrt(a)
    return {'Bell':([1,a/q,1],[1,1/(a*q),1]),'Low Shelf':([a,a*sa/q,a*a],[a,sa/q,1]),'High Shelf':([a*a,a*sa/q,a],[1,sa/q,a]),
            'HP':([1,0,0],[1,1/q,1]),'LP':([0,0,1],[1,1/q,1])}[art]
def adb(n,d,x): s=1j*x; return 20*np.log10(abs(np.polyval(n,s)/np.polyval(d,s)))
def soll(baender,f):
    t=np.zeros_like(f)
    for b in baender:
        x=f/b["f"]
        if b["typ"] in ("Low Cut","High Cut"):
            a="HP" if b["typ"]=="Low Cut" else "LP"; n=b.get("s",12)//12
            if n==1: t+=adb(*proto(a,0,b["q"]),x)
            else:
                for i in range(n):
                    q=1/(2*np.cos(np.pi*(2*i+1)/(4*n)))*(b["q"]/0.70710678 if i==n-1 else 1); t+=adb(*proto(a,0,q),x)
        else: t+=adb(*proto(b["typ"],b["g"],b["q"]),x)
    return t
def mess(name):
    l=np.load(f"carla/{name}.npy"); i=int(np.argmax(np.abs(l)>1e-6))-200
    h=l[i:i+N]/0.5; H=np.fft.rfft(h); f=np.fft.rfftfreq(N,1/SR); return f,20*np.log10(abs(H)+1e-15)
faelle={"neutral":[],"glocke16k":[dict(typ="Bell",f=16000,g=12,q=1.425)],
 "mix":[dict(typ="Low Cut",f=40,q=0.707,s=48),dict(typ="Low Shelf",f=100,g=3,q=0.707),dict(typ="Bell",f=250,g=-4,q=2),
        dict(typ="Bell",f=3000,g=5,q=1),dict(typ="High Shelf",f=12000,g=4,q=0.707),dict(typ="High Cut",f=19000,q=0.707,s=24)]}
# a-eq bei 48 kHz, gleiche Glocke (bw=1 ≙ Q 1,425 gemessen)
x=np.frombuffer(subprocess.run(["./ir_aeq","48000","2","16000","12","1",str(N)],capture_output=True).stdout,np.float32)
fa=np.fft.rfftfreq(N,1/SR); aeq=20*np.log10(abs(np.fft.rfft(x.astype(float))))
fig,ax=plt.subplots(1,3,figsize=(18,5.5)); ber={}
for k,(name,b) in enumerate(faelle.items()):
    f,m=mess(name); sel=(f>=20)&(f<=20000); s=soll(b,f[sel]) if b else np.zeros(sel.sum())
    gilt=s>-24; d=np.abs(m[sel]-s)[gilt]; ber[name]=dict(max_abw_db=round(float(d.max()),3),bei_hz=round(float(f[sel][gilt][d.argmax()]),0))
    a=ax[k]; a.semilogx(f[sel],s,"k--",lw=1.2,label="Soll (analog)"); a.semilogx(f[sel],m[sel],"C0",lw=2.2,alpha=.85,label="Cypher EQ in Carla")
    if name=="glocke16k":
        sa=(fa>=20)&(fa<=20000); a.semilogx(fa[sa],aeq[sa],"C3",lw=1.8,label="a-eq (Ardour)")
        ber[name]["a_eq_bei_20k"]=round(float(np.interp(20000,fa,aeq)),2); ber[name]["cypher_bei_20k"]=round(float(np.interp(20000,f,m)),2); ber[name]["soll_bei_20k"]=round(float(soll(b,np.array([20000.]))[0]),2)
    a.set(title={"neutral":"Neutral (alle Bänder aus)","glocke16k":"Glocke +12 dB @ 16 kHz","mix":"Mischkurve, 6 Bänder"}[name]+f"  |  max. Abw. {ber[name]['max_abw_db']} dB",xlim=(20,20000),xlabel="Hz",ylabel="dB")
    if name=="neutral": a.set_ylim(-0.1,0.1)
    a.grid(1,"both",alpha=.3); a.legend(loc="lower left" if name!="mix" else "lower center")
plt.suptitle("Cypher EQ 0.1 · gemessen als VST3 in Carla 2.5.8, 48 kHz, Impulsantwort",y=1.0); plt.tight_layout(); plt.savefig("cypher_eq_carla.png",dpi=105)
print(json.dumps(ber,indent=1))
