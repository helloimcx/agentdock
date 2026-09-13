#!/bin/sh
set -u

API_BASE="${LOCAL_AI_CORE_BASE_URL:-http://127.0.0.1:9831/api/local/v1}"
WORKSPACE_ID="${LOCAL_AI_WORKSPACE_ID:-default}"

if [ "$#" -lt 1 ]; then
  echo "Usage: query-memory.sh \"<query>\" [category] [tag]" >&2
  exit 1
fi

QUERY="$1"
CATEGORY="${2:-}"
TAG="${3:-}"

PARAMS="query=$(printf '%s' "$QUERY" | sed 's/ /%20/g')"
if [ -n "$CATEGORY" ]; then
  PARAMS="${PARAMS}&category=${CATEGORY}"
fi
if [ -n "$TAG" ]; then
  PARAMS="${PARAMS}&tag=${TAG}"
fi

curl -s -X GET "${API_BASE}/workspaces/${WORKSPACE_ID}/memory/query?${PARAMS}"
