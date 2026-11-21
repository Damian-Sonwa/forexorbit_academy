/**
 * Footer: the closing band of every page. A deeper surface than the page, a lit hairline at its top
 * edge (the horizon), and the orbit arc quietly behind the brand column.
 */

import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';

const columns = [
  {
    title: 'Learn',
    links: [
      { href: '/courses', label: 'Courses' },
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/about', label: 'About' },
    ],
  },
  {
    title: 'Support',
    links: [
      { href: '/help', label: 'Help Center' },
      { href: '/support', label: 'Contact support' },
      { href: '/help#troubleshooting', label: 'Troubleshooting' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/terms', label: 'Terms of Service' },
    ],
  },
];

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-line bg-[color-mix(in_srgb,var(--fo-bg)_70%,#000_30%)] text-ink dark:bg-[#060709]">
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,112,18,0.55)_30%,rgba(255,112,18,0.55)_70%,transparent)]" />
      <svg aria-hidden className="pointer-events-none absolute -left-40 -top-24 h-[420px] w-[760px] text-primary-500 opacity-[0.14]" viewBox="0 0 760 420" fill="none">
        <ellipse cx="380" cy="210" rx="360" ry="150" transform="rotate(-10 380 210)" stroke="currentColor" />
        <ellipse cx="380" cy="210" rx="300" ry="112" transform="rotate(-10 380 210)" stroke="currentColor" strokeDasharray="2 9" />
      </svg>
      <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4 md:gap-12">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" aria-label="FX Orbit Academy home" className="mb-5 inline-flex transition-opacity duration-200 hover:opacity-85">
              <BrandLogo className="h-10" />
            </Link>
            <p className="max-w-xs text-sm leading-relaxed text-ink-muted">
              Structured Forex education: courses, guided practice, and a learning community with expert instructors.
            </p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-subtle">{column.title}</h3>
              <ul className="space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-ink-muted transition-colors hover:text-primary-600 dark:hover:text-primary-400">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-xs text-ink-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} ForexOrbit Academy. All rights reserved.</p>
          <p>Educational content only. Not financial advice.</p>
        </div>
      </div>
    </footer>
  );
}
