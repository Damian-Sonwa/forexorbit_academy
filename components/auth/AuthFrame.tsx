/**
 * Sign-in / sign-up / password pages. The auth backdrop (body[data-surface='auth']) keeps the grid and
 * the glow but no page-wide arc; the orbit is drawn here, around the illustration: the main ring's
 * far side passes behind the trader and its near side in front. The form is a lit hero panel.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import BrandLogo from '@/components/BrandLogo';
import ThemeToggle from '@/components/ThemeToggle';

export const authFieldClass =
  'input mt-1.5 !text-base';

export const authLabelClass = 'block text-sm font-medium text-ink-muted';

export const authHelperClass = 'mt-1 text-sm leading-snug text-ink-subtle';

export const authButtonClass =
  'btn btn-primary btn-lg mt-5 w-full rounded-full';

/** Both orbit layers share one box, so the near half lines up with the far half exactly. */
const orbitBox = 'pointer-events-none absolute inset-0 m-auto h-[92%] w-[110%] text-primary-500';

export function AuthFrame({
  title,
  lead,
  children,
  switcher,
}: {
  title: string;
  lead: string;
  children: ReactNode;
  switcher: ReactNode;
}) {
  return (
    <div className="min-h-screen text-ink">
      <header className="flex items-center justify-between gap-4 px-6 pt-6 sm:px-10 lg:px-12">
        <Link href="/" aria-label="FX Orbit Academy home" className="inline-flex transition-opacity duration-200 hover:opacity-85">
          <BrandLogo priority className="h-9 sm:h-10" />
        </Link>
        <ThemeToggle className="h-10 w-10 rounded-xl text-ink-muted hover:bg-tint hover:text-ink" />
      </header>
      <main className="mx-auto grid w-full max-w-7xl items-center gap-8 px-6 py-8 sm:px-10 md:grid-cols-[minmax(0,1.2fr)_minmax(20rem,26rem)] md:gap-10 lg:min-h-[calc(100vh-5rem)] lg:gap-16 lg:px-12">
        <div className="relative hidden min-w-0 items-center justify-center md:flex">
          {/* The orbit, far side: drawn behind the illustration. */}
          <svg aria-hidden className={orbitBox} viewBox="0 0 600 600" fill="none" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="auth-ring" x1="0" y1="0" x2="600" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="currentColor" stopOpacity="0" />
                <stop offset=".3" stopColor="currentColor" stopOpacity=".22" />
                <stop offset=".78" stopColor="currentColor" stopOpacity=".6" />
                <stop offset="1" stopColor="currentColor" stopOpacity=".08" />
              </linearGradient>
              <linearGradient id="auth-halo" x1="0" y1="0" x2="600" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="currentColor" stopOpacity=".14" />
                <stop offset=".5" stopColor="currentColor" stopOpacity=".03" />
                <stop offset="1" stopColor="currentColor" stopOpacity=".12" />
              </linearGradient>
              <radialGradient id="auth-node-glow">
                <stop offset="0" stopColor="currentColor" stopOpacity=".9" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </radialGradient>
            </defs>
            <g transform="rotate(-18 300 300)">
              {/* wide halo, very faint */}
              <ellipse cx="300" cy="300" rx="330" ry="178" stroke="url(#auth-halo)" strokeWidth="1" />
              {/* main ring */}
              <ellipse cx="300" cy="300" rx="290" ry="150" stroke="url(#auth-ring)" strokeWidth="1.25" />
              {/* inner dotted track, drifting slowly */}
              <ellipse className="auth-orbit-drift" cx="300" cy="300" rx="240" ry="112" stroke="currentColor" strokeOpacity=".26" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="0.1 8" />
            </g>
            {/* nodes sit exactly on their rings */}
            <circle cx="141" cy="175.8" r="2" fill="currentColor" fillOpacity=".35" />
            <circle cx="515" cy="289" r="2.5" fill="currentColor" fillOpacity=".55" />
            <circle className="auth-orbit-pulse" cx="481.5" cy="139.7" r="16" fill="url(#auth-node-glow)" />
            <circle cx="481.5" cy="139.7" r="4.5" fill="currentColor" />
            <circle cx="481.5" cy="139.7" r="9" stroke="currentColor" strokeOpacity=".35" />
          </svg>
          <div className="relative flex flex-col items-center">
            <img
              src="/images/young-trader-forex.webp"
              alt="Young trader with a laptop and floating forex pair panels"
              width={1222}
              height={1287}
              className="h-auto w-auto max-h-[26rem] max-w-full object-contain drop-shadow-[0_30px_60px_rgba(0,0,0,0.45)] md:max-h-[min(34rem,70vh)] lg:max-h-[min(42rem,calc(100vh-9rem))]"
            />
            <p className="mt-2 max-w-sm text-center text-sm text-ink-muted">
              Learn the reasoning behind the chart, then practise it on a simulated market.
            </p>
          </div>
          {/* The orbit, near side: the lower half of the main ring, over the illustration, fading at
              both ends so it emerges from behind the trader and returns there. */}
          <svg aria-hidden className={orbitBox} viewBox="0 0 600 600" fill="none" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="auth-ring-front" x1="10" y1="0" x2="590" y2="0" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="currentColor" stopOpacity="0" />
                <stop offset=".25" stopColor="currentColor" stopOpacity=".5" />
                <stop offset=".6" stopColor="currentColor" stopOpacity=".7" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
              <clipPath id="auth-ring-near" clipPathUnits="userSpaceOnUse">
                <rect x="0" y="300" width="600" height="300" />
              </clipPath>
            </defs>
            <g transform="rotate(-18 300 300)">
              <ellipse cx="300" cy="300" rx="290" ry="150" stroke="url(#auth-ring-front)" strokeWidth="1.5" clipPath="url(#auth-ring-near)" />
            </g>
            <circle cx="147.4" cy="425.3" r="3" fill="currentColor" fillOpacity=".8" />
          </svg>
        </div>
        <div className="mx-auto w-full min-w-0 max-w-md md:mx-0 md:max-w-none">
          <div className="panel-hero glass-panel p-6 sm:p-8 animate-rise-in">
            <p className="page-kicker">ForexOrbit Academy</p>
            <h1 className="mt-3 font-display text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
            <p className="mt-2 text-sm leading-snug text-ink-muted">{lead}</p>
            <div className="mt-6">{children}</div>
            <div className="divider mt-6" />
            <p className="mt-4 text-sm leading-snug text-ink-muted">{switcher}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
