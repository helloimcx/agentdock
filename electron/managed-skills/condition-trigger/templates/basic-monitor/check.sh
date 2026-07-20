#!/bin/sh
# Example: HTTP health check monitor
# Reads a JSON request from stdin, checks an endpoint, writes a protocol response to stdout.
#
# Config fields (from manifest.json):
#   url              — endpoint to check (required)
#   timeout_seconds  — curl timeout (default 10)
#   expected_status  — HTTP status that means "healthy" (default 200)
#   cooldown_minutes — suppress re-alerts within this window (default 30)
#
# The script uses rising-edge triggering: `matched:true` fires only on the first
# detection. To avoid spamming during an ongoing outage, we check `previousState`
# for a recent failure and suppress重复 alerts within the cooldown window.

set -eu

# --- Parse input from stdin ---
input=$(cat)

extract() {
  # Extract a top-level string value by key (no nesting support — see protocol doc)
  printf '%s' "$input" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p"
}

extract_number() {
  printf '%s' "$input" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\\([0-9]*\\).*/\\1/p"
}

url=$(extract url)
timeout_seconds=$(extract_number timeout_seconds)
expected_status=$(extract_number expected_status)
cooldown_minutes=$(extract_number cooldown_minutes)

# Apply defaults
timeout_seconds="${timeout_seconds:-10}"
expected_status="${expected_status:-200}"
cooldown_minutes="${cooldown_minutes:-30}"

if [ -z "$url" ]; then
  echo '{"protocolVersion":1,"matched":false,"summary":"missing url in config"}'
  exit 0
fi

# --- Parse triggeredAt (this evaluation's timestamp) ---
triggered_at=$(extract triggeredAt)

# --- Cooldown check: suppress re-alerts if we already alerted recently ---
last_failure=$(extract last_failure)
last_healthy=$(extract last_healthy)

# If we have a last_failure timestamp and no intervening last_healthy,
# check whether we're still within the cooldown window.
if [ -n "$last_failure" ] && [ -z "$last_healthy" ] && [ -n "$triggered_at" ]; then
  # Compute elapsed time using triggeredAt as the evaluation time.
  # Try BSD/macOS date first, then GNU date, then python3 as fallback.
  parse_epoch() {
    date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s 2>/dev/null \
      || date -u -d "$1" +%s 2>/dev/null \
      || python3 -c "import datetime,sys;ts=sys.argv[1].rstrip('Z');print(int(datetime.datetime.fromisoformat(ts).replace(tzinfo=datetime.timezone.utc).timestamp()))" "$1" 2>/dev/null
  }

  eval_epoch=$(parse_epoch "$triggered_at")
  failure_epoch=$(parse_epoch "$last_failure")

  if [ -n "$failure_epoch" ] && [ -n "$eval_epoch" ]; then
    elapsed_minutes=$(( (eval_epoch - failure_epoch) / 60 ))
    if [ "$elapsed_minutes" -lt "$cooldown_minutes" ]; then
      echo "{\"protocolVersion\":1,\"matched\":false,\"summary\":\"$url still failing — cooldown active (${elapsed_minutes}m < ${cooldown_minutes}m), suppressed\",\"payload\":{\"url\":\"$url\",\"cooldown_remaining_minutes\":$(( cooldown_minutes - elapsed_minutes ))},\"nextState\":{\"last_failure\":\"$last_failure\"}}"
      exit 0
    fi
  fi
elif [ -n "$last_failure" ] && [ -z "$last_healthy" ]; then
  # No triggeredAt available — skip cooldown, proceed with check
  echo "Warning: no triggeredAt in input, skipping cooldown check" >&2
fi

# --- Perform the check ---
echo "Checking $url (expecting HTTP $expected_status, timeout ${timeout_seconds}s..." >&2

http_status=$(curl -s -o /dev/null -w '%{http_code}' \
  --max-time "$timeout_seconds" \
  --connect-timeout 5 \
  "$url" 2>/dev/null) || http_status="000"

echo "Got HTTP $http_status" >&2

# --- Build response (use cat<<EOF so $variables expand but JSON stays clean) ---
# Use triggeredAt as the canonical timestamp; fall back to current time
response_time="${triggered_at:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

if [ "$http_status" = "$expected_status" ]; then
  # Service is healthy — rising edge reset (matched:false clears the alert state)
  cat <<EOF
{"protocolVersion":1,"matched":false,"summary":"$url is healthy (HTTP $http_status)","payload":{"url":"$url","http_status":$http_status},"nextState":{"last_healthy":"$response_time"}}
EOF
else
  # Service is down or unexpected status — rising edge trigger
  cat <<EOF
{"protocolVersion":1,"matched":true,"summary":"$url returned HTTP $http_status (expected $expected_status)","payload":{"url":"$url","http_status":$http_status,"expected_status":$expected_status},"nextState":{"last_failure":"$response_time"}}
EOF
fi
