import { useEffect, useRef, useState } from 'react';

/** True when the OS asks for reduced motion. Live-updates if the user flips it. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Ease a number from 0 up to `target` on mount (and whenever `target` changes),
 * so stat cards tick up like a counter settling. Honours reduced-motion by
 * jumping straight to the value. `round` controls decimal places.
 */
export function useCountUp(target: number, { durationMs = 700, round = 0 } = {}): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(reduced ? target : 0);
  const frame = useRef<number>(0);
  const from = useRef(0);

  useEffect(() => {
    if (reduced || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    const factor = 10 ** round;
    const tick = (now: number): void => {
      const t = Math.min((now - start) / durationMs, 1);
      // easeOutCubic — fast then gently settling
      const eased = 1 - (1 - t) ** 3;
      const next = origin + (target - origin) * eased;
      setValue(Math.round(next * factor) / factor);
      if (t < 1) frame.current = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [target, durationMs, round, reduced]);

  return value;
}
