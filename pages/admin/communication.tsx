/**
 * Communication operations (Phase 14; Admin and Super Admin). GET /api/admin/communication:
 * delivery states, queue depth, retries, suppressions, recent terminal failures (type and reason
 * only: no addresses or contents), push states, socket counters, the last worker run and which
 * providers are configured.
 */

import { useState } from 'react';
import CommShell, { Tabs } from '@/components/communication/CommShell';
import { ErrorState, Metric, MetricGrid } from '@/components/student/dashboard/Panels';
import { MetricSkeleton } from '@/components/loading';
import { formatDate, relativeTime } from '@/components/student/dashboard/format';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { DeliveryStats } from '@/lib/communication/delivery';
import type { MetricsSnapshot } from '@/lib/communication/metrics';

type Ops = DeliveryStats & { realtime: MetricsSnapshot; providers: Record<'email' | 'emailWebhook' | 'push' | 'video', boolean> };
const PROVIDERS: Array<[keyof Ops['providers'], string, string]> = [
  ['email', 'Email (Resend)', 'RESEND_API_KEY, RESEND_FROM, APP_BASE_URL'],
  ['emailWebhook', 'Delivery webhooks', 'RESEND_WEBHOOK_SECRET'],
  ['push', 'Browser push', 'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT'],
  ['video', 'Video (Agora)', 'AGORA_APP_ID, AGORA_APP_CERTIFICATE'],
];

export default function CommunicationOps() {
  const [hours, setHours] = useState('24');
  const { data, error, loading, reload } = usePortalResource<Ops>(`/admin/communication?hours=${hours}`);
  const c = data?.realtime.counters || {};
  return (
    <CommShell kicker="Admin" title="Communication operations" lede="Delivery health across in-app, email, push and real time. Counts only: no addresses or message contents." roles={['admin', 'superadmin']} actions={<button type="button" className="btn btn-secondary" onClick={() => void reload()}>Refresh</button>}>
      <div className="mb-5"><Tabs label="Window" items={[['1', '1 hour'], ['24', '24 hours'], ['168', '7 days']]} value={hours} onChange={setHours} /></div>
      {loading && !data && <MetricSkeleton />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <div className="space-y-6">
          <section aria-labelledby="email-title">
            <h2 id="email-title" className="section-title mb-3">Email</h2>
            <MetricGrid cols="sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Queue depth" value={data.queueDepth} tone={data.queueDepth > 100 ? 'text-caution' : 'text-ink'} hint="queued, sending or retrying" />
              <Metric label="Sent" value={data.email.sent} hint="accepted by the provider" />
              <Metric label="Delivered" value={data.email.delivered} hint="confirmed by webhook" />
              <Metric label="Retrying" value={data.retrying} />
              <Metric label="Failed" value={data.email.failed} tone={data.email.failed ? 'text-down' : 'text-ink'} />
              <Metric label="Bounced / complaints" value={`${data.email.bounced} / ${data.email.complained}`} hint={`${data.suppressedAddresses} addresses suppressed`} />
            </MetricGrid>
            <p className="mt-2 text-xs text-ink-subtle">“Sent” means the provider accepted the message; “delivered” needs the provider’s signed webhook. {data.email.suppressed} suppressed and {data.email.skipped} skipped (no address) in this window.</p>
          </section>

          <section aria-labelledby="rt-title">
            <h2 id="rt-title" className="section-title mb-3">Real time and push</h2>
            <MetricGrid cols="sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="Open sockets" value={data.realtime.gauges.activeSockets || 0} hint="this server" />
              <Metric label="Connections" value={c.socketConnections || 0} hint={`since ${formatDate(data.realtime.startedAt, true)}`} />
              <Metric label="Refused" value={c.socketRefused || 0} hint="no or invalid session" />
              <Metric label="Ended by server" value={c.socketEndedByServer || 0} hint="session ended" />
              <Metric label="Live events" value={c.realtimeEmitted || 0} />
              <Metric label="Push sent / failed" value={`${(data.push.sent || 0) + (data.push.partial || 0)} / ${data.push.failed || 0}`} hint={`${data.push.unavailable || 0} unavailable`} />
            </MetricGrid>
            <p className="mt-2 text-xs text-ink-subtle">Socket counters are per server process and reset on restart. Last worker run: {data.realtime.lastWorker ? `${relativeTime(String(data.realtime.lastWorker.at))}${Array.isArray(data.realtime.lastWorker.errors) && data.realtime.lastWorker.errors.length ? ` (failed: ${(data.realtime.lastWorker.errors as string[]).join(', ')})` : ''}` : 'not yet on this server'}.</p>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="card p-5">
              <h2 className="section-title">Recent failures</h2>
              {data.recentFailures.length ? (
                <ul className="mt-3 divide-y divide-[var(--fo-line)] text-sm" data-testid="failures">
                  {data.recentFailures.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                      <span className="min-w-0"><span className="font-medium text-ink">{f.type}</span><span className="block text-xs text-ink-subtle">{f.category || 'uncategorised'} · {f.attempts} attempt{f.attempts === 1 ? '' : 's'}</span></span>
                      <span className="text-right"><span className="chip chip-down">{f.state}</span><span className="block text-xs text-ink-muted">{f.reason || 'unknown'} · {relativeTime(String(f.at))}</span></span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-3 text-sm text-ink-muted">No terminal failures in this window.</p>}
            </div>
            <div className="card p-5">
              <h2 className="section-title">Providers</h2>
              <ul className="mt-3 space-y-3 text-sm">
                {PROVIDERS.map(([key, label, vars]) => (
                  <li key={key} className="flex items-start justify-between gap-3">
                    <span><span className="font-medium text-ink">{label}</span><span className="block text-xs text-ink-subtle">{vars}</span></span>
                    <span className={`chip ${data.providers[key] ? 'chip-up' : ''}`}>{data.providers[key] ? 'Configured' : 'Not configured'}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink-subtle">When a provider is missing or failing, messages still appear in the app; email waits in the queue and retries with backoff.</p>
            </div>
          </section>
        </div>
      )}
    </CommShell>
  );
}
