/**
 * Account security controls in Settings: change password (current password required) and sign out of
 * every device. The password rule is the same one the server applies (lib/password-policy.js). After
 * a password change this tab keeps working with the new session the server sets; every other device
 * is signed out.
 */

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/router';
import { Check, Eye, EyeOff } from 'lucide-react';
import ConfirmDialog from '@/components/admin/portal/ConfirmDialog';
import { SettingGroup } from '@/components/settings/SettingsParts';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { duringSessionChange } from '@/lib/session-change';
import { PASSWORD_MIN_CHARS, checkNewPassword } from '@/lib/password-policy';

type ApiError = { response?: { status?: number; data?: { error?: string; message?: string; retryAfterSec?: number } }; message?: string };

function errorText(err: unknown, fallback: string): string {
  const e = err as ApiError;
  const data = e.response?.data;
  if (e.response?.status === 429 && data?.retryAfterSec) {
    return `Too many attempts. Try again in about ${Math.ceil(data.retryAfterSec / 60)} minute(s).`;
  }
  return data?.error || data?.message || fallback;
}

function PasswordInput({ id, label, value, onChange, autoComplete, children }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string; children?: React.ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="studio-label">{label}</label>
      <div className="relative mt-1.5">
        <input id={id} type={shown ? 'text' : 'password'} autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} className="studio-input !pr-12" required aria-describedby={children ? `${id}-help` : undefined} />
        <button type="button" onClick={() => setShown(!shown)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-ink-subtle hover:text-ink" aria-label={`${shown ? 'Hide' : 'Show'} ${label.toLowerCase()}`} aria-pressed={shown}>
          {shown ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
        </button>
      </div>
      {children && <div id={`${id}-help`} className="studio-hint mt-1.5">{children}</div>}
    </div>
  );
}

function Rule({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${met ? 'font-medium text-ink' : ''}`}>
      <span aria-hidden className={`flex h-4 w-4 items-center justify-center rounded-full ${met ? 'bg-[#ff7417] text-[#191919]' : 'border border-[var(--fo-line-strong)]'}`}>{met && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}</span>
      {children}
    </span>
  );
}

export default function AccountSecurity() {
  const { logout } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const typed = Boolean(currentPassword || newPassword || confirmPassword);
  const clear = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    const policy = checkNewPassword(newPassword);
    if (!policy.ok) {
      setError(policy.error);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    setSaving(true);
    try {
      // Every other session has ended; the server set a new session cookie for this browser.
      const res = await duringSessionChange(() => apiClient.post<{ message: string }>('/auth/change-password', { currentPassword, newPassword }));
      clear();
      setMessage(res.message);
    } catch (err: unknown) {
      setError(errorText(err, 'Could not change your password. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSignOutEverywhere = async () => {
    try {
      await apiClient.post('/auth/logout-all');
      await logout();
      router.push('/login');
      return null;
    } catch (err: unknown) {
      return errorText(err, 'Could not sign out other devices. Try again.');
    }
  };

  return (
    <>
      <SettingGroup title="Password" help="Changing your password signs you out on every other device.">
        <form onSubmit={handleChangePassword} noValidate className="max-w-md space-y-5" aria-label="Change password">
          <PasswordInput id="current-password" label="Current password" autoComplete="current-password" value={currentPassword} onChange={(v) => { setCurrentPassword(v); setMessage(''); }} />
          <PasswordInput id="new-password" label="New password" autoComplete="new-password" value={newPassword} onChange={setNewPassword}>
            <Rule met={newPassword !== '' && checkNewPassword(newPassword).ok}>At least {PASSWORD_MIN_CHARS} characters</Rule>
          </PasswordInput>
          <PasswordInput id="confirm-new-password" label="Confirm new password" autoComplete="new-password" value={confirmPassword} onChange={setConfirmPassword}>
            <Rule met={confirmPassword !== '' && confirmPassword === newPassword}>Matches the new password</Rule>
          </PasswordInput>
          {error && <p className="studio-error" role="alert">{error}</p>}
          {message && <p className="studio-frost flex items-start gap-2 rounded-lg px-3.5 py-2.5 text-sm font-medium" role="status"><Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--st-accent)]" strokeWidth={2.5} aria-hidden />{message}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={saving} className="btn btn-primary min-h-[2.75rem]">{saving ? 'Saving…' : 'Change password'}</button>
            {typed && !saving && <button type="button" onClick={clear} className="btn btn-ghost min-h-[2.75rem]">Cancel</button>}
          </div>
        </form>
      </SettingGroup>

      <SettingGroup title="Sign out everywhere" tone="danger" help="Ends your session on every device and browser, including this one. Use it if you signed in on a device you no longer control.">
        <button type="button" onClick={() => setConfirming(true)} className="btn btn-danger-quiet min-h-[2.75rem]">Sign out on all devices</button>
      </SettingGroup>
      {confirming && createPortal(<ConfirmDialog title="Sign out everywhere?" consequence="You will be signed out on every device and browser, including this one." confirmLabel="Sign out on all devices" danger onConfirm={handleSignOutEverywhere} onClose={() => setConfirming(false)} />, document.body)}
    </>
  );
}
