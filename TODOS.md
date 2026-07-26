# TODOS

## Windows autostart for the local terminal agent

**What:** `local-agent/install.sh` only registers autostart on macOS (launchd)
and Linux (systemd --user). On Windows it falls back to starting the agent
once in the foreground and exits — no persistence across reboots, no "install
once, forget forever" experience.

**Why:** The personal-terminal feature (see `local-agent/`, wired into
`public/index.html`'s "Get your terminal started" flow) needs autostart on
every platform to deliver on "press the button once, ever." Right now a
Windows visitor gets a working terminal for the current session only.

**Pros:** Completes cross-platform parity for the core feature; likely a
meaningful chunk of hackathon attendees if any run Windows.

**Cons:** Needs a Windows box to actually test against (none available in this
session) — a Startup-folder `.vbs`/`.bat` shim or a tool like NSSM would need
real verification, not just code that looks right.

**Context:** `install.sh`'s `$UNAME` branch (`Darwin` / `Linux` / else) is
where this plugs in. The `else` branch currently just runs the agent in the
foreground once — replace it with a Windows-specific branch once someone can
test on that platform. Bash via Git Bash/WSL reports `MINGW64_NT-*` or
`Linux` respectively; native PowerShell wouldn't run this script at all, so a
parallel `install.ps1` may be the cleaner path rather than shoehorning
Windows into the bash script.

**Depends on / blocked by:** Access to a Windows machine to verify.

---

## node-pty prebuild fallback on uncommon platforms

**What:** `local-agent/package.json` pulls in `node-pty@^1.1.0`, which ships
prebuilt native bindings for `darwin-arm64`, `darwin-x64`, `win32-arm64`, and
`win32-x64` (confirmed in this session — `npm install` skipped compilation
entirely on this Mac). Linux and any other arch aren't in that prebuild list,
so `npm install` on those platforms falls back to compiling from source via
node-gyp, which needs Python + a C++ toolchain and can fail silently on a
random visitor's laptop mid-install.

**Why:** A failed `npm install` inside `install.sh` currently just stops with
an npm error — the visitor sees a wall of node-gyp output instead of a clear
"here's what to do" message.

**Pros:** Graceful failure (a clear "couldn't build your terminal — need
Python + Xcode/build-essential" message) turns a confusing hard failure into
an actionable one.

**Cons:** Real fix (bundling a prebuilt binary for more platforms, or vendoring
a WASM pty) is out of scope for the hackathon timeline — this is a "detect and
explain" fix, not a "solve" fix.

**Context:** Add a `postinstall` check in `install.sh` after `npm install`
that verifies `node -e "require('node-pty')"` succeeds before proceeding to
the autostart registration step; if it fails, print the Python/build-tools
hint and exit instead of silently registering a broken service.

**Depends on / blocked by:** Nothing — can be picked up any time.
