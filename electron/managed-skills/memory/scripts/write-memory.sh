#!/bin/sh
set -u

API_BASE="${LOCAL_AI_CORE_BASE_URL:-http://127.0.0.1:9831/api/local/v1}"
WORKSPACE_ID="${LOCAL_AI_WORKSPACE_ID:-default}"

if [ "$#" -lt 4 ]; then
  echo "Usage: write-memory.sh <category> <slug> \"<title>\" \"<content>\" [tags_comma_separated] [summary]" >&2
  exit 1
fi

CATEGORY="$1"
SLUG="$2"
TITLE="$3"
CONTENT="$4"
TAGS_RAW="${5:-}"
SUMMARY="${6:-}"

BODY=$(node -e '
const [category, slug, title, content, tagsRaw, summary] = process.argv.slice(1);
const tags = tagsRaw ? tagsRaw.split(",").map(t => t.trim()).filter(Boolean) : [];
console.log(JSON.stringify({
  category,
  slug,
  title,
  content,
  tags,
  summary: summary || undefined,
}));
' "$CATEGORY" "$SLUG" "$TITLE" "$CONTENT" "$TAGS_RAW" "$SUMMARY")

curl -s -X POST \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  "${API_BASE}/workspaces/${WORKSPACE_ID}/memory/pages"
