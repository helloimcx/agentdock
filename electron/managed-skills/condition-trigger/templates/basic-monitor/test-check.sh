#!/bin/sh
# Self-test for check.sh — simulates stdin input and validates stdout protocol compliance.
# Run: ./test-check.sh
#
# Note: Tests 1 and 2 require network access to httpbin.org.
# Set SKIP_EXTERNAL=1 to skip them.

set -eu

fail=0
script_dir=$(cd "$(dirname "$0")" && pwd)
tmpfile=$(mktemp /tmp/test-config.XXXXXX)
trap 'rm -f "$tmpfile"' EXIT

# --- Helper: extract a boolean/number/string from JSON response ---
json_bool() {
  printf '%s' "$2" | sed -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*(true|false).*/\\1/"
}

json_number() {
  printf '%s' "$2" | sed -E "s/.*\"$1\"[[:space:]]*:[[:space:]]*([0-9]+).*/\\1/"
}

json_has_key() {
  printf '%s' "$2" | grep -q "\"$1\""
}

assert_eq() {
  if [ "$2" = "$3" ]; then
    echo "  PASS — $1"
  else
    echo "  FAIL — $1: expected '$3', got '$2'"
    fail=1
  fi
}

# =============================================================================
# Unit tests (no network required)
# =============================================================================

# --- Test 1: missing url returns matched=false ---
echo "Test 1: missing url in config..."
cat > "$tmpfile" <<'INPUT'
{
  "protocolVersion": 1,
  "evaluationId": "test-config-missing",
  "triggeredAt": "2026-07-20T10:00:00Z",
  "config": {},
  "previousState": {}
}
INPUT

exit_code=0
result=$(cat "$tmpfile" | /bin/sh "$script_dir/check.sh" 2>/dev/null) || exit_code=$?
if [ "$exit_code" != "0" ]; then
  echo "  FAIL — script exited with code $exit_code"
  fail=1
else
  matched=$(json_bool matched "$result")
  assert_eq "matched=false" "$matched" "false"
fi

# --- Test 2: cooldown suppression (no previous failure → no suppression) ---
echo "Test 2: no previous state → no cooldown applied..."
cat > "$tmpfile" <<'INPUT'
{
  "protocolVersion": 1,
  "evaluationId": "test-no-state",
  "triggeredAt": "2026-07-20T10:00:00Z",
  "config": { "url": "https://httpbin.org/status/200" },
  "previousState": {}
}
INPUT

# This test needs network. Skip gracefully if unavailable or SKIP_EXTERNAL=1.
if [ "${SKIP_EXTERNAL:-0}" = "1" ]; then
  echo "  SKIP — SKIP_EXTERNAL=1"
elif ! curl -s --max-time 3 -o /dev/null https://httpbin.org 2>/dev/null; then
  echo "  SKIP — httpbin.org unreachable"
else
  result=$(cat "$tmpfile" | /bin/sh "$script_dir/check.sh" 2>/dev/null)
  matched=$(json_bool matched "$result")
  assert_eq "healthy endpoint → matched=false" "$matched" "false"

  if json_has_key payload "$result"; then
    http_status=$(json_number http_status "$result")
    assert_eq "payload.http_status = 200" "$http_status" "200"
  else
    echo "  FAIL — payload missing from response"
    fail=1
  fi

  if json_has_key nextState "$result"; then
    echo "  PASS — nextState present"
  else
    echo "  FAIL — nextState missing"
    fail=1
  fi
fi

# --- Test 3: unhealthy endpoint with no state → matched=true ---
echo "Test 3: unhealthy endpoint → matched=true..."
if [ "${SKIP_EXTERNAL:-0}" = "1" ]; then
  echo "  SKIP — SKIP_EXTERNAL=1"
elif ! curl -s --max-time 3 -o /dev/null https://httpbin.org 2>/dev/null; then
  echo "  SKIP — httpbin.org unreachable"
