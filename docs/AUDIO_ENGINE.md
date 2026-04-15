# Minos Audio Engine

This document is the permanent technical reference for Minos' live Dante audio path: how audio moves through the system, which bugs were found during hardware testing, why each fix was needed, and how the fixes fit together.

Minos was validated on real Dante hardware using a Shure MXWANI8 as the source-side device and additional Inferno-based receivers downstream. The current implementation is the result of debugging the full chain under real subscriptions, real PTP, and real silence-to-audio transitions.

## Pipeline overview

```text
Shure / Dante TX
    |
    v
inferno RX flows
    |
    v
samples_collector
    |
    v
Minos DSP callback (device.rs)
    |   - i32 <-> f32 conversion
    |   - routing matrix
    |   - metering
    |   - TX ring write
    v
External TX ring buffer
    |
    v
inferno TX flows
    |
    v
Downstream Dante RX / DAC
```

The hot path lives in `crates/patchbox-dante/src/device.rs`. Inferno provides the Dante RX/TX plumbing; Minos owns the DSP callback and the external TX ring that inferno reads from.

## The important timing model

There are five moving parts that matter for understanding nearly every bug below:

1. **PTP media clock** drives Dante time.
2. **`samples_count` / `block`** is how many samples inferno says are ready this callback.
3. **`write_pos`** is Minos' write pointer into the TX ring.
4. **`current_timestamp` / `current_ts_cb`** is inferno TX's view of where transmission currently is in PTP time.
5. **`LEAD_SAMPLES`** is how far ahead of TX Minos writes into the ring.

The target steady-state relationship is:

```text
write_pos ~= tx_position + LEAD_SAMPLES
```

Too far behind causes underruns or pops. Too far ahead adds latency. Advancing the ring incorrectly during silence can also cause old audio to be replayed as a pop.

## Why `ExternalBuffer` matters

Minos transmits from inferno's `ExternalBuffer`, not from inferno's normal owned ring buffers.

That distinction matters because `ExternalBuffer` uses `unconditional_read = true`. In practice, that means TX reads whatever positions it asks for, even if Minos has not freshly advanced `write_pos` to them yet. For normal buffers inferno can use freshness metadata; for Minos' external TX ring it cannot.

That design is what made the final remaining pop bug possible: during silence, if Minos stops advancing `write_pos`, TX can eventually read stale audio left behind from a previous ring revolution.

## How the fixes slot together

The fixes fell into four layers:

| Layer | Purpose | Key fixes |
|---|---|---|
| Device availability | Make the virtual Dante device stay visible and start correctly | Keep `DeviceServer` alive, poll PTP after start |
| Sample correctness | Make PCM values and ring timing mathematically correct | 24-bit sample scaling fix, first-callback alignment fix, linear ring advance |
| Scheduling / latency | Remove unnecessary buffering and wakeup delay | `cap_sys_nice`, event-driven notify path in inferno, `LEAD_SAMPLES=96` |
| Silence safety | Prevent stale audio from being replayed during quiet periods | Zero-fill guard for `block == 0`, resync on large resume blocks |

The important lesson is that the "popping" problem was not one bug. Different pops came from different failure modes:

- device start / timing not ready
- wrong PCM scaling
- ring gaps caused by timer-jitter "self-correction"
- stale audio replayed during silence

## Chronology of the real fixes

### 1. Keep `DeviceServer` alive so Minos stays visible in Dante Controller

- **Commit:** `5e7d8e4`
- **Problem:** `DeviceServer` was dropped at the end of `start_real()`.
- **Impact:** the mDNS broadcaster died, so the device vanished from Dante Controller even though startup looked successful.
- **Fix:** store `DeviceServer` inside `DanteDevice` as `server: Mutex<Option<DeviceServer>>`.
- **Why it was needed:** everything else depends on the device staying alive long enough for real subscriptions and TX flows to exist.

### 2. Poll the PTP clock explicitly in the legopc/inferno fork

- **Commit:** `c97f7ea`
- **Problem:** the `legopc/inferno` fork does not block inside startup until the PTP clock is ready.
- **Impact:** Minos could start before valid media time existed, making first alignment unreliable.
- **Fix:** add an explicit polling loop after device startup and capture `ptp_at_poll` once the clock becomes valid.
- **Why it was needed:** Minos' TX ring math depends on a stable PTP reference before the first callback is armed.

### 3. Use wall-clock elapsed time for first-callback alignment

- **Commit:** `8cd79ca`
- **Problem:** early approaches tried to snap to TX state before TX had meaningful timing data, producing invalid initial alignment.
- **Impact:** `write_pos` could start at the wrong place, causing severe distortion or desynchronisation.
- **Fix:** record `Instant::now()` at PTP poll time and estimate `elapsed_samples` at the first callback.
- **Why it was needed:** this gave Minos a safe initial estimate before inferno TX had enough state to be used continuously.

### 4. Fix Dante sample conversion scaling (`2^31`, not `2^23`)

