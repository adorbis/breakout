#!/usr/bin/env bash
# Tests for scripts/breakout-cd. Production is never touched:
#  * control flow (deploy / bootstrap failure / rollback / stop / tick) runs with stubbed docker stages
#    and a temporary state dir;
#  * compose policy, identity check, notifier and migration rehearsal run for real against
#    throwaway inputs (a local mock HTTP server, ephemeral containers).
# Usage: scripts/test/breakout-cd.test.sh [<image-tag-for-rehearsal>]
set -uo pipefail
HERE=$(cd "$(dirname "$0")/.." && pwd)
SCRIPT="$HERE/breakout-cd"
REAL_TAG=${1:-}
PASS=0 FAILS=0
ok()   { echo "ok   - $1"; PASS=$((PASS + 1)); }
bad()  { echo "FAIL - $1"; FAILS=$((FAILS + 1)); }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

TMP=$(mktemp -d); trap 'rm -rf "$TMP"; [[ -n "${MOCK_PID:-}" ]] && kill "$MOCK_PID" 2>/dev/null' EXIT

# shellcheck disable=SC1090
source "$SCRIPT"           # library mode: functions only
set +e

setup() {  # fresh state dir + stubs for every scenario
  CD="$TMP/cd-$1"; mkdir -p "$CD/releases" "$CD/failed"; : >"$CD/deploy.log"
  CALLS="$CD/calls"; : >"$CALLS"
  SHA=1111111111111111111111111111111111111111; ID=${SHA:0:12}
  PREV="" FAIL_AT="" UP_FAIL="" VERIFY_FAIL=""
  validate_target()     { echo "validate $1" >>"$CALLS"; }
  fetch_origin()        { echo "$SHA"; }
  export_commit()       { mkdir -p "$CD/releases/${1:0:12}"; echo "name: breakout" >"$CD/releases/${1:0:12}/compose.yaml"; echo "${1:0:12}"; }
  stage_checks()        { echo checks >>"$CALLS"; [[ $FAIL_AT != checks ]] || die "stub: checks"; }
  stage_test()          { echo test >>"$CALLS"; [[ $FAIL_AT != test ]] || die "stub: tests failed"; }
  stage_build()         { echo "build $2" >>"$CALLS"; }
  ephemeral_run()       { echo "ephemeral $1" >>"$CALLS"; [[ $FAIL_AT != smoke ]]; }
  pre_backup()          { echo backup >>"$CALLS"; BACKUP_DIR=""; }
  migration_rehearsal() { echo rehearsal >>"$CALLS"; [[ $FAIL_AT != rehearsal ]] || die "stub: rehearsal"; }
  compose_up()          { echo "up $2" >>"$CALLS"; echo "$2" >"$CD/uptag"; [[ " $UP_FAIL " != *" $2 "* ]]; }
  verify_live()         { echo verify >>"$CALLS"; [[ " $VERIFY_FAIL " != *" $(cat "$CD/uptag") "* ]]; }
  compose_stop()        { echo stop >>"$CALLS"; }
  running_image()       { echo "$PREV"; }
  notify()              { echo "notify $1 $2" >>"$CALLS"; }
}
run_deploy() { ( NOTIFY_ON_EXIT=true; trap on_exit EXIT; cmd_deploy "$@" ) >/dev/null 2>&1; echo $?; }
has() { grep -q -- "$2" "$1"; }

# --- S1 not approved ---------------------------------------------------------
setup s1; rc=$(run_deploy)
check "S1 unapproved deploy refuses (rc=1)" '[[ $rc == 1 ]]'
check "S1 unapproved deploy never builds or touches compose" '! has "$CALLS" "^build\|^up"'

# --- S2 bootstrap success ----------------------------------------------------
setup s2; touch "$CD/APPROVED"; rc=$(run_deploy --bootstrap)
check "S2 bootstrap success rc=0" '[[ $rc == 0 ]]'
check "S2 validates in bootstrap mode" 'has "$CALLS" "validate bootstrap"'
check "S2 order: checks→test→build→smoke→backup→rehearsal→up→verify" \
  '[[ "$(grep -oE "^(checks|test|build|ephemeral|backup|rehearsal|up|verify)" "$CALLS" | tr "\n" " ")" == "checks test build ephemeral backup rehearsal up verify " ]]'
