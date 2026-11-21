/**
 * Admin portal: platform settings (Phase 13). GET /api/admin/portal/config. Read-only visibility of
 * what is configured (never a secret value). The platform has no runtime-editable settings: these
 * are deploy-time environment settings, changed by redeploying, never from the browser.
 */

import AdminShell from '@/components/admin/portal/AdminShell';
import { DataTable } from '@/components/admin/portal/Views';
import { ErrorState, Section } from '@/components/student/dashboard/Panels';
import { TableSkeleton } from '@/components/loading';
import { usePortalResource } from '@/hooks/usePortalResource';
import type { PlatformConfig } from '@/lib/admin-portal';

export default function AdminSettingsPage() {
  const { data, error, loading, reload } = usePortalResource<PlatformConfig>('/admin/portal/config');
  return (
    <AdminShell title="Platform settings" lede="What is configured on this deployment. Secrets are never shown.">
      {loading && !data && <TableSkeleton rows={6} />}
      {error && <ErrorState text={error} onRetry={() => void reload()} />}
      {data && (
        <div className="space-y-8">
          <p className="notice text-sm" data-testid="settings-readonly">
            These settings are part of the deployment ({data.environment}). They are changed by updating the environment and redeploying, not from this page, so no one can alter payment, email or security configuration from a browser session.
          </p>
          <Section title="Integrations">
            <DataTable testId="settings-integrations" head={<tr><th>Integration</th><th>State</th></tr>}>
              {data.integrations.map((i) => (
                <tr key={i.id}>
                  <td>{i.label}</td>
                  <td><span className={`chip ${/enabled|configured/.test(i.state) && !/not/.test(i.state) ? 'chip-up' : ''}`}>{i.state}</span>{i.detail && <span className="block text-2xs text-ink-subtle">{i.detail}</span>}</td>
                </tr>
              ))}
            </DataTable>
          </Section>
          <Section title="Platform rules">
            <DataTable head={<tr><th>Setting</th><th>Value</th></tr>}>
              {data.platform.map((p) => <tr key={p.label}><td>{p.label}</td><td className="text-ink-muted">{p.value}</td></tr>)}
            </DataTable>
          </Section>
        </div>
      )}
    </AdminShell>
  );
}
