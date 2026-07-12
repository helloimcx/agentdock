#!/bin/sh
set -eu

usage() {
  echo "Usage: register-condition-trigger.sh stage <script-id> <source-dir> | test-approval <version-id> <actor> | test <version-id> <actor> | enable-approval <version-id> <actor> | add <title> <script-id> <version-id> <interval> <message>" >&2
  exit 1
}

command=${1:-}
case "$command" in
  stage)
    [ "$#" = 3 ] || usage
    script_id=$2
    source_dir=$3
    source_json=$(SOURCE_DIR="$source_dir" node <<'NODE'
const { lstatSync, readFileSync, readdirSync } = require('node:fs');
const { relative, resolve, sep } = require('node:path');
const root = resolve(process.env.SOURCE_DIR || '');
const files = [];
function walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    const full = resolve(directory, name);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`symlink is not allowed: ${full}`);
    if (stat.isDirectory()) walk(full);
    else if (stat.isFile()) {
      const path = relative(root, full).split(sep).join('/');
      const content = readFileSync(full, 'utf8');
      files.push({ path, content });
    }
  }
}
walk(root);
const bytes = Buffer.byteLength(JSON.stringify({ files }), 'utf8');
if (bytes > 1200000) throw new Error('source bundle exceeds 1,200,000 bytes');
process.stdout.write(JSON.stringify(files));
NODE
)
    lac script stage --script "$script_id" --source-json "$source_json"
    ;;
  test-approval) [ "$#" = 3 ] || usage; lac script test-approval "$2" --actor "$3" ;;
  test) [ "$#" = 3 ] || usage; lac script test "$2" --actor "$3" ;;
  enable-approval) [ "$#" = 3 ] || usage; lac script enable-approval "$2" --actor "$3" ;;
  add) [ "$#" = 6 ] || usage; lac automation add --script-version "$4" --script-id "$3" --title "$2" --interval "$5" --message "$6" ;;
  *) usage ;;
esac
