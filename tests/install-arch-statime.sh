#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
installer="$repo_root/scripts/install-arch.sh"

require_contains() {
    local needle="$1"
    if ! grep -Fq "$needle" "$installer"; then
        printf 'install-arch.sh missing expected text: %s\n' "$needle" >&2
        exit 1
    fi
}

require_absent() {
    local needle="$1"
    if grep -Fq "$needle" "$installer"; then
        printf 'install-arch.sh contains forbidden text: %s\n' "$needle" >&2
        exit 1
    fi
}

require_contains 'STATIME_REPO="https://github.com/legopc/statime.git"'
require_contains 'STATIME_BRANCH="inferno-dev"'
require_contains 'STATIME_SRC="/opt/statime-inferno-dev"'
require_contains 'install -d -o "$RUN_AS" -g "$(id -gn "$RUN_AS")" "$STATIME_SRC"'
require_contains 'git clone --branch "$STATIME_BRANCH" "$STATIME_REPO" "$STATIME_SRC"'
require_contains 'git -C "$STATIME_SRC" fetch origin "$STATIME_BRANCH"'
require_contains 'git -C "$STATIME_SRC" checkout "$STATIME_BRANCH"'
require_contains 'git -C "$STATIME_SRC" reset --hard "origin/$STATIME_BRANCH"'
require_contains 'git -C "$STATIME_SRC" submodule update --init --recursive'
require_contains 'cargo build --release -p statime-linux'
require_contains 'Statime PTP daemon (legopc/statime inferno-dev — PTPv1 slave support)'
require_absent 'inferno-ptpv1-master'

printf 'install-arch statime repo invariants OK\n'
