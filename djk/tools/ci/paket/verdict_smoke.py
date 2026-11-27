# verdict_smoke.py RESULT_DIR HOST_SHA256 VERSION: judges the "K key=value" lines of guest.log, writes smoke.json, prints the verdict.
import json, sys, re
res, hostsha, version = sys.argv[1:4]
kv = {}
for line in open(f"{res}/guest.log", errors="replace"):
    m = re.match(r"K (\w+)=(.*)$", line.rstrip("\n"))
    if m: kv[m.group(1)] = m.group(2)
def num(k):
    try: return float(kv[k])
    except Exception: return None
tools = num("mcp_tools")
skills = num("mcp_skills")
checks = [
    ("deb copied unchanged (sha256 host = guest)", kv.get("deb_sha256") == hostsha),
    ("apt install rc 0", kv.get("install_rc") == "0"),
    ("installed version equals the package version", kv.get("installed_version") == version),
    ("cypher-dj start rc 0", kv.get("start_rc") == "0"),
    ("web interface answers 200", kv.get("http_code") == "200"),
    ("no failed cypherdj units, at least 8 active", num("units_failed") == 0 and (num("units_active") or 0) >= 8),
    ("cypher-dj demo rc 0", kv.get("demo_rc") == "0"),
    ("demo: master max above -30 dBFS", num("master_max_db") is not None and num("master_max_db") > -30),
    ("sound: Strudel (bd*4, strom 1) peak above -40 dBFS on the sink", num("strudel_peak_db") is not None and num("strudel_peak_db") > -40),
    ("sound: RB-338 (strom 2) peak above -40 dBFS on the sink", num("rb338_peak_db") is not None and num("rb338_peak_db") > -40),
    ("sound: Baukasten instrument bass-acid (strom 5) peak above -40 dBFS on the sink", num("baukasten_peak_db") is not None and num("baukasten_peak_db") > -40),
    ("sound: silence before and after stop (all three below -60 dBFS)", all((num(k) is not None and num(k) < -60) for k in ("sound_silence_before_db", "strudel_after_peak_db", "rb338_after_peak_db", "baukasten_after_peak_db", "modular_melodie_after_peak_db"))),
    ("tour: only the expected freeze step is not 2xx", kv.get("tour_failed_steps", "x") in ("", "freeze:400")),
    ("tour: at least 13 steps ran", (num("tour_steps") or 0) >= 13),
    ("no file in /opt/cypher-dj newer than the install (after tour)", num("opt_newer") == 0),
    ("no file in /opt/cypher-dj owned by a user", num("opt_not_root") == 0),
    ("no EACCES/EROFS in the user journal", num("journal_eacces") == 0),
    ("mcp probe rc 0 with at least 100 tools", kv.get("mcp_rc") == "0" and tools is not None and tools >= 100),
    ("mcp probe lists the shipped skills (2026-07-28)", skills is not None and skills >= 2),
    ("no file in /opt/cypher-dj newer than the install (after mcp)", num("opt_newer_after_mcp") == 0),
    ("cypher-dj stop rc 0", kv.get("stop_rc") == "0"),
]
out = {"version": version, "checks": [{"name": n, "pass": bool(p)} for n, p in checks], "values": kv,
       "pass": all(p for _, p in checks)}
json.dump(out, open(f"{res}/smoke.json", "w"), indent=2)
for n, p in checks: print(("PASS  " if p else "FAIL  ") + n)
print("RESULT " + ("PASS" if out["pass"] else "FAIL"))
for k in ("strudel_peak_db", "strudel_rms_db", "rb338_peak_db", "rb338_rms_db", "baukasten_peak_db", "baukasten_rms_db", "modular_melodie_peak_db", "install_s", "install_download_mib", "start_s", "master_max_db", "tour_steps", "tour_2xx", "tour_failed_steps", "mcp_tools", "mcp_skills", "opt_files", "opt_mb", "rt_probe"):
    print(f"  {k} = {kv.get(k)}")
