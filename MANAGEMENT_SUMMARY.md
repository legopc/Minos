# Minos Dante Patchbox — Management Summary

> Product and engineering backlog summary. Covers all planned improvements across reliability, features, UX, audio/DSP, and future work. Each item includes rationale, risks, and effort estimates.

---

## Part 1 — Critical Reliability

Issues where data loss, audio outages, or security failures are possible. Address before shipping new features.

---

### 1. Config Write Safety

**What it is.** When settings are saved, the system writes a temporary file and renames it into place. That rename is not flushed to disk before the process exits, so a power cut at the wrong moment can corrupt the config file entirely.

**Why implement.** Corrupt config means the service fails to start on next boot. On an unattended audio node in a live venue this is a serious operational risk.

**Why not.** The fix adds 2–5 ms per save. Saves happen on background threads — never in the audio path — so this is acceptable.

**Risk.** The scene file has an even worse problem: it uses a plain write with no rename at all. Both must be fixed together or the scene file remains fragile.

**Effort.** 2 hours.

---

### 2. Persist Error Propagation

**What it is.** There are 40+ places in the API where a failed config save is silently ignored. The API returns HTTP 200 success even though the change was never written to disk. On the next restart, the change is gone with no explanation.

**Why implement.** Operators have no way to know their changes did not persist, causing confusing incidents where settings revert after a restart.

**Why not.** In-memory state is already changed before the save. On failure, the setting is live until restart but gone after. The fix returns HTTP 500 with a note that the change is live in memory. Rolling back in-memory state is too complex for marginal benefit.

**Risk.** Must be done after item 1 — surfacing persist errors is only meaningful once persist is actually reliable.

**Effort.** 2 hours (bulk replacement macro across 40+ call sites).

---

### 3. Real-Time Callback Panic Guard

**What it is.** The audio callback runs at scheduler priority 90. Any panic inside it crashes the entire process immediately with no safety net.

**Why implement.** Any unexpected condition in the DSP pipeline — divide by zero, out-of-bounds index — takes down the whole node and stops audio completely.

**Why not.** The `catch_unwind` mechanism requires all captured values to be annotated as unwind-safe. The risk is masking a real bug by catching it silently.

**Risk.** After a panic, the DSP processor state may be mid-update. The fix zeros all TX output buffers and lets the next callback reload clean state from the triple-buffer — one buffer-length of silence on a panic.

**Effort.** 1 day.

---

### 4. JWT Secret Persisted to Disk

**What it is.** Every service restart generates a new random auth secret, immediately invalidating all browser sessions.

**Why implement.** Planned or unplanned restarts currently log out every operator. Disruptive on a live system.

**Why not.** The secret file must be written with mode 0600. Deploy and install scripts must ensure the config directory exists with correct ownership. Corrupt or wrong-length files fall back to a fresh ephemeral secret safely.

**Effort.** 2–3 hours.

---

### 5. JWT Token Refresh Endpoint

**What it is.** Auth tokens expire after 8 hours with no refresh mechanism. A browser session left open overnight fails silently on next interaction.

**Why implement.** Operators leave sessions open for days. Silent expiry causes confusing behavior where the UI appears to work but all API calls fail.

**Why not.** The refresh endpoint must be placed *outside* the JWT validation middleware layer, otherwise expired tokens also fail the refresh endpoint. Subtle routing concern.

**Effort.** Half a day.

---

## Part 2 — High Priority Features

Significant operational or workflow impact. Not emergencies.

---

### 7. Input Gain Badge

**What it is.** The input gain control already exists in the backend and data model. A single missing code block in `input_dsp_to_value()` means the badge never renders in the matrix or mixer.

**Why implement.** One-line fix that unlocks trim control directly from the channel strip. Operators need per-channel gain to compensate for different signal levels.

**Why not.** No reason not to.

**Effort.** 2 hours including UI badge styling.

---

### 8. Zipper Noise on Gain Changes

**What it is.** When a fader or gain value changes, the new value takes effect instantly at the sample boundary. At high gains or large jumps this causes an audible click.

**Why implement.** Smooth gain ramping is a basic professional audio requirement.

**Why not.** Moderately complex. Ramp state must be delivered to the real-time callback without allocation, using the existing triple-buffer pattern.

**Risk.** Overlapping ramps (fast fader drag) must start from the current ramped position, not the original value.

**Effort.** 1 day.

---

### 9. Denormal Number Protection

**What it is.** At very low signal levels, floating point numbers can enter a denormal state where the processor takes 100× longer per operation, causing audio dropouts.

**Why implement.** Known and common source of subtle audio glitches that are hard to diagnose after the fact.

**Why not.** No real objection. The fix is a single processor instruction (FTZ + DAZ bits) applied once on the RT thread at startup.

**Effort.** 2 hours.

---

### 10. WebSocket Connection Cleanup

**What it is.** When a browser disconnects abnormally (closed tab, network drop), the server does not reliably close the associated WebSocket state. Zombie connections accumulate and consume memory.

**Why implement.** Slow memory leak on a long-running embedded node. Becomes a reliability issue with many operators connecting and disconnecting.