- **File:** `crates/patchbox-dante/src/sample_conv.rs`
- **Problem:** inferno carries Dante's 24-bit PCM left-justified in the upper bits of an `i32`, but Minos was normalising as if it were right-justified 24-bit audio.
- **Impact:** RX audio was effectively 256x too large and clipped badly; TX audio was correspondingly wrong on the way out.
- **Fix:** normalise and denormalise using `2^31`.
- **Why it was needed:** until this was corrected, the audio path could never sound clean, regardless of ring-buffer timing.

### 5. Replace timer-jitter self-correction with linear ring advance

- **Commit:** `d14bfce`
- **Problem:** Minos recomputed `write_pos = tx_ptp + LEAD` every callback.
- **Impact:** any Tokio timer jitter meant TX time had moved farther than the block being written, so ring positions were skipped; TX read those skipped positions as silence, producing pops.
- **Fix:** stop self-correcting every callback and instead use pure linear advance: `write_pos += block`.
- **Why it was needed:** `block` already comes from inferno's PTP-derived RX path; using it directly avoids creating micro-gaps in the TX ring.

### 6. Re-enable real-time scheduling with `cap_sys_nice`

- **Runtime fix**
- **Problem:** the binary had lost `cap_sys_nice` after replacement.
- **Impact:** the DSP thread silently fell back from `SCHED_FIFO` to normal scheduling, increasing wakeup jitter enough to destabilise low-latency operation.
- **Fix:** reapply `sudo setcap cap_sys_nice=eip /path/to/patchbox` after each deploy.
- **Why it was needed:** low `LEAD_SAMPLES` only works if the callback thread reliably wakes on time.

### 7. Replace inferno's polling wakeup with event-driven notify

- **Patchbox commit:** `5845d33`
- **Inferno fork files:** `samples_collector.rs`, `mod.rs`, `flows_rx.rs`
- **Problem:** inferno woke the callback on a timer, which added avoidable batching delay even on a clean LAN.
- **Impact:** audio through Minos had a large but steady extra delay even after correctness bugs were fixed.
- **Fix:** wire `TransferNotifier` from the RX side into a Tokio `Notify`, so `samples_collector` wakes immediately on packet transfer, with a fallback timer only for silence or safety.
- **Why it was needed:** this removed the main software-added latency floor from the hot path.

### 8. Reduce `LEAD_SAMPLES` from 192 to 96

- **Patchbox commit:** `5845d33`
- **Problem:** once wakeup jitter was reduced, Minos was still writing farther ahead of TX than necessary.
- **Impact:** extra latency without corresponding stability benefit.
- **Fix:** lower `LEAD_SAMPLES` to 96 samples at 48kHz (2ms).
- **Why it was needed:** after event-driven wakeup and `SCHED_FIFO`, a 4ms lead was no longer justified on the tested LAN.

### 9. Guard the external TX ring during silence

- **Commit:** `188b95b`
- **Problem:** `ExternalBuffer` uses unconditional reads. During `block == 0`, `write_pos` stalls, but TX keeps moving. After one full ring revolution, TX can revisit positions containing old audio from an earlier pass.
- **Impact:** occasional pops during silence-to-audio transitions even after the earlier fixes.
- **Fix:** when `block == 0`, zero-fill from `write_pos` up to `tx + LEAD`; when a large resume block arrives, snap `write_pos` back to `tx + LEAD` before writing.
- **Why it was needed:** this is the final safety layer that makes silence stay silent for an external ring with no freshness metadata.

## PFL solo monitor path

The PFL (Pre-Fader Listen) feature routes a selected input channel to the local headphone jack of the dante-doos node for live monitoring.

### Signal path

```text
Dante RX (raw f32 samples)
    |
    v
[matrix.rs: pre-input-DSP tap]
    |  monitor_buf[] = inputs[rx_idx]  (raw, before channel trim/EQ)
    v
[device.rs: RT callback]
    |  try_lock → push to Arc<Mutex<VecDeque<f32>>>
    v
[monitor.rs: ALSA writer thread]
    |  drain queue into local VecDeque accumulator
    |  fill 128-frame period (pad with silence if underflow)
    v
ALSA plughw:1,0 (HD-Audio Generic — ALC221 headphone jack)
```

### Why the tap is pre-DSP

The config for dante-doos has `gain_db = 7.48` on input channel 0. Applying a PFL tap post-DSP would push the signal to ±2.37, clipping it after `f32→i32` conversion. The pre-DSP tap reads the raw Dante samples which are always within `[-1.0, 1.0]`.

### The 32-frame block problem (and fix)

**Root cause found during Sprint F bring-up:** Dante delivers 32-frame blocks at 48kHz (~0.67ms per callback). The original monitor path used `triple_buffer` — which only keeps the *latest* published value. During one 128-frame ALSA period (2.67ms), four Dante callbacks fire. The ALSA writer woke up and read only the fourth frame; the first three were silently overwritten.

