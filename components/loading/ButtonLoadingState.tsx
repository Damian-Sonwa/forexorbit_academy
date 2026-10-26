import { ReactNode } from 'react';

interface ButtonLoadingStateProps {
  loading: boolean;
  children?: ReactNode;
  loadingLabel?: string;
}

export function ButtonLoadingState({ loading, children, loadingLabel = 'Working' }: ButtonLoadingStateProps) {
  if (!loading) return <>{children}</>;
  return (
    <span className="inline-flex items-center justify-center gap-2" aria-live="polite">
      <span className="orbit-dash inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      <span>{loadingLabel}</span>
    </span>
  );
}
