/**
 * Former instructor course page. Course details, lessons, quizzes and publishing now live in the
 * shared course builder (/builder/:courseId), used by instructors and administrators alike, so
 * there is one editor. Old links and bookmarks are forwarded there.
 */

import { useRouter } from 'next/router';
import { useEffect } from 'react';
import LoadingSpinner from '@/components/LoadingSpinner';

export default function InstructorCourseRedirect() {
  const router = useRouter();
  const courseId = typeof router.query.courseId === 'string' ? router.query.courseId : '';
  useEffect(() => {
    if (courseId) void router.replace(`/builder/${encodeURIComponent(courseId)}`);
  }, [courseId, router]);
  return <LoadingSpinner message="Opening the course builder" fullScreen />;
}
