/**
 * Back Button Component
 * Reusable back navigation button
 */

import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

interface BackButtonProps {
  href?: string; // Optional fallback URL if no history
  label?: string; // Optional custom label
  className?: string; // Optional custom styling
}

export default function BackButton({ href, label = 'Back', className = '' }: BackButtonProps) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    // Check if there's history to go back to
    if (typeof window !== 'undefined') {
      setCanGoBack(window.history.length > 1);
    }
  }, []);

  const handleBack = () => {
    if (canGoBack) {
      router.back();
    } else if (href) {
      router.push(href);
    } else {
      // Default fallback to home or dashboard
      router.push('/');
    }
  };

  return (
    <button
      onClick={handleBack}
      className={`inline-flex items-center space-x-2 px-5 py-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-2 border-gray-300 dark:border-gray-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 hover:text-primary-700 dark:hover:text-primary-300 hover:border-primary-500 dark:hover:border-primary-500 rounded-lg transition-all font-semibold shadow-md hover:shadow-lg z-10 relative ${className}`}
      aria-label={label}
      type="button"
      style={{ display: 'inline-flex' }}
    >
      <svg
        className="w-5 h-5 flex-shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
          d="M10 19l-7-7m0 0l7-7m-7 7h18"
        />
      </svg>
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

