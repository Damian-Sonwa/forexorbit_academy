/**
 * The controls for a student's profile, shared by onboarding and Settings. Every choice is a native
 * radio or checkbox inside its label, so keyboard and screen-reader behaviour is the browser's.
 */

import { useId, type ReactNode } from 'react';
import { Check, Plus } from 'lucide-react';
import {
  EDUCATION, GENDERS, TEXT_MAX, TOPIC_GROUPS, TRADING_LEVELS, YEARS, singleLine, unlistedTopics, yearsLabel,
  type Channel, type TradingLevel,
} from '@/lib/student-profile';

function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? <p id={id} className="studio-error mt-1.5">{text}</p> : null;
}

const OptionalMark = () => <span className="ml-1.5 font-normal text-ink-subtle">Optional</span>;

export function TextField({ id, label, value, onChange, type = 'text', hint, error, placeholder, autoComplete, inputMode, max }: {
  id: string; label: string; value: string; onChange: (value: string) => void; type?: string; hint?: ReactNode; error?: string;
  placeholder?: string; autoComplete?: string; inputMode?: 'tel' | 'text'; max?: string;
}) {
  const describedBy = [error && `${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' ') || undefined;
  return (
    <div>
      <label htmlFor={id} className="studio-label">{label}</label>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} className="studio-input mt-1.5" placeholder={placeholder} autoComplete={autoComplete} inputMode={inputMode} max={max} maxLength={type === 'date' ? undefined : TEXT_MAX} required aria-invalid={error ? true : undefined} aria-describedby={describedBy} />
      {hint && <p id={`${id}-hint`} className="studio-hint mt-1.5">{hint}</p>}
      <FieldError id={`${id}-error`} text={error} />
    </div>
  );
}

function Group({ id, legend, error, optional, hideLegend, children }: { id: string; legend: string; error?: string; optional?: boolean; hideLegend?: boolean; children: ReactNode }) {
  return (
    <fieldset id={id} tabIndex={-1} className="min-w-0 outline-none" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className={hideLegend ? 'sr-only' : 'studio-label mb-2'}>{legend}{optional && <OptionalMark />}</legend>
      {children}
      <FieldError id={`${id}-error`} text={error} />
    </fieldset>
  );
}

export function GenderField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const name = useId();
  return (
    <Group id={id} legend="Gender" optional>
      <div className="flex flex-wrap gap-2">
        {GENDERS.map(([v, label]) => (
          <label key={v || 'none'} className="studio-choice min-h-[2.75rem] items-center rounded-full px-4 text-sm font-medium">
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
            {label}
          </label>
        ))}
      </div>
    </Group>
  );
}

export function EducationSelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="studio-label">Highest education level<OptionalMark /></label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="studio-input mt-1.5">
        <option value="">Select education level</option>
        {EDUCATION.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </div>
  );
}

export function CertificationsField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <label htmlFor={id} className="studio-label">Relevant certifications<OptionalMark /></label>
      <textarea id={id} rows={2} maxLength={TEXT_MAX} value={value} onChange={(e) => onChange(singleLine(e.target.value).slice(0, TEXT_MAX))} className="studio-input mt-1.5 resize-none" placeholder="CFA, Series 7" aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className="studio-hint mt-1 flex justify-between gap-4"><span>Separate them with commas.</span><span className="num">{value.length}/{TEXT_MAX}</span></p>
    </div>
  );
}

/** What each level sees on the same market: candles, then structure, then a plan. */
function LevelChart({ level }: { level: TradingLevel }) {
  const bars: number[][] = [[8, 44, 60, 38, 66], [24, 36, 50, 30, 56], [40, 40, 52, 34, 60, 1], [56, 26, 44, 20, 50], [72, 30, 42, 24, 48, 1], [88, 14, 32, 8, 38]];
  return (
    <svg viewBox="0 0 104 72" className="h-16 w-24 shrink-0 sm:h-20 sm:w-full" aria-hidden focusable="false">
      {level === 'advanced' && <><rect x="2" y="50" width="100" height="10" fill="#8FB4DC" fillOpacity=".3" /><line x1="2" x2="102" y1="12" y2="12" stroke="#C65A16" strokeDasharray="3 3" /></>}
      <g transform={level === 'beginner' ? 'translate(18 0)' : undefined}>
        {bars.slice(0, level === 'beginner' ? 3 : 6).map(([x, top, bottom, high, low, white]) => (
          <g key={x}>
            <line x1={x + 5} x2={x + 5} y1={high} y2={low} stroke="#C65A16" strokeWidth="1.2" />
            <rect x={x} y={top} width="10" height={bottom - top} rx="1.2" fill={white ? '#FFFFFF' : '#FF7417'} stroke="#C65A16" strokeWidth="1" />
          </g>
        ))}
      </g>
      {level !== 'beginner' && <path d="M4 69 L99 36" stroke="#D29A26" strokeWidth="1.5" strokeLinecap="round" />}
      {level === 'advanced' && <path d="M12 54 C 34 46, 52 46, 66 38 S 88 28, 98 21" stroke="var(--fo-text)" strokeOpacity=".75" strokeWidth="1.3" fill="none" strokeLinecap="round" />}
    </svg>
  );
}

export function LevelField({ id, value, onChange, error }: { id: string; value: TradingLevel; onChange: (value: TradingLevel) => void; error?: string }) {
  const name = useId();
  return (
    <Group id={id} legend="Trading level" error={error}>
      <div className="grid gap-2.5 sm:grid-cols-3 sm:gap-3">
        {TRADING_LEVELS.map(({ id: level, label, hint }) => (
          <label key={level} className="studio-choice items-center gap-4 rounded-xl p-3 sm:flex-col sm:items-stretch sm:gap-3 sm:p-4">
            <input type="radio" name={name} checked={value === level} onChange={() => onChange(level)} aria-label={`${label}: ${hint}`} />
            <LevelChart level={level} />
            <span aria-hidden className="min-w-0">
              <span className="block font-display text-base font-semibold tracking-tight">{label}</span>
              <span className="studio-hint block">{hint}</span>
            </span>
          </label>
        ))}
      </div>
    </Group>
  );
}

/** Years as stops on a scale rather than a menu. */
export function YearsField({ id, value, onChange, error }: { id: string; value: string; onChange: (value: string) => void; error?: string }) {
  const name = useId();
  const index = YEARS.findIndex(([v]) => v === value);
  const inset = `${100 / YEARS.length / 2}%`;
  const reach = index < 0 ? 0 : index / (YEARS.length - 1);
  return (
    <Group id={id} legend="Years of forex or trading experience" error={error}>
      <div className="relative">
        <span aria-hidden className="absolute top-[0.9375rem] h-0.5 bg-[var(--fo-line-strong)]" style={{ left: inset, right: inset }} />
        <span aria-hidden className="absolute top-[0.9375rem] h-0.5 origin-left bg-[#FF7417] transition-transform duration-300 ease-orbit motion-reduce:transition-none" style={{ left: inset, right: inset, transform: `scaleX(${reach})` }} />
        <div className="relative grid grid-cols-5">
          {YEARS.map(([v, label, short], i) => (
            <label key={v} className="group relative flex min-h-[3.75rem] cursor-pointer flex-col items-center gap-2 rounded-lg pt-2 text-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#e0620f]">
              <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} aria-label={label} className="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0" />
              <span aria-hidden className={`h-4 w-4 rounded-full border-2 transition-colors duration-200 ${i === index ? 'border-[#c65a16] bg-[#ff7417] ring-4 ring-[rgba(255,116,23,0.22)]' : i < index ? 'border-[#c65a16] bg-[#ff7417]' : 'border-[var(--st-hollow)] bg-[var(--st-sheet)] group-hover:border-[#c65a16]'}`} />
              <span aria-hidden className={`num whitespace-nowrap ${i === index ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{short}</span>
            </label>
          ))}
        </div>
      </div>
      <p className="studio-hint mt-1" aria-hidden>{index >= 0 ? yearsLabel(value) : 'Choose a range'}</p>
    </Group>
  );
}

