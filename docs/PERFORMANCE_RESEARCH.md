# Minos / dante-patchbox — Performance Research

> Comprehensive research into further latency, jitter, reliability, and performance
> improvements across all layers of the stack.
>
> **Scope:** research only — no code changes.  
> **Hardware assumption:** production nodes always have hardware-assisted PTP
> (NIC-level timestamping). Software-PTP limitations are not a constraint.  
> **Baseline:** ~3.5–4 ms Minos-contributed latency (1 ms flow + <0.5 ms wakeup +
> 1 ms lead_samples + 1 ms TX).

---

## Table of Contents

1. [OS & Kernel](#1-os--kernel)
2. [Network Stack](#2-network-stack)
3. [Audio Engine (device.rs)](#3-audio-engine-devicers)
4. [DSP Chain (matrix / eq / limiter)](#4-dsp-chain)
5. [Inferno Library Integration](#5-inferno-library-integration)
6. [Memory & Allocator](#6-memory--allocator)
7. [Observability & Telemetry](#7-observability--telemetry)
8. [Unconventional / High-Risk Ideas](#8-unconventional--high-risk-ideas)
9. [Summary Table](#9-summary-table)

---

## 1. OS & Kernel

### 1.1 PREEMPT_RT Kernel

The single highest-impact OS change available.

The current kernel on dante-doos is `6.19.11-arch1-1` — a **vanilla** kernel with no
real-time patch. Under vanilla scheduling, even a SCHED_FIFO thread can experience
unbounded latency spikes because the kernel itself holds non-preemptible spinlocks
during interrupt handling (e.g., memory allocation, page faults, NIC IRQ).

With `PREEMPT_RT`:
- Spinlocks become preemptible mutexes.
- Hard IRQ handlers run in a threaded context (SCHED_FIFO elevatable).
- `schedule_hrtimer` latency can drop from 100–300 µs worst-case to <20 µs.
- Measured jitter reduction in comparable AoIP stacks: 10× to 30× lower worst-case
  wakeup latency.

**How to apply:**
```
# Arch Linux: use linux-rt or linux-rt-lts from AUR
pacman -S linux-rt linux-rt-headers
```

After switch:
- Elevate the NIC IRQ thread to SCHED_FIFO 50:
  ```bash
  IRQNUM=$(grep enp1s0 /proc/interrupts | awk -F: '{print $1}' | tr -d ' ')
  chrt -f -p 50 $(cat /proc/irq/$IRQNUM/smp_affinity_list)
  ```
- The patchbox audio thread stays at SCHED_FIFO 90 (already configured).

**Risk:** low — Arch AUR packages are well-maintained, rolling updates require
re-applying the patch set but the AUR PKGBUILD handles this automatically.

---

### 1.2 CPU Isolation & Core Pinning

On multi-core hardware, isolate at least one core exclusively for the audio thread.

```
# /etc/default/grub
GRUB_CMDLINE_LINUX="isolcpus=3 nohz_full=3 rcu_nocbs=3"
```

Then pin the patchbox process to that core:
```bash
# In systemd unit or ExecStartPre=
taskset -c 3 ./patchbox
```

**Benefits:**
- No kernel housekeeping (RCU callbacks, timer ticks) on the isolated core.
- No OS scheduler interference between callbacks.
- The `nohz_full` flag turns off the periodic timer tick on core 3 → 0 jitter from
  tick interrupt.

**EliteDesk GX-212JC has 2 cores.** With isolation, one core is dedicated to audio
and the other handles all OS work + HTTP API + Tokio async. This is tight but viable.
On a more capable production node (4+ cores) this is a clear win.

---

### 1.3 IRQ Affinity

The NIC IRQ should not fire on the audio core:

```bash
# Move NIC IRQ to core 0, leaving core 1 (or 3) for audio
echo 1 > /proc/irq/$IRQNUM/smp_affinity   # bitmask: CPU 0 only
```

Also move any other high-frequency IRQs (USB, SATA) away from the audio core.

---

### 1.4 `mlockall` — Memory Locking

The audio callback must never trigger a page fault. Page faults cause
`do_page_fault()` to run under interrupt context, adding 50–500 µs latency spikes.

```rust
// In main.rs, before spawning the audio thread:
unsafe {
    libc::mlockall(libc::MCL_CURRENT | libc::MCL_FUTURE);
}
```

This locks all current and future mapped pages into RAM. Combined with
`PREEMPT_RT` + CPU isolation, this eliminates the last major source of
non-determinism in the audio thread.

**Rust:** the `libc` crate exposes this directly. No additional dependencies.

---

### 1.5 Huge Pages (THP / Static)

The TX ring buffer is `RING_SIZE * 4 bytes = 128 KB` for f32 samples, or
`32768 * 4 bytes = 128 KB`. At the default kernel page size of 4 KB, this spans
32 pages with potential TLB misses.

Using a 2 MB huge page for the ring buffer eliminates TLB churn in the hot path:

```rust
// Allocate with MAP_HUGETLB | MAP_ANONYMOUS
let ptr = mmap(
    null_mut(), size,
    PROT_READ | PROT_WRITE,
    MAP_PRIVATE | MAP_ANONYMOUS | MAP_HUGETLB,
    -1, 0
);
```

Or enable transparent huge pages (THP) for the process:
```bash
echo "always" > /sys/kernel/mm/transparent_hugepage/enabled
```

**Expected impact:** measurable reduction in L1/L2 cache miss rate in the callback
hot path, especially for the ring buffer read/write scan.

---

### 1.6 CPU Governor & Frequency Scaling

On embedded hardware, the default governor is often `powersave` or `schedutil`,
which scales down CPU frequency under low load. The audio callback fires every ~1 ms
and may not trigger a frequency ramp-up in time.

```bash
# Force max performance on all cores
cpupower frequency-set -g performance
# Or per-core:
echo performance > /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor
```

**For production nodes with hardware PTP:** this is a prerequisite, not optional.
A CPU running at 400 MHz instead of 1.2 GHz will fail real-time deadlines even with
SCHED_FIFO.

---

### 1.7 Disable C-States

Deep CPU sleep states (C2, C3, C6) cause wakeup latencies of 50–300 µs. The audio
thread wakes every ~1 ms, so a C-state entry between callbacks will cause a late
wakeup.

```bash
# Disable deep C-states via kernel parameter
GRUB_CMDLINE_LINUX="... processor.max_cstate=1 intel_idle.max_cstate=0"

# Or at runtime:
cpupower idle-set -D 1   # disable states deeper than C1
```

---

## 2. Network Stack

### 2.1 Hardware PTP (Assumed Available on Production)

The production node will have hardware PTP support (NIC-level timestamping). This
transforms PTP from software interpolation to nanosecond-accurate hardware events.

**Expected impact on Minos:**
- PTP sync accuracy: from ±10–50 µs (software) to ±10–100 ns (hardware).
- `tx_latency_ns` can potentially drop from 1 ms to 250–500 µs because the clock
  alignment is trustworthy.
- `rx_jitter_samples` can potentially drop from 48 to 16–24 samples (0.33–0.5 ms)
  since clock drift is negligible.

**How to verify hardware timestamping is active:**
```bash
ethtool -T enp1s0
# Should report: hardware-transmit, hardware-receive, hardware-raw-clock
```

Ensure statime is configured to use hardware timestamping in `statime.toml`.

---

### 2.2 Dedicated Audio VLAN

Dante traffic shares the current network with general LAN traffic (mDNS, HTTP, etc.).
A dedicated VLAN for audio:
- Eliminates broadcast domain noise from other devices.
- Allows switch QoS to be configured without ambiguity.
- Prevents non-audio traffic bursts from stealing bandwidth or inducing Dante
  retransmission.

**Architecture:**
```
VLAN 10 (audio): dante-doos ↔ Shure MXWANI8 ↔ Dante endpoints
VLAN 1  (mgmt):  dante-doos ↔ HTTP API ↔ inferno-central ↔ management PC
```

dante-doos would need two network interfaces (or a managed switch with 802.1Q trunk).

---

### 2.3 Switch QoS — DSCP / 802.1p

Dante natively marks audio packets with DSCP `EF` (Expedited Forwarding, `0x2E`).
Most commodity switches ignore DSCP by default.

Configure the switch to honour DSCP or 802.1p markings:
- **DSCP EF (46)** → highest queue (strict priority)
- **DSCP CS7 (56)** → PTP traffic → same or next queue

On a managed switch (e.g., UniFi/Cisco SG series):
```
class-map match-any AUDIO_DSCP
  match dscp ef
policy-map AUDIO_QOS
  class AUDIO_DSCP
    priority 100%
interface GigabitEthernet 0/1
  service-policy output AUDIO_QOS
```

**Impact:** eliminates queue-induced jitter from competing traffic. Most relevant in
environments with video streaming or large file transfers on the same switch.

---

### 2.4 NIC Driver Tuning — Interrupt Coalescing

NIC interrupt coalescing batches multiple received packets before raising a CPU
interrupt. Default coalescing is optimised for throughput, not latency.

```bash
# Disable coalescing for minimum latency
ethtool -C enp1s0 rx-usecs 0 tx-usecs 0 rx-frames 1 tx-frames 1
```

For audio, each Dante RTP packet should trigger an interrupt immediately. At 48 kHz
with 48-sample blocks, Dante sends a packet every 1 ms — coalescing delays even a
single packet causes a callback to block.

**Tradeoff:** disabling coalescing raises CPU usage slightly (more frequent
interrupts). On a dedicated audio node this is fine.

---

### 2.5 Jumbo Frames

Dante uses 1500-byte MTU by default. Jumbo frames (MTU 9000) are not directly
applicable to Dante's 48-sample-per-packet flow, but they benefit:
- Control traffic (mDNS, device enumeration).
- Future bulk-transfer paths (config sync, firmware updates over the audio network).

For a pure audio path, jumbo frames offer no latency benefit and may increase
per-packet processing overhead. **Not recommended for the audio interface.**

---

### 2.6 `SO_PRIORITY` / `SO_MARK` on Dante Sockets

If Dante sockets are accessible (they're inside the inferno library), setting
`SO_PRIORITY = 7` (network-layer priority) on the RX socket ensures the kernel's
`tc` qdisc prioritises Dante packets above other outgoing traffic from the same host.

This is a host-side complement to switch QoS. Check if inferno exposes socket options.

---

### 2.7 `net.core.rmem_max` and Dante Receive Buffer

Ensure the kernel socket receive buffer is large enough to absorb burst packets
without drops:

```bash
# /etc/sysctl.d/99-audio.conf
net.core.rmem_max = 26214400
net.core.wmem_max = 26214400
net.core.rmem_default = 1048576
net.ipv4.udp_rmem_min = 8192
```

A dropped UDP packet means a missing Dante RTP packet → silence gap → resync event.

---

## 3. Audio Engine (device.rs)

### 3.1 Reduce `tx_latency_ns` Below 1 ms

`tx_latency_ns = 1_000_000` (line 127 in device.rs) is hardcoded and advertised to
all downstream Dante receivers. This controls the negotiated Dante flow latency —
the delay between the transmitter sending and the receiver playing.

With hardware PTP providing sub-100 ns clock accuracy, the 1 ms advertised latency
has a ~10× safety margin. Reducing it:

| `tx_latency_ns` | Flow latency | Risk |
|---|---|---|
| 1,000,000 (current) | 1 ms | Safe |
| 750,000 | 0.75 ms | Very low with HW PTP |
| 500,000 | 0.5 ms | Low with HW PTP, requires testing |
| 250,000 | 0.25 ms | Aggressive, some receivers may reject |

**Action:** make `tx_latency_ns` a config parameter. Allow per-deployment tuning
without recompilation.

---

### 3.2 Reduce `lead_samples` to 32 or 16

Current default is `lead_samples = 48` (1 ms). With PREEMPT_RT + CPU isolation,
wakeup jitter drops to <20 µs, making a 1 ms write-ahead excessively conservative.

| `lead_samples` | Write-ahead | Safe under |
|---|---|---|
| 48 (current) | 1 ms | Vanilla kernel |
| 32 | 0.67 ms | PREEMPT_RT, no CPU isolation |
| 16 | 0.33 ms | PREEMPT_RT + CPU isolation |
| 8  | 0.17 ms | PREEMPT_RT + CPU iso + tickless |

**Action:** already configurable — tune per-deployment based on measured wakeup
jitter. Document a measurement procedure in ops runbook.

---

### 3.3 Reduce `rx_jitter_samples` Below 48

Same rationale as `lead_samples`. The inferno RX jitter buffer absorbs network
jitter. With a managed switched network (not WiFi) and hardware PTP:

| `rx_jitter_samples` | Buffer | Safe under |
|---|---|---|
| 48 (current) | 1 ms | Any network |
| 32 | 0.67 ms | Managed switch + HW PTP |
| 16 | 0.33 ms | Dedicated VLAN + HW PTP |
| 8  | 0.17 ms | Aggressive — requires measurement |

---

### 3.4 Self-Correcting `write_pos` Drift Detection

The current design uses linear ring advance (`write_pos += block`) with a hard snap
on large gaps. This is correct but loses any visibility into slow drift between
`write_pos` and `tx_ptp + lead_samples`.

**Proposal:** log (not act on) the drift every N callbacks:
```rust
let drift = (write_pos as i64) - (tx_ptp_samples + lead_samples as i64);
```

Logging drift without acting on it gives insight into long-term clock rate differences
between the host's wall clock (used for initial alignment) and PTP. Over hours,
a 1 ppm crystal difference = 3.6 ms/hour drift. This is absorbed by the ring buffer
silently today — making it visible enables proactive tuning.

---

### 3.5 Configurable Block Size (Frame Size)

Dante sends 48 samples per packet at 48 kHz = 1 ms blocks. The inferno library
may support aggregation to 96 or 128 samples for lower callback overhead at the
cost of higher latency. For an installation where 2 ms latency is acceptable but
CPU load is constrained, larger blocks reduce:
- DSP processing calls per second (halved at 96 samples).
- Triple-buffer polling rate.
- OS scheduling pressure.

This is an inferno library parameter — worth investigating.

---

### 3.6 Remove Per-Callback Config Triple-Buffer Poll

The config triple-buffer is pushed every 10 ms from a background task. The audio
callback pulls from `tb_output` on every callback (every ~1 ms). This means 10 polls
per config update, 9 of which return no change.

Consider:
- Poll the triple-buffer only every Nth callback (e.g., every 5 = 5 ms latency for
  config changes, near-invisible to users).
- Or use an `AtomicBool` dirty flag: set by the background task, checked cheaply in
  the callback.

**Savings:** minor CPU reduction, but reduces cache-line churn on the shared
triple-buffer slot.

---

### 3.7 Silence Detection Optimisation

The current silence guard zero-fills the ring from `write_pos` to `tx_current +
lead_samples` on every `block == 0` callback. If the silent period is long
(e.g., ambient noise floor during closed hours), this writes hundreds of zeros
per callback unnecessarily.

**Optimisation:** track a `silence_filled_to: u64` watermark. Only fill forward
from the last-filled position, not from scratch each time.

---

## 4. DSP Chain

### 4.1 SIMD Vectorisation (AVX2 / SSE4.2 / NEON)

The inner loops in `eq.rs` and `limiter.rs` process audio sample-by-sample in scalar
Rust. The compiler can auto-vectorise under the right conditions, but the biquad
filter recurrence relation has a serial dependency (`s1`, `s2` depend on the previous
iteration) that defeats auto-vectorisation.

**Approach 1 — Parallel interleaved channels:**
Process two or four channels of the same filter simultaneously using SIMD:
```rust
// Instead of: for ch in 0..4 { filter[ch].process(sample[ch]) }
// Use 4-wide SIMD: load 4 samples, compute 4 filters simultaneously
let samples = f32x4::from([s0, s1, s2, s3]);
// ... vectorised biquad ...
```
This gives 4× throughput for the EQ stage across channels.

**Approach 2 — `std::simd` (portable SIMD, stabilised in Rust 1.78):**
```rust
use std::simd::f32x8;
```
Write the gain/mix loop using `f32x8` — the matrix mixing (`out += in * gain`) is
embarrassingly parallel and vectorises trivially.

**Approach 3 — `rubato` or `dasp` crate:**
Consider the `dasp` crate for signal processing primitives — it provides hand-tuned
SIMD implementations of common DSP operations.

**Compiler flags for SIMD:**
```toml
# .cargo/config.toml
[target.x86_64-unknown-linux-gnu]
rustflags = ["-C", "target-cpu=native"]
```
This enables all CPU-specific instructions (AVX2, FMA on x86; NEON on ARM).

---

### 4.2 FMA (Fused Multiply-Add) for Biquad

The biquad inner loop is:
```rust
y = b0*x + s1
s1 = b1*x - a1*y + s2
s2 = b2*x - a2*y
```

Each line is a multiply-add or multiply-subtract — exactly what FMA covers.
With `target-cpu=native` on x86-64 (Haswell+), the compiler should emit `VFMADD`
instructions. On AMD GX-212JC (Jaguar architecture), FMA3 may not be available —
verify with `grep fma /proc/cpuinfo`.

For the production node (assumed more capable), FMA gives ~10–20% throughput
improvement on the DSP chain.

---

### 4.3 Denormal Flushing (FTZ / DAZ)

Denormal floating-point numbers (very small values near zero) cause massive CPU
slowdowns — processing a denormal can be 10–100× slower than a normal float because
the CPU microcode handles them specially.

In audio processing, denormals appear naturally in EQ filter states (`s1`, `s2`)
when processing near-silence:
```rust
// Set FTZ (Flush-To-Zero) + DAZ (Denormals-Are-Zero) on the audio thread
unsafe {
    let mut csr = _mm_getcsr();
    csr |= 0x8000; // FTZ
    csr |= 0x0040; // DAZ
    _mm_setcsr(csr);
}
```

On ARM/NEON, the equivalent is setting `FPCR.FZ = 1`.

**Expected impact:** prevents rare 10× latency spikes during silence-to-signal
transitions. Critical for a real-time audio system.

---

### 4.4 Wire `InputChannelDsp` (Gate / Compressor / HPF / LPF)

The `InputChannelDsp` structs are fully defined in `config.rs` (gate, compressor,
HPF, LPF per input) but not yet wired into `matrix.rs::process()`.

From a **performance** perspective (not just features), input-side processing is
more efficient than output-side:
- Gate/expander on input: eliminates background noise from being mixed into all
  outputs. Reduces the effective signal level, which reduces limiter work downstream.
- HPF on input: removes sub-sonic energy that wastes headroom and limiter gain
  reduction cycles.
- Compressor on input: smooths level variations, reducing peak excursions that
  trigger the output limiter.

Wiring input DSP is both a feature completion and a performance win.

---

### 4.5 Pre-Compute Gain Linear Values

`db_to_linear()` calls `f32::powf(10.0, db/20.0)` which involves a transcendental
function. This is called in the matrix hot path for every input/output channel per
callback.

Since gain values change only on user interaction (not per-sample), pre-compute and
cache the linear values:
```rust
// In config.rs or AppState
pub input_gain_linear: Vec<f32>,  // updated when config changes
pub output_gain_linear: Vec<f32>,
```

In the audio callback, read pre-computed linear values directly. Eliminates
transcendental math from the RT path entirely.

---

### 4.6 Limit Coefficient Recalculation Rate

`PerOutputDsp::sync()` is called every callback (every ~1 ms). It checks config
changes with floating-point epsilon comparisons and, if changed, recomputes biquad
coefficients (involves `sin`, `cos`, `exp` — expensive transcendental operations).

This is already guarded by change detection. However, the epsilon comparison itself
runs every callback. Consider:
- A generation counter: config struct carries a `u64` version; callback only calls
  `sync()` when version changed.
- Or: coalesce coefficient updates to the background task, writing a pre-computed
  `Coeffs` struct to the triple buffer instead of raw `EqConfig`. The callback only
  copies coefficients — zero transcendental math in the RT path.

---

### 4.7 Parallel Output Processing

Currently, outputs are processed sequentially:
```rust
for (i, output) in outputs.iter_mut().enumerate() {
    // ... mix + EQ + limiter for output i
}
```

For systems with many zones (8, 16, 32), this is linear in zone count. Each zone's
processing is independent — they can run in parallel.

**Option A:** Rayon `par_iter_mut()` — trivial change but introduces thread pool
overhead for small zone counts. Beneficial only for 8+ zones.

**Option B:** SIMD across zones — process 4 zones simultaneously using `f32x4`,
packing one sample per lane per zone. Works well for the gain/mix stage; harder for
the biquad.

---

### 4.8 Sample Rate as a Generic Parameter

`SAMPLE_RATE` is hardcoded to `48_000.0` in `eq.rs`. Making it a `const` generic
parameter allows the compiler to fold the sample-rate divisions at compile time:

```rust
struct BiquadFilter<const SR: u32 = 48000>;
```

For a 48 kHz-only system this is cosmetic. But if 96 kHz support is ever added,
this avoids runtime division by sample rate in the hot path.

---

## 5. Inferno Library Integration

### 5.1 Investigate Sub-1 ms Flow Subscription Latency

The current `tx_latency_ns = 1_000_000` (1 ms) is the Dante-advertised TX flow
latency. The inferno library negotiates this with downstream receivers. Whether
inferno supports 500 µs or 250 µs flow latency is currently unknown.

**Research action:**
- Read `flows_tx.rs` and `flows_rx.rs` in the inferno fork.
- Check the AES67/Dante protocol spec: what is the minimum supported latency for
  AES67 streams? (AES67 mandates ≥1 ms but Dante extensions may go lower.)
- Test with the Shure MXWANI8: does it reject subscriptions with `tx_latency_ns <
  1_000_000`? Log the subscription negotiation response.

---

### 5.2 `rx_jitter_samples` — Inferno's Internal Jitter Buffer

The inferno library absorbs network jitter before delivering samples to the callback.
The `rx_jitter_samples` parameter controls this buffer depth.

With hardware PTP and a managed switch, the dominant source of jitter is the host
OS scheduler (SCHED_FIFO wakeup latency). After applying PREEMPT_RT:
- Scheduler jitter: <20 µs typical, <100 µs worst-case.
- Network jitter (managed switch, no congestion): <10 µs.
- Total: <120 µs → `rx_jitter_samples = 6` (0.125 ms) is theoretically achievable.

This requires careful measurement. Start at 32, reduce by 50% until glitches appear,
then add a 2× safety margin.

---

### 5.3 TransferNotifier — Avoid Tokio Overhead

The current wakeup path is:
```
inferno RX callback → TransferNotifier → Tokio Notify → async callback
```

This crosses a Tokio scheduler boundary. On a single-threaded Tokio runtime, this
may add up to 50–200 µs of scheduling latency if other tasks are running.

**Investigation:** profile how long between `TransferNotifier` signal and audio
callback invocation using `std::time::Instant` measurements. If >50 µs, consider
a dedicated real-time thread (non-Tokio) for the audio callback:
```rust
std::thread::Builder::new()
    .name("audio-rt".into())
    .spawn(|| {
        set_rt_priority(90);
        loop {
            notify.wait(); // raw condvar, not Tokio
            process_audio();
        }
    });
```

This removes Tokio entirely from the critical path.

---

### 5.4 Multicast Packet Pacing

Dante uses multicast UDP for audio streams. High-channel-count configurations can
send many packets in a burst at the start of each millisecond. This micro-burst can
cause switch queue overflow and retransmission.

**Investigation:**
- Check if inferno supports packet pacing (spreading TX packets across the 1 ms
  window instead of bursting).
- If not, OS-level pacing with `tc` and the `fq` qdisc:
  ```bash
  tc qdisc add dev enp1s0 root fq maxrate 100mbit
  ```
  The `fq` qdisc paces flows, smoothing bursts without adding significant latency.

---

### 5.5 PTP Clock Socket (`/tmp/ptp-usrvclock`) Latency

Minos reads PTP time via a Unix domain socket to statime. Each read involves:
- A `sendmsg()` syscall to request the timestamp.
- A `recvmsg()` syscall to receive the response.
- One context switch (socket is AF_UNIX, kernel-mediated).

The startup PTP poll loop does this 200 times (2-second timeout). At runtime, PTP
is read once at callback start for the initial alignment.

**Optimisation:** once aligned, avoid re-reading PTP every callback. Instead:
- Record `ptp_at_start` and `wall_at_start` once.
- Calculate `ptp_now ≈ ptp_at_start + (Instant::now() - wall_at_start)`.
- Interpolate using the known sample rate and wall clock.
- Re-sync to actual PTP every 10 seconds to correct for crystal drift (~1 ppm).

This eliminates the Unix socket round-trip from the hot callback path entirely.

---

## 6. Memory & Allocator

### 6.1 Custom RT-Safe Allocator for the Audio Thread

The global Rust allocator (`jemalloc` by default in release, or `ptmalloc`) is not
real-time safe. It acquires a mutex that can be held by another thread, causing
unbounded priority inversion on the audio thread if it ever allocates.

Rust's zero-allocation audio callback (no `Vec::push`, no `Box::new`) is correct.
However, DSP state (`BiquadFilter`, `PerOutputDsp`) resides on the heap and is
accessed from the callback.

**Short term:** audit the callback path for any hidden allocations (e.g., closure
captures, `format!()` macro, `eprintln!`). Use `cargo-flamegraph` to confirm.

**Long term:** consider the `rtrb` crate (lock-free ring buffer for audio) and
`baseplug` patterns for fully allocation-free DSP state management. For extreme
cases, a custom slab allocator pre-allocated at startup guarantees no mutex in
the callback.

---

### 6.2 Reduce False Sharing on Atomic Counters

`audio_callbacks` and `resyncs` are `AtomicU64` values in `AppState`. The audio
thread increments them on every callback. If they share a cache line with other
frequently-read fields (e.g., Dante connection state), the atomic increment causes
cache invalidation on the API server thread every callback.

**Fix:** align these atomics to cache line boundaries:
```rust
#[repr(align(64))]
struct AudioCounters {
    callbacks: AtomicU64,
    resyncs: AtomicU64,
}
```

This is a micro-optimisation but relevant at 1000 callbacks/second with multiple
readers.

---

### 6.3 Pre-Fault Stack Pages

Stack page faults can occur the first time a thread uses a stack frame deeper than
previously accessed. In C realtime audio, this is solved by `prefault_stack()`.
In Rust:

```rust
fn prefault_stack() {
    let mut dummy = [0u8; 256 * 1024]; // 256 KB deep
    std::hint::black_box(&mut dummy);   // prevent optimisation
}
```

Call this once from the audio thread before the main callback loop. Ensures all
stack pages are mapped and faulted before real-time work begins.

---

## 7. Observability & Telemetry

End-to-end visibility is required to validate any of the above improvements. Without
measurement, tuning is guesswork.

### 7.1 Callback Timing Histogram

Add a lock-free histogram of per-callback timing in the audio thread:
```rust
// In device.rs callback:
let start = Instant::now();
// ... process ...
let elapsed_us = start.elapsed().as_micros() as u32;
histogram.record(elapsed_us);
```

Expose as `GET /metrics` (Prometheus-compatible):
```
patchbox_callback_duration_us{quantile="0.5"}  450
patchbox_callback_duration_us{quantile="0.99"} 820
patchbox_callback_duration_us{quantile="0.999"} 4200
patchbox_callback_duration_us_max 18500
```

The P99.9 value reveals tail latency — the real risk for audio glitches.

**Crate:** `hdrhistogram` (lock-free, HDR histogram — ideal for latency tracking).

---

### 7.2 `write_pos` Drift Logging

Log the signed delta `write_pos - (tx_ptp_samples + lead_samples)` every 5 seconds.
A drifting value indicates a crystal frequency mismatch or PTP sync issue. Export
as a Prometheus gauge.

---

### 7.3 Resync Rate as an SLO

`resyncs` (already tracked as an atomic) should be treated as an SLO violation
counter. Expose it as a Prometheus counter and set an alert threshold:
- **0 resyncs/hour**: nominal operation.
- **>1 resync/hour**: investigate network or PTP issues.
- **>10 resyncs/hour**: user-audible glitches likely — page on-call.

---

### 7.4 Per-Callback Wakeup Latency

Measure the time between when inferno signals `TransferNotifier` and when the
callback actually starts executing. This requires a timestamp from inside inferno
or a clock capture at the Notify signal:
```rust
// In the Notify receiver:
let wakeup_start = Instant::now();
notify.notified().await;
let wakeup_latency = wakeup_start.elapsed();
```

This distinguishes between audio processing latency and scheduling latency — the two
must be measured separately to diagnose glitches.

---

### 7.5 PTP Offset Tracking in `/health`

Extend the `/health` endpoint to report PTP offset and RMS jitter. Read these from
the statime Unix socket:
```json
{
  "ptp": {
    "synced": true,
    "offset_ns": 43,
    "rms_jitter_ns": 12,
    "grandmaster": "00:1d:c1:ff:fe:11:22:33"
  }
}
```

This makes PTP quality visible in inferno-central monitoring without requiring a
separate PTP monitoring tool.

---

### 7.6 Network Packet Timestamp Pipeline

For production deployments, instrument the Dante RX packet path with packet
timestamps:
- Record `recv_timestamp` (SO_TIMESTAMPING kernel receive timestamp) on each Dante
  packet.
- Compare against the PTP timestamp embedded in the RTP header.
- Measure per-packet network jitter → feeds directly into tuning `rx_jitter_samples`.

This requires inferno library support for `SO_TIMESTAMPING` or a side-channel
listener on the Dante port.

---

### 7.7 Flame Graph Profiling

Profile the audio callback with `perf` + `cargo-flamegraph` to find unexpected hot
paths:
```bash
# On the production node:
perf record -g -p $(pidof patchbox) -F 999 -- sleep 10
perf script | stackcollapse-perf.pl | flamegraph.pl > flame.svg
```

Verify that the hot path is dominated by DSP work (expected) rather than by system
calls, allocations, or synchronisation primitives (problems).

---

## 8. Unconventional / High-Risk Ideas

### 8.1 DPDK — Kernel-Bypass Networking

DPDK (Data Plane Development Kit) bypasses the kernel network stack entirely, polling
NIC hardware directly from userspace. Used in high-frequency trading and 5G telco for
sub-microsecond packet handling.

**For Dante:**
- Eliminate all kernel network overhead: no `recv()` syscall, no socket buffer, no
  IRQ context switch.
- Packet-to-callback latency: ~1–5 µs (vs. current ~50–200 µs).
- Would require a DPDK-aware Dante/inferno implementation.

**Feasibility:** very high effort. Would require forking inferno to use DPDK's PMD
(Poll Mode Driver) instead of kernel sockets. Not justified unless latency targets
drop below 500 µs total.

**A lighter alternative:** XDP (eXpress Data Path) — a kernel hook that runs eBPF
before the network stack. Can filter and redirect Dante packets to a userspace ring
without full DPDK complexity. See §8.2.

---

### 8.2 XDP / eBPF Packet Steering

XDP allows writing an eBPF program that intercepts Dante UDP packets at the NIC
driver level, before the kernel socket layer:

```c
// eBPF XDP program: redirect Dante packets to a dedicated ring
SEC("xdp")
int dante_steer(struct xdp_md *ctx) {
    // match UDP dst port 319 (PTP) or 8700+ (Dante RTP)
    // redirect to AF_XDP socket (zero-copy)
    return bpf_redirect_map(&xdp_map, rx_queue_index, 0);
}
```

Combined with an `AF_XDP` socket, this delivers Dante packets directly to a
userspace ring buffer with zero kernel copies.

**Expected benefit:** 20–50 µs reduction in per-packet latency, elimination of
kernel socket overhead.

**Feasibility:** medium effort, high reward. XDP is production-stable since Linux
5.4. Would require inferno to support `AF_XDP` as a transport option.

---

### 8.3 `io_uring` for Network I/O

`io_uring` provides asynchronous I/O via a shared memory ring buffer between kernel
and userspace, avoiding per-syscall overhead. For UDP audio sockets:
- Submit batched `IORING_OP_RECVMSG` operations.
- Kernel fills the ring without syscall-per-packet overhead.
- Completion events are polled (no wakeup latency) or can signal via eventfd.

**Benefit vs. cost:** For 48 kHz with one packet per millisecond, syscall overhead
is minimal compared to DSP work. `io_uring` pays off more for high packet-rate
scenarios (96 kHz, many channels).

---

### 8.4 Dedicated Hardware Audio DSP Co-Processor

For extreme performance, offload DSP to a dedicated co-processor:
- **FPGA (Xilinx Artix / Intel Cyclone):** EQ, limiter, matrix mixing in hardware.
  Latency: ~5 µs for the DSP chain (vs. ~20 µs in software). Deterministic with zero
  jitter.
- **ARM Cortex-M with DMA:** A low-cost MCU (e.g., STM32H7) can run the DSP chain
  in hardware with DMA transfer from/to the main CPU via SPI/I2S. Main CPU handles
  Dante and routing; MCU handles sample processing.
- **SHARC DSP (Analog Devices):** Purpose-built floating-point audio DSP. Used in
  professional mixing consoles. BSP complexity is high.

**Feasibility:** very high effort, significant hardware cost. Only justified for a
>32-zone installation where the software DSP bottleneck becomes a limiting factor.

---

### 8.5 PTP-Disciplined Clock Feed to the Audio Thread

Instead of reading PTP via Unix socket at startup and interpolating, use a kernel
`PHC` (PTP Hardware Clock) device directly:

```c
// Open the PTP hardware clock device
int fd = open("/dev/ptp0", O_RDWR);
struct ptp_clock_time ts;
ioctl(fd, PTP_CLOCK_GETTIME, &ts);
```

Reading `PHC` via `ioctl` is a direct hardware register read — no socket, no context
switch, no statime daemon in the critical path. Latency: ~1 µs.

The audio thread can call `PTP_CLOCK_GETTIME` on every callback without penalty.
This eliminates the interpolation drift described in §5.5 and removes statime as a
single point of failure for audio timing.

**Feasibility:** medium effort. Requires `CAP_SYS_TIME` or opening `/dev/ptp0` at
startup (before privilege drop). Only valid with hardware PTP NICs (assumed for
production).

---

### 8.6 Lock-Free Scene Snapshots for Zero-Latency Scene Changes

Currently, scene recall replaces the `PatchboxConfig` and pushes to the triple
buffer. A scene change will propagate within 10 ms (next triple-buffer push).

For instantaneous scene changes (e.g., "stage open" automation), pre-render scene
configs as lock-free snapshots in a fixed-size array. The audio callback reads
the active snapshot index from an `AtomicUsize` — updated atomically by the scene
scheduler. Scene change latency: one callback period (~1 ms), zero mutex.

---

### 8.7 Speculative Pre-warming for Cold-Start Jitter

At startup, the audio callback is cold: instruction cache not warmed, branch
predictor not trained. The first 50–100 callbacks may be slower than steady state.

**Mitigation:** run a `dry_run()` pre-warm pass before the first real audio callback:
```rust
// Call matrix::process() with dummy buffers 100 times to warm caches
for _ in 0..100 {
    matrix::process(&dummy_inputs, &mut dummy_outputs, &config, &mut dsp, 48000.0);
}
```

This eliminates cold-start glitches in the first second of operation — particularly
noticeable during service restarts while audio is playing.

---

## 9. Summary Table

| Category | Idea | Est. Impact | Effort | Risk |
|---|---|---|---|---|
| **OS/Kernel** | PREEMPT_RT kernel | ★★★★★ jitter | Medium | Low |
| **OS/Kernel** | CPU isolation + `nohz_full` | ★★★★ jitter | Low | Low |
| **OS/Kernel** | `mlockall` — memory locking | ★★★ jitter | Very Low | Very Low |
| **OS/Kernel** | Disable C-states | ★★★ latency | Very Low | Very Low |
| **OS/Kernel** | CPU governor = performance | ★★★ reliability | Very Low | Very Low |
| **OS/Kernel** | IRQ affinity | ★★ jitter | Low | Low |
| **OS/Kernel** | Huge pages for ring buffer | ★ throughput | Low | Low |
| **Network** | Hardware PTP (production) | ★★★★★ accuracy | None (given) | None |
| **Network** | Dedicated audio VLAN | ★★★ reliability | Medium | Low |
| **Network** | Switch QoS / DSCP | ★★★ jitter | Medium | Low |
| **Network** | NIC interrupt coalescing off | ★★ latency | Very Low | Very Low |
| **Network** | Socket receive buffer tuning | ★★ reliability | Very Low | Very Low |
| **Audio Engine** | `tx_latency_ns` → config param | ★★★★ latency | Very Low | Low |
| **Audio Engine** | `lead_samples` → 16–32 | ★★★ latency | Very Low | Low |
| **Audio Engine** | `rx_jitter_samples` → 16–32 | ★★★ latency | Very Low | Low |
| **Audio Engine** | PHC direct read (§5.5, §8.5) | ★★★ accuracy | Medium | Low |
| **Audio Engine** | Drift logging | ★★ observability | Very Low | None |
| **DSP** | FTZ/DAZ denormal flushing | ★★★ reliability | Very Low | Very Low |
| **DSP** | Pre-compute gain linear values | ★★ CPU | Very Low | Very Low |
| **DSP** | SIMD vectorisation | ★★★ CPU | High | Medium |
| **DSP** | Generation-counter for sync() | ★ CPU | Low | Very Low |
| **DSP** | Wire InputChannelDsp | ★★ quality | Medium | Low |
| **DSP** | Pre-warm DSP cache at startup | ★★ cold-start | Very Low | None |
| **Inferno** | Dedicated RT audio thread | ★★★ latency | Medium | Medium |
| **Inferno** | Sub-1ms flow latency test | ★★★★ latency | Low (research) | Unknown |
| **Inferno** | Packet pacing / fq qdisc | ★★ reliability | Low | Low |
| **Memory** | False sharing: align atomics | ★ CPU | Very Low | None |
| **Memory** | Pre-fault stack | ★★ cold-start | Very Low | None |
| **Observability** | Callback duration histogram | ★★★★ visibility | Low | None |
| **Observability** | write_pos drift gauge | ★★★ visibility | Very Low | None |
| **Observability** | PTP offset in /health | ★★★ visibility | Low | None |
| **Unconventional** | XDP/eBPF packet steering | ★★★ latency | High | Medium |
| **Unconventional** | Direct PHC read | ★★★ accuracy | Medium | Low |
| **Unconventional** | Lock-free scene snapshots | ★★ latency | Low | Low |
| **Unconventional** | DPDK kernel-bypass | ★★★★★ latency | Very High | High |
| **Unconventional** | FPGA DSP offload | ★★★★ determinism | Very High | High |

---

### Recommended Sequence

**Quick wins (< 1 day each, no code changes):**
1. CPU governor → `performance`
2. Disable C-states
3. `mlockall` — add 2 lines to `main.rs`
4. NIC interrupt coalescing off
5. Socket receive buffer tuning
6. FTZ/DAZ denormals (3 lines in `device.rs`)

**Medium effort (1–3 days each):**
7. PREEMPT_RT kernel installation
8. CPU isolation (`isolcpus` + `taskset`)
9. IRQ affinity
10. Make `tx_latency_ns` a config parameter
11. Add callback timing histogram → `/metrics`
12. PTP offset in `/health`
13. Pre-compute gain linear values
14. Pre-warm DSP cache at startup

**Larger projects (1–2 weeks each):**
15. Dedicated RT audio thread (remove Tokio from hot path)
16. SIMD vectorisation for matrix mix and EQ
17. XDP/eBPF Dante packet steering
18. Direct PHC read for PTP timestamps
19. Dedicated audio VLAN + managed QoS

**Research / experimental:**
20. Sub-1ms Dante flow latency (test with inferno + Shure hardware)
21. inferno `AF_XDP` transport option
22. FPGA DSP co-processor (prototype only)

---

*Last updated: 2026-04-12 — baseline is dante-doos deploy commit `1af777f`.*
