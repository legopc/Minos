# Operations Guide

This guide covers running, deploying, and maintaining dante-patchbox in production.

**Production server:** http://10.10.1.53:9191
**Server PID file:** /tmp/patchbox.pid
**Server log:** /tmp/patchbox.log
**Watchdog log:** /tmp/patchbox-watchdog.log

---

## Deploy workflow

Always use `./deploy.sh` to deploy code changes. Do not manually stop the server unless you understand the PID file race condition described below.

    cd /home/legopc/dante-patchbox
    ./deploy.sh

This script:
1. Runs `cargo build --release`
2. Reads `/tmp/patchbox.pid`, sends SIGTERM to the current server
3. Removes the PID file
4. Waits for the watchdog to detect the server is down and restart with the new binary
5. Waits up to 15 seconds for the new server to respond, then confirms

### The watchdog race condition

The watchdog polls `GET /api/v1/state` every 10 seconds. If you stop the server manually,
the watchdog may start the OLD binary before you launch the new one. If the watchdog starts
first, your launch attempt fails silently (PID file conflict) and you end up running stale
code without realising it.

`deploy.sh` avoids this by letting the watchdog always be the one to restart.

---

## Watchdog

`watchdog.sh` runs as a background process and auto-restarts patchbox if it crashes.

    nohup ./watchdog.sh &                          # start (already running in production)
    ps aux | grep watchdog.sh | grep -v grep       # verify it is running
    tail -f /tmp/patchbox-watchdog.log             # follow restart log

The watchdog checks `GET /api/v1/state` every 10 seconds. On failure it:
1. Removes `/tmp/patchbox.pid`
2. Starts `./target/release/patchbox -p 9191` from the project directory

**Note:** The watchdog does NOT build. It always starts whatever binary is in `target/release/patchbox`.

---

## Authentication setup

### How auth works

1. Login overlay appears on every page load
2. Credentials validated via PAM (Linux system accounts)
3. On success, a JWT HS256 token is issued (8-hour expiry)
4. JWT secret is randomly generated at startup and invalidated on every restart
5. After a restart, all browser sessions must re-login

### PAM service

Server tries PAM services in order:
1. `/etc/pam.d/patchbox` if present
2. `/etc/pam.d/sshd` fallback
3. `/etc/pam.d/su` last resort

To create a dedicated PAM service, create `/etc/pam.d/patchbox`:

    auth    required  pam_unix.so    nodelay
    account required  pam_unix.so

### User and group setup

Roles are determined by Linux group membership:

    patchbox-admin      -> Admin role    (full access, all zones, config)
    patchbox-operator   -> Operator role (all zones, no config)
    patchbox-bar-<id>   -> BarStaff role (own zone only)
    (no group)          -> ReadOnly role (view only)

Example: create a bar-1 staff user:

    sudo groupadd patchbox-bar-bar1
    sudo useradd -M -s /usr/sbin/nologin bar1staff
    sudo passwd bar1staff
    sudo usermod -aG patchbox-bar-bar1 bar1staff

The zone ID in the group name must match a zone key in config.toml:

    [zones]
    "bar1" = [0, 1]   # group: patchbox-bar-bar1
    "bar2" = [2, 3]   # group: patchbox-bar-bar2

### API keys (machine-to-machine)

For external systems that need API access without a user login, add to config.toml:

    [api_keys]
    "my-secret-token-123" = { label = "Automation system", role = "operator" }

Then send: `Authorization: Bearer my-secret-token-123`

---

## Configuration

Default config: `/etc/patchbox/config.toml`
Override with `--config /path/to/config.toml` or `PATCHBOX_CONFIG` env var.

### Full example config

    port        = 9191
    n_inputs    = 8
    n_outputs   = 8
    device_name = "dante-patchbox"
    scenes_dir  = "/var/lib/patchbox/scenes"

    allowed_origins = ["http://10.10.1.53:9191"]

    [api_keys]
    # "secret-token-abc" = { label = "Automation", role = "operator" }

    [zones]
    "bar1" = [0, 1]
    "bar2" = [2, 3]
    "bar3" = [4, 5]
    "stage" = [6, 7]

---

## Making web UI changes

The web UI (`web-ui/` directory) is compiled into the binary via rust-embed.
Every change to HTML/CSS/JS requires a rebuild and server restart:

    ./deploy.sh

The three files in `web-ui/`:
- `index.html` - SPA shell (structure, modals, login overlay)
- `app.js` - all frontend logic (~5300 lines, plain JavaScript, no framework)
- `style.css` - amber industrial theme (~2450 lines)

### Where to find things in app.js

    Auth / login            End of file - initAuth IIFE, validateStoredToken, patchFetch
    boot() initial load     ~line 1217
    Matrix render           buildUI() ~line 260
    Input row render        buildInputRow() ~line 357
    EQ modal                openEqModal() ~line 1315
    Compressor modal        openCompModal() ~line 1411
    Gate modal              openGateModal() ~line 4981
    WebSocket               connectWS() ~line 961
    Metering paint loop     paintMeters() ~line 884
    Strips view             buildStripsView() ~line 1509
    Virtual scroll          ~line 4557
    Zone routing            ~line 3580

---

## Known gotchas

### JWT invalidated on restart
Every restart generates a new JWT secret. All browser sessions become invalid.
Users will see the login screen on next page load - just re-login.

### PID file race condition
See deploy workflow section above. Always use `./deploy.sh`.

### Browser caching old JS
After a deploy, users may need a hard refresh (Ctrl+Shift+R / Cmd+Shift+R).

### Compressor/EQ modal shows "no channel selected"
The modal was applied without a valid channel index. Close and reopen it from
the correct strip button. This is a defensive guard.

### Virtual scroll activates only above 32 channels
Production setup is 8x8 so virtual scroll is inactive. If you expand beyond 32
channels, ensure matrix rows use `display: flex` not `display: table-row`.

---

## Log locations

    /tmp/patchbox.log                  main server log
    /tmp/patchbox-watchdog.log         watchdog restart log
    journalctl -u dante-patchbox -f    systemd journal (if installed)

    tail -f /tmp/patchbox.log
    grep -i "error" /tmp/patchbox.log | tail -20

---

## Health check

    curl http://10.10.1.53:9191/api/v1/health

Returns JSON with `"status": "ok"`. Use for monitoring.

## Prometheus metrics

    curl http://10.10.1.53:9192/metrics

Key metrics: patchbox_ws_connections, patchbox_uptime_seconds.
