// S7 s7-arch-shared-strip — shared channel-strip component.
//
// Extracts the strip widget (fader, meter, mute, solo, DSP badges)
// used by both mixer.js and matrix.js. API:
//
//   import { buildStrip } from './components/strip.js';
//   const el = buildStrip({
//     id: 'rx_3',            // dom id suffix
//     label: 'Ch 3',         // channel name
//     volumeDb: -6.0,
//     muted: false,
//     soloed: false,
//     dspSummary: {...},     // dsp badge list
//     onVolume: (db) => ..., onMute: () => ..., onSolo: () => ...,
//     onDspClick: (blockId) => ...,
//   });
//
// TODO: move _buildOutputMaster body here, parametrise.
