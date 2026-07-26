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

## ~~node-pty prebuild fallback on uncommon platforms~~ — done

`install.sh` now checks `node -e "require('node-pty')"` right after `npm
install` and exits with a clear Python/build-tools hint instead of silently
wiring up an autostart service that could never actually launch a terminal.
Bundling prebuilt binaries for more platforms (the actual "solve", not just
"detect and explain") is still out of scope for the hackathon timeline.