check "S2 records current release" '[[ "$(cat "$CD/current")" == "$ID $SHA" ]]'
check "S2 history=deployed" 'has "$CD/releases.jsonl" "\"result\":\"deployed\""'
check "S2 success notification" 'has "$CALLS" "^notify ok"'

# --- S3 first deployment fails (no previous release) -> STOP, alert ---------
setup s3; touch "$CD/APPROVED"; VERIFY_FAIL=$ID; rc=$(run_deploy --bootstrap)
check "S3 bootstrap failure rc=1" '[[ $rc == 1 ]]'
check "S3 service is stopped, not left unhealthy" 'has "$CALLS" "^stop"'
check "S3 no rollback attempted (nothing to roll back to)" '[[ $(grep -c "^up" "$CALLS") == 1 ]]'
check "S3 commit marked failed (no retry loop)" '[[ -e "$CD/failed/$SHA" ]]'
check "S3 history=failed_no_previous" 'has "$CD/releases.jsonl" failed_no_previous'
check "S3 failure notification names STOPPED" 'has "$CALLS" "^notify fail .*STOPPED"'
check "S3 current not written" '[[ ! -e "$CD/current" ]]'

# --- S4 deploy fails, previous healthy -> rollback --------------------------
setup s4; touch "$CD/APPROVED"; PREV=breakout-copilot:aaaaaaaaaaaa; echo "aaaaaaaaaaaa 0000000000000000000000000000000000000000" >"$CD/current"
echo "name: breakout" >"$CD/compose.current.yaml"; VERIFY_FAIL=$ID; rc=$(run_deploy)
check "S4 rc=1 (deploy failed)" '[[ $rc == 1 ]]'
check "S4 rolled back to previous tag" 'has "$CALLS" "^up aaaaaaaaaaaa"'
check "S4 not stopped after healthy rollback" '! has "$CALLS" "^stop"'
check "S4 history=rolled_back" 'has "$CD/releases.jsonl" rolled_back'
check "S4 current still points at previous" 'has "$CD/current" "^aaaaaaaaaaaa"'
check "S4 failure notification" 'has "$CALLS" "^notify fail .*rolled back"'

# --- S5 deploy fails AND rollback fails -> STOP ------------------------------
setup s5; touch "$CD/APPROVED"; PREV=breakout-copilot:aaaaaaaaaaaa; echo "name: breakout" >"$CD/compose.current.yaml"
VERIFY_FAIL="$ID aaaaaaaaaaaa"; rc=$(run_deploy)
check "S5 rc=1" '[[ $rc == 1 ]]'
check "S5 stopped after failed rollback" 'has "$CALLS" "^stop"'
check "S5 history=rollback_failed" 'has "$CD/releases.jsonl" rollback_failed'

# --- S6 tests fail -> production untouched, commit marked -------------------
setup s6; touch "$CD/APPROVED"; PREV=breakout-copilot:aaaaaaaaaaaa; FAIL_AT=test; rc=$(run_deploy)
check "S6 rc=1" '[[ $rc == 1 ]]'
check "S6 no backup/compose when tests fail" '! has "$CALLS" "^backup\|^up\|^stop"'
check "S6 commit marked failed" '[[ -e "$CD/failed/$SHA" ]]'

# --- S7 rehearsal fails -> production untouched ------------------------------
setup s7; touch "$CD/APPROVED"; PREV=breakout-copilot:aaaaaaaaaaaa; FAIL_AT=rehearsal; rc=$(run_deploy)
check "S7 rehearsal failure blocks compose up" '[[ $rc == 1 ]] && ! has "$CALLS" "^up"'

# --- S8 tick ------------------------------------------------------------------
setup s8; touch "$CD/APPROVED"; touch "$CD/failed/$SHA"
out=$( cmd_tick 2>&1 ); rc=$?
check "S8 tick skips a failed commit (rc=0, no deploy)" '[[ $rc == 0 ]] && ! has "$CALLS" "^validate"'
setup s8b; touch "$CD/APPROVED"; echo "$ID $SHA" >"$CD/current"; ( cmd_tick ) >/dev/null 2>&1; rc=$?
check "S8 tick is a no-op when already deployed" '[[ $rc == 0 ]] && [[ ! -s "$CALLS" ]]'
setup s8c; ( cmd_tick ) >/dev/null 2>&1; rc=$?
check "S8 tick without APPROVED is a no-op" '[[ $rc == 0 ]] && [[ ! -s "$CALLS" ]]'