**Why not.** Requires a cancellation token threading between the send and receive task for each connection, plus an inactivity timeout. Moderate refactor of the WebSocket handler.

**Effort.** Half a day.

---

### 11. Destructive Action Confirmation Dialogs

**What it is.** Actions such as deleting a scene or resetting the system use the browser's built-in `confirm()` dialog, which looks out of place and can be suppressed by browser policies.

**Why implement.** Professional UI quality. Consistent dark-themed modal across all destructive actions.

**Risk.** Four specific call sites across the codebase must all be migrated.

**Effort.** 1 day.

---

## Part 3 — Medium UX Improvements

Quality-of-life improvements for operators. No backend changes required except where noted.

---

### 12. Crosspoint Pending State

**What it is.** When a routing crosspoint is clicked, the cell immediately shows as changed even if the API call is still in flight. Adds a spinner while the request is pending and prevents double-clicks.

**Effort.** Under 1 day.

---

### 13. Mixer Scene Scroll Indicators

**What it is.** When more favourite scenes exist than fit on screen, there is no indication. Left and right arrow buttons appear when content is available off-screen.

**Effort.** Half a day.

---

### 14. DSP Panel Overflow Detection

**What it is.** DSP panels that pop open near the edge of the viewport clip off-screen. The panel flips to the opposite side when it would overflow.

**Effort.** Half a day.

---

### 15. Fader Edit Affordance

**What it is.** Faders can be double-clicked to type a precise value, but there is no visual hint. A pencil icon appears on hover.

**Effort.** 2 hours.

---

### 16. Empty Matrix State Hint

**What it is.** When no routes exist, the matrix is entirely empty with no guidance. A subtle overlay reading "click a cell to create a route" appears when no crosspoints are active.

**Effort.** Half a day.

---

### 17. Peak Hold Meters

**What it is.** Adds a slowly decaying peak line to the signal meters, showing the highest recent level. Standard practice for headroom monitoring.

**Risk.** Decay rate must be chosen carefully — 10 dB/s is the standard.

**Effort.** 1 day.

---

### 18. Keyboard Shortcuts

**What it is.** Adds Ctrl+S to save the current scene, Escape to close panels, question mark to show a help overlay, and similar shortcuts.

**Effort.** 1.5 days.

---

### 19. API Retry with Backoff

**What it is.** Failed API calls currently show an error immediately. A retry wrapper attempts the call again with 100, 200, then 400 ms backoff before reporting failure.

**Effort.** 1 day.

---

### 20. Scene Save/Rename Modal

**What it is.** A proper modal for saving and renaming scenes, replacing the basic browser prompt. Shows a diff of what changed before confirming an overwrite.

**Why not.** Requires a backend PATCH endpoint for scene rename, which does not currently exist.

**Effort.** 2 days.

---

## Part 4 — Audio and DSP Enhancements

Improvements to the quality and correctness of the audio processing pipeline.

---

### 21. DC Blocker on All Inputs

**What it is.** A fixed 0.5 Hz high-pass filter on every input channel. Removes DC offset caused by mic imbalances or phantom power before any other DSP processing.

**Why implement.** DC offset causes clicks when gates open/close and can reduce headroom unexpectedly.

**Why not.** The filter is always on and not user-configurable. This is intentional — it is inaudible and purely protective.

**Effort.** 1–2 hours.

---

### 22. True Peak and LUFS Metering

**What it is.** Broadcast-standard metering. True peak uses 3× oversampling to catch inter-sample peaks that normal peak meters miss. LUFS (Loudness Units relative to Full Scale) is required for broadcast compliance per EBU R128.

**Why not.** Significantly more expensive computation than RMS. The upsampler and K-weighting filter must not affect audio callback timing.

**Risk.** Block-based LUFS accumulator requires careful memory management to avoid in-callback allocation.

**Effort.** 3–4 days.

---

### 23. Scene Recall Crossfade

**What it is.** When a scene is loaded, all parameter changes happen simultaneously and instantly, which can cause audible pops. A configurable crossfade time ramps all parameters smoothly.

**Why not.** Ramp state must be delivered to the RT callback without dynamic allocation. Overlapping ramps (loading a second scene before the first crossfade completes) must be handled gracefully.

**Effort.** 4–6 days.

---

### 24. Per-Output Delay Compensation

**What it is.** A configurable delay in milliseconds on any TX output, to compensate for speaker placement or acoustic distance.

**Why not.** Maximum delay storage is proportional to the max delay time × sample rate × channel count. At 100 ms / 48 kHz / 64 outputs, memory use must be bounded at startup.

**Effort.** 2 days.

---

### 25. Dynamic EQ

**What it is.** An EQ band that only engages above a configurable threshold — combining compression and equalization. Useful for de-essing or corrective EQ that only activates when the signal is problematic.

**Why not.** More expensive than static EQ. Sidechain signal path adds complexity to the DSP pipeline ordering.

**Effort.** 3–5 days.

---

## Part 5 — Major New Features

Significant features requiring substantial design and implementation work.

