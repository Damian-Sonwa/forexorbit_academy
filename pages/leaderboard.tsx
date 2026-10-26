/**
 * Leaderboard Page
 * Displays rankings by points, course completions, quiz scores, or course-specific progress
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
// import Footer from '@/components/Footer'; // Reserved for future use
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { Award, Medal, Trophy } from 'lucide-react';

interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  email: string;
  points?: number;
  completions?: number;
  avgScore?: number;
  totalQuizzes?: number;
  progress?: number;
  avatar?: string;
}

export default function Leaderboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState<'points' | 'completions' | 'quizzes' | 'course'>('points');
  const [courseId, setCourseId] = useState('');

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }

    if (isAuthenticated) {
      fetchLeaderboard();
    }
  }, [isAuthenticated, authLoading, type, courseId]);

  const fetchLeaderboard = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('type', type);
      if (type === 'course' && courseId) {
        params.append('courseId', courseId);
      }

      const response = await apiClient.get<LeaderboardEntry[]>(`/leaderboard?${params.toString()}`);
      setLeaderboard(response);
    } catch (error: any) {
      console.error('Fetch leaderboard error:', error);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return <LoadingSpinner message="Loading leaderboard..." fullScreen />;
  }

  if (!isAuthenticated || !user) return null;

  const getRankIcon = (rank: number) => {
    if (rank === 1) return <Trophy className="h-5 w-5" aria-hidden />;
    if (rank === 2) return <Medal className="h-5 w-5" aria-hidden />;
    if (rank === 3) return <Award className="h-5 w-5" aria-hidden />;
    return rank;
  };

  const getRankColor = (rank: number) => {
    if (rank === 1) return 'bg-primary-600 text-white';
    if (rank === 2) return 'bg-neutral-700 text-white';
    if (rank === 3) return 'bg-neutral-300 text-neutral-900';
    return 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200';
  };

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
      <Header />
      <main className="flex-1 flex flex-col overflow-hidden px-4 sm:px-6 lg:px-8 py-4">
        <div className="mb-4 flex-shrink-0">
          <p className="page-kicker mb-2">Community</p>
          <h1 className="page-title">Leaderboard</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm">See how you rank against other students</p>
        </div>

        {/* Filter Tabs */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-4 mb-4 flex-shrink-0">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex gap-2">
              {(['points', 'completions', 'quizzes'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
                    type === t
                      ? 'bg-primary-400 text-neutral-900'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {type === 'course' && (
              <input
                type="text"
                placeholder="Course ID..."
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 text-sm"
              />
            )}
          </div>
        </div>

        {/* Leaderboard Table */}
        {leaderboard.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-12 text-center flex-1 flex items-center justify-center">
            <p className="text-gray-600 dark:text-gray-400">No rankings available yet</p>
          </div>
        ) : (
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex-1 flex flex-col">
            <div className="overflow-auto flex-1">
              <table className="w-full min-w-full">
                <thead className="bg-neutral-50 dark:bg-neutral-800 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Student</th>
                    {type === 'points' && (
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Points</th>
                    )}
                    {type === 'completions' && (
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Courses Completed</th>
                    )}
                    {type === 'quizzes' && (
                      <>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Avg Score</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Quizzes</th>
                      </>
                    )}
                    {type === 'course' && (
                      <th className="px-4 py-3 text-left text-xs font-bold text-gray-700 dark:text-gray-300 uppercase">Progress</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {leaderboard.map((entry) => (
                    <tr
                      key={entry.userId}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                        entry.userId === user.id ? 'bg-primary-50 dark:bg-primary-900/20' : ''
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className={`w-10 h-10 rounded-full ${getRankColor(entry.rank)} flex items-center justify-center font-bold text-sm`}>
                          {getRankIcon(entry.rank)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-neutral-900 rounded-full flex items-center justify-center text-white font-bold mr-2 text-xs">
                            {entry.name?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <p className="text-sm font-bold text-gray-900 dark:text-white">
                              {entry.name} {entry.userId === user.id && '(You)'}
                            </p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{entry.email}</p>
                          </div>
                        </div>
                      </td>
                      {type === 'points' && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-base font-bold text-primary-600 dark:text-primary-400">{entry.points || 0}</span>
                        </td>
                      )}
                      {type === 'completions' && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-base font-bold text-green-600 dark:text-green-400">{entry.completions || 0}</span>
                        </td>
                      )}
                      {type === 'quizzes' && (
                        <>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-base font-bold text-primary-600 dark:text-primary-400">{entry.avgScore || 0}%</span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-sm text-gray-600 dark:text-gray-400">{entry.totalQuizzes || 0}</span>
                          </td>
                        </>
                      )}
                      {type === 'course' && (
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <div className="w-24 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                              <div
                                className="bg-primary-500 h-2 rounded-full"
                                style={{ width: `${entry.progress || 0}%` }}
                              ></div>
                            </div>
                            <span className="text-sm font-bold text-gray-900 dark:text-white">{entry.progress || 0}%</span>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

