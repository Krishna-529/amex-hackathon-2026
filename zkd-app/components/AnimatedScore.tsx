'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Eases a number toward its target (+1 per ~110ms) so a risk score that jumps —
 * when it crosses the threshold, or the /ops demo "Ramp risk" pushes it up —
 * climbs on screen instead of snapping to the new value. No animation on first
 * render (shows the value immediately); animates only when it changes. Renders
 * '—' when the value is null (no forecast yet).
 */
export function AnimatedScore({ value, className }: { value: number | null; className?: string }) {
  const [display, setDisplay] = useState<number | null>(value);
  const prev = useRef<number | null>(value);

  useEffect(() => {
    if (value == null) {
      prev.current = null;
      setDisplay(null);
      return;
    }
    const from = prev.current;
    prev.current = value;
    if (from == null || from === value) {
      setDisplay(value);
      return;
    }
    const step = from < value ? 1 : -1;
    let v = from;
    const iv = setInterval(() => {
      v += step;
      setDisplay(v);
      if ((step > 0 && v >= value) || (step < 0 && v <= value)) {
        setDisplay(value);
        clearInterval(iv);
      }
    }, 110);
    return () => clearInterval(iv);
  }, [value]);

  return <span className={className}>{display ?? '—'}</span>;
}
