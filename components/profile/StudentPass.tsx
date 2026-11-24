/**
 * The student pass: the answers so far as an academy card. Decorative (the form and the review carry
 * the same values as text), so it is hidden from assistive technology.
 */

import BrandLogo from '@/components/BrandLogo';
import CandleMeter from '@/components/profile/CandleMeter';
import { YEARS, type ProfileForm } from '@/lib/student-profile';

export default function StudentPass({ form, step, total, className = '' }: { form: ProfileForm; step: number; total: number; className?: string }) {
  const name = form.fullName.trim() || 'Your name';
  // The trading values have defaults, so they appear only once their step is reached.
  const cells: Array<[string, string]> = [
    ['Level', step >= 2 ? form.tradingLevel.charAt(0).toUpperCase() + form.tradingLevel.slice(1) : ''],
    ['Experience', step >= 2 ? `${YEARS.find(([v]) => v === form.yearsOfExperience)?.[2] || ''} years` : ''],
    ['Topics', form.preferredTopics.length ? `${form.preferredTopics.length} chosen` : ''],
  ];
  return (
    <div className={`onb-pass ${className}`} aria-hidden>
      <svg viewBox="0 0 340 214" className="absolute inset-0 h-full w-full" fill="none" focusable="false">
        <g stroke="#E8AD38" transform="rotate(-18 262 66)">
          <ellipse cx="262" cy="66" rx="128" ry="62" strokeOpacity=".34" />
          <ellipse cx="262" cy="66" rx="98" ry="44" strokeOpacity=".22" strokeDasharray="1 5" strokeLinecap="round" />
        </g>
      </svg>
      <div className="relative flex h-full flex-col justify-between p-[6.5%]">
        <div className="flex items-start justify-between gap-3">
          <BrandLogo variant="light" className="h-6" />
          <span className="text-xs font-medium text-[#e8ad38]">Student pass</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#ff7417] font-display text-xl font-semibold text-[#191919]">
            {form.profilePhoto ? <img src={form.profilePhoto} alt="" className="h-full w-full object-cover" /> : name.charAt(0).toUpperCase()}
          </span>
          <span className={`min-w-0 flex-1 truncate font-display text-lg font-semibold tracking-tight ${form.fullName.trim() ? '' : 'opacity-50'}`}>{name}</span>
          <CandleMeter filled={step - 1} total={total} className="h-7 w-auto shrink-0" />
        </div>
        <div className="grid grid-cols-[1fr_0.75fr_1.25fr] gap-2">
          {cells.map(([label, value]) => (
            <span key={label} className="min-w-0">
              <span className="block text-[0.6875rem] text-[#b4c3d6]">{label}</span>
              {value ? <span className="studio-fade block truncate text-xs font-semibold sm:text-[0.8125rem]">{value}</span> : <span className="mb-1.5 mt-2.5 block h-0.5 w-8 rounded bg-[rgba(220,235,250,0.25)]" />}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
