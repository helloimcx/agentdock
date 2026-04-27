#!/usr/bin/env bash
set -euo pipefail

version="${1:-}"
if ! [[ "${version}" =~ ^[0-9]+[.][0-9]+[.][0-9]+([-.+][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid AgentDock version: ${version}" >&2
  exit 2
fi

package="@kafca/agentdock@${version}"
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
  if npm install -g "${package}"; then
    break
  fi

  if [[ "${attempt}" == "18" ]]; then
    exit 1
  fi

  sleep 10
done

systemctl restart agentdock

for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS http://127.0.0.1:14173/api/local/v1/health; then
    exit 0
  fi
  sleep 2
done

systemctl status agentdock --no-pager -l >&2 || true
exit 1