/** Topics as a watchlist: grouped rows you add or remove. */
export function TopicsField({ id, value, onChange, error, chips }: { id: string; chips?: boolean; value: string[]; onChange: (value: string[]) => void; error?: string }) {
  const toggle = (topic: string) => onChange(value.includes(topic) ? value.filter((t) => t !== topic) : [...value, topic]);
  const extra = unlistedTopics(value);
  const groups = extra.length ? [...TOPIC_GROUPS, { title: 'Saved earlier', topics: extra }] : TOPIC_GROUPS;
  if (chips) {
    return (
      <Group id={id} legend="Preferred learning topics" error={error} hideLegend>
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.title} role="group" aria-label={group.title}>
              <p aria-hidden className="studio-label mb-2.5">{group.title}</p>
              <div className="flex flex-wrap gap-2.5">
                {group.topics.map((topic) => {
                  const on = value.includes(topic);
                  return (
                    <label key={topic} className="studio-choice min-h-[3rem] max-w-full items-center gap-2.5 rounded-full py-2 pl-5 pr-4 text-[0.9375rem] font-medium">
                      <input type="checkbox" checked={on} onChange={() => toggle(topic)} />
                      <span className="min-w-0 [overflow-wrap:anywhere]">{topic}</span>
                      {on ? <Check className="h-4 w-4 shrink-0 text-[var(--st-accent)]" strokeWidth={2.75} aria-hidden /> : <Plus className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Group>
    );
  }
  return (
    <Group id={id} legend="Preferred learning topics" error={error}>
      <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => (
          <div key={group.title} role="group" aria-label={group.title}>
            <p aria-hidden className="studio-hint border-b border-[var(--fo-line-strong)] pb-1.5">{group.title}</p>
            {group.topics.map((topic) => {
              const on = value.includes(topic);
              return (
                <label key={topic} className="studio-row justify-between text-[0.9375rem]">
                  <input type="checkbox" checked={on} onChange={() => toggle(topic)} />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{topic}</span>
                  <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-colors ${on ? 'bg-[#ff7417] text-[#191919]' : 'text-ink-subtle'}`}>{on ? <Check className="h-3.5 w-3.5" strokeWidth={2.75} /> : <Plus className="h-4 w-4" />}</span>
                </label>
              );
            })}
          </div>
        ))}
      </div>
    </Group>
  );
}

export function Switch({ checked, onChange, label, disabled, describedBy }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean; describedBy?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} aria-describedby={describedBy} disabled={disabled} onClick={() => onChange(!checked)} className="studio-switch">
      <span aria-hidden><Check className="h-3 w-3" strokeWidth={3} /></span>
    </button>
  );
}

const CHANNEL_LABEL: Array<[Channel, string]> = [['email', 'Email'], ['sms', 'SMS'], ['push', 'Push']];
export function ChannelsField({ id, value, onChange, hideLegend }: { id: string; hideLegend?: boolean; value: Record<Channel, boolean>; onChange: (value: Record<Channel, boolean>) => void }) {
  return (
    <Group id={id} legend="Notification preferences" hideLegend={hideLegend}>
      <div className="flex flex-wrap gap-x-8 gap-y-1">
        {CHANNEL_LABEL.map(([channel, label]) => (
          <span key={channel} className="inline-flex min-h-[2.75rem] items-center gap-3 text-[0.9375rem]">
            <Switch checked={value[channel]} onChange={(on) => onChange({ ...value, [channel]: on })} label={`${label} notifications`} />
            <span aria-hidden>{label}</span>
          </span>
        ))}
      </div>
    </Group>
  );
}
