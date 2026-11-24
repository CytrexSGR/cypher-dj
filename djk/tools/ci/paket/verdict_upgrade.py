# verdict_upgrade.py RESULT_DIR OLD_VERSION NEW_VERSION: judges the "K key=value" lines of guest.log, writes upgrade.json, prints the verdict.
import json, sys, re
res, oldv, version = sys.argv[1:4]
kv = {}
for line in open(f"{res}/guest.log", errors="replace"):
    m = re.match(r"K (\w+)=(.*)$", line.rstrip("\n"))
    if m: kv[m.group(1)] = m.group(2)
def num(k):
    try: return float(kv[k])
    except Exception: return None
checks = [
    ("old package installs, version " + oldv, kv.get("old_install_rc") == "0" and kv.get("old_version") == oldv),
    ("studio starts with the old package", kv.get("pre_start_rc") == "0"),
    ("preset saved before the upgrade (HTTP answer ok, readable)", kv.get("preset_save_http_ok") == "1" and kv.get("preset_read_before_http") == "200"),
    ("project upgrade-probe with a real take recorded (upgrade_gast vorher rc 0)", kv.get("vorher_rc") == "0"),
    ("new package installs over the old one, version " + version, kv.get("new_install_rc") == "0" and kv.get("new_version") == version and kv.get("compare_gt") == "1"),
    ("nothing in /opt/cypher-dj owned by a user", num("opt_not_root") == 0),
    ("preset files byte-identical before and after (sha256 of the preset file(s) found by name below the home folder, wherever they live)", kv.get("preset_files_identical") == "1"),
    ("project model of upgrade-probe unchanged apart from wiedergabe_rev (playback counter)", kv.get("project_model_equal") == "1"),
    ("upgrade rule of upgrade_vergleich.py (upgrade_gast nachher rc 0: project opens, take identical, demo above -30 dBFS, no user file lost or changed except program-owned state); see snapshots/notes-nachher.txt", kv.get("nachher_rc") == "0"),
    ("services come back: start rc 0, web interface 200", kv.get("post_start_rc") == "0" and kv.get("post_http") == "200"),
    ("services come back: at least 8 cypherdj units active, none failed", (num("post_units_active") or 0) >= 8 and num("post_units_failed") == 0),
    ("preset still there: GET 200, identical to before, found by search", kv.get("preset_read_after_http") == "200" and kv.get("preset_values_equal") == "1" and (num("preset_found_by_search") or 0) >= 1),
    ("project opens (HTTP 200) and holds its take clip", kv.get("project_opens_http") == "200" and (num("project_has_take") or 0) >= 1),
    ("user journal since the upgrade: no EACCES/EROFS", num("journal_eacces") == 0),
    ("user journal since the upgrade: no error from a cypherdj unit", num("journal_unit_errors") == 0),
    ("cypher-dj stop rc 0", kv.get("stop_rc") == "0"),
]
out = {"old": oldv, "new": version, "checks": [{"name": n, "pass": bool(p)} for n, p in checks], "values": kv, "pass": all(p for _, p in checks)}
json.dump(out, open(f"{res}/upgrade.json", "w"), indent=2)
for n, p in checks: print(("PASS  " if p else "FAIL  ") + n)
print("RESULT " + ("PASS" if out["pass"] else "FAIL"))
for k in ("old_version", "new_version", "preset_id", "post_units_active", "post_units_failed", "journal_eacces", "journal_unit_errors", "project_has_take"):
    print(f"  {k} = {kv.get(k)}")
