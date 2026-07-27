#!/usr/bin/env bash
# Claude Code Stop hook — POST /notify so lounge users get agent:done.
# Env is injected by the PTY spawn (host or local agent):
#   HACKERHOUSE_SERVER_URL  — Express base (no trailing slash preferred)
#   HACKERHOUSE_USER_ID     — room / user id
#   HACKERHOUSE_SESSION_TOKEN — signed token; /notify authenticates on this
set -euo pipefail

if [[ -z "${HACKERHOUSE_SERVER_URL:-}" || -z "${HACKERHOUSE_SESSION_TOKEN:-}" ]]; then
  echo "[hackerhouse] skip notify: HACKERHOUSE_SERVER_URL / HACKERHOUSE_SESSION_TOKEN unset" >&2
  exit 0
fi

# Trailing slash breaks some proxies; ngrok free needs the skip header.
SERVER_URL="${HACKERHOUSE_SERVER_URL%/}"

curl -sS -X POST "${SERVER_URL}/notify" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d "{\"token\": \"${HACKERHOUSE_SESSION_TOKEN}\"}" \
  >/dev/null || true
