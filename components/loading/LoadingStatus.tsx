import { OrbitMark } from './OrbitMark';

interface LoadingStatusProps {
  label: string;
  compact?: boolean;
}

export function LoadingStatus({ label, compact = false }: LoadingStatusProps) {
  return (
    <div className={`inline-flex items-center gap-2 text-neutral-600 dark:text-neutral-300 ${compact ? 'text-xs' : 'text-sm'}`} role="status" aria-live="polite">
      <OrbitMark className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
      <span>{label}</span>
    </div>
  );
}
