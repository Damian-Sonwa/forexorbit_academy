/**
 * Former instructor lessons page. Lessons are created and edited in the shared course builder
 * (/builder/:courseId); this address forwards to the instructor's courses.
 */

import { useRouter } from 'next/router';
import { useEffect } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';

export default function InstructorLessonsRedirect() {
  const router = useRouter();
  useEffect(() => {
    void router.replace('/instructor/dashboard?section=courses');
  }, [router]);
  return <LoadingSpinner message="Opening your courses" fullScreen />;
}