---

### 26. Internal Submix Buses

**What it is.** Virtual internal channels that multiple inputs can be routed into. Each bus has its own full DSP chain identical to an input channel. The bus output appears as a new row in the routing matrix and can be routed to any TX output — equivalent to group buses on a conventional mixing console.

**Why implement.** Enables sub-grouping, monitor mixes, effects sends, and multi-zone setups without external hardware. Significant differentiator for a software patchbay.

**Why not.** Largest feature in the backlog. Touches the RT pipeline, config schema, API, matrix UI, and mixer UI. However, the full architecture is already designed and risks are well understood.

**Risk.** Low. All bus processors are pre-allocated at startup — no dynamic allocation in the audio callback. All new config fields use backward-compatible defaults so existing installations load unchanged.

**Dependencies.** None. The prerequisite input gain badge fix (item 7) is a 2-hour self-contained change.

| Phase | Scope | Effort |
|-------|-------|--------|
| 1 | Input gain badge fix | 2h |
| 2 | Bus processor + config schema | 2d |
| 3 | API endpoints | 1d |
| 4 | Matrix UI — bus rows | 1d |
| 5 | Mixer UI — bus strips | 1d |
| 6 | System settings | 0.5d |
| 7 | Polish, scene save/load, edge cases | 1d |
| **Total** | | **~7–8 days** |

---

### 27. Mixer AFL/PFL Solo to Local ALSA Soundcard

**What it is.** Solos any input channel to headphones without affecting main outputs. PFL (Pre-Fader Listen) taps the signal post-input-DSP, pre-matrix. The signal routes to the node's internal ALSA soundcard — the onboard hardware audio device such as a Realtek ALC221 or a USB DAC — not a Dante TX channel.

**Why implement.** Solo is a fundamental tool for setup and troubleshooting. Without it, diagnosing a routing problem requires trial and error. Using the local ALSA device means no Dante TX channels are consumed and the PA is never affected.

**Why not.** Introduces two separate audio output paths: Dante (PTP-synchronized) and ALSA (local crystal). Clock drift between them is ~50 ppm, absorbed by the triple-buffer mechanism. Completely imperceptible for diagnostic monitoring.

**Risk.** ALSA device sharing with other system audio services requires `plughw:` prefix for dmix sharing. For critical production use, a dedicated USB headphone DAC is recommended. The ALSA module is behind a compile-time feature flag so CI builds do not require ALSA headers.

| Phase | Scope | Effort |
|-------|-------|--------|
| 1 | ALSA writer module, monitor buffer, triple-buffer plumbing | 1.5d |
| 2 | API: solo endpoints, device config, device enumeration | 0.5d |
| 3 | Frontend: solo buttons, system settings monitor dropdown | 0.5d |
| 4 | Polish: hot-reconfigure, fade-out, USB hot-plug, health diagnostics | 0.5d |
| 5 | Bus solo (depends on Internal Buses) | 0.5d |
| **Total** | | **~2.5 days** (excl. bus solo) |

---

## Part 6 — Low Priority and Future Work

Valuable but not urgent. Some depend on major features above.

| Item | Description | Effort |
|------|-------------|--------|
| Prometheus metrics | Expose counters for audio callbacks, resyncs, WS clients, PTP offset for dashboarding | 1–1.5d |
| PTP clock health accuracy | Report actual clock offset and lock duration, not just socket existence | 0.5d |
| Scene scheduler | Auto-recall scenes at scheduled times or on a recurring basis | 2–3d |
| Matrix keyboard navigation | Tab, arrow, Enter navigation for accessibility and speed | 1–2d |
| Persistence integration tests | Automated tests verifying config survives process restart | 2d |
| API rate limiting | Prevent runaway clients flooding the system | 0.5d |
| Config versioning and migration | Version field enables automated schema migration on upgrade | 1d |
| Audit logging | Record who changed what and when — required for multi-operator environments | 1–2d |
| Config backup and restore UI | Download/upload config from the System tab | 2d |
| EQ frequency response curve | Canvas drawing of combined EQ curve in DSP panel | 1.5d |
| Gain reduction meters | Meter showing compressor/limiter gain reduction per channel | 2.5d |
| Clipping detection badges | Counter badge showing post-limiter clip events per channel | 1.5d |

---

## Summary

| Area | Items | Estimated Effort |
|------|-------|-----------------|
| Critical reliability | 5 | ~5–7 days |
| High priority features | 5 | ~5–6 days |
| Medium UX improvements | 9 | ~9–10 days |
| Audio/DSP enhancements | 5 | ~12–18 days |
| Major new features | 2 | ~10–11 days |
| Low priority / future | 12 | ~15–20 days |
| **Total** | **38** | **~56–72 days** |

**Recommended first sprint.** Config write safety + persist error propagation + JWT secret persistence: combined ~6 hours, dramatically reduces operational risk. Add the input gain badge as a 2-hour bonus. These four items are independent of everything else and have no blocking dependencies.

**Recommended second sprint.** Internal buses — full architecture designed and documented, no blocking dependencies, highest capability impact.
