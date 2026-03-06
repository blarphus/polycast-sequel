#!/bin/zsh

set -euo pipefail

tmp_file="/tmp/polycast-complete.wav"

python3 - <<'PY'
import math
import struct
import wave

path = "/tmp/polycast-complete.wav"
sample_rate = 44100
segments = [
    (392.0, 0.16, 0.35),
    (0.0, 0.05, 0.0),
    (659.25, 0.20, 0.35),
]

frames = []
for freq, duration, amp in segments:
    count = int(sample_rate * duration)
    attack = max(1, int(sample_rate * 0.01))
    release = max(1, int(sample_rate * 0.02))
    for i in range(count):
        if freq == 0.0:
            sample = 0.0
        else:
            attack_env = min(1.0, i / attack)
            release_env = min(1.0, (count - i) / release)
            env = min(attack_env, release_env)
            sample = amp * env * math.sin(2 * math.pi * freq * i / sample_rate)
        frames.append(struct.pack("<h", int(max(-1.0, min(1.0, sample)) * 32767)))

with wave.open(path, "wb") as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(sample_rate)
    wav.writeframes(b"".join(frames))
PY

afplay "$tmp_file"
