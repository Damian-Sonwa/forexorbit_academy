/**
 * Legal Terms of Service Page
 * Redirects to main terms page
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function LegalTermsOfService() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/terms');
  }, [router]);

  return null;
}

