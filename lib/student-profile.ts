/**
 * The student profile as the onboarding flow (/onboarding) and Settings (/profile) edit it: the
 * option lists, the form shape and the checks made before sending. Both pages post the whole form to
 * POST /api/student/onboarding, whose rules (lib/onboarding-input.js) stay the authority; the checks
 * here only point at the field sooner.
 */

export type TradingLevel = 'beginner' | 'intermediate' | 'advanced';
export type Channel = 'email' | 'sms' | 'push';

export interface ProfileForm {
  fullName: string;
  dateOfBirth: string;
  gender: string;
  contactNumber: string;
  profilePhoto: string;
  educationLevel: string;
  certifications: string;
  tradingLevel: TradingLevel;
  yearsOfExperience: string;
  preferredTopics: string[];
  notificationPreferences: Record<Channel, boolean>;
}

export type ProfileField = keyof ProfileForm;
export type ProfileErrors = Partial<Record<ProfileField, string>>;

/** The part of GET /api/auth/me these pages read. */
export interface ProfileSource {
  name?: string;
  profilePhoto?: string | null;
  studentDetails?: Partial<Omit<ProfileForm, 'profilePhoto'>> | null;
}

export const TEXT_MAX = 200;

export const EMPTY_PROFILE: ProfileForm = {
  fullName: '',
  dateOfBirth: '',
  gender: '',
  contactNumber: '',
  profilePhoto: '',
  educationLevel: '',
  certifications: '',
  tradingLevel: 'beginner',
  yearsOfExperience: '0',
  preferredTopics: [],
  notificationPreferences: { email: true, sms: false, push: true },
};

export const GENDERS: Array<[string, string]> = [['', 'Prefer not to say'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']];

export const EDUCATION: Array<[string, string]> = [
  ['high-school', 'High school'],
  ['diploma', 'Diploma'],
  ['bachelor', "Bachelor's degree"],
  ['master', "Master's degree"],
  ['phd', 'PhD'],
  ['other', 'Other'],
];

export const TRADING_LEVELS: Array<{ id: TradingLevel; label: string; hint: string }> = [
  { id: 'beginner', label: 'Beginner', hint: 'Just starting out' },
  { id: 'intermediate', label: 'Intermediate', hint: 'Some experience' },
  { id: 'advanced', label: 'Advanced', hint: 'Expert trader' },
];

/** Value, full label, and the short label used on the scale. */
export const YEARS: Array<[string, string, string]> = [
  ['0', 'Less than 1 year', '< 1'],
  ['1-2', '1–2 years', '1–2'],
  ['3-5', '3–5 years', '3–5'],
  ['6-10', '6–10 years', '6–10'],
  ['10+', 'More than 10 years', '10+'],
];

/** Grouped for reading only; the stored value is the topic name. */
export const TOPIC_GROUPS: Array<{ title: string; topics: string[] }> = [
  { title: 'Foundations', topics: ['Forex Basics', 'Fundamental Analysis'] },
  { title: 'Reading the chart', topics: ['Technical Analysis', 'Chart Patterns', 'Indicators & Oscillators'] },
  { title: 'Discipline and systems', topics: ['Risk Management', 'Trading Psychology', 'Algorithmic Trading'] },
];
const LISTED = new Set(TOPIC_GROUPS.flatMap((g) => g.topics));
/** Topics saved earlier that are not in today's list. They stay selected until removed. */
export const unlistedTopics = (topics: string[]) => topics.filter((t) => !LISTED.has(t));

const labelIn = (list: Array<[string, string, ...string[]]>, value: string) => list.find(([id]) => id === value)?.[1] || value;
export const educationLabel = (value: string) => labelIn(EDUCATION, value);
export const yearsLabel = (value: string) => labelIn(YEARS, value);
export const genderLabel = (value: string) => labelIn(GENDERS, value);

/** "12 April 1996" for a stored yyyy-mm-dd, without a timezone shift. */
export function dateLabel(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  if (!m) return value || '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

export function profileFrom(data: ProfileSource): ProfileForm {
  const d = data.studentDetails || {};
  return {
    fullName: d.fullName || data.name || '',
    dateOfBirth: d.dateOfBirth || '',
    gender: d.gender || '',
    contactNumber: d.contactNumber || '',
    profilePhoto: data.profilePhoto || '',
    educationLevel: d.educationLevel || '',
    certifications: d.certifications || '',
    tradingLevel: d.tradingLevel || 'beginner',
    yearsOfExperience: d.yearsOfExperience || '0',
    preferredTopics: d.preferredTopics || [],
    notificationPreferences: d.notificationPreferences || { ...EMPTY_PROFILE.notificationPreferences },
  };
}

/** The server takes single-line text only; a line break becomes a comma. */
export const singleLine = (value: string) => value.replace(/\s*[\r\n\t]+\s*/g, ', ');

const CHECKS: Partial<Record<ProfileField, (f: ProfileForm) => string | false>> = {
  fullName: (f) => !f.fullName.trim() && 'Enter your full name.',
  dateOfBirth: (f) => (!f.dateOfBirth ? 'Enter your date of birth.' : f.dateOfBirth > new Date().toISOString().slice(0, 10) && 'Your date of birth cannot be in the future.'),
  contactNumber: (f) => !f.contactNumber.trim() && 'Enter a contact number.',
  educationLevel: (f) => !f.educationLevel && 'Choose your highest education level.',
  tradingLevel: (f) => !f.tradingLevel && 'Choose the level that describes you.',
  yearsOfExperience: (f) => !f.yearsOfExperience && 'Choose how long you have been trading.',
  preferredTopics: (f) => f.preferredTopics.length === 0 && 'Choose at least one topic.',
};

/** The fields POST /api/student/onboarding requires, by onboarding step and Settings section. */
export const PERSONAL_FIELDS: ProfileField[] = ['fullName', 'dateOfBirth', 'contactNumber'];
export const EDUCATION_FIELDS: ProfileField[] = ['educationLevel'];
export const TRADING_FIELDS: ProfileField[] = ['tradingLevel', 'yearsOfExperience'];
export const TOPIC_FIELDS: ProfileField[] = ['preferredTopics'];
export const LEARNING_FIELDS: ProfileField[] = [...EDUCATION_FIELDS, ...TRADING_FIELDS, ...TOPIC_FIELDS];
export const REQUIRED_FIELDS: ProfileField[] = [...PERSONAL_FIELDS, ...LEARNING_FIELDS];

export function profileErrors(form: ProfileForm, fields: ProfileField[] = REQUIRED_FIELDS): ProfileErrors {
  const out: ProfileErrors = {};
  for (const field of fields) {
    const problem = CHECKS[field]?.(form);
    if (problem) out[field] = problem;
  }
  return out;
}

/** How many of the required details are stored on the account. */
export function completeness(source: ProfileSource | null | undefined) {
  const details = source?.studentDetails as Record<string, unknown> | null | undefined;
  const filled = REQUIRED_FIELDS.filter((field) => {
    const v = details?.[field];
    return Array.isArray(v) ? v.length > 0 : Boolean(v);
  }).length;
  return { filled, total: REQUIRED_FIELDS.length };
}

export function apiErrorText(err: unknown, fallback: string) {
  const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string };
  return e?.response?.data?.message || e?.response?.data?.error || e?.message || fallback;
}