# --- S9 compose policy (real docker compose config) --------------------------
source "$SCRIPT"; set +e        # restore real stage functions
CD="$TMP/cd-policy"; mkdir -p "$CD/failed"; : >"$CD/deploy.log"
pol() {  # $1 name, $2 sed expression applied to the real compose.yaml, $3 expect (pass|fail)
  local r="$TMP/rel-$1"; mkdir -p "$r"; sed -E "$2" "$HERE/../compose.yaml" >"$r/compose.yaml"
  ( compose_policy "$r" ) >/dev/null 2>&1; local rc=$?
  if [[ $3 == pass ]]; then check "S9 policy accepts: $1" '[[ $rc == 0 ]]'; else check "S9 policy rejects: $1" '[[ $rc != 0 ]]'; fi
}
pol real-compose 's/^$//' pass
pol privileged 's/^    read_only: true/    read_only: true\n    privileged: true/' fail
pol host-network 's/^    read_only: true/    read_only: true\n    network_mode: host/' fail
pol host-bind-mount 's|^      - copilot_data:/data|      - copilot_data:/data\n      - /:/host|' fail
pol public-port 's/"127\.0\.0\.1:/"0.0.0.0:/' fail
pol docker-socket 's|^      - copilot_data:/data|      - /var/run/docker.sock:/var/run/docker.sock|' fail
pol cap-add 's/^    cap_drop: \[ALL\]/    cap_drop: [ALL]\n    cap_add: [SYS_ADMIN]/' fail
pol writable-root 's/^    read_only: true/    read_only: false/' fail
pol pinned-image 's/^    image: .*/    image: evil:latest/' fail

# --- S10 compose approval gate (real stage_checks) ---------------------------
r="$TMP/rel-approve"; mkdir -p "$r/backend/src"; cp "$HERE/../compose.yaml" "$r/"
for f in Dockerfile package.json package-lock.json backend/src/server.ts; do : >"$r/$f"; done
printf 'export const MIGRATIONS = [\n `CREATE TABLE t (a);`,\n];\n' >"$r/backend/src/db.ts"
DEPLOY_SHA=2222; ( stage_checks "$r" yes ) >/dev/null 2>&1; rc=$?
check "S10 unapproved compose blocks deploy" '[[ $rc == 1 ]]'
check "S10 ...without marking the commit failed" '[[ ! -e "$CD/failed/2222" ]]'
sha256sum <"$r/compose.yaml" | cut -d" " -f1 >"$CD/compose.approved.sha256"
( stage_checks "$r" yes ) >/dev/null 2>&1; check "S10 approved compose passes" '[[ $? == 0 ]]'
echo "# changed" >>"$r/compose.yaml"; ( stage_checks "$r" yes ) >/dev/null 2>&1
check "S10 any compose change needs re-approval" '[[ $? == 1 ]]'
cp "$HERE/../compose.yaml" "$r/"; printf 'export const MIGRATIONS = [\n `DROP TABLE t;`,\n];\n' >"$r/backend/src/db.ts"
( stage_checks "$r" yes ) >/dev/null 2>&1; check "S10 text guard still rejects DROP" '[[ $? == 1 ]]'
DEPLOY_SHA=""

# --- S11 identity: wrong host / missing identity refuse before writing anything
printf 'EXPECT_HOST=expected-host\nEXPECT_MACHINE_ID=%s\n' "$(cut -c1-12 /etc/machine-id)" >"$TMP/target.env"
out=$(env -i PATH="$PATH" BREAKOUT_CD_TARGET_ENV="$TMP/target.env" bash -c 'hostname(){ echo not-the-host; }; export -f hostname; "$0" validate' "$SCRIPT" 2>&1); rc=$?
check "S11 wrong hostname refused" '[[ $rc == 1 && "$out" == *"expected expected-host"* ]]'
out=$(env -i PATH="$PATH" BREAKOUT_CD_TARGET_ENV="$TMP/absent.env" "$SCRIPT" validate 2>&1); rc=$?
check "S11 missing identity file refused" '[[ $rc == 1 && "$out" == *"identity not configured"* ]]'
printf 'EXPECT_HOST=x\nEXPECT_MACHINE_ID=abc\n' >"$TMP/short.env"
out=$(env -i PATH="$PATH" BREAKOUT_CD_TARGET_ENV="$TMP/short.env" "$SCRIPT" validate 2>&1); rc=$?
check "S11 short machine-id prefix refused" '[[ $rc == 1 && "$out" == *"identity not configured"* ]]'

