/**
 * Lesson Access Guard Component
 * Wraps lesson content and checks access before rendering
 * Non-intrusive wrapper - does not modify existing lesson logic
 */

import { ReactNode, useState, useEffect } from 'react';
import { DEMO_UNLOCK_ENABLED, isPremiumUser } from '@/lib/demo-unlock-config';
import { hasDemoAccess, grantDemoAccess, cleanupExpiredAccess } from '@/lib/demo-access-helper';
import DemoModal from './DemoModal';
import { useAuth } from '@/hooks/useAuth';

interface LessonAccessGuardProps {
  lessonId: string;
  lessonTitle?: string;
  isLocked?: boolean;
  isAccessible?: boolean;
  children: ReactNode;
}

/**
 * Lesson Access Guard
 * Checks if user has access to lesson (premium, enrolled, or demo)
 * Shows demo modal if lesson is locked and user is not premium
 */
export default function LessonAccessGuard({
  lessonId,
  lessonTitle,
  isLocked = false,
  isAccessible = true,
  children,
}: LessonAccessGuardProps) {
  const { user } = useAuth();
  const [showDemoModal, setShowDemoModal] = useState(false);
  const [hasAccess, setHasAccess] = useState(false);

  useEffect(() => {
    // Cleanup expired access on mount
    cleanupExpiredAccess();

    // If feature is disabled, allow access (existing behavior)
    if (!DEMO_UNLOCK_ENABLED) {
      setHasAccess(true);
      return;
    }

    // If lesson is explicitly not locked and accessible, allow access
    if (!isLocked && isAccessible) {
      setHasAccess(true);
      return;
    }

    // If lesson is explicitly locked, check access methods
    if (isLocked) {
      // Check if user is premium (premium users bypass lock)
      if (isPremiumUser(user)) {
        setHasAccess(true);
        return;
      }

      // Check if user has demo access
      if (hasDemoAccess(lessonId)) {
        setHasAccess(true);
        return;
      }

      // Lesson is locked and no access - show locked message
      setHasAccess(false);
      return;
    }

    // Default: allow access if not explicitly locked
    setHasAccess(true);
  }, [lessonId, isLocked, isAccessible, user]);

  // Debug logging (remove in production if needed)
  useEffect(() => {
    if (DEMO_UNLOCK_ENABLED && isLocked) {
      console.log('[Demo Unlock] Lesson locked:', {
        lessonId,
        isLocked,
        isAccessible,
        userRole: user?.role,
        hasDemoAccess: hasDemoAccess(lessonId),
        isPremium: isPremiumUser(user),
      });
    }
  }, [lessonId, isLocked, isAccessible, user]);

  const handleUnlock = () => {
    try {
      grantDemoAccess(lessonId);
      setHasAccess(true);
      setShowDemoModal(false);
    } catch (error) {
      console.warn('Failed to grant demo access:', error);
      // Do nothing - lesson remains locked
    }
  };

  // If user has access, render children normally
  if (hasAccess) {
    return <>{children}</>;
  }

  // If lesson is locked and no access, show locked message with demo option
  return (
    <>
      <div className="bg-white rounded-xl sm:rounded-2xl shadow-lg border-2 border-gray-200 p-8 sm:p-12 text-center">
        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4">Lesson Locked</h2>
        <p className="text-gray-600 mb-6 max-w-md mx-auto">
          This lesson is currently locked. {DEMO_UNLOCK_ENABLED && 'Watch a demo to unlock it for 24 hours, or enroll in the course for full access.'}
        </p>
        {DEMO_UNLOCK_ENABLED && (
          <button
            onClick={() => setShowDemoModal(true)}
            className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-md hover:shadow-lg"
          >
            Unlock with Demo
          </button>
        )}
      </div>

      {/* Demo Modal */}
      <DemoModal
        isOpen={showDemoModal}
        onClose={() => setShowDemoModal(false)}
        onUnlock={handleUnlock}
        lessonTitle={lessonTitle}
        lessonId={lessonId}
      />
    </>
  );
}