else
  cat > "$tmpfile" <<'INPUT'
{
  "protocolVersion": 1,
  "evaluationId": "test-unhealthy",
  "triggeredAt": "2026-07-20T10:00:00Z",
  "config": { "url": "https://httpbin.org/status/503", "expected_status": 200 },
  "previousState": {}
}
INPUT

  result=$(cat "$tmpfile" | /bin/sh "$script_dir/check.sh" 2>/dev/null)
  matched=$(json_bool matched "$result")
  assert_eq "unhealthy endpoint → matched=true" "$matched" "true"

  if json_has_key nextState "$result"; then
    echo "  PASS — nextState recorded for rising-edge tracking"
  else
    echo "  FAIL — nextState missing (needed for cooldown/dedup)"
    fail=1
  fi
fi

# --- Test 4: cooldown suppression within window ---
echo "Test 4: cooldown suppresses re-alert within window..."
cat > "$tmpfile" <<'INPUT'
{
  "protocolVersion": 1,
  "evaluationId": "test-cooldown",
  "triggeredAt": "2026-07-20T10:05:00Z",
  "config": { "url": "https://httpbin.org/status/503", "expected_status": 200, "cooldown_minutes": 30 },
  "previousState": { "last_failure": "2026-07-20T10:00:00Z" }
}
INPUT

if [ "${SKIP_EXTERNAL:-0}" = "1" ]; then
  echo "  SKIP — SKIP_EXTERNAL=1"
elif ! curl -s --max-time 3 -o /dev/null https://httpbin.org 2>/dev/null; then
  echo "  SKIP — httpbin.org unreachable"
else
  result=$(cat "$tmpfile" | /bin/sh "$script_dir/check.sh" 2>/dev/null)
  matched=$(json_bool matched "$result")
  assert_eq "cooldown active → matched=false" "$matched" "false"

  if echo "$result" | grep -q "cooldown"; then
    echo "  PASS — summary mentions cooldown suppression"
  else
    echo "  WARN — summary doesn't mention cooldown (non-fatal)"
  fi
fi

# --- Test 5: healthy endpoint after cooldown expiry clears failure state ---
# The previous last_failure is outside the cooldown window, so the script
# evaluates the endpoint normally. A healthy response should set last_healthy
# and reset the rising-edge state.
echo "Test 5: healthy endpoint after cooldown expiry sets last_healthy..."
if [ "${SKIP_EXTERNAL:-0}" = "1" ]; then
  echo "  SKIP — SKIP_EXTERNAL=1"
elif ! curl -s --max-time 3 -o /dev/null https://httpbin.org 2>/dev/null; then
  echo "  SKIP — httpbin.org unreachable"
else
  cat > "$tmpfile" <<'INPUT'
{
  "protocolVersion": 1,
  "evaluationId": "test-recovery",
  "triggeredAt": "2026-07-20T11:30:00Z",
  "config": { "url": "https://httpbin.org/status/200", "expected_status": 200, "cooldown_minutes": 30 },
  "previousState": { "last_failure": "2026-07-20T10:00:00Z" }
}
INPUT

  result=$(cat "$tmpfile" | /bin/sh "$script_dir/check.sh" 2>/dev/null)
  matched=$(json_bool matched "$result")
  assert_eq "healthy after cooldown → matched=false" "$matched" "false"

  if json_has_key nextState "$result"; then
    if echo "$result" | grep -q "last_healthy"; then
      echo "  PASS — nextState.last_healthy set (rising edge reset)"
    else
      echo "  FAIL — nextState missing last_healthy (recovery should clear alert)"
      fail=1
    fi
  else
    echo "  FAIL — nextState missing"
    fail=1
  fi
fi

# --- Test 6: malformed stdin (not valid JSON) ---
echo "Test 6: malformed stdin → script exits gracefully..."
echo "not json at all" > "$tmpfile"
exit_code=0
result=$(cat "$tmpfile" | /bin/sh "$script_dir/check.sh" 2>/dev/null) || exit_code=$?
# With set -eu and no URL, script should output matched=false and exit 0
if [ "$exit_code" = "0" ]; then
  matched=$(json_bool matched "$result" || echo "false")
  assert_eq "no url → matched=false" "$matched" "false"
else
  echo "  FAIL — exit code $exit_code (should handle gracefully)"
  fail=1
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
if [ "$fail" = "0" ]; then
  echo "All tests passed."
  exit 0
else
  echo "Some tests FAILED."
  exit 1
fi
