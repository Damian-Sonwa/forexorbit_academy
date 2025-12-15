/**
 * Demo Modal Component
 * Displays modal for unlocking lessons with demo
 * Isolated component - does not modify existing lesson logic
 */

import { useState } from 'react';
import { DEMO_UNLOCK_ENABLED } from '@/lib/demo-unlock-config';
import { grantDemoAccess } from '@/lib/demo-access-helper';

interface DemoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlock: () => void;
  lessonTitle?: string;
  lessonId?: string;
}

export default function DemoModal({ isOpen, onClose, onUnlock, lessonTitle }: DemoModalProps) {
  const [isWatchingDemo, setIsWatchingDemo] = useState(false);
  const [demoCompleted, setDemoCompleted] = useState(false);

  // If feature is disabled, don't render
  if (!DEMO_UNLOCK_ENABLED) {
    return null;
  }

  if (!isOpen) return null;

  const handleWatchDemo = () => {
    setIsWatchingDemo(true);
    // Simulate demo video (in real implementation, this would play an actual demo video)
    // For now, we'll just set a timeout to simulate watching
    setTimeout(() => {
      setDemoCompleted(true);
      setIsWatchingDemo(false);
    }, 3000); // 3 second demo simulation
  };

  const handleUnlock = () => {
    if (!demoCompleted) return;
    
    try {
      // Get lesson ID from somewhere (we'll need to pass it as prop)
      // For now, we'll handle it in the parent component
      onUnlock();
      onClose();
    } catch (error) {
      console.warn('Failed to unlock lesson with demo:', error);
      // Do nothing - lesson remains locked
    }
  };

  const handleCancel = () => {
    setIsWatchingDemo(false);
    setDemoCompleted(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 sm:p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Unlock Lesson with Demo</h2>
          {lessonTitle && (
            <p className="text-sm text-gray-600 mb-4">{lessonTitle}</p>
          )}
          <p className="text-gray-700">
            Watch a short demo to unlock this lesson for 24 hours. You'll have full access to all lesson content.
          </p>
        </div>

        {!demoCompleted ? (
          <div className="space-y-4">
            {!isWatchingDemo ? (
              <>
                <button
                  onClick={handleWatchDemo}
                  className="w-full px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-md hover:shadow-lg"
                >
                  Watch Demo to Unlock
                </button>
                <button
                  onClick={handleCancel}
                  className="w-full px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary-600 border-t-transparent mb-4"></div>
                <p className="text-gray-600">Playing demo...</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 text-center">
              <svg className="w-12 h-12 text-green-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-green-800 font-semibold">Demo completed!</p>
            </div>
            <button
              onClick={handleUnlock}
              className="w-full px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors shadow-md hover:shadow-lg"
            >
              Unlock Lesson
            </button>
            <button
              onClick={handleCancel}
              className="w-full px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

