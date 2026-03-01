// ---------------------------------------------------------------------------
// utils/sounds.ts -- Short synthesized sound effects via Web Audio API
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;

function getContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

/** Quick soft tick (~60 ms) */
export function playFlipSound(): void {
  const ac = getContext();
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  osc.type = 'sine';
  osc.frequency.value = 1800;
  gain.gain.value = 0.15;

  osc.connect(gain);
  gain.connect(ac.destination);

  const t = ac.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  osc.start(t);
  osc.stop(t + 0.06);
}

/** Ascending two-note chime (~250 ms) */
export function playCorrectSound(): void {
  const ac = getContext();
  const notes = [660, 880];
  const duration = 0.12;
  const t = ac.currentTime;

  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0.2;

    osc.connect(gain);
    gain.connect(ac.destination);

    const start = t + i * 0.13;
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.start(start);
    osc.stop(start + duration);
  });
}

/** Low single buzz (~150 ms, subtle) */
export function playIncorrectSound(): void {
  const ac = getContext();
  const osc = ac.createOscillator();
  const gain = ac.createGain();

  osc.type = 'triangle';
  osc.frequency.value = 220;
  gain.gain.value = 0.18;

  osc.connect(gain);
  gain.connect(ac.destination);

  const t = ac.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.start(t);
  osc.stop(t + 0.15);
}

/** Ascending three-note arpeggio (~500 ms, celebratory) */
export function playCompleteSound(): void {
  const ac = getContext();
  const notes = [523, 659, 784]; // C5, E5, G5
  const duration = 0.15;
  const t = ac.currentTime;

  notes.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();

    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = 0.25;

    osc.connect(gain);
    gain.connect(ac.destination);

    const start = t + i * 0.16;
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    osc.start(start);
    osc.stop(start + duration);
  });
}
