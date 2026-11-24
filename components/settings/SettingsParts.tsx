/**
 * Settings content parts. A section is a heading and a run of ruled groups: what the setting is on
 * the left, its control on the right. Groups never become cards of their own.
 */

import type { ReactNode } from 'react';

export function SettingsSection({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <section aria-labelledby="settings-section-title" className="studio-fade">
      <h2 id="settings-section-title" className="font-display text-[1.375rem] font-semibold leading-tight tracking-[-0.02em]">{title}</h2>
      <p className="mt-1.5 max-w-xl text-[0.9375rem] leading-relaxed text-ink-muted">{lede}</p>
      <div className="mt-6 divide-y divide-[var(--fo-line)] border-t border-line">{children}</div>
    </section>
  );
}

export function SettingGroup({ title, help, tone, wide, children }: { title: string; help?: ReactNode; tone?: 'danger'; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`grid gap-x-10 gap-y-4 py-7 ${wide ? '' : 'xl:grid-cols-[13rem_minmax(0,1fr)]'}`}>
      <div className={wide ? 'max-w-xl' : ''}>
        <h3 className={`text-[0.9375rem] font-semibold ${tone === 'danger' ? 'text-[var(--st-danger)]' : ''}`}>{title}</h3>
        {help && <p className="studio-hint mt-1">{help}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A value the member cannot change here, with the reason. */
export function ReadOnlyValue({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <p className="studio-label">{label}</p>
      <p className="mt-1.5 text-base [overflow-wrap:anywhere]">{value}</p>
      {note && <p className="studio-hint mt-1">{note}</p>}
    </div>
  );
}
