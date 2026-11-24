#!/usr/bin/env bash
# release_veroeffentlichen.sh: publishes the release of a tag atomically, so a visible release always has both assets.
#
# Environment: API (…/api/v1/repos/OWNER/REPO), AUTH (a full header line, "Authorization: token …"), TAG, V (package version),
# DEB (the .deb; DEB.sha256 next to it), BODY (the changelog section file), WORK (scratch folder).
# Steps: refuse when a published release for the tag exists; delete a draft left by a failed earlier run; create the release as a DRAFT;
# upload the .deb and its sha256; check both sizes through the API and, where the token may download, the sha256 of the download; only then publish (draft off).
# On any failure the draft is deleted again; nothing visible is left behind. Exit 0 published, 1 failed.
set -u
: "${API:?}" "${AUTH:?}" "${TAG:?}" "${V:?}" "${DEB:?}" "${BODY:?}" "${WORK:?}"
mkdir -p "$WORK"
py() { python3 -I -c "$@"; }
# downloads go through the web route (attachments/<uuid> for a draft), which takes a personal token as Basic oauth2:<token>. The job token of
# a run is refused there in both forms: a private repo answers 404 "Not found." (paket runs of v0.4.0-rc2 and v0.4.0-rc3, both stopped here
# after a green smoke test). A refused download is therefore not a failure: the size from the API stands, the content check is skipped and said so.
case "$AUTH" in "Authorization: token "?*) ;; *) echo "release_veroeffentlichen: AUTH must be 'Authorization: token <token>'" >&2; exit 1;; esac
DLAUTH="Authorization: Basic $(printf 'oauth2:%s' "${AUTH#Authorization: token }" | base64 -w0)"
id=""; fertig=0
aufraeumen() {
  [ "$fertig" = 1 ] && return 0
  if [ -n "$id" ]; then
    code=$(curl -s -o /dev/null -w '%{http_code}' -H "$AUTH" -X DELETE "$API/releases/$id")
    echo "release_veroeffentlichen: draft $id deleted again (HTTP $code), nothing is left visible" >&2
  fi
}
trap aufraeumen EXIT
nein() { echo "release_veroeffentlichen: $*" >&2; exit 1; }

# 1. a published release for the tag blocks; the answer must be understood (404 = none, 200 = look at draft)
code=$(curl -s -o "$WORK/rel-get.json" -w '%{http_code}' -H "$AUTH" "$API/releases/tags/$TAG")
case "$code" in
  404) ;;
  200) [ "$(py 'import json,sys; print(str(json.load(open(sys.argv[1])).get("draft", False)).lower())' "$WORK/rel-get.json")" = true ] \
         || nein "a published release for $TAG already exists, not touching it" ;;
  *)   nein "cannot read the release of $TAG (HTTP $code)" ;;
esac
# 2. drafts of this tag from a failed run are removed (a rerun starts clean)
curl -s -o "$WORK/drafts.json" -w '' -H "$AUTH" "$API/releases?draft=true&limit=50" || true
for old in $(py 'import json,sys
try: d = json.load(open(sys.argv[1]))
except Exception: d = []
print(" ".join(str(r["id"]) for r in d if r.get("tag_name") == sys.argv[2] and r.get("draft")))' "$WORK/drafts.json" "$TAG"); do
  curl -s -o /dev/null -H "$AUTH" -X DELETE "$API/releases/$old"; echo "release_veroeffentlichen: removed the leftover draft $old of an earlier run"
done

# 3. create as draft
pre=false; case "$V" in *-*|*~*) pre=true;; esac
py 'import json,sys; print(json.dumps({"tag_name":sys.argv[1],"name":"cypher-dj "+sys.argv[2],"body":open(sys.argv[3],encoding="utf-8").read(),"prerelease":sys.argv[4]=="true","draft":True}))' \
  "$TAG" "$V" "$BODY" "$pre" > "$WORK/rel.json"
code=$(curl -s -o "$WORK/rel.out" -w '%{http_code}' -H "$AUTH" -H 'Content-Type: application/json' -X POST -d @"$WORK/rel.json" "$API/releases")
if [ "$code" != 201 ]; then
  echo "release_veroeffentlichen: creating the release failed with HTTP $code: $(head -c 300 "$WORK/rel.out")" >&2
  nein "the job token needs the repository write scope (Actions token permissions of the repo); no personal token is used here"
fi
id=$(py 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$WORK/rel.out") || nein "no release id in the answer"

# 4. upload
for f in "$DEB" "$DEB.sha256"; do
  code=$(curl -s -o "$WORK/asset.out" -w '%{http_code}' -H "$AUTH" -F "attachment=@$f" "$API/releases/$id/assets?name=$(basename "$f")")
  [ "$code" = 201 ] || nein "uploading $(basename "$f") failed with HTTP $code: $(head -c 300 "$WORK/asset.out")"
done

# 5. verify: both assets are listed with the right size; where the token may download, they download to the same sha256
ohne_inhalt=0
code=$(curl -s -o "$WORK/rel-check.json" -w '%{http_code}' -H "$AUTH" "$API/releases/$id")
[ "$code" = 200 ] || nein "cannot read the draft back (HTTP $code)"
for f in "$DEB" "$DEB.sha256"; do
  n=$(basename "$f")
  url=$(py 'import json,sys
r = json.load(open(sys.argv[1]))
for a in r.get("assets") or []:
    if a.get("name") == sys.argv[2] and a.get("size") == int(sys.argv[3]): print(a.get("browser_download_url", "")); break' "$WORK/rel-check.json" "$n" "$(stat -c %s "$f")")
  [ -n "$url" ] || nein "asset $n is missing from the draft or has the wrong size (expected $(stat -c %s "$f") bytes)"
  code=$(curl -s -L -o "$WORK/dl-$n" -w '%{http_code}' -H "$DLAUTH" "$url") || nein "downloading $n back failed"
  case "$code" in
    200) [ "$(sha256sum "$WORK/dl-$n" | cut -d' ' -f1)" = "$(sha256sum "$f" | cut -d' ' -f1)" ] || nein "asset $n differs from the local file after the download (sha256)" ;;
    401|403|404) ohne_inhalt=1; echo "release_veroeffentlichen: the download route refuses this token for $n (HTTP $code); size checked through the API, content check skipped" ;;
    *) nein "downloading $n back failed with HTTP $code" ;;
  esac
done
if [ "$ohne_inhalt" = 1 ]; then echo "release_veroeffentlichen: both assets verified by size on the draft"
else echo "release_veroeffentlichen: both assets verified (size, sha256) on the draft"; fi

# 6. publish
code=$(curl -s -o "$WORK/pub.out" -w '%{http_code}' -H "$AUTH" -H 'Content-Type: application/json' -X PATCH -d '{"draft":false}' "$API/releases/$id")
[ "$code" = 200 ] || nein "publishing the draft failed with HTTP $code: $(head -c 300 "$WORK/pub.out")"
fertig=1
echo "release_veroeffentlichen: release $TAG published (id $id)"
