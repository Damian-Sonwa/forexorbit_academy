/**
 * Footer Component
 * Site footer with links and information
 */

import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';

const columns = [
  {
    title: 'Learn',
    links: [
      { href: '/courses', label: 'Courses' },
      { href: '/dashboard', label: 'Dashboard' },
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
    <footer className="bg-nav-bg text-nav-text border-t border-white/10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-4 md:gap-12">
          <div className="col-span-2 md:col-span-1">
            <Link href="/" aria-label="FX Orbit Academy home" className="mb-5 inline-flex transition-opacity duration-200 hover:opacity-85">
              <BrandLogo variant="light" className="h-10" />
            </Link>
            <p className="max-w-xs text-sm text-nav-muted leading-relaxed">
              Structured Forex education: courses, guided practice, and a learning community with expert instructors.
            </p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-nav-muted">{column.title}</h3>
              <ul className="space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className="text-sm text-neutral-300 hover:text-primary-400">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-white/10 pt-6 text-xs text-nav-muted sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} ForexOrbit Academy. All rights reserved.</p>
          <p>Educational content only. Not financial advice.</p>
        </div>
      </div>
    </footer>
  );
}
