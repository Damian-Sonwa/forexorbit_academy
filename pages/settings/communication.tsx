/**
 * Settings: notifications (Phase 14). One place for channels, categories and devices.
 *   GET/PUT /api/communication/preferences   (essential categories cannot be turned off)
 *   GET/POST/DELETE /api/communication/devices (push on this browser; the member's own devices)
 * Changes apply to the next message (preferences are checked again when it is sent); no sign-out
 * is needed. Push appears only when the site has push configured.
 */

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Lock, Monitor, Trash2 } from 'lucide-react';
import ConfirmDialog from '@/components/admin/portal/ConfirmDialog';
import { errorText } from '@/components/communication/CommShell';
import { Switch } from '@/components/profile/ProfileFields';
import { SettingGroup, SettingsSection } from '@/components/settings/SettingsParts';
import SettingsShell from '@/components/settings/SettingsShell';
import { ErrorState } from '@/components/student/dashboard/Panels';
import { formatDate } from '@/components/student/dashboard/format';
import { usePortalResource } from '@/hooks/usePortalResource';
import { apiClient } from '@/lib/api-client';

type ChannelId = 'inApp' | 'email' | 'push';
type Prefs = Record<ChannelId, Record<string, boolean>>;
type PrefsResponse = { preferences: Prefs; categories: Array<{ id: string; label: string; essential: boolean; help: string }>; emailSuppressed: boolean };
type Device = { id: string; label: string; createdAt: string | null; lastUsedAt: string | null };
type DevicesResponse = { devices: Device[]; push: { available: boolean; publicKey: string | null } };
const CHANNELS: Array<{ id: ChannelId; label: string }> = [{ id: 'inApp', label: 'In app' }, { id: 'email', label: 'Email' }, { id: 'push', label: 'Push' }];

function keyBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function CommunicationSettings() {
  const prefs = usePortalResource<PrefsResponse>('/communication/preferences');
  const devices = usePortalResource<DevicesResponse>('/communication/devices');
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [removing, setRemoving] = useState<Device | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const tell = (kind: 'ok' | 'error', text: string) => {
    clearTimeout(noticeTimer.current);
    setNotice({ kind, text });
    if (kind === 'ok') noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };

  /** Changes one switch only, so two quick changes cannot undo each other. */
  const put = (channel: ChannelId, category: string, value: boolean) =>
    prefs.setData((d) => (d ? { ...d, preferences: { ...d.preferences, [channel]: { ...d.preferences[channel], [category]: value } } } : d));

  const toggle = async (channel: ChannelId, category: string, value: boolean) => {
    const key = `${channel}.${category}`;
    setSaving((s) => new Set(s).add(key));
    put(channel, category, value);
    try {
      const res = await apiClient.put<{ preferences: Prefs }>('/communication/preferences', { [channel]: { [category]: value } });
      put(channel, category, res.preferences[channel][category]);
      tell('ok', 'Saved. It applies to the next message.');
    } catch (err) {
      put(channel, category, !value);
      tell('error', errorText(err, 'That setting could not be saved.'));
    } finally {
      setSaving((s) => { const next = new Set(s); next.delete(key); return next; });
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
      tell('ok', 'Push notifications are on for this browser.');
    } catch (err) {
      tell('error', err instanceof Error && !('response' in (err as object)) ? err.message : errorText(err, 'Push could not be turned on.'));
    } finally {
      setEnabling(false);
    }
  };

  const removeDevice = async (device: Device) => {
    try {
      await apiClient.delete(`/communication/devices?id=${encodeURIComponent(device.id)}`);
      await devices.reload();
      setRemoving(null);
      tell('ok', 'Device removed.');
      return null;
    } catch (err) {
      return errorText(err, 'The device could not be removed.');
    }
  };

  const pushAvailable = Boolean(devices.data?.push.available);
  const shown = CHANNELS.filter((c) => c.id !== 'push' || pushAvailable);
  // Full class names, so Tailwind sees them.
  const columns = shown.length === 3 ? 'sm:grid-cols-[minmax(0,1fr)_repeat(3,4.5rem)]' : 'sm:grid-cols-[minmax(0,1fr)_repeat(2,4.5rem)]';

  return (
    <SettingsShell section="notifications">
      <SettingsSection title="Notifications" lede="Choose how ForexOrbit reaches you for each kind of message. Changes save as you make them.">
        <SettingGroup wide title="What you receive" help="Essential account and security messages are always sent.">
          {prefs.loading && !prefs.data && <div role="status" aria-label="Loading notification settings" className="space-y-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="orbit-skeleton h-14 rounded-lg" />)}</div>}
          {prefs.error && <ErrorState text={prefs.error} onRetry={() => void prefs.reload()} />}
          {prefs.data && (
            <>
              {prefs.data.emailSuppressed && <p className="notice notice-caution mb-4 text-sm">Emails to your address bounced or were reported, so email is paused. In-app notifications still reach you.</p>}
              <div data-testid="preferences-table">
                <div aria-hidden className={`studio-hint hidden border-b border-[var(--fo-line-strong)] pb-2 sm:grid ${columns}`}>
                  <span>Message</span>
                  {shown.map((c) => <span key={c.id} className="text-center">{c.label}</span>)}
                </div>
                {prefs.data.categories.map((cat) => (
                  <div key={cat.id} role="group" aria-labelledby={`cat-${cat.id}`} className={`grid gap-y-3 border-b border-line py-4 last:border-b-0 sm:items-center ${columns}`}>
                    <div className="min-w-0 sm:pr-6">
                      <p id={`cat-${cat.id}`} className="flex items-center gap-1.5 text-[0.9375rem] font-semibold">{cat.label}{cat.essential && <Lock className="h-3.5 w-3.5 text-ink-subtle" aria-label="Essential" />}</p>
                      <p className="studio-hint mt-0.5">{cat.help}</p>
                    </div>
                    <div className="flex gap-x-7 sm:contents">
                      {shown.map((c) => (
                        <span key={c.id} className="flex min-h-[2.75rem] items-center gap-2.5 sm:justify-center">
                          <Switch checked={prefs.data!.preferences[c.id][cat.id]} disabled={cat.essential || saving.has(`${c.id}.${cat.id}`)} onChange={(v) => void toggle(c.id, cat.id, v)} label={`${cat.label} by ${c.label.toLowerCase()}`} />
                          <span aria-hidden className="text-sm text-ink-muted sm:hidden">{c.label}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </SettingGroup>

        <SettingGroup wide title="Devices" help={pushAvailable ? 'Browsers that receive push notifications for your account. Signing out of a browser removes it.' : 'Push notifications are not available on this site yet. In-app and email notifications still reach you.'}>
          {pushAvailable && <button type="button" className="btn btn-primary min-h-[2.75rem]" onClick={() => void enablePush()} disabled={enabling}>{enabling ? 'Turning on…' : 'Turn on for this browser'}</button>}
          {devices.error && <ErrorState text={devices.error} onRetry={() => void devices.reload()} />}
          {devices.data && devices.data.devices.length > 0 && (
            <ul className="mt-4 divide-y divide-[var(--fo-line)] border-y border-line">
              {devices.data.devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="flex min-w-0 items-center gap-3"><Monitor className="h-5 w-5 shrink-0 text-ink-subtle" aria-hidden /><span className="min-w-0"><span className="block truncate text-[0.9375rem] font-medium">{d.label}</span><span className="studio-hint block">Added {formatDate(d.createdAt)}{d.lastUsedAt ? `, last push ${formatDate(d.lastUsedAt, true)}` : ''}</span></span></span>
                  <button type="button" className="icon-btn h-11 w-11 shrink-0 hover:text-[var(--st-danger)]" onClick={() => setRemoving(d)} aria-label={`Remove ${d.label}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
                </li>
              ))}
            </ul>
          )}
        </SettingGroup>
      </SettingsSection>

      <div className="pointer-events-none sticky bottom-3 z-20 flex justify-center" aria-live="polite">
        {notice && (
          <p className="studio-night studio-fade pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium shadow-lift" role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.kind === 'ok' && <Check className="h-4 w-4 shrink-0 text-[#e8ad38]" strokeWidth={2.75} aria-hidden />}
            <span className={notice.kind === 'error' ? 'text-[#ffb9a3]' : ''}>{notice.text}</span>
          </p>
        )}
      </div>

      {removing && createPortal(<ConfirmDialog title={`Remove ${removing.label}?`} consequence="It stops receiving push notifications. You can turn push on again from that browser." confirmLabel="Remove device" danger onConfirm={() => removeDevice(removing)} onClose={() => setRemoving(null)} />, document.body)}
    </SettingsShell>
  );
}
