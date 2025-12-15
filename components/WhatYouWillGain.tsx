/**
 * What You Will Gain Component
 * Displays personalized learning benefits based on user's selected learning level
 * Reads from user profile (learningLevel) and uses configuration mapping
 */

import { useAuth } from '@/hooks/useAuth';
import { getLearningLevelContent, type LearningLevel } from '@/lib/learning-level-content';

export default function WhatYouWillGain() {
  const { user } = useAuth();

  // Get user's learning level with safe fallback
  const userLevel = (user?.learningLevel || 'beginner') as LearningLevel;
  const content = getLearningLevelContent(userLevel);

  return (
    <div className="mb-4 sm:mb-6 bg-white rounded-xl shadow-lg border-l-4 border-blue-700 p-4 sm:p-6 hover:shadow-xl transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold mb-3 sm:mb-4 flex items-center text-gray-900">
            <span className="mr-2 sm:mr-3 text-2xl sm:text-3xl md:text-4xl">📈</span>
            <span className="break-words">Forex Training – What You Will Gain</span>
          </h2>
          <p className="text-sm text-gray-600 mb-4 sm:mb-6">
            Personalized learning path for <span className="font-semibold capitalize">{content.displayName}</span> level traders
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 mt-4 sm:mt-6">
            {content.gains.map((gain, index) => (
              <div key={index} className="flex items-start space-x-3">
                <span className="text-2xl flex-shrink-0">{gain.icon}</span>
                <div>
                  <h3 className="font-semibold mb-1 text-gray-900">{gain.title}</h3>
                  <p className="text-gray-700 text-sm">{gain.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

