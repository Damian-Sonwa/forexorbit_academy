import type { ReactNode } from 'react';
import type { FeatureKey } from '@/lib/config/features';
import { FEATURES } from '@/lib/config/features';

type FeatureGuardProps = {
  feature: FeatureKey;
  children: ReactNode;
  /** Optional custom “off” UI */
  fallback?: ReactNode;
};

/**
 * Wrap page sections or routes (with middleware as the real gate) to show a friendly message.
 */
export default function FeatureGuard({ feature, children, fallback }: FeatureGuardProps) {
  if (!FEATURES[feature]) {
    return (
      <>
        {fallback ?? (
          <div className="max-w-lg mx-auto mt-16 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-card p-8 text-center opacity-95">
            <p className="text-lg font-semibold text-brand-dark dark:text-nav-text">Coming soon</p>
            <p className="mt-2 text-sm text-secondary-700 dark:text-nav-muted">
              This feature is not available yet. Check back later.
            </p>
          </div>
        )}
      </>
    );
  }
  return <>{children}</>;
}
