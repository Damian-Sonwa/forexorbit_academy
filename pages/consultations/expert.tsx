/**
 * Expert Consultation Dashboard
 * For Instructors and Admins to manage consultation requests
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
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
  // REUSED from dashboard - state for consultation management
  const [consultationRequests, setConsultationRequests] = useState<ConsultationRequest[]>([]);
  const [consultationSessions, setConsultationSessions] = useState<ConsultationSession[]>([]);
  const [loadingConsultations, setLoadingConsultations] = useState(false);
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

  // Load consultation requests - REUSED from dashboard
  const loadRequests = async () => {
    try {
      setLoadingConsultations(true);
      const data = await apiClient.get<ConsultationRequest[]>('/consultations/requests');
      setRequests(data || []);
      setConsultationRequests(data || []);
    } catch (error) {
      console.error('Failed to load consultation requests:', error);
      setRequests([]);
      setConsultationRequests([]);
    } finally {
      setLoadingConsultations(false);
    }
  };

  // Load active consultation sessions - REUSED from dashboard
  const loadSessions = async () => {
    try {
      const data = await apiClient.get<ConsultationSession[]>('/consultations/sessions');
      setSessions(data || []);
      setConsultationSessions(data || []);
    } catch (error) {
      console.error('Failed to load consultation sessions:', error);
      setSessions([]);
      setConsultationSessions([]);
    }
  };

  const loadAvailability = async () => {
    try {
      const data = await apiClient.get<Array<{ _id: string; expertAvailable?: boolean; [key: string]: unknown }>>('/consultations/experts');
      const currentExpert = data.find((expert) => expert._id === user?.id);
      if (currentExpert) {
        setExpertAvailable(currentExpert.expertAvailable || false);
      }
    } catch (error) {
      console.error('Failed to load availability:', error);
    }
  };

  // Handle accept/reject consultation request - REUSED from dashboard
  const handleConsultationAction = async (requestId: string, action: 'accept' | 'reject') => {
    if (action === 'reject' && !confirm('Are you sure you want to reject this consultation request?')) {
      return;
    }

    setLoadingConsultations(true);
    setLoading(true);
    try {
      await apiClient.put(`/consultations/requests/${requestId}`, { action });
      alert(action === 'accept' ? 'Request accepted! Consultation session created.' : 'Request rejected.');
      await loadRequests();
      await loadSessions();
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.message || `Failed to ${action} request`;
      alert(errorMessage);
    } finally {
      setLoadingConsultations(false);
      setLoading(false);
    }
  };

  // Alias functions for compatibility
  const handleAcceptRequest = (requestId: string) => handleConsultationAction(requestId, 'accept');
  const handleRejectRequest = (requestId: string) => handleConsultationAction(requestId, 'reject');

  const handleToggleAvailability = async () => {
    setLoading(true);
    try {
      await apiClient.put('/consultations/experts', { available: !expertAvailable });
      setExpertAvailable(!expertAvailable);
      alert(`You are now ${!expertAvailable ? 'available' : 'unavailable'} for consultations`);
    } catch (error: unknown) {
      let errorMessage = 'Failed to update availability';
      if (error && typeof error === 'object' && 'response' in error) {
        const apiError = error as { response?: { data?: { error?: string } }; message?: string };
        errorMessage = apiError.response?.data?.error || apiError.message || errorMessage;
      } else if (error instanceof Error) {
        errorMessage = error.message || errorMessage;
      }
      alert(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinSession = async (sessionId: string) => {
    router.push(`/consultations/chat/${sessionId}`);
  };

  if (authLoading || !isAuthenticated) {
    return <LoadingSpinner message="Loading expert consultations..." fullScreen />;
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

            {/* Pending Requests - REUSED from dashboard UI */}
            {view === 'requests' && (
              <div className="space-y-4">
                {/* Consultation Requests Section - REUSED from dashboard */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-3 sm:p-4">
                  <div className="flex items-center space-x-3 mb-4">
                    <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">Consultation Requests</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400">View and manage consultation requests from students</p>
                    </div>
                  </div>
                  
                  {loadingConsultations ? (
                    <div className="text-center py-4">
                      <p className="text-gray-600 dark:text-gray-400">Loading requests...</p>
                    </div>
                  ) : consultationRequests.length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-gray-600 dark:text-gray-400">No consultation requests at the moment</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {consultationRequests.map((request) => (
                        <div
                          key={request._id}
                          className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 sm:p-4 bg-gray-50 dark:bg-gray-900"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                                  request.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                                  request.status === 'accepted' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                                  request.status === 'rejected' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                                  'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                                }`}>
                                  {request.status.charAt(0).toUpperCase() + request.status.slice(1)}
                                </span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                                </span>
                              </div>
                              {request.student && (
                                <div className="flex items-center gap-2 mb-2">
                                  {request.student.profilePhoto && (
                                    <img
                                      src={request.student.profilePhoto}
                                      alt={request.student.name}
                                      className="w-8 h-8 rounded-full"
                                    />
                                  )}
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{request.student.name}</p>
                                    <p className="text-xs text-gray-600 dark:text-gray-400">{request.student.email}</p>
                                  </div>
                                </div>
                              )}
                              <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{request.topic}</p>
                              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{request.description}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                Type: <span className="capitalize">{request.consultationType.replace('-', ' ')}</span>
                              </p>
                            </div>
                            {request.status === 'pending' && (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleConsultationAction(request._id, 'accept')}
                                  disabled={loadingConsultations}
                                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Accept
                                </button>
                                <button
                                  onClick={() => handleConsultationAction(request._id, 'reject')}
                                  disabled={loadingConsultations}
                                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  Reject
                                </button>
                              </div>
                            )}
                            {request.status === 'accepted' && (
                              <div className="flex gap-2 flex-wrap">
                                <button
                                  onClick={() => {
                                    // Find session for this request
                                    const session = consultationSessions.find((s: any) => s.requestId === request._id && s.status === 'active');
                                    if (session) {
                                      router.push(`/consultations/chat/${session._id}`);
                                    } else {
                                      // Load sessions to find the one for this request
                                      apiClient.get<any[]>('/consultations/sessions').then((sessions) => {
                                        const activeSession = sessions.find((s: any) => s.requestId === request._id && s.status === 'active');
                                        if (activeSession) {
                                          router.push(`/consultations/chat/${activeSession._id}`);
                                        } else {
                                          alert('Session not found. Please try again.');
                                        }
                                      });
                                    }
                                  }}
                                  className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center gap-2"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                  </svg>
                                  Live Chat
                                </button>
                                {/* Voice/Video Call buttons removed - Agora SDK handles calls in chat page */}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Active Consultation Sessions - REUSED from dashboard */}
                {consultationSessions.filter((s: any) => s.status === 'active').length > 0 && (
                  <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-3 sm:p-4">
                    <div className="flex items-center space-x-3 mb-4">
                      <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <div>
                        <h3 className="text-sm font-bold text-gray-900 dark:text-white">Active Consultation Sessions</h3>
                        <p className="text-xs text-gray-600 dark:text-gray-400">Communicate with students in real-time</p>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      {consultationSessions.filter((s: any) => s.status === 'active').map((session: any) => (
                        <div
                          key={session._id}
                          className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="flex-1">
                              {session.student && (
                                <div className="flex items-center gap-2 mb-2">
                                  {session.student.profilePhoto && (
                                    <img
                                      src={session.student.profilePhoto}
                                      alt={session.student.name}
                                      className="w-8 h-8 rounded-full"
                                    />
                                  )}
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{session.student.name}</p>
                                    <p className="text-xs text-gray-600 dark:text-gray-400">{session.student.email}</p>
                                  </div>
                                </div>
                              )}
                              <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{session.topic}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                Started {formatDistanceToNow(new Date(session.startedAt), { addSuffix: true })} • {session.messageCount || 0} messages
                              </p>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <button
                                onClick={() => router.push(`/consultations/chat/${session._id}`)}
                                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center gap-2"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                Live Chat
                              </button>
                              {/* Voice/Video Call buttons removed - Agora SDK handles calls in chat page */}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Active Sessions - REUSED from dashboard UI */}
            {view === 'sessions' && (
              <div className="space-y-4">
                {/* Active Consultation Sessions - REUSED from dashboard */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-3 sm:p-4">
                  <div className="flex items-center space-x-3 mb-4">
                    <svg className="w-6 h-6 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900 dark:text-white">Active Consultation Sessions</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400">Communicate with students in real-time</p>
                    </div>
                  </div>
                  
                  {consultationSessions.filter((s: any) => s.status === 'active').length === 0 ? (
                    <div className="text-center py-4">
                      <p className="text-gray-600 dark:text-gray-400">No active consultation sessions</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {consultationSessions.filter((s: any) => s.status === 'active').map((session: any) => (
                        <div
                          key={session._id}
                          className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-gray-50 dark:bg-gray-900"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="flex-1">
                              {session.student && (
                                <div className="flex items-center gap-2 mb-2">
                                  {session.student.profilePhoto && (
                                    <img
                                      src={session.student.profilePhoto}
                                      alt={session.student.name}
                                      className="w-8 h-8 rounded-full"
                                    />
                                  )}
                                  <div>
                                    <p className="text-sm font-semibold text-gray-900 dark:text-white">{session.student.name}</p>
                                    <p className="text-xs text-gray-600 dark:text-gray-400">{session.student.email}</p>
                                  </div>
                                </div>
                              )}
                              <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{session.topic}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">
                                Started {formatDistanceToNow(new Date(session.startedAt), { addSuffix: true })} • {session.messageCount || 0} messages
                              </p>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                              <button
                                onClick={() => router.push(`/consultations/chat/${session._id}`)}
                                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center gap-2"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                                </svg>
                                Live Chat
                              </button>
                              {/* Voice/Video Call buttons removed - Agora SDK handles calls in chat page */}
                            </div>
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








