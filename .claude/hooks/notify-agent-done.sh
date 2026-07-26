#!/usr/bin/env bash
# Claude Code Stop hook — POST /notify so lounge users get agent:done.
# Set locally (do not commit):
#   export HACKERHOUSE_SERVER_URL=http://localhost:3001
#   export HACKERHOUSE_USER_ID=<your-userId>
set -euo pipefail

if [[ -z "${HACKERHOUSE_SERVER_URL:-}" || -z "${HACKERHOUSE_USER_ID:-}" ]]; then
  echo "[hackerhouse] skip notify: HACKERHOUSE_SERVER_URL / HACKERHOUSE_USER_ID unset" >&2
  exit 0
fi

curl -sS -X POST "${HACKERHOUSE_SERVER_URL}/notify" \
  -H "Content-Type: application/json" \
  -d "{\"userId\": \"${HACKERHOUSE_USER_ID}\"}" \
  >/dev/null || true
