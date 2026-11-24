/**
 * Student onboarding: five steps, each laid out for what it asks, saved once at the end
 *   GET  /api/auth/me                      existing answers
 *   POST /api/student/onboarding           the whole form
 *   PUT  /api/student/onboarding/complete  first time only
 * Optional: a student can skip it. A student who already finished uses the same steps to edit.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import BrandLogo from '@/components/BrandLogo';
import LoadingSpinner from '@/components/LoadingSpinner';
import PhotoField from '@/components/profile/PhotoField';
import { CertificationsField, ChannelsField, EducationTiles, GenderField, LevelField, TextField, TopicsField, YearsField } from '@/components/profile/ProfileFields';
import Skyline from '@/components/profile/Skyline';
import StudentPass from '@/components/profile/StudentPass';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import {
  EDUCATION_FIELDS, EMPTY_PROFILE, PERSONAL_FIELDS, REQUIRED_FIELDS, TOPIC_FIELDS, TRADING_FIELDS,
  apiErrorText, dateLabel, educationLabel, genderLabel, profileErrors, profileFrom, yearsLabel,
  type ProfileErrors, type ProfileField, type ProfileForm, type ProfileSource,
} from '@/lib/student-profile';

const STEPS: Array<{ name: string; fields: ProfileField[] }> = [
  { name: 'Personal details', fields: PERSONAL_FIELDS },
  { name: 'Education', fields: EDUCATION_FIELDS },
  { name: 'Trading experience', fields: TRADING_FIELDS },
  { name: 'Preferences', fields: TOPIC_FIELDS },
  { name: 'Confirmation', fields: [] },
];
const LAST = STEPS.length;

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const channelsOn = (form: ProfileForm) => ([['email', 'email'], ['sms', 'SMS'], ['push', 'push']] as const).filter(([k]) => form.notificationPreferences[k]).map(([, label]) => label);

const COPY = [
  { title: 'Introduce yourself', lede: 'This goes on your profile. You can change it whenever you like.', editing: 'These details stay on your profile. Lessons stay open either way.' },
  { title: 'What have you studied?', lede: 'Any background is a fine place to start. Choose the highest level you have finished.', editing: 'Choose the highest level you have finished.' },
  { title: 'How well do you know the market?', lede: 'Your answer sets your starting level, so be honest rather than ambitious.', editing: 'This describes your experience. Your course level changes only as you complete courses.' },
  { title: 'What do you want to learn?', lede: 'Choose at least one topic, as many as you like.', editing: 'Choose at least one topic, as many as you like.' },
  { title: 'Does this look right?', lede: 'Check the details, then finish. You can change them later in Settings.', editing: 'Check the details, then save your changes.' },
];
const NOTES = [
  'Your pass fills in as you answer. Setup is optional: skip it and open a course whenever you are ready.',
  'Certifications are optional.',
  'Not sure? Choose the lower one. Your level rises as you complete courses.',
  'Notification choices can be changed later in Settings.',
  'Your answers are saved when you finish this step.',
];

export default function Onboarding() {
  const { user, isAuthenticated, loading: authLoading, refreshUser, logout } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [started, setStarted] = useState(false);
  const [reached, setReached] = useState(1);
  const [back, setBack] = useState(false);
  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [finished, setFinished] = useState(false);
  const [dirty, setDirty] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);

  const userId = user?.id;
  const isStudent = user?.role === 'student';
  const editing = Boolean(user?.onboardingCompleted) && !finished;

  // Redirect if not authenticated or not a student
  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) router.push('/login');
    else if (user && user.role !== 'student') router.push('/dashboard');
  }, [isAuthenticated, authLoading, user, router]);

  // Existing answers, once per account: a later profile refresh (tab focus, photo upload) must not
  // replace what is being typed.
  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      setForm(profileFrom(await apiClient.get<ProfileSource>('/auth/me')));
      setLoadState('ready');
    } catch {
      setLoadState('failed');
    }
  }, []);
  useEffect(() => {
    if (userId && isStudent) void load();
  }, [userId, isStudent, load]);

  // Answers are sent at the end, so leaving the site part-way asks first.
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // After a step change, the page starts at the top and the new heading is announced.
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    heading.current?.focus({ preventScroll: true });
  }, [step, finished, started]);

  const set = <K extends ProfileField>(field: K, value: ProfileForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setDirty(true);
  };
  const setPhoto = (photo: string) => setForm((prev) => ({ ...prev, profilePhoto: photo }));

  const goTo = (next: number) => {
    if (next === step) return;
    focusHeading.current = true;
    setBack(next < step);
    setErrors({});
    setSaveError('');
    setStep(next);
    setReached((r) => Math.max(r, next));
  };

  /** True when these fields are complete; otherwise shows what is missing, on the step that asks it. */
  const check = (fields: ProfileField[]) => {
    const found = profileErrors(form, fields);
    const first = fields.find((f) => found[f]);
    if (!first) return true;
    const owner = STEPS.findIndex((s) => s.fields.includes(first)) + 1;
    if (owner !== step) goTo(owner);
    setErrors(found);
    setTimeout(() => document.getElementById(`ob-${first}`)?.focus(), 0);
    return false;
  };

  const submit = async () => {
    if (!check(REQUIRED_FIELDS)) return;
    setSaving(true);
    setSaveError('');
    const firstTime = !user?.onboardingCompleted;
    try {
      await apiClient.post('/student/onboarding', form);
      // Mark onboarding as complete (only if not already completed)
      if (firstTime) await apiClient.put('/student/onboarding/complete');
      setDirty(false);
      // Refresh the shared profile (onboarding status) before leaving.
      await refreshUser();
      if (firstTime) {
        focusHeading.current = true;
        setFinished(true);
      } else {
        router.push('/dashboard');
      }
    } catch (error) {
      setSaveError(apiErrorText(error, 'Failed to save onboarding data'));
      setSaving(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (step === LAST) void submit();
    else if (check(STEPS[step - 1].fields)) goTo(step + 1);
  };

  const openStep = (next: number) => {
    if (next < step || check(STEPS[step - 1].fields)) goTo(next);
  };

  const signOut = async () => {
    await logout();
    router.push('/login');
  };

  if (authLoading || !isAuthenticated || (user && user.role !== 'student')) {
    return <LoadingSpinner message="Loading onboarding..." fullScreen />;
  }

  const firstName = (form.fullName.trim() || user?.name || '').split(/\s+/)[0] || '';
  const problems = Object.values(errors).filter(Boolean);
  const intro = loadState === 'ready' && !finished && !editing && !started;
  const copy = COPY[step - 1];
  const progress = finished ? 1 : intro ? 0.12 : 0.12 + ((step - 1) / LAST) * 0.88;

  const head = <Head><title key="title">{editing ? 'Edit your profile | ForexOrbit Academy' : 'Get started | ForexOrbit Academy'}</title></Head>;
  const topBar = (
    <div className="relative z-10 mx-auto flex w-full max-w-[76rem] items-center justify-between gap-3 px-4 py-3 sm:px-8 sm:py-5">
      <Link href="/" aria-label="FX Orbit Academy home" className="inline-flex shrink-0"><BrandLogo variant="light" priority className="h-7 brightness-0 invert sm:h-9" /></Link>
      <div className="flex items-center text-sm font-medium sm:gap-1">
        <button type="button" onClick={() => void signOut()} title={user?.email} className="min-h-[2.75rem] whitespace-nowrap rounded-full px-2.5 hover:bg-white/10">Sign out</button>
        {!finished && <button type="button" onClick={() => router.push('/dashboard')} className="min-h-[2.75rem] whitespace-nowrap rounded-full border border-white/40 px-3.5 hover:bg-white/10">{editing ? 'Dashboard' : 'Skip for now'}</button>}
      </div>
    </div>
  );

  // Opening and closing: the orange field fills the screen.
  if (intro || (loadState === 'ready' && finished)) {
    return (
      <div className="studio onb">
        {head}
        <div className="onb-field flex min-h-[100dvh] flex-col">
          <Skyline progress={progress} />
          {topBar}
          <main className="relative z-10 mx-auto grid w-full max-w-[76rem] flex-1 content-center items-center gap-10 px-4 pb-14 pt-4 sm:px-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-16" data-testid={finished ? 'onboarding-done' : 'onboarding-intro'}>
            <div className="max-w-xl">
              <h1 ref={heading} tabIndex={-1} className="onb-title text-[clamp(2.5rem,1.6rem+4.2vw,4.5rem)] [overflow-wrap:anywhere]">
                {finished ? <>You&rsquo;re set{firstName ? `, ${firstName}` : ''}.</> : <>Welcome{firstName ? `, ${firstName}` : ''}.</>}
              </h1>
              <p className="mt-5 max-w-md text-lg leading-relaxed">
                {finished
                  ? <>{user?.learningLevel ? <>You start at <strong className="font-semibold">{user.learningLevel}</strong> level. It moves up as you complete courses.</> : 'Your level moves up as you complete courses.'} You can change your details in Settings.</>
                  : 'Tell us where you are starting, and we set your level to match. Four short steps, then a quick check.'}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {finished ? (
                  <>
                    <Link href="/dashboard" className="btn btn-lg min-h-[3.25rem] !rounded-full bg-[#ffffff] !px-8 text-[#8f3707] hover:bg-[#fff3e8]">Open dashboard</Link>
                    <Link href="/courses" className="btn btn-lg min-h-[3.25rem] !rounded-full border border-white/50 !px-8 hover:bg-white/10">Browse courses</Link>
                  </>
                ) : (
                  <button type="button" onClick={() => { focusHeading.current = true; setStarted(true); }} className="btn btn-lg min-h-[3.25rem] !rounded-full bg-[#ffffff] !px-8 text-[#8f3707] hover:bg-[#fff3e8]">Get started<ArrowRight className="h-4 w-4" aria-hidden /></button>
                )}
              </div>
            </div>
            <div className="onb-pass-in w-full max-w-[26rem]"><StudentPass form={form} step={finished ? LAST + 1 : 1} total={LAST} className="lg:rotate-[4deg]" /></div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="studio onb min-h-[100dvh]">
      {head}
      <div className="onb-field">
        <Skyline progress={progress} />
        {topBar}
        <div className="relative z-10 mx-auto min-h-[14rem] max-w-[76rem] px-4 pb-24 pt-2 sm:px-8 sm:pb-32 sm:pt-5">
          {loadState === 'ready' && (
            <div key={step} className={`max-w-2xl ${back ? 'studio-step-back' : 'studio-step'}`}>
              <p className="num text-sm font-medium">Step {step} of {LAST}</p>
              <h1 ref={heading} tabIndex={-1} className="onb-title mt-2 text-[clamp(1.875rem,1.4rem+2.2vw,3.125rem)]">{step === 1 && editing ? 'Edit your profile' : copy.title}</h1>
              <p className="mt-3 max-w-lg text-[0.9375rem] leading-relaxed sm:text-base">{editing ? copy.editing : copy.lede}</p>
            </div>
          )}
        </div>
      </div>

      <main className="relative z-10 mx-auto -mt-16 grid max-w-[76rem] gap-8 px-3 pb-10 sm:-mt-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="onb-sheet min-w-0">
          {/* Progress along the top edge of the sheet; finished steps lead back. */}
          <nav aria-label="Onboarding progress" className="border-b border-line px-4 sm:px-8">
            <ol className="flex gap-1.5 sm:gap-3">
              {STEPS.map(({ name }, i) => {
                const n = i + 1;
                const here = n === step;
                const open = loadState === 'ready' && !here && n <= reached;
                const inner = (
                  <>
                    <span className="block h-1 overflow-hidden rounded-full bg-[#ece6dc]">{n <= step && <span className="onb-grow block h-full rounded-full bg-[#ff7417]" />}</span>
                    <span aria-hidden className={`mt-2.5 hidden truncate text-[0.8125rem] md:block ${here ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{name}</span>
                    <span className="sr-only">{`${name}${n < step ? ', complete' : ''}`}</span>
                  </>
                );
                return (
                  <li key={name} aria-current={here ? 'step' : undefined} className="min-w-0 flex-1">
                    {open ? <button type="button" onClick={() => openStep(n)} className="block w-full py-5 text-left hover:opacity-75 md:pb-3.5">{inner}</button> : <span className="block py-5 md:pb-3.5">{inner}</span>}
                  </li>
                );
              })}
            </ol>
          </nav>

          <div className="px-4 pt-7 sm:px-8 sm:pt-9">
            {loadState === 'loading' && (
              <div role="status" aria-label="Loading your answers" className="space-y-5 pb-10">
                <div className="orbit-skeleton h-[4.5rem] w-2/3 rounded-xl" /><div className="orbit-skeleton h-14 w-full rounded-xl" /><div className="orbit-skeleton h-14 w-full rounded-xl" />
              </div>
            )}
            {loadState === 'failed' && (
              <div className="pb-10" role="alert">
                <h1 className="font-display text-xl font-semibold">Your answers could not be loaded</h1>
                <p className="studio-hint mt-1">Nothing has changed. Check your connection, then try again.</p>
                <button type="button" className="btn btn-primary mt-4 min-h-[2.75rem]" onClick={() => void load()}>Try again</button>
              </div>
            )}
            {loadState === 'ready' && (
              <>
                {/* Outside the form: its confirmation dialog has a form of its own. */}
                {step === 1 && <div className="studio-step mb-8"><PhotoField photo={form.profilePhoto} name={form.fullName || user?.name || ''} onChange={setPhoto} /></div>}

                <form onSubmit={onSubmit} noValidate>
                  <div key={step} className={`min-h-[18rem] pb-9 ${back ? 'studio-step-back' : 'studio-step'}`}>
                    {step === 1 && (
                      <div className="space-y-6">
                        <TextField id="ob-fullName" label="Full name" value={form.fullName} onChange={(v) => set('fullName', v)} error={errors.fullName} placeholder="Enter your full name" autoComplete="name" />
                        <div className="grid gap-6 sm:grid-cols-2">
                          <TextField id="ob-dateOfBirth" label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => set('dateOfBirth', v)} error={errors.dateOfBirth} autoComplete="bday" max={new Date().toISOString().slice(0, 10)} />
                          <TextField id="ob-contactNumber" label="Contact number" type="tel" inputMode="tel" value={form.contactNumber} onChange={(v) => set('contactNumber', v)} error={errors.contactNumber} placeholder="+1234567890" autoComplete="tel" hint="Include your country code." />
                        </div>
                        <GenderField id="ob-gender" value={form.gender} onChange={(v) => set('gender', v)} />
                      </div>
                    )}
                    {step === 2 && (
                      <div className="space-y-8">
                        <EducationTiles id="ob-educationLevel" value={form.educationLevel} onChange={(v) => set('educationLevel', v)} error={errors.educationLevel} />
                        <CertificationsField id="ob-certifications" value={form.certifications} onChange={(v) => set('certifications', v)} />
                      </div>
                    )}
                    {step === 3 && (
                      <div className="space-y-9">
                        <LevelField id="ob-tradingLevel" value={form.tradingLevel} onChange={(v) => set('tradingLevel', v)} error={errors.tradingLevel} />
                        <YearsField id="ob-yearsOfExperience" value={form.yearsOfExperience} onChange={(v) => set('yearsOfExperience', v)} error={errors.yearsOfExperience} />
                      </div>
                    )}
                    {step === 4 && (
                      <div className="space-y-8">
                        <TopicsField chips id="ob-preferredTopics" value={form.preferredTopics} onChange={(v) => set('preferredTopics', v)} error={errors.preferredTopics} />
                        <div className="studio-frost rounded-2xl px-4 py-4 sm:px-6">
                          <ChannelsField id="ob-notificationPreferences" value={form.notificationPreferences} onChange={(v) => set('notificationPreferences', v)} />
                        </div>
                      </div>
                    )}
                    {step === LAST && <Review form={form} onEdit={goTo} />}
                  </div>

                  <div className="sticky bottom-0 z-10 -mx-4 rounded-b-3xl border-t border-line bg-[#ffffff] px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3.5 sm:-mx-8 sm:px-8 sm:pb-5 sm:pt-5">
                    {saveError && <p className="studio-error mb-2.5" role="alert">{saveError}</p>}
                    {problems.length > 0 && <p className="sr-only" role="alert">{problems.join(' ')}</p>}
                    <div className="flex items-center justify-between gap-3">
                      {step > 1 ? <button type="button" onClick={() => goTo(step - 1)} disabled={saving} className="btn btn-ghost btn-lg !rounded-full !px-4"><ArrowLeft className="h-4 w-4" aria-hidden />Back</button> : <span className="hidden sm:block" />}
                      <button type="submit" disabled={saving} className="btn btn-primary btn-lg min-h-[3.25rem] min-w-[11rem] !rounded-full max-sm:flex-1">
                        {step < LAST ? <>Continue<ArrowRight className="h-4 w-4" aria-hidden /></> : saving ? 'Saving…' : editing ? 'Save changes' : 'Complete onboarding'}
                      </button>
                    </div>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>

        {loadState === 'ready' && (
          <aside className="hidden lg:block" aria-label="About this step">
            <div className="sticky top-8 -mt-24">
              <div className="onb-pass-in"><StudentPass form={form} step={step} total={LAST} /></div>
              <p className="studio-hint mt-5 px-1">{NOTES[step - 1]}</p>
              <p className="studio-hint mt-4 truncate px-1">Signed in as {user?.email}</p>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
}

/** The answers as a record, each part leading back to its step. */
function Review({ form, onEdit }: { form: ProfileForm; onEdit: (step: number) => void }) {
  const channels = channelsOn(form);
  const rows: Array<[number, string, Array<[string, string]>]> = [
    [1, 'Personal details', [['Name', form.fullName], ['Date of birth', dateLabel(form.dateOfBirth)], ['Contact', form.contactNumber], ['Gender', genderLabel(form.gender)]]],
    [2, 'Education', [['Highest level', educationLabel(form.educationLevel)], ['Certifications', form.certifications || 'None']]],
    [3, 'Trading experience', [['Level', capital(form.tradingLevel)], ['Experience', yearsLabel(form.yearsOfExperience)]]],
    [4, 'Preferences', [['Topics', list(form.preferredTopics)], ['Notifications', channels.length ? capital(list(channels)) : 'None']]],
  ];
  return (
    <div className="border-t-2 border-[var(--fo-text)]">
      {rows.map(([n, title, items]) => (
        <section key={title} aria-label={title} className="relative grid gap-x-6 gap-y-2 border-b border-line py-5 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
          <h2 className="font-display text-[0.9375rem] font-semibold leading-6">{title}</h2>
          <dl className="space-y-1.5 text-[0.9375rem] sm:pr-14">
            {items.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[7.25rem_minmax(0,1fr)] gap-3">
                <dt className="text-ink-muted">{label}</dt>
                <dd className="font-medium [overflow-wrap:anywhere]">{value}</dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={() => onEdit(n)} className="absolute right-0 top-2 min-h-[2.75rem] rounded-lg px-2 text-sm font-semibold text-[var(--st-accent)] underline-offset-4 hover:underline" aria-label={`Edit ${title.toLowerCase()}`}>Edit</button>
        </section>
      ))}
    </div>
  );
}
