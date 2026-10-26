/**
 * Shared wait indicator. Full-screen waits use the branded page loader.
 * Smaller waits use the same mark without taking over the page.
 */

import { FullPageLoader } from '@/components/loading/FullPageLoader';
import { LoadingStatus } from '@/components/loading/LoadingStatus';

interface LoadingSpinnerProps {
  message?: string;
  fullScreen?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export default function LoadingSpinner({
  message = 'Loading',
  fullScreen = false,
  size = 'md',
}: LoadingSpinnerProps) {
  if (fullScreen) {
    return <FullPageLoader message={message} />;
  }

  return (
    <div className={`flex items-center justify-center ${size === 'sm' ? 'py-6' : 'py-12'}`}>
      <LoadingStatus label={message} compact={size === 'sm'} />
    </div>
  );
}
