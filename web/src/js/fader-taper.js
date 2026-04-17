// fader-taper.js — pro-audio fader taper mapping for all mixer faders.
//
// Unified taper for input/output/bus/zone/VCA faders: piecewise-linear dB scale
// with a breakpoint at unity (0 dB) for intuitive console-style control.
//
// Slider domain: [0, 1000] (integer, 0.1% resolution)
// dB range: [−∞, +12] dB with following breakpoints:
//   - 0 to 25:     Mute zone (→ −∞)
//   - 26 to 325:   Slow segment (−30 … −10 dB, 0.067 dB/step)
//   - 326 to 875:  Medium segment (−10 … 0 dB, 0.018 dB/step, unity at 875)
//   - 876 to 1000: Fast segment (0 … +12 dB, 0.096 dB/step)
//
// Typical positions:
//   - 0.0 (slider = 0):      −∞ (mute)
//   - 0.10 (slider = 100):   ~−60 dB
//   - 0.30 (slider = 300):   ~−30 dB
//   - 0.60 (slider = 600):   ~−10 dB
//   - 0.75 (slider = 750):   ~−2 dB
//   - 0.875 (slider = 875):  0 dB (unity, zero marks)
//   - 1.0 (slider = 1000):   +12 dB

const _F_MUTE = 25;
const _F_S1 = 325, _F_S2 = 875, _F_S3 = 1000;
const _F_D1L = -30, _F_D1H = -10, _F_D2H = 0, _F_D3H = 12;

/**
 * sliderToDb — map slider position (0–1000) to dB gain.
 * @param {number} sliderPos  slider position in [0, 1000]
 * @returns {number}  dB value, −∞ for mute
 */
export function sliderToDb(sliderPos) {
  sliderPos = Math.round(Math.max(0, Math.min(_F_S3, sliderPos)));
  if (sliderPos <= _F_MUTE) return -Infinity;
  if (sliderPos <= _F_S1) {
    const t = (sliderPos - _F_MUTE) / (_F_S1 - _F_MUTE);
    return _F_D1L + t * (_F_D1H - _F_D1L);
  }
  if (sliderPos <= _F_S2) {
    const t = (sliderPos - _F_S1) / (_F_S2 - _F_S1);
    return _F_D1H + t * (_F_D2H - _F_D1H);
  }
  const t = (sliderPos - _F_S2) / (_F_S3 - _F_S2);
  return _F_D2H + t * (_F_D3H - _F_D2H);
}

/**
 * dbToSlider — map dB gain to slider position (0–1000).
 * @param {number} db  dB value or −∞
 * @returns {number}  slider position in [0, 1000]
 */
export function dbToSlider(db) {
  if (!isFinite(db) && db < 0) return 0;            // −∞ → mute
  if (db < _F_D1L) return 0;                        // below range → mute
  if (db <= _F_D1H) {
    const t = (db - _F_D1L) / (_F_D1H - _F_D1L);
    return Math.round(_F_MUTE + t * (_F_S1 - _F_MUTE));
  }
  if (db <= _F_D2H) {
    const t = (db - _F_D1H) / (_F_D2H - _F_D1H);
    return Math.round(_F_S1 + t * (_F_S2 - _F_S1));
  }
  if (db <= _F_D3H) {
    const t = (db - _F_D2H) / (_F_D3H - _F_D2H);
    return Math.round(_F_S2 + t * (_F_S3 - _F_S2));
  }
  return _F_S3;                                      // above +12 → clamp
}

/**
 * sliderToGain — map slider position to linear gain factor.
 * @param {number} sliderPos  slider position in [0, 1000]
 * @returns {number}  linear gain in [~0.001, ~3.16] (−60 dB to +10 dB)
 */
export function sliderToGain(sliderPos) {
  const db = sliderToDb(sliderPos);
  if (!isFinite(db)) return 0;  // mute → no gain
  return Math.pow(10, db / 20);
}

/**
 * gainToSlider — map linear gain factor to slider position.
 * @param {number} gain  linear gain in [0, ~3.16]
 * @returns {number}  slider position in [0, 1000]
 */
export function gainToSlider(gain) {
  if (gain <= 0) return 0;  // zero or negative → mute
  return dbToSlider(20 * Math.log10(gain));
}
