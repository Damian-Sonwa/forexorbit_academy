/**
 * The landing hero's lesson-chart card, animated (decorative only):
 *   - enters once with a short 3D settle (transform only, so the image paints at once: no LCP delay);
 *   - floats slowly, with a soft orange shadow that breathes beneath it;
 *   - a glass sheen sweeps across it, clipped to the card by the image's own transparency;
 *   - the end of the glowing trend line pulses;
 *   - with a fine pointer, the card tilts a few degrees toward the cursor;
 *   - two glass chips (statements about the platform, no figures) float on their own rhythm in
 *     front of the card, from the sm breakpoint up.
 * Everything stops under prefers-reduced-motion (styles/globals.css, "Landing hero").
 */

import { useEffect, useRef } from 'react';

const SRC = '/images/smd.webp';
const MAX_TILT = 5; // degrees

export default function HeroVisual() {
  const tiltRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const enabled = useRef(false);

  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { enabled.current = fine.matches && !reduce.matches; };
    update();
    fine.addEventListener('change', update);
    reduce.addEventListener('change', update);
    return () => {
      fine.removeEventListener('change', update);
      reduce.removeEventListener('change', update);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  const setTilt = (x: number, y: number) => {
    const el = tiltRef.current;
    if (!el) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty('--tilt-x', `${(-y * MAX_TILT).toFixed(2)}deg`);
      el.style.setProperty('--tilt-y', `${(x * MAX_TILT).toFixed(2)}deg`);
    });
  };

  const onMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled.current || event.pointerType !== 'mouse') return;
    const box = event.currentTarget.getBoundingClientRect();
    setTilt((event.clientX - box.left) / box.width - 0.5, (event.clientY - box.top) / box.height - 0.5);
  };

  return (
    <div className="hero-visual relative mx-auto w-full max-w-[42rem] xl:max-w-none" onPointerMove={onMove} onPointerLeave={() => setTilt(0, 0)}>
      {/* breathing shadow, beneath the card */}
      <div aria-hidden className="hero-visual-shadow pointer-events-none absolute inset-x-[16%] bottom-[2%] h-[9%] rounded-[50%] bg-primary-500/25 blur-2xl dark:bg-primary-500/20" />
      <div className="hero-visual-enter">
        <div className="hero-visual-float">
          <div ref={tiltRef} className="hero-visual-tilt relative">
            <img
              src={SRC}
              alt="EUR/USD lesson chart showing trend identification, support and resistance, risk management, and review steps"
              width={1536}
              height={1024}
              {...{ fetchpriority: 'high' }}
              decoding="async"
              className="relative mx-auto h-auto w-full drop-shadow-[0_16px_28px_rgba(23,23,23,0.08)]"
            />
            {/* glass sheen, clipped to the card by the image's alpha */}
            <div
              aria-hidden
              className="hero-visual-sheen pointer-events-none absolute inset-0"
              style={{ WebkitMaskImage: `url(${SRC})`, maskImage: `url(${SRC})` }}
            />
            {/* the trend line's glowing tip (at 81.4% / 27.8% of the image) */}
            <span aria-hidden className="pointer-events-none absolute left-[81.4%] top-[27.8%] h-0 w-0">
              <span className="hero-visual-tip absolute -left-3 -top-3 h-6 w-6 rounded-full border border-primary-400/80" />
              <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-primary-300 shadow-[0_0_12px_4px_rgba(255,138,51,0.6)]" />
            </span>
          </div>
        </div>
      </div>
      {/* Glass chips, in front of the card: facts about the platform, not data. */}
      <span className="hero-chip hero-chip-a glass-chip pointer-events-none absolute bottom-[9%] left-0 hidden sm:inline-flex">
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="hero-visual-tip absolute inset-0 rounded-full bg-primary-400" />
          <span className="relative h-2 w-2 rounded-full bg-primary-500" />
        </span>
        Simulated market · virtual funds
      </span>
      <span className="hero-chip hero-chip-b glass-chip pointer-events-none absolute right-[3%] top-[6%] hidden sm:inline-flex">
        Learn <span className="text-primary-600 dark:text-primary-400" aria-hidden>→</span> practise <span className="text-primary-600 dark:text-primary-400" aria-hidden>→</span> review
      </span>
    </div>
  );
}
