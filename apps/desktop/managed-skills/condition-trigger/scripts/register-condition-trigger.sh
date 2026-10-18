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
const { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync, statSync, writeFileSync } = require('node:fs');
const { relative, resolve, sep } = require('node:path');
const MAX_FILES = 64;
const MAX_BYTES = 1_048_576;
const sourceDirectory = resolve(process.env.SOURCE_DIR || '');
const noFollow = constants.O_NOFOLLOW;
const directoryOnly = constants.O_DIRECTORY;
if (!noFollow || !directoryOnly) throw new Error('secure source staging requires O_NOFOLLOW and O_DIRECTORY');
function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}
function openDirectory(path, isRoot = false) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | noFollow | directoryOnly);
  } catch (error) {
    if (isRoot) throw new Error('source root must be a non-symlink directory');
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isDirectory()) throw new Error('source root must be a non-symlink directory');
    return stat;
  } finally {
    closeSync(fd);
  }
}
const openedRoot = openDirectory(sourceDirectory, true);
const root = realpathSync(sourceDirectory);
function assertRootStable() {
  if (!sameFile(openedRoot, statSync(root))) throw new Error('source root changed while staging');
}
assertRootStable();
const files = [];
let bytes = 0;
function readStableRegularFile(path) {
  assertRootStable();
  const fd = openSync(path, constants.O_RDONLY | noFollow);
  try {
    const before = fstatSync(fd);
    if (!before.isFile()) throw new Error(`non-regular file is not allowed: ${path}`);
    if (before.size > MAX_BYTES - bytes) throw new Error(`source bundle exceeds ${MAX_BYTES} content bytes`);
    const buffer = Buffer.allocUnsafe(before.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (!read) throw new Error(`source file changed while staging: ${path}`);
      offset += read;
    }
    const after = fstatSync(fd);
    if (!sameFile(before, after) || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error(`source file changed while staging: ${path}`);
    }
    assertRootStable();
    bytes += buffer.length;
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } finally {
    closeSync(fd);
  }
}
function walk(directory) {
  for (const name of readdirSync(directory).sort()) {
    const full = resolve(directory, name);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`symlink is not allowed: ${full}`);
    if (stat.isDirectory()) throw new Error(`source bundle must be flat; nested directory is not allowed: ${full}`);
    else if (stat.isFile()) {
      if (files.length >= MAX_FILES) throw new Error(`source bundle exceeds ${MAX_FILES} files`);
      const path = relative(root, full).split(sep).join('/');
      const content = readStableRegularFile(full);
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
