# UI smoke tests (s7-test-ui-smoke)

Fast Playwright smoke tests for the Minos UI.

## Prereqs

- Node 20+
- Rust toolchain (same as repo CI)
- A PAM service file for patchbox (`/etc/pam.d/patchbox`) if using a real local test user

Minimal PAM config (Linux):

```sh
sudo tee /etc/pam.d/patchbox >/dev/null <<'EOF'
auth required pam_unix.so
account required pam_unix.so
EOF
```

With the documented `patchbox-test` / `patchbox-test` credentials, global setup seeds the ignored
`.runtime/config.toml` with a config-backed admin test user before starting patchbox.

To exercise PAM instead, create a local admin user for tests:

```sh
sudo groupadd -f patchbox-admin
sudo useradd -m -s /bin/bash patchbox-test || true
echo 'patchbox-test:patchbox-test' | sudo chpasswd
sudo usermod -a -G patchbox-admin patchbox-test
```

## Install

```sh
cd tests/ui
npm ci
npx playwright install chromium
```

## Run (recommended: prebuilt binary)

```sh
# from repo root
cargo build -p patchbox --features inferno --release

cd tests/ui
PATCHBOX_BIN=$PWD/../../target/release/patchbox \
PATCHBOX_TEST_USERNAME=patchbox-test \
PATCHBOX_TEST_PASSWORD=patchbox-test \
npm test
```

## Run (fallback: cargo run)

```sh
cd tests/ui
PATCHBOX_FEATURES=inferno \
PATCHBOX_TEST_USERNAME=patchbox-test \
PATCHBOX_TEST_PASSWORD=patchbox-test \
npm test
```

Notes:
- Global setup starts patchbox on port 9191 and waits for `/api/v1/health`.
- If something is already listening on 9191 and healthy, the tests will reuse it.