Result: 32 audio frames + 96 silence frames per 128-frame ALSA period = **25% audio duty cycle = severe distortion**.

**Fix:** Replace `triple_buffer` with a bounded `Arc<Mutex<VecDeque<f32>>>` FIFO queue (capacity 9600 frames / 200ms).

- RT callback: `try_lock` + push 32 samples per block (drops on lock contention — acceptable at 0.67ms intervals)
- ALSA writer: after each blocking `writei()` returns (~2.67ms), drain the queue into a local `VecDeque` accumulator, then consume exactly 128 frames (padding with silence if the queue underflows)

Steady state: queue accumulates ~128 samples during the `writei()` block → drained → written → 100% duty cycle → clean audio.

### Hardware volume initialisation

The ALC221 codec boots with the headphone amplifier at minimum. `set_hardware_volume()` is called once when the ALSA device is opened; it mutes all Speaker controls and sets Headphone/Master/PCM to maximum. This must happen before any audio can be heard.

### ALSA configuration

| Parameter | Value | Reason |
|---|---|---|
| Format | S32\_LE | `plughw` converts to native S24 |
| Period | 128 frames | 4× Dante block size — queue accumulates exactly one period per `writei()` |
| Buffer | 1024 frames (8 periods) | 21ms headroom against jitter |
| `start_threshold` | 512 frames | Prevent DMA from starting after the first write — avoids underrun→recover→underrun cycle |
| Channels | 2 (L=R) | Mono PFL duplicated to both ears |

### Files

| File | Role |
|---|---|
| `crates/patchbox-dante/src/monitor.rs` | ALSA writer thread: device open, hardware volume, accumulator loop |
| `crates/patchbox-dante/src/device.rs` | Queue creation, RT callback push, monitor writer lifecycle (hot-reconfigure on device change) |
| `crates/patchbox-core/src/matrix.rs` | Pre-DSP PFL tap: `monitor_buf[] = inputs[rx_idx]` |



These were useful investigations, but not root causes:

- **Huge `LEAD_SAMPLES` values** reduced symptoms but did not solve the actual bugs.
- **Very large ring sizes** provided more forgiveness but also masked timing mistakes rather than fixing them.
- **`hole_fix_wait`** was not the source of the steady playthrough latency on a clean LAN; it only matters when there are actual holes / reordering events.
- **`no new samples?!` warnings** during quiet periods were mostly the fallback timer firing during silence suppression, not proof of active packet loss.

## Current latency picture

For the Minos portion of the chain, the useful approximation is:

```text
flow_latency + wakeup_latency + (LEAD_SAMPLES / 48000) + TX latency
```

With the current hardware-tested settings:

| Component | Approximate cost |
|---|---:|
| Dante flow latency | 1ms |
| Event-driven wakeup | <0.5ms |
| `LEAD_SAMPLES = 96` | 2ms |
| TX latency | 1ms |
| **Minos portion** | **~4–5ms** |

That is not the full end-to-end number. The downstream receiver's own subscription latency, jitter buffer, and DAC still add time after Minos has already transmitted the audio.

## Deployment requirements

For real Dante hardware testing, Minos needs both capabilities below on the deployed binary:

```bash
sudo setcap cap_net_raw,cap_sys_nice+ep ./target/release/patchbox
```

- **`cap_net_raw`** is required for inferno's raw socket Dante networking.
- **`cap_sys_nice`** is required so the DSP callback thread can elevate to `SCHED_FIFO`.

Important: replacing the binary clears capabilities, so they must be re-applied after every deploy.

## Files to read first

If you need to work on this area again, start here:

| File | Why it matters |
|---|---|
| `crates/patchbox-dante/src/device.rs` | Main DSP callback, TX ring logic, `LEAD_SAMPLES`, RT scheduling, monitor queue push |
| `crates/patchbox-dante/src/monitor.rs` | ALSA writer thread: PFL accumulator loop, hardware volume init, xrun recovery |
| `crates/patchbox-core/src/matrix.rs` | PFL pre-DSP tap, routing matrix, per-bus DSP chain |
| `crates/patchbox-dante/src/sample_conv.rs` | Dante PCM scaling |
| `inferno_aoip/src/device_server/samples_collector.rs` | RX wakeup behavior and callback scheduling |
| `inferno_aoip/src/device_server/mod.rs` | Wiring between device setup and callback path |
| `inferno_aoip/src/device_server/flows_rx.rs` | Event-driven transfer notifications |
| `inferno_aoip/src/device_server/flows_tx.rs` | TX timestamp tracking and external-buffer reads |
| `inferno_aoip/src/ring_buffer.rs` | `ExternalBuffer`, unconditional reads, hole-fix logic |

## Summary

The stable low-latency result came from fixing the stack in the right order:

1. make the device stay alive,
2. make time valid,
3. make samples mathematically correct,
4. make ring writes gap-free,
5. make scheduling deterministic,
6. reduce buffering,
7. make silence safe.

That order matters. Later fixes only worked because the earlier layers were already correct.
