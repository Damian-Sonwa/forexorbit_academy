/**
 * Quiz settings for instructors (Phase 9). The server validates every value again
 * (lib/quiz-assessment.js normalizeSettings); this form only collects them. Empty number fields
 * mean "none" (unlimited attempts, no time limit, no pass mark).
 */

export type QuizSettingsForm = {
  status: 'draft' | 'published';
  maxAttempts: number | null;
  timeLimitMinutes: number | null;
  passingPercent: number | null;
  reviewPolicy: 'after_submission' | 'after_pass' | 'after_last_attempt' | 'never';
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  availableFrom: string | null;
  availableUntil: string | null;
};

export const DEFAULT_QUIZ_SETTINGS: QuizSettingsForm = {
  status: 'published',
  maxAttempts: null,
  timeLimitMinutes: null,
  passingPercent: null,
  reviewPolicy: 'after_submission',
  shuffleQuestions: false,
  shuffleOptions: false,
  availableFrom: null,
  availableUntil: null,
};

const input = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white';
/** The value of a datetime-local field is local time; toISOString would shift it on every save. */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value));

export default function QuizSettingsPanel({ value, onChange }: { value: QuizSettingsForm; onChange: (next: QuizSettingsForm) => void }) {
  const set = <K extends keyof QuizSettingsForm>(key: K, v: QuizSettingsForm[K]) => onChange({ ...value, [key]: v });
  return (
    <fieldset className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700" data-testid="quiz-settings">
      <legend className="px-1 text-sm font-semibold text-gray-800 dark:text-gray-200">Settings</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm text-gray-700 dark:text-gray-300">Status
          <select className={input} value={value.status} onChange={(e) => set('status', e.target.value as QuizSettingsForm['status'])}>
            <option value="published">Published (students can take it)</option>
            <option value="draft">Draft (hidden from students)</option>
          </select>
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">Review of correct answers
          <select className={input} value={value.reviewPolicy} onChange={(e) => set('reviewPolicy', e.target.value as QuizSettingsForm['reviewPolicy'])}>
            <option value="after_submission">After each submission</option>
            <option value="after_pass">After passing</option>
            <option value="after_last_attempt">After the last attempt</option>
            <option value="never">Never</option>
          </select>
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">Attempts allowed (empty = unlimited)
          <input className={input} type="number" min={1} max={20} value={value.maxAttempts ?? ''} onChange={(e) => set('maxAttempts', numberOrNull(e.target.value))} />
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">Time limit in minutes (empty = none)
          <input className={input} type="number" min={1} max={300} value={value.timeLimitMinutes ?? ''} onChange={(e) => set('timeLimitMinutes', numberOrNull(e.target.value))} />
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">Pass mark % (empty = none)
          <input className={input} type="number" min={0} max={100} value={value.passingPercent ?? ''} onChange={(e) => set('passingPercent', numberOrNull(e.target.value))} />
        </label>
        <div className="flex flex-col justify-end gap-2 text-sm text-gray-700 dark:text-gray-300">
          <label className="flex items-center gap-2"><input type="checkbox" checked={value.shuffleQuestions} onChange={(e) => set('shuffleQuestions', e.target.checked)} /> Shuffle question order</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={value.shuffleOptions} onChange={(e) => set('shuffleOptions', e.target.checked)} /> Shuffle answer options</label>
        </div>
        <label className="text-sm text-gray-700 dark:text-gray-300">Opens (optional)
          <input className={input} type="datetime-local" value={toLocal(value.availableFrom)} onChange={(e) => set('availableFrom', e.target.value ? new Date(e.target.value).toISOString() : null)} />
        </label>
        <label className="text-sm text-gray-700 dark:text-gray-300">Closes (optional)
          <input className={input} type="datetime-local" value={toLocal(value.availableUntil)} onChange={(e) => set('availableUntil', e.target.value ? new Date(e.target.value).toISOString() : null)} />
        </label>
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">Students who already started keep the questions and time they started with. With a pass mark, a quiz completes its lesson only when passed. An attempt with no answers never completes the lesson.</p>
    </fieldset>
  );
}
