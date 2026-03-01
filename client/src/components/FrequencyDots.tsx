import React from 'react';

export const LEVEL_COLORS = ['#ff4d4d', '#ff944d', '#ffdd4d', '#75d147', '#4ade80'];

export function FrequencyDots({ frequency }: { frequency: number | null }) {
  if (frequency == null) return null;
  const filled = Math.ceil(frequency / 2);
  const color = LEVEL_COLORS[filled - 1] || LEVEL_COLORS[0];
  return (
    <span className="freq-dots" title={`Frequency: ${frequency}/10`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="freq-dot"
          style={{ background: color, opacity: i < filled ? 1 : 0.25 }}
        />
      ))}
    </span>
  );
}
