/**
 * Expert Consultation Dashboard
 * For Instructors and Admins to manage consultation requests
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { formatDistanceToNow } from 'date-fns';

interface ConsultationRequest {
  _id: string;
  studentId: string;
  expertId: string;
  topic: string;
  description: string;
  consultationType: 'live-chat' | 'audio-call' | 'video-call';
  status: 'pending' | 'accepted' | 'rejected' | 'completed';
  createdAt: string;
  student?: {
    _id: string;
    name: string;
    email: string;
    profilePhoto?: string;
  };
}

interface ConsultationSession {
  _id: string;
  requestId: string;
  studentId: string;
  expertId: string;
  topic: string;
  consultationType: string;
  status: 'active' | 'completed';
  startedAt: string;
  endedAt?: string;
  student?: {
    _id: string;
    name: string;
    email: string;
    profilePhoto?: string;
  };
  messageCount: number;
}

export default function ExpertConsultation() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [view, setView] = useState<'requests' | 'sessions' | 'settings'>('requests');
  const [requests, setRequests] = useState<ConsultationRequest[]>([]);
  const [sessions, setSessions] = useState<ConsultationSession[]>([]);
  const [expertAvailable, setExpertAvailable] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && (user?.role === 'instructor' || user?.role === 'admin' || user?.role === 'superadmin')) {
      loadRequests();
      loadSessions();
      loadAvailability();
    }
  }, [isAuthenticated, user]);

  const loadRequests = async () => {
    try {
      const data = await apiClient.get('/consultations/requests');
      setRequests(data);
    } catch (error) {
      console.error('Failed to load requests:', error);
    }
  };

  const loadSessions = async () => {
    try {
      const data = await apiClient.get('/consultations/sessions');
      setSessions(data);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const loadAvailability = async () => {
    try {
      const data = await apiClient.get('/consultations/experts');
      const currentExpert = data.find((expert: any) => expert._id === user?.id);
      if (currentExpert) {
        setExpertAvailable(currentExpert.expertAvailable);
      }
    } catch (error) {
      console.error('Failed to load availability:', error);
    }
  };

  const handleAcceptRequest = async (requestId: string) => {
    setLoading(true);
    try {
      const response = await apiClient.put(`/consultations/requests/${requestId}`, { action: 'accept' });
      alert('Request accepted! Consultation session created.');
      await loadRequests();
      await loadSessions();
      // Navigate to chat if session was created
      if (response.sessionId) {
        router.push(`/consultations/chat/${response.sessionId}`);
      }
    } catch (error: any) {
      alert(error.response?.data?.error || error.message || 'Failed to accept request');
    } finally {
      setLoading(false);
    }
  };

  const handleRejectRequest = async (requestId: string) => {
    if (!confirm('Are you sure you want to reject this consultation request?')) {
      return;
    }
    setLoading(true);
    try {
      await apiClient.put(`/consultations/requests/${requestId}`, { action: 'reject' });
      alert('Request rejected');
      await loadRequests();
    } catch (error: any) {
      alert(error.response?.data?.error || error.message || 'Failed to reject request');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAvailability = async () => {
    setLoading(true);
    try {
      await apiClient.put('/consultations/experts', { available: !expertAvailable });
      setExpertAvailable(!expertAvailable);
      alert(`You are now ${!expertAvailable ? 'available' : 'unavailable'} for consultations`);
    } catch (error: any) {
      alert(error.response?.data?.error || error.message || 'Failed to update availability');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSession = async (sessionId: string) => {
    router.push(`/consultations/chat/${sessionId}`);
  };

  if (authLoading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (user?.role !== 'instructor' && user?.role !== 'admin' && user?.role !== 'superadmin') {
    return <div className="min-h-screen flex items-center justify-center">Access denied. Only experts can access this page.</div>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Expert Consultation Dashboard</h1>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <div className={`w-3 h-3 rounded-full ${expertAvailable ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">
                    {expertAvailable ? 'Available' : 'Unavailable'}
                  </span>
                </div>
                <button
                  onClick={handleToggleAvailability}
                  disabled={loading}
                  className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                    expertAvailable
                      ? 'bg-yellow-600 hover:bg-yellow-700 text-white'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  } disabled:opacity-50`}
                >
                  {expertAvailable ? 'Set Unavailable' : 'Set Available'}
                </button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex space-x-4 mb-6 border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setView('requests')}
                className={`px-4 py-2 font-semibold transition-colors ${
                  view === 'requests'
                    ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Pending Requests ({requests.filter(r => r.status === 'pending').length})
              </button>
              <button
                onClick={() => setView('sessions')}
                className={`px-4 py-2 font-semibold transition-colors ${
                  view === 'sessions'
                    ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Active Sessions ({sessions.filter(s => s.status === 'active').length})
              </button>
              <button
                onClick={() => setView('settings')}
                className={`px-4 py-2 font-semibold transition-colors ${
                  view === 'settings'
                    ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Settings
              </button>
            </div>

            {/* Pending Requests */}
            {view === 'requests' && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Pending Consultation Requests</h2>
                {requests.filter(r => r.status === 'pending').length === 0 ? (
                  <div className="text-center py-12">
                    <svg className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-gray-500 dark:text-gray-400">No pending requests at the moment</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {requests.filter(r => r.status === 'pending').map((request) => (
                      <div key={request._id} className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center space-x-3">
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold">
                              {request.student?.name?.charAt(0).toUpperCase() || 'S'}
                            </div>
                            <div>
                              <p className="font-semibold text-gray-900 dark:text-white">{request.student?.name || 'Student'}</p>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{request.student?.email}</p>
                            </div>
                          </div>
                          <span className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded-full text-sm font-semibold">
                            Pending
                          </span>
                        </div>
                        <div className="mb-4">
                          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Topic: {request.topic}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">Type: {request.consultationType.replace('-', ' ').replace(/\b\w/g, l => l.toUpperCase())}</p>
                          <p className="text-sm text-gray-600 dark:text-gray-400">{request.description}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-500 mt-2">
                            Requested {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                        <div className="flex space-x-3">
                          <button
                            onClick={() => handleAcceptRequest(request._id)}
                            disabled={loading}
                            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
                          >
                            Accept Request
                          </button>
                          <button
                            onClick={() => handleRejectRequest(request._id)}
                            disabled={loading}
                            className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Active Sessions */}
            {view === 'sessions' && (
              <div className="space-y-4">
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Active Consultation Sessions</h2>
                  {sessions.filter(s => s.status === 'active').length === 0 ? (
                    <div className="text-center py-12">
                      <svg className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <p className="text-gray-500 dark:text-gray-400">No active sessions</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {sessions.filter(s => s.status === 'active').map((session) => (
                        <div key={session._id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold">
                                {session.student?.name?.charAt(0).toUpperCase() || 'S'}
                              </div>
                              <div>
                                <p className="font-semibold text-gray-900 dark:text-white">{session.student?.name || 'Student'}</p>
                                <p className="text-sm text-gray-600 dark:text-gray-400">{session.topic}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                  Started {formatDistanceToNow(new Date(session.startedAt), { addSuffix: true })} • {session.messageCount} messages
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleJoinSession(session._id)}
                              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors"
                            >
                              Join Chat
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Completed Sessions */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Completed Sessions</h2>
                  {sessions.filter(s => s.status === 'completed').length === 0 ? (
                    <p className="text-gray-500 dark:text-gray-400">No completed sessions</p>
                  ) : (
                    <div className="space-y-3">
                      {sessions.filter(s => s.status === 'completed').slice(0, 10).map((session) => (
                        <div key={session._id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-gray-900 dark:text-white">{session.student?.name || 'Student'}</p>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{session.topic}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                Completed {session.endedAt ? formatDistanceToNow(new Date(session.endedAt), { addSuffix: true }) : ''}
                              </p>
                            </div>
                            <span className="px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded-full text-sm font-semibold">
                              Completed
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Settings */}
            {view === 'settings' && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Expert Settings</h2>
                <div className="space-y-6">
                  <div>
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={expertAvailable}
                        onChange={handleToggleAvailability}
                        disabled={loading}
                        className="w-5 h-5 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white">Available for Consultations</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          When enabled, students can request consultations from you
                        </p>
                      </div>
                    </label>
                  </div>
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      <strong>Note:</strong> You can toggle your availability at any time. When unavailable, students will not be able to send you new consultation requests.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}





