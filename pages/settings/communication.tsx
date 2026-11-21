/**
 * Communication settings (Phase 14): one place for channels, categories and devices.
 *   GET/PUT /api/communication/preferences   (essential categories cannot be turned off)
 *   GET/POST/DELETE /api/communication/devices (push on this browser; the member's own devices)
 * Changes apply to the next message (preferences are checked again when it is sent); no sign-out
 * is needed. Push appears only when the site has push configured.
 */

import { useState } from 'react';
import { BellRing, Lock, Mail, Monitor, Smartphone, Trash2 } from 'lucide-react';
import CommShell, { errorText } from '@/components/communication/CommShell';
import { ErrorState } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { formatDate } from '@/components/student/dashboard/format';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';

type Prefs = Record<'inApp' | 'email' | 'push', Record<string, boolean>>;
type PrefsResponse = { preferences: Prefs; categories: Array<{ id: string; label: string; essential: boolean; help: string }>; emailSuppressed: boolean };
type DevicesResponse = { devices: Array<{ id: string; label: string; createdAt: string | null; lastUsedAt: string | null }>; push: { available: boolean; publicKey: string | null } };
const CHANNELS: Array<{ id: 'inApp' | 'email' | 'push'; label: string; icon: typeof Mail }> = [{ id: 'inApp', label: 'In app', icon: BellRing }, { id: 'email', label: 'Email', icon: Mail }, { id: 'push', label: 'Push', icon: Smartphone }];

function keyBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function CommunicationSettings() {
  const prefs = usePortalResource<PrefsResponse>('/communication/preferences');
  const devices = usePortalResource<DevicesResponse>('/communication/devices');
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [enabling, setEnabling] = useState(false);

  const toggle = async (channel: string, category: string, value: boolean) => {
    if (!prefs.data) return;
    const key = `${channel}.${category}`;
    setSaving(key);
    const before = prefs.data;
    prefs.setData({ ...before, preferences: { ...before.preferences, [channel]: { ...before.preferences[channel as keyof Prefs], [category]: value } } });
    try {
      const res = await apiClient.put<{ preferences: Prefs }>('/communication/preferences', { [channel]: { [category]: value } });
      prefs.setData({ ...before, preferences: res.preferences });
      setNotice({ kind: 'ok', text: 'Saved. It applies to the next message.' });
    } catch (err) {
      prefs.setData(before);
      setNotice({ kind: 'error', text: errorText(err, 'That setting could not be saved.') });
    } finally {
      setSaving(null);
    }
  };

  const enablePush = async () => {
    setEnabling(true);
    setNotice(null);
    try {
      const key = devices.data?.push.publicKey;
      if (!key || typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('This browser does not support push notifications.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Notifications are blocked for this site in your browser settings.');
      const registration = await navigator.serviceWorker.ready;
      const subscription = (await registration.pushManager.getSubscription()) || (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }));
      const label = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'Phone browser' : 'Computer browser';
      await apiClient.post('/communication/devices', { subscription: subscription.toJSON(), label });
      await devices.reload();
      setNotice({ kind: 'ok', text: 'Push notifications are on for this browser.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error && !('response' in (err as object)) ? err.message : errorText(err, 'Push could not be turned on.') });
    } finally {
      setEnabling(false);
    }
  };

  const removeDevice = async (id: string) => {
    try {
      await apiClient.delete(`/communication/devices?id=${encodeURIComponent(id)}`);
      await devices.reload();
    } catch (err) {
      setNotice({ kind: 'error', text: errorText(err, 'The device could not be removed.') });
    }
  };

  const pushAvailable = Boolean(devices.data?.push.available);
  const shown = CHANNELS.filter((c) => c.id !== 'push' || pushAvailable);

  return (
    <CommShell kicker="Settings" title="Notification settings" lede="Choose how ForexOrbit reaches you for each kind of message. Essential account and security messages are always sent.">
      {notice && <p className={`notice ${notice.kind === 'ok' ? 'notice-brand' : 'notice-caution'} mb-4 text-sm`} role="status">{notice.text}</p>}
      {prefs.loading && !prefs.data && <TableSkeleton rows={6} />}
      {prefs.error && <ErrorState text={prefs.error} onRetry={() => void prefs.reload()} />}
      {prefs.data && (
        <section className="card overflow-hidden p-0" aria-labelledby="channels-title">
          <div className="border-b border-line px-5 py-4">
            <h2 id="channels-title" className="section-title">What you receive</h2>
            {prefs.data.emailSuppressed && <p className="notice notice-caution mt-3 text-sm">Emails to your address bounced or were reported, so email is paused. Update your email address in your profile to receive email again.</p>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="preferences-table">
              <thead>
                <tr className="text-left">
                  <th className="px-4 py-3 font-medium text-ink-subtle sm:px-5">Category</th>
                  {shown.map((c) => { const Icon = c.icon; return <th key={c.id} className="w-14 px-1 py-3 text-center font-medium text-ink-subtle sm:w-24 sm:px-3"><span className="inline-flex items-center gap-1.5" title={c.label}><Icon className="h-4 w-4" aria-hidden /><span className="sr-only sm:not-sr-only">{c.label}</span></span></th>; })}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--fo-line)]">
                {prefs.data.categories.map((cat) => (
                  <tr key={cat.id}>
                    <td className="px-4 py-3.5 sm:px-5">
                      <span className="flex items-center gap-1.5 font-medium text-ink">{cat.label}{cat.essential && <Lock className="h-3.5 w-3.5 text-ink-subtle" aria-label="Essential" />}</span>
                      <span className="block text-xs text-ink-muted">{cat.help}</span>
                    </td>
                    {shown.map((c) => {
                      const on = prefs.data!.preferences[c.id][cat.id];
                      return (
                        <td key={c.id} className="px-1 py-3.5 text-center sm:px-3">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={on}
                            aria-label={`${cat.label} by ${c.label.toLowerCase()}`}
                            disabled={cat.essential || saving === `${c.id}.${cat.id}`}
                            onClick={() => void toggle(c.id, cat.id, !on)}
                            className={`relative inline-flex h-6 w-10 shrink-0 items-center sm:w-11 rounded-full transition-colors ${on ? 'bg-primary-500' : 'bg-[var(--fo-line-strong)]'} ${cat.essential ? 'cursor-not-allowed opacity-60' : ''}`}
                          >
                            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-[18px] sm:translate-x-5' : 'translate-x-0.5'}`} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card mt-6 p-5" aria-labelledby="devices-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="devices-title" className="section-title">Devices</h2>
            <p className="mt-1 text-sm text-ink-muted">{pushAvailable ? 'Browsers that receive push notifications for your account. Signing out of a browser removes it.' : 'Push notifications are not available on this site yet. In-app and email notifications still reach you.'}</p>
          </div>
          {pushAvailable && <button type="button" className="btn btn-primary" onClick={() => void enablePush()} disabled={enabling}>{enabling ? 'Turning on…' : 'Turn on for this browser'}</button>}
        </div>
        {devices.error && <div className="mt-4"><ErrorState text={devices.error} onRetry={() => void devices.reload()} /></div>}
        {devices.data && devices.data.devices.length > 0 && (
          <ul className="mt-4 divide-y divide-[var(--fo-line)] rounded-xl border border-line">
            {devices.data.devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 items-center gap-3"><Monitor className="h-5 w-5 shrink-0 text-ink-subtle" aria-hidden /><span className="min-w-0"><span className="block truncate text-sm font-medium text-ink">{d.label}</span><span className="block text-xs text-ink-subtle">Added {formatDate(d.createdAt)}{d.lastUsedAt ? ` · last push ${formatDate(d.lastUsedAt, true)}` : ''}</span></span></span>
                <button type="button" className="icon-btn" onClick={() => void removeDevice(d.id)} aria-label={`Remove ${d.label}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </CommShell>
  );
}
