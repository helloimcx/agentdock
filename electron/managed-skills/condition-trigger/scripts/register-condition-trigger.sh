#!/bin/sh
set -eu

usage() {
  echo "Usage: register-condition-trigger.sh create <title> | stage <script-id> <source-dir> | test-approval <version-id> <actor> | apply-approval <version-id> <approval-id> <actor> | test <version-id> <actor> | enable-approval <version-id> <actor> | add <title> <script-id> <version-id> <interval> <message>" >&2
  exit 1
}

command=${1:-}
case "$command" in
  create) [ "$#" = 2 ] || usage; lac script create --title "$2" ;;
  stage)
    [ "$#" = 3 ] || usage
    script_id=$2
    source_dir=$3
    source_file=$(mktemp "${TMPDIR:-/tmp}/condition-trigger-source.XXXXXX")
    trap 'rm -f "$source_file"' EXIT HUP INT TERM
    SOURCE_DIR="$source_dir" SOURCE_FILE="$source_file" node <<'NODE'
const { lstatSync, readFileSync, readdirSync, realpathSync, writeFileSync } = require('node:fs');
const { relative, resolve, sep } = require('node:path');
const MAX_FILES = 256;
const MAX_BYTES = 1_200_000;
const sourceDirectory = resolve(process.env.SOURCE_DIR || '');
const sourceStat = lstatSync(sourceDirectory);
if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) throw new Error('source root must be a non-symlink directory');
const root = realpathSync(sourceDirectory);
const files = [];
let bytes = Buffer.byteLength('[]', 'utf8');
function walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    const full = resolve(directory, name);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`symlink is not allowed: ${full}`);
    if (stat.isDirectory()) walk(full);
    else if (stat.isFile()) {
      if (files.length >= MAX_FILES) throw new Error(`source bundle exceeds ${MAX_FILES} files`);
      if (stat.size > MAX_BYTES - bytes) throw new Error(`source bundle exceeds ${MAX_BYTES} bytes`);
      const path = relative(root, full).split(sep).join('/');
      const content = readFileSync(full, 'utf8');
      const nextBytes = bytes + Buffer.byteLength(JSON.stringify({ path, content }), 'utf8') + 1;
      if (nextBytes > MAX_BYTES) throw new Error(`source bundle exceeds ${MAX_BYTES} bytes`);
      bytes = nextBytes;
      files.push({ path, content });
    }
  }
}
walk(root);
writeFileSync(process.env.SOURCE_FILE, JSON.stringify(files), { mode: 0o600 });
NODE
    lac script stage --script "$script_id" --source-file "$source_file"
    rm -f "$source_file"
    trap - EXIT HUP INT TERM
    ;;
  test-approval) [ "$#" = 3 ] || usage; lac script test-approval "$2" --actor "$3" ;;
  apply-approval) [ "$#" = 4 ] || usage; lac script approve "$2" --approval "$3" --actor "$4" ;;
  test) [ "$#" = 3 ] || usage; lac script test "$2" --actor "$3" ;;
  enable-approval) [ "$#" = 3 ] || usage; lac script enable-approval "$2" --actor "$3" ;;
  add) [ "$#" = 6 ] || usage; lac automation add --script-version "$4" --script-id "$3" --title "$2" --interval "$5" --message "$6" ;;
  *) usage ;;
esac
