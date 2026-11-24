/**
 * Settings: profile, learning, security and appearance (?section=…). Notifications is
 * /settings/communication, inside the same frame.
 *
 * A student's profile and learning details are one record (POST /api/student/onboarding needs all of
 * it), so both sections edit one form and share one save bar; moving between them keeps the changes.
 * Other roles see their account here and can change their photo; that API is for students only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Check } from 'lucide-react';
import AccountSecurity from '@/components/AccountSecurity';
import ConfirmDialog from '@/components/admin/portal/ConfirmDialog';
import PhotoField from '@/components/profile/PhotoField';
import { CertificationsField, ChannelsField, EducationSelect, GenderField, LevelField, TextField, TopicsField, YearsField } from '@/components/profile/ProfileFields';
import AppearanceSettings from '@/components/settings/AppearanceSettings';
import { ReadOnlyValue, SettingGroup, SettingsSection } from '@/components/settings/SettingsParts';
import SettingsShell, { sectionFrom, type SectionId } from '@/components/settings/SettingsShell';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import {
  EMPTY_PROFILE, LEARNING_FIELDS, REQUIRED_FIELDS, apiErrorText, completeness, profileErrors, profileFrom,
  type ProfileErrors, type ProfileField, type ProfileForm, type ProfileSource,
} from '@/lib/student-profile';

/** Where each field is edited; the photo saves by itself. */
const IN_LEARNING: ProfileField[] = [...LEARNING_FIELDS, 'certifications'];
const EDITABLE = (Object.keys(EMPTY_PROFILE) as ProfileField[]).filter((f) => f !== 'profilePhoto');
const sectionOf = (field: ProfileField): SectionId => (IN_LEARNING.includes(field) ? 'learning' : 'profile');
const hrefOf = (section: SectionId) => (section === 'profile' ? '/profile' : `/profile?section=${section}`);

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const router = useRouter();
  const [saved, setSaved] = useState<ProfileForm>(EMPTY_PROFILE);
  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);

  const userId = user?.id;
  const isStudent = user?.role === 'student';
  const section = sectionFrom(router.query.section, isStudent);

  const changed = useMemo(() => EDITABLE.filter((f) => JSON.stringify(form[f]) !== JSON.stringify(saved[f])), [form, saved]);
  const dirty = changed.length > 0;
  const flagged = useMemo(() => [...new Set(changed.map(sectionOf))], [changed]);

  // Once per account: a later profile refresh must not replace what is being edited.
  const load = useCallback(async () => {
    setLoadState('loading');
    try {
      const next = profileFrom(await apiClient.get<ProfileSource>('/auth/me'));
      setSaved(next);
      setForm(next);
      setLoadState('ready');
    } catch {
      setLoadState('failed');
    }
  }, []);
  useEffect(() => {
    if (userId) void load();
  }, [userId, load]);

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (!justSaved) return undefined;
    const timer = setTimeout(() => setJustSaved(false), 4000);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const set = <K extends ProfileField>(field: K, value: ProfileForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
    setSaveError('');
    setJustSaved(false);
  };
  const setPhoto = (photo: string) => {
    setForm((prev) => ({ ...prev, profilePhoto: photo }));
    setSaved((prev) => ({ ...prev, profilePhoto: photo }));
    void refreshUser();
  };

  const discard = () => {
    setForm(saved);
    setErrors({});
    setSaveError('');
  };

  const save = async () => {
    setSaveError('');
    const found = profileErrors(form);
    const first = REQUIRED_FIELDS.find((f) => found[f]);
    if (first) {
      setErrors(found);
      const owner = sectionOf(first);
      setSaveError(owner === section ? 'Complete the marked details to save.' : `To save, complete the marked details in ${owner === 'learning' ? 'Learning' : 'Profile'} too.`);
      if (owner !== section) await router.push(hrefOf(owner), undefined, { shallow: true, scroll: false });
      setTimeout(() => document.getElementById(`st-${first}`)?.focus(), 60);
      return;
    }
    setSaving(true);
    try {
      await apiClient.post('/student/onboarding', form);
      if (!user?.onboardingCompleted) await apiClient.put('/student/onboarding/complete');
      setSaved(form);
      setJustSaved(true);
      void refreshUser();
    } catch (error) {
      setSaveError(apiErrorText(error, 'Failed to save profile'));
    } finally {
      setSaving(false);
    }
  };

  const onLeave = (href: string) => {
    if (!dirty || href.startsWith('/profile')) return true;
    setLeaveTo(href);
    return false;
  };

  const stored = completeness(user);
  const missing = stored.total - stored.filled;
  const editsProfile = section === 'profile' || section === 'learning';

  return (
    <SettingsShell section={section} onLeave={onLeave} flagged={flagged}>
      {editsProfile && loadState === 'loading' && (
        <div role="status" aria-label="Loading your profile" className="space-y-5 pb-6">
          <div className="orbit-skeleton h-7 w-40 rounded-lg" /><div className="orbit-skeleton h-4 w-2/3 rounded" />
          <div className="orbit-skeleton h-[4.5rem] w-full rounded-lg" /><div className="orbit-skeleton h-12 w-full rounded-lg" /><div className="orbit-skeleton h-12 w-full rounded-lg" />
        </div>
      )}
      {editsProfile && loadState === 'failed' && (
        <div className="studio-frost mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl p-4" role="alert">
          <p className="text-sm font-medium">Your profile could not be loaded.</p>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>Try again</button>
        </div>
      )}

      {editsProfile && loadState === 'ready' && isStudent && missing > 0 && (
        <p className="studio-frost mb-7 rounded-xl px-4 py-3 text-sm">
          {missing === 1 ? 'One detail is' : `${missing} details are`} still missing from your profile. Fill them in here, or <Link href="/onboarding" className="font-semibold text-[var(--st-accent)] underline underline-offset-2">use the guided setup</Link>.
        </p>
      )}

      {section === 'profile' && loadState === 'ready' && (
        <SettingsSection title="Profile" lede={isStudent ? 'Who you are and how to reach you.' : 'Your account details.'}>
          <SettingGroup title="Photo" help="Saved as soon as you choose it.">
            <PhotoField photo={form.profilePhoto} name={form.fullName || user?.name || ''} onChange={setPhoto} />
          </SettingGroup>
          {isStudent ? (
            <>
              <SettingGroup title="Identity">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="sm:col-span-2"><TextField id="st-fullName" label="Full name" value={form.fullName} onChange={(v) => set('fullName', v)} error={errors.fullName} placeholder="Enter your full name" autoComplete="name" /></div>
                  <TextField id="st-dateOfBirth" label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => set('dateOfBirth', v)} error={errors.dateOfBirth} autoComplete="bday" max={new Date().toISOString().slice(0, 10)} />
                  <div className="sm:col-span-2"><GenderField id="st-gender" value={form.gender} onChange={(v) => set('gender', v)} /></div>
                </div>
              </SettingGroup>
              <SettingGroup title="Contact">
                <div className="grid gap-5 sm:grid-cols-2">
                  <TextField id="st-contactNumber" label="Contact number" type="tel" inputMode="tel" value={form.contactNumber} onChange={(v) => set('contactNumber', v)} error={errors.contactNumber} placeholder="+1234567890" autoComplete="tel" />
                  <ReadOnlyValue label="Email" value={user?.email || ''} note="Used to sign in. It cannot be changed here." />
                </div>
              </SettingGroup>
              <SettingGroup title="Contact channels" help="Your general preference, kept on your profile. To choose what you receive, message by message, open Notifications.">
                <ChannelsField hideLegend id="st-notificationPreferences" value={form.notificationPreferences} onChange={(v) => set('notificationPreferences', v)} />
              </SettingGroup>
            </>
          ) : (
            <SettingGroup title="Account" help="Your name, email and role are managed by an administrator.">
              <div className="grid gap-5 sm:grid-cols-2">
                <ReadOnlyValue label="Full name" value={user?.name || ''} />
                <ReadOnlyValue label="Email" value={user?.email || ''} />
              </div>
              {user?.role === 'instructor' && <Link href="/instructor/profile" className="mt-5 inline-block text-sm font-semibold text-[var(--st-accent)] underline-offset-4 hover:underline">See your assigned courses</Link>}
            </SettingGroup>
          )}
        </SettingsSection>
      )}

      {section === 'learning' && loadState === 'ready' && (
        <SettingsSection title="Learning" lede="Your background and what you want to study.">
          <SettingGroup title="Education">
            <div className="space-y-5">
              <EducationSelect id="st-educationLevel" value={form.educationLevel} onChange={(v) => set('educationLevel', v)} error={errors.educationLevel} />
              <CertificationsField id="st-certifications" value={form.certifications} onChange={(v) => set('certifications', v)} />
            </div>
          </SettingGroup>
          <SettingGroup wide title="Trading experience" help="How you describe yourself. Your course level is separate and changes only as you complete courses.">
            <div className="max-w-2xl space-y-8">
              <LevelField id="st-tradingLevel" value={form.tradingLevel} onChange={(v) => set('tradingLevel', v)} error={errors.tradingLevel} />
              <YearsField id="st-yearsOfExperience" value={form.yearsOfExperience} onChange={(v) => set('yearsOfExperience', v)} error={errors.yearsOfExperience} />
            </div>
          </SettingGroup>
          <SettingGroup wide title="Topics" help="Keep at least one.">
            <div className="max-w-2xl"><TopicsField id="st-preferredTopics" value={form.preferredTopics} onChange={(v) => set('preferredTopics', v)} error={errors.preferredTopics} /></div>
          </SettingGroup>
        </SettingsSection>
      )}

      {section === 'security' && (
        <SettingsSection title="Security" lede="Your password and the devices you are signed in on.">
          <AccountSecurity />
        </SettingsSection>
      )}

      {section === 'appearance' && <AppearanceSettings />}

      {/* One bar for the student record, shown wherever its changes are pending. */}
      {isStudent && (dirty || justSaved || saveError) && (
        <div className="studio-night studio-fade sticky bottom-3 z-20 -mx-1 mt-2 rounded-xl px-4 py-3 shadow-lift sm:-mx-3" data-testid="save-bar">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
            <p className="flex min-w-0 items-center gap-2 text-sm font-medium" role={saveError ? 'alert' : 'status'}>
              {saveError ? <span className="text-[#ffb9a3]">{saveError}</span> : dirty ? 'You have unsaved changes.' : <><Check className="h-4 w-4 shrink-0 text-[#e8ad38]" strokeWidth={2.75} aria-hidden />Changes saved.</>}
            </p>
            {dirty && (
              <div className="flex gap-2 max-sm:w-full">
                <button type="button" onClick={discard} disabled={saving} className="btn min-h-[2.75rem] border border-[var(--night-line)] hover:bg-white/10 max-sm:flex-1">Discard</button>
                <button type="button" onClick={() => void save()} disabled={saving} className="btn btn-primary min-h-[2.75rem] max-sm:flex-1">{saving ? 'Saving…' : 'Save changes'}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {leaveTo && createPortal(
        <ConfirmDialog
          title="Leave without saving?"
          consequence="The changes to your profile have not been saved and will be lost."
          confirmLabel="Discard and leave"
          danger
          onConfirm={async () => { discard(); await router.push(leaveTo); return null; }}
          onClose={() => setLeaveTo(null)}
        />,
        document.body,
      )}
    </SettingsShell>
  );
}
