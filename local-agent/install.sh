#!/usr/bin/env bash
# Hacker House local terminal — one-time install.
# Usage: curl -fsSL $SERVER_URL/agent/install.sh | bash -s -- $SERVER_URL $ROOM_ID $TOKEN
#
# Downloads the local companion, installs its deps, and registers it as an
# autostarting background service so it comes back after a reboot without
# ever needing to be reinstalled. This is the one manual step in the whole
# flow — everything after this is automatic.
set -euo pipefail

SERVER_URL="${1:?server URL required (pass the app URL)}"
ROOM_ID="${2:?room id required (pass your userId, shown by the app)}"
TOKEN="${3:?session token required (pass the value shown by the app)}"
AGENT_DIR="$HOME/.hackerhouse-agent"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found on PATH. Install Node (https://nodejs.org) — it's" >&2
  echo "the same requirement Claude Code itself has — then re-run this command." >&2
  exit 1
fi

mkdir -p "$AGENT_DIR"
curl -fsSL "$SERVER_URL/agent/agent.js" -o "$AGENT_DIR/agent.js"
curl -fsSL "$SERVER_URL/agent/package.json" -o "$AGENT_DIR/package.json"
# Same Stop hook the host installs for a host-spawned pty (terminal/pty.ts)
# — fetched rather than bundled so there's one source of truth for it.
curl -fsSL "$SERVER_URL/agent/hooks/notify-agent-done.sh" -o "$AGENT_DIR/notify-agent-done.sh"

# Room id and session token are per-visitor secrets scoped to one room;
# serverUrl is not, but keeping all three together in one file matches what
# agent.js actually needs to register and is simplest to autostart with.
cat > "$AGENT_DIR/config.json" <<EOF
{
  "serverUrl": "$SERVER_URL",
  "roomId": "$ROOM_ID",
  "token": "$TOKEN"
}
EOF
chmod 600 "$AGENT_DIR/config.json"

echo "Installing dependencies (first time only, ~30-60s)..."
(cd "$AGENT_DIR" && npm install --omit=dev --silent)

NODE_BIN=$(command -v node)

# node-pty only ships prebuilt native bindings for darwin/win32 — everywhere
# else npm install just fell back to compiling from source via node-gyp,
# which needs Python + a C++ toolchain. A failed compile doesn't fail
# `npm install` loudly enough to stop this script, so without this check
# we'd register an autostart service that can never actually launch a
# terminal — check it can load before wiring up autostart.
if ! "$NODE_BIN" -e "require('node-pty')" >/dev/null 2>&1; then
  echo "Couldn't build your terminal's native module (node-pty)." >&2
  echo "This usually means Python and a C++ toolchain aren't installed:" >&2
  echo "  macOS:  xcode-select --install" >&2
  echo "  Linux:  install Python 3 + gcc/make (e.g. build-essential on Debian/Ubuntu)" >&2
  echo "Then re-run: curl -fsSL \$SERVER_URL/agent/install.sh | bash -s -- \$SERVER_URL \$ROOM_ID \$TOKEN" >&2
  exit 1
fi

UNAME=$(uname -s)

if [ "$UNAME" = "Darwin" ]; then
  PLIST="$HOME/Library/LaunchAgents/com.hackerhouse.agent.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.hackerhouse.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$AGENT_DIR/agent.js</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$AGENT_DIR/agent.log</string>
  <key>StandardErrorPath</key><string>$AGENT_DIR/agent.log</string>
</dict>
</plist>
EOF
  launchctl unload "$PLIST" >/dev/null 2>&1 || true
  launchctl load "$PLIST"
  echo "Done — your terminal is running in the background and will start automatically from now on."
elif [ "$UNAME" = "Linux" ]; then
  UNIT_DIR="$HOME/.config/systemd/user"
  mkdir -p "$UNIT_DIR"
  cat > "$UNIT_DIR/hackerhouse-agent.service" <<EOF
[Unit]
Description=Hacker House local terminal agent

[Service]
ExecStart=$NODE_BIN $AGENT_DIR/agent.js
Restart=always

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now hackerhouse-agent
  echo "Done — your terminal is running in the background and will start automatically from now on."
else
  echo "No autostart support for '$UNAME' yet — starting your terminal once in the foreground."
  echo "Re-run this to bring it back: node \"$AGENT_DIR/agent.js\""
  exec node "$AGENT_DIR/agent.js"
fi
