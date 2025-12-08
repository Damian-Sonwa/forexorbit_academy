/**
 * Badges/Achievements Page
 * Displays all available badges and user's earned badges
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';

interface Badge {
  _id: string;
  name: string;
  description: string;
  icon: string;
  pointsRequired: number;
  category: string;
  earned?: boolean;
  earnedAt?: string;
}

export default function Badges() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [userPoints, setUserPoints] = useState(0);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    if (isAuthenticated) {
      fetchBadges();
      fetchUserPoints();
    }
  }, [isAuthenticated, authLoading]);

  const fetchBadges = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<Badge[]>('/badges');
      setBadges(response);
    } catch (error: any) {
      console.error('Fetch badges error:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUserPoints = async () => {
    try {
      const response = await apiClient.get('/auth/me');
      setUserPoints(response.points || 0);
    } catch (error: any) {
      console.error('Fetch user points error:', error);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading badges...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) return null;

  const earnedBadges = badges.filter(b => b.earned);
  const availableBadges = badges.filter(b => !b.earned && b.pointsRequired <= userPoints);
  const lockedBadges = badges.filter(b => !b.earned && b.pointsRequired > userPoints);

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <Header />
      <main className="flex-1 flex flex-col overflow-hidden px-4 sm:px-6 lg:px-8 py-4">
        <div className="mb-4 flex-shrink-0">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-1">Badges & Achievements</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">Track your achievements and milestones</p>
        </div>

        {/* Points Display */}
        <div className="bg-gradient-to-br from-primary-500 to-secondary-600 rounded-xl shadow-lg p-4 mb-4 flex-shrink-0 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-primary-100 text-sm font-medium mb-1">Your Points</p>
              <p className="text-4xl font-bold">{userPoints}</p>
            </div>
            <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center border-4 border-white/30">
              <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Earned Badges */}
        {earnedBadges.length > 0 && (
          <div className="mb-4 flex-shrink-0">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Earned Badges ({earnedBadges.length})</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {earnedBadges.map((badge) => (
                <div
                  key={badge._id}
                  className="bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-2xl shadow-lg p-6 border-4 border-yellow-300 dark:border-yellow-500"
                >
                  <div className="text-center">
                    <div className="text-6xl mb-4">{badge.icon}</div>
                    <h3 className="text-xl font-bold text-white mb-2">{badge.name}</h3>
                    <p className="text-yellow-100 text-sm mb-4">{badge.description}</p>
                    <div className="bg-white/20 backdrop-blur-sm rounded-lg p-2">
                      <p className="text-white text-xs font-semibold">
                        Earned: {badge.earnedAt ? new Date(badge.earnedAt).toLocaleDateString() : 'Recently'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Available Badges */}
        {availableBadges.length > 0 && (
          <div className="mb-4 flex-shrink-0">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Available Badges ({availableBadges.length})</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {availableBadges.map((badge) => (
                <div
                  key={badge._id}
                  className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border-2 border-primary-200 dark:border-primary-700 p-6 hover:shadow-xl transition-all"
                >
                  <div className="text-center">
                    <div className="text-6xl mb-4 opacity-75">{badge.icon}</div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">{badge.name}</h3>
                    <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">{badge.description}</p>
                    <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-2">
                      <p className="text-primary-700 dark:text-primary-300 text-xs font-semibold">
                        {badge.pointsRequired} points required • You have {userPoints} points
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Locked Badges */}
        {lockedBadges.length > 0 && (
          <div className="flex-1 overflow-y-auto">
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">Locked Badges ({lockedBadges.length})</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {lockedBadges.map((badge) => (
                <div
                  key={badge._id}
                  className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg border-2 border-gray-200 dark:border-gray-700 p-6 opacity-60"
                >
                  <div className="text-center">
                    <div className="text-6xl mb-4 grayscale">{badge.icon}</div>
                    <h3 className="text-xl font-bold text-gray-500 dark:text-gray-400 mb-2">{badge.name}</h3>
                    <p className="text-gray-400 dark:text-gray-500 text-sm mb-4">{badge.description}</p>
                    <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-2">
                      <p className="text-gray-500 dark:text-gray-400 text-xs font-semibold">
                        {badge.pointsRequired} points required • Need {badge.pointsRequired - userPoints} more points
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {badges.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center flex-1 flex items-center justify-center">
            <p className="text-gray-600 dark:text-gray-400">No badges available yet</p>
          </div>
        )}
      </main>
    </div>
  );
}

