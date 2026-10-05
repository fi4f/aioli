/** Validate one public voice recipe before allocating or playing its samples. */
export function validateVoice(wave, start, end, duration, gain) {
  if (!['sine', 'square', 'triangle', 'sawtooth', 'noise'].includes(wave))
    throw new Error(`Unknown waveform ${wave}`);
  if (
    ![start, end, duration, gain].every(Number.isFinite) ||
    start < 1 ||
    end < 1 ||
    start > 20000 ||
    end > 20000 ||
    duration < 0.01 ||
    duration > 5 ||
    gain < 0 ||
    gain > 1
  )
    throw new Error('Voice: Hz 1–20000, duration 0.01–5s, gain 0–1');
  return { wave, start, end, duration, gain };
}
/** Mix recipes into deterministic mono PCM, independent of AudioContext. */
export function synthesize(voices, rate = 44100) {
  if (!voices.length || voices.length > 16) throw new Error('A patch needs 1–16 voices');
  const duration = Math.max(...voices.map((v) => v.duration)),
    samples = new Float32Array(Math.ceil((duration + 0.02) * rate));
  for (const v of voices) {
    // Integrate frequency for a linear pitch sweep; reseed each noise voice so
    // audition, the graphical preview, and exported WAV agree.
    let phase = 0,
      seed = 123456;
    for (let i = 0; i < Math.ceil(v.duration * rate); i++) {
      const t = i / rate,
        progress = t / v.duration;
      phase += (v.start + (v.end - v.start) * progress) / rate;
      const p = phase % 1;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const signal = {
        sine: () => Math.sin(phase * Math.PI * 2),
        square: () => (p < 0.5 ? 1 : -1),
        triangle: () => 1 - 4 * Math.abs(p - 0.5),
        sawtooth: () => 2 * p - 1,
        noise: () => seed / 2147483648 - 1,
      }[v.wave]();
      // A short attack/release avoids discontinuities at voice boundaries.
      const envelope =
        Math.min(1, t / 0.008) * Math.min(1, (v.duration - t) / Math.min(0.08, v.duration / 2));
      samples[i] += signal * envelope * v.gain;
    }
  }
  for (let i = 0; i < samples.length; i++) samples[i] = Math.tanh(samples[i]);
  return samples;
}
/** Encode a standard little-endian, 16-bit, mono PCM WAV. */
export function wav(samples, rate = 44100) {
  const buffer = new ArrayBuffer(44 + samples.length * 2),
    view = new DataView(buffer);
  const str = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((s, i) =>
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, s)) * 32767), true),
  );
  return buffer;
}
