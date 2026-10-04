#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
javac -d "$build_dir" src/main/java/com/agentdock/a11y/ScreenLease.java src/main/java/com/agentdock/a11y/NodeCatalog.java test/com/agentdock/a11y/*.java
java -cp "$build_dir" com.agentdock.a11y.ScreenLeaseTest
java -cp "$build_dir" com.agentdock.a11y.NodeCatalogTest
