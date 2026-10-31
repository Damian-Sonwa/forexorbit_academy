/**
 * Account security controls on the profile page: change password (current password required) and
 * sign out of every device. The password rule is the same one the server applies
 * (lib/password-policy.js). After a password change this tab keeps working with the new token the
 * server returns; every other device is signed out.
 */

import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
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

const fieldClass =
  'w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-700 dark:text-white';

export default function AccountSecurity() {
  const { logout } = useAuth();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

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
      const res = await apiClient.post<{ message: string }>('/auth/change-password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setMessage(res.message);
    } catch (err: unknown) {
      setError(errorText(err, 'Could not change your password. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSignOutEverywhere = async () => {
    setError('');
    setMessage('');
    if (!confirm('Sign out on every device, including this one?')) return;
    setSigningOut(true);
    try {
      await apiClient.post('/auth/logout-all');
      await logout();
      router.push('/login');
    } catch (err: unknown) {
      setError(errorText(err, 'Could not sign out other devices. Try again.'));
      setSigningOut(false);
    }
  };

  return (
    <section className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 sm:p-8 mt-6" aria-labelledby="account-security-heading">
      <h2 id="account-security-heading" className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Account security
      </h2>

      {message && (
        <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg" role="status">
          <p className="text-green-800 dark:text-green-300 text-sm">{message}</p>
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg" role="alert">
          <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
        </div>
      )}

      <form onSubmit={handleChangePassword} className="space-y-4 max-w-md" aria-labelledby="change-password-heading">
        <h3 id="change-password-heading" className="text-lg font-semibold text-gray-900 dark:text-white">
          Change password
        </h3>
        <div>
          <label htmlFor="current-password" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Current password
          </label>
          <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className={fieldClass} required />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            New password
          </label>
          <input id="new-password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_CHARS} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={fieldClass} required />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">At least {PASSWORD_MIN_CHARS} characters.</p>
        </div>
        <div>
          <label htmlFor="confirm-new-password" className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Confirm new password
          </label>
          <input id="confirm-new-password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_CHARS} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={fieldClass} required />
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">Changing your password signs you out on every other device.</p>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Change password'}
        </button>
      </form>

      <div className="mt-8 pt-6 border-t border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Sign out everywhere</h3>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Ends your session on every device and browser, including this one. Use it if you signed in on a device you no longer control.
        </p>
        <button
          type="button"
          onClick={handleSignOutEverywhere}
          disabled={signingOut}
          className="btn btn-danger-quiet px-4 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {signingOut ? 'Signing out…' : 'Sign out on all devices'}
        </button>
      </div>
    </section>
  );
}
