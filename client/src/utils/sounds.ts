// ---------------------------------------------------------------------------
// utils/sounds.ts -- Short synthesized sound effects via Web Audio API
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

function shapeEnvelope(gain: GainNode, start: number, attack: number, peak: number, decay: number) {
  gain.gain.cancelScheduledValues(start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
}

function scheduleTone({
  type = 'sine',
  frequency,
  start,
  attack = 0.01,
  decay = 0.12,
  gain = 0.12,
  detune = 0,
}: {
  type?: OscillatorType;
  frequency: number;
  start: number;
  attack?: number;
  decay?: number;
  gain?: number;
  detune?: number;
}) {
  const ac = getContext();
  const osc = ac.createOscillator();
  const gainNode = ac.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  osc.detune.setValueAtTime(detune, start);
  osc.connect(gainNode);
  gainNode.connect(ac.destination);

  shapeEnvelope(gainNode, start, attack, gain, decay);
  osc.start(start);
  osc.stop(start + attack + decay + 0.02);
}

/** Quick soft tick (~60 ms) */
export function playFlipSound(): void {
  const t = getContext().currentTime;
  scheduleTone({ type: 'triangle', frequency: 1180, start: t, attack: 0.003, decay: 0.05, gain: 0.08 });
  scheduleTone({ type: 'sine', frequency: 1560, start: t + 0.015, attack: 0.003, decay: 0.035, gain: 0.04 });
}

/** Warm ascending success chime */
export function playCorrectSound(): void {
  const t = getContext().currentTime;
  scheduleTone({ type: 'triangle', frequency: 523.25, start: t, attack: 0.01, decay: 0.11, gain: 0.08 });
  scheduleTone({ type: 'sine', frequency: 659.25, start: t + 0.07, attack: 0.01, decay: 0.14, gain: 0.11 });
  scheduleTone({ type: 'sine', frequency: 783.99, start: t + 0.14, attack: 0.01, decay: 0.18, gain: 0.13 });
  scheduleTone({ type: 'triangle', frequency: 1046.5, start: t + 0.15, attack: 0.008, decay: 0.12, gain: 0.035 });
}

/** Soft downward wrong-answer tone */
export function playIncorrectSound(): void {
  const t = getContext().currentTime;
  scheduleTone({ type: 'triangle', frequency: 329.63, start: t, attack: 0.008, decay: 0.09, gain: 0.09 });
  scheduleTone({ type: 'sawtooth', frequency: 246.94, start: t + 0.075, attack: 0.008, decay: 0.13, gain: 0.07, detune: -4 });
  scheduleTone({ type: 'triangle', frequency: 196, start: t + 0.15, attack: 0.008, decay: 0.16, gain: 0.06 });
}

/** Ascending three-note arpeggio (~500 ms, celebratory) */
export function playCompleteSound(): void {
  const t = getContext().currentTime;
  scheduleTone({ type: 'triangle', frequency: 523.25, start: t, attack: 0.01, decay: 0.14, gain: 0.08 });
  scheduleTone({ type: 'triangle', frequency: 659.25, start: t + 0.11, attack: 0.01, decay: 0.14, gain: 0.1 });
  scheduleTone({ type: 'triangle', frequency: 783.99, start: t + 0.22, attack: 0.01, decay: 0.16, gain: 0.12 });
  scheduleTone({ type: 'sine', frequency: 1046.5, start: t + 0.34, attack: 0.01, decay: 0.22, gain: 0.08 });
}
