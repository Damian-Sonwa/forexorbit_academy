/**
 * Support FAQ Page
 * Redirects to main FAQ page
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function SupportFAQ() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/faq');
  }, [router]);

  return null;
}