# --- S12 notifier against a local mock ntfy ----------------------------------
CD="$TMP/cd-notify"; mkdir -p "$CD"; : >"$CD/deploy.log"
python3 - "$TMP/req" >/dev/null 2>&1 <<'PY' &
import http.server, sys, socketserver
out = sys.argv[1]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        with open(out, "w") as f:
            f.write("title=%s\nprio=%s\nauth=%s\nbody=%s\n" % (self.headers["Title"], self.headers["Priority"],
                    "present" if self.headers.get("Authorization", "").startswith("Bearer ") else "absent", body.decode()))
        self.send_response(200); self.end_headers()
    def log_message(self, *a): pass
with socketserver.TCPServer(("127.0.0.1", 0), H) as s:
    open(out + ".port", "w").write(str(s.server_address[1])); s.handle_request()
PY
MOCK_PID=$!
for _ in $(seq 50); do [[ -s "$TMP/req.port" ]] && break; sleep 0.1; done
printf 'NOTIFY_URL=http://127.0.0.1:%s/breakout-cd\nNOTIFY_TOKEN=tk_dummy_for_test\n' "$(cat "$TMP/req.port")" >"$CD/notify.env"
EXPECT_HOST=test-host
notify fail "deploy of abc failed"; wait "$MOCK_PID" 2>/dev/null; MOCK_PID=""
check "S12 ntfy request delivered with title+priority" 'has "$TMP/req" "title=Breakout CD FAIL on test-host" && has "$TMP/req" "prio=high"'
check "S12 bearer token sent (value not logged)" 'has "$TMP/req" "auth=present" && ! has "$CD/deploy.log" tk_dummy'
check "S12 ALERT file written" 'has "$CD/ALERT" "deploy of abc failed"'
printf 'NOTIFY_URL=http://127.0.0.1:9/none\n' >"$CD/notify.env"
( notify fail "unreachable" ); check "S12 unreachable notifier never fails the caller" '[[ $? == 0 ]] && has "$CD/deploy.log" "delivery to NOTIFY_URL failed"'
notify ok "fine"; check "S12 success clears ALERT" '[[ ! -e "$CD/ALERT" ]]'

# --- S13 migration rehearsal on a v1 "production" DB (real image) ------------
if [[ -n "$REAL_TAG" ]]; then
  CD="$TMP/cd-reh"; mkdir -p "$CD"; : >"$CD/deploy.log"; BACKUP_DIR="$TMP/bk"; mkdir -p "$BACKUP_DIR"
  docker run --rm -i --network none --user 0 -v "$BACKUP_DIR:/w" --entrypoint node "$IMAGE_REPO:$REAL_TAG" \
    --disable-warning=ExperimentalWarning --input-type=module - <<'JS'
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "/app/backend/src/db.ts";
const db = new DatabaseSync("/w/breakout.db.snapshot");
db.exec(MIGRATIONS[0]); db.exec("PRAGMA user_version = 1");
db.exec("INSERT INTO users VALUES ('u1','alice','h',0,'t'); INSERT INTO conversations VALUES ('c1','u1','t',NULL,NULL,'t','t');");
db.close();
JS
  ( migration_rehearsal "$REAL_TAG" ) >/dev/null 2>&1; rc=$?
  check "S13 rehearsal upgrades a v1 prod copy additively (v1→v2, rows kept)" '[[ $rc == 0 ]] && has "$CD/deploy.log" "additive OK: v1→v2"'
  check "S13 rehearsal leaves the snapshot itself untouched" '[[ -f "$BACKUP_DIR/breakout.db.snapshot" ]]'
  echo '{"integrity":"ok","user_version":2,"objects":{"table:t":{"a":"|0|0"}},"rows":{"t":5}}' >"$TMP/b.json"
  echo '{"integrity":"ok","user_version":3,"objects":{},"rows":{}}' >"$TMP/a.json"
  dbcheck "$REAL_TAG" "$TMP" compare /w/b.json /w/a.json >/dev/null 2>&1
  check "S13 compare rejects a dropped table / lost rows" '[[ $? == 1 ]]'
else
  echo "skip - S13 (pass an image tag to run the real-image rehearsal)"
fi

echo "# pass $PASS"; echo "# fail $FAILS"
((FAILS == 0))
