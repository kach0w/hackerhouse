#!/usr/bin/env bash
# Hacker House local terminal — one-time install.
# Usage: curl -fsSL $ORIGIN/agent/install.sh | bash -s -- $TOKEN $ORIGIN $USER_ID
#
# Downloads the standalone agent, installs its two deps, and registers it as
# an autostarting background service so it comes back after a reboot without
# ever needing to be reinstalled. This is the one manual step in the whole
# flow — everything after this is automatic (the room just shows as live).
set -euo pipefail

TOKEN="${1:?token required (copied from the app)}"
ORIGIN="${2:?origin required (the app's URL)}"
USER_ID="${3:?userId required (your own userId, same one the app uses)}"
AGENT_DIR="$HOME/.hackerhouse-agent"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found on PATH. Install Node (https://nodejs.org) — same" >&2
  echo "requirement Claude Code itself has — then re-run this command." >&2
  exit 1
fi

mkdir -p "$AGENT_DIR"
curl -fsSL "$ORIGIN/agent/agent.js" -o "$AGENT_DIR/agent.js"
curl -fsSL "$ORIGIN/agent/package.json" -o "$AGENT_DIR/package.json"

cat > "$AGENT_DIR/env.json" <<EOF
{"serverUrl":"$ORIGIN","roomId":"$USER_ID","token":"$TOKEN"}
EOF
chmod 600 "$AGENT_DIR/env.json"

echo "Installing dependencies (first time only, ~30-60s)..."
(cd "$AGENT_DIR" && npm install --omit=dev --silent)

# node-pty's prebuilt spawn-helper binary can lose its executable bit on a
# fresh install (seen on macOS) — without this, both the primary and
# fallback shell spawn crash the agent outright the moment it tries to open
# a terminal. Cheap and idempotent, safe to always run.
find "$AGENT_DIR/node_modules/node-pty" -name "spawn-helper" -exec chmod +x {} \; 2>/dev/null || true

NODE_BIN=$(command -v node)
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
