/**
 * Appearance: the same theme choice as the header toggle (hooks/useTheme), kept on this browser.
 */

import { SettingGroup, SettingsSection } from '@/components/settings/SettingsParts';
import { useTheme } from '@/hooks/useTheme';

const THEMES = [
  { dark: true, label: 'Dark', hint: 'Black and orange', bg: '#08090c', panel: '#161920', line: 'rgba(255,240,222,.18)', text: '#f3efe9' },
  { dark: false, label: 'Light', hint: 'Warm paper and navy', bg: '#f7f4ef', panel: '#ffffff', line: 'rgba(23,43,69,.18)', text: '#172b45' },
];

/** A small drawing of the app in that theme. */
function Preview({ bg, panel, line, text }: { bg: string; panel: string; line: string; text: string }) {
  const bars = [[86, 44, 22], [102, 36, 20], [118, 40, 14, 1], [134, 26, 22], [150, 18, 18]];
  return (
    <svg viewBox="0 0 180 104" className="w-full rounded-lg" aria-hidden focusable="false">
      <rect width="180" height="104" fill={bg} />
      <rect width="180" height="13" fill={panel} /><rect x="8" y="4.5" width="26" height="4" rx="2" fill="#FF7417" />
      {[24, 34, 44, 54].map((y, i) => <rect key={y} x="8" y={y} width={i === 1 ? 34 : 26} height="4" rx="2" fill={i === 1 ? '#FF7417' : text} opacity={i === 1 ? 1 : 0.35} />)}
      <rect x="58" y="22" width="114" height="72" rx="5" fill={panel} stroke={line} />
      <rect x="66" y="30" width="38" height="4" rx="2" fill={text} opacity=".85" />
      <g transform="translate(-4 14)">
        {bars.map(([x, y, h, white]) => <g key={x}><line x1={x + 4} x2={x + 4} y1={y - 5} y2={y + h + 5} stroke="#C65A16" /><rect x={x} y={y} width="8" height={h} rx="1" fill={white ? '#fff' : '#FF7417'} stroke="#C65A16" strokeWidth=".8" /></g>)}
      </g>
    </svg>
  );
}

export default function AppearanceSettings() {
  const { isDark, toggleTheme } = useTheme();
  return (
    <SettingsSection title="Appearance" lede="How the academy looks on this browser.">
      <SettingGroup title="Theme" help="Applies at once and is remembered on this browser. The button in the header changes the same setting.">
        <fieldset>
          <legend className="sr-only">Theme</legend>
          <div className="grid max-w-lg gap-3 min-[420px]:grid-cols-2">
            {THEMES.map((t) => (
              <label key={t.label} className="studio-choice flex-col gap-3 rounded-xl p-2.5">
                <input type="radio" name="theme" checked={isDark === t.dark} onChange={() => { if (isDark !== t.dark) toggleTheme(); }} aria-label={`${t.label}: ${t.hint}`} />
                <Preview {...t} />
                <span aria-hidden className="flex items-center gap-3 px-1.5 pb-1">
                  <span><span className="block text-[0.9375rem] font-semibold">{t.label}</span><span className="studio-hint block">{t.hint}</span></span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </SettingGroup>
    </SettingsSection>
  );
}
