/**
 * Support Contact Page
 * Redirects to main contact page
 */

import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function SupportContact() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/contact');
  }, [router]);

  return null;
}

