/**
 * Legal Privacy Policy Page
 * Redirects to main privacy policy page
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function LegalPrivacyPolicy() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/privacy');
  }, [router]);

  return null;
}

