/**
 * PageHeader: how every page opens. Kicker (with the orbit node), display title, lede and an
 * actions slot that wraps under the title on small screens.
 */
import type { ReactNode } from 'react';

interface PageHeaderProps {
  kicker?: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({ kicker, title, lede, actions, className = '' }: PageHeaderProps) {
  return (
    <header className={`mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        {kicker && <p className="page-kicker">{kicker}</p>}
        <h1 className={`page-title ${kicker ? 'mt-3' : ''}`}>{title}</h1>
        {lede && <p className="page-lede">{lede}</p>}
      </div>
      {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A row of labelled numbers on one panel, divided by hairlines. */
export function ReadoutStrip({ items, className = '' }: { items: Array<{ label: string; value: ReactNode; testId?: string; tone?: string }>; className?: string }) {
  const cols = items.length >= 5 ? 'sm:grid-cols-3 lg:grid-cols-5' : items.length === 4 ? 'sm:grid-cols-4' : items.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2';
  return (
    <section className={`overflow-hidden rounded-panel border border-line shadow-panel ${className}`}>
      <div className={`grid grid-cols-2 gap-px bg-[var(--fo-line)] ${cols}`}>
        {items.map((item, i) => (
          <div key={item.label} data-testid={item.testId} className={`relative bg-surface-1 px-5 py-4 ${items.length % 2 === 1 && i === items.length - 1 ? 'col-span-2 sm:col-span-1' : ''}`}>
            {i === 0 && <span aria-hidden className="absolute left-0 top-4 h-6 w-[2px] rounded-r bg-primary-500" />}
            <p className={`readout-value ${item.tone || ''}`}>{item.value}</p>
            <p className="mt-1 text-xs leading-snug text-ink-subtle">{item.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
