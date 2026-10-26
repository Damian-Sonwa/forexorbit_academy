import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export function RouteProgress() {
  const router = useRouter();
  const [active, setActive] = useState(false);

  useEffect(() => {
    const start = () => setActive(true);
    const stop = () => setActive(false);
    router.events.on('routeChangeStart', start);
    router.events.on('routeChangeComplete', stop);
    router.events.on('routeChangeError', stop);
    return () => {
      router.events.off('routeChangeStart', start);
      router.events.off('routeChangeComplete', stop);
      router.events.off('routeChangeError', stop);
    };
  }, [router]);

  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] h-0.5 overflow-hidden bg-primary-100 dark:bg-neutral-800" role="status" aria-label="Loading next page">
      <div className="orbit-route-bar h-full w-1/3 bg-primary-600" />
    </div>
  );
}
