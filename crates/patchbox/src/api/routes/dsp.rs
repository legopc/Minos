// DSP route handlers are co-located with their channel types:
//   Input DSP (GET/PUT /api/v1/inputs/:ch/dsp and sub-blocks) → api/routes/inputs.rs
//   Output DSP (GET/PUT /api/v1/outputs/:ch/dsp and sub-blocks) → api/routes/outputs.rs
//   Bus DSP → api/routes/buses.rs
//
// This file is reserved for future cross-cutting DSP handlers:
//   POST /api/v1/dsp/presets          (when presets.rs is wired into AppState)
//   GET  /api/v1/dsp/defaults         (serve generated/dsp-defaults.json via API)
//   POST /api/v1/dsp/bulk-update      (Sprint 6 — bulk DSP param mutation)
