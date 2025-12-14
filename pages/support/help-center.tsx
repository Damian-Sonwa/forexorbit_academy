/**
 * Support Help Center Page
 * Redirects to main help page
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function SupportHelpCenter() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/help');
  }, [router]);

  return null;
}

