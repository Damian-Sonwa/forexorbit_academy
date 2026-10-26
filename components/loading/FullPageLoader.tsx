import { OrbitMark } from './OrbitMark';

interface FullPageLoaderProps {
  message?: string;
}

export function FullPageLoader({ message = 'Loading' }: FullPageLoaderProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-6 dark:bg-neutral-950" role="status" aria-live="polite">
      <div className="flex max-w-sm flex-col items-center text-center">
        <OrbitMark />
        <p className="mt-6 font-display text-lg font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{message}</p>
        <p className="mt-1 text-sm text-neutral-500">ForexOrbit Academy</p>
      </div>
    </div>
  );
}
