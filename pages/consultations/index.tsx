/**
 * Expert Consultation Page - Student View
 * Request consultations, join live sessions, view history
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';
// import { useSocket } from '@/hooks/useSocket'; // Reserved for future use
import { apiClient } from '@/lib/api-client';
import { formatDistanceToNow } from 'date-fns';

interface Expert {
  _id: string;
  name: string;
  email: string;
  profilePhoto?: string;
  expertAvailable: boolean;
  role: string;
}

interface ConsultationRequest {
  _id: string;
  studentId: string;
  expertId: string;
  topic: string;
  description: string;
  consultationType: 'live-chat' | 'audio-call' | 'video-call';
  status: 'pending' | 'accepted' | 'rejected' | 'completed';
  createdAt: string;
  expert?: Expert;
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
  expert?: Expert;
  messageCount: number;
}

export default function Consultations() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  // const { socket, connected } = useSocket(); // Reserved for future use
  const [view, setView] = useState<'request' | 'history' | 'chat'>('request');
  const [experts, setExperts] = useState<Expert[]>([]);
  const [requests, setRequests] = useState<ConsultationRequest[]>([]);
  const [sessions, setSessions] = useState<ConsultationSession[]>([]);
  // const [selectedSession, setSelectedSession] = useState<ConsultationSession | null>(null); // Reserved for future use
  const [requestForm, setRequestForm] = useState({
    expertId: '',
    topic: '',
    description: '',
    consultationType: 'live-chat' as 'live-chat' | 'audio-call' | 'video-call',
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'student') {
      loadExperts();
      loadRequests();
      loadSessions();
    }
  }, [isAuthenticated, user]);

  const loadExperts = async () => {
    try {
      const data = await apiClient.get<Expert[]>('/consultations/experts');
      setExperts(data.filter((expert) => expert.expertAvailable));
    } catch (error) {
      console.error('Failed to load experts:', error);
    }
  };

  const loadRequests = async () => {
    try {
      const data = await apiClient.get<ConsultationRequest[]>('/consultations/requests');
      setRequests(data);
    } catch (error) {
      console.error('Failed to load requests:', error);
    }
  };

  const loadSessions = async () => {
    try {
      const data = await apiClient.get<ConsultationSession[]>('/consultations/sessions');
      setSessions(data);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!requestForm.expertId || !requestForm.topic || !requestForm.description) {
      alert('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/consultations/requests', requestForm);
      alert('Consultation request submitted successfully!');
      setRequestForm({ expertId: '', topic: '', description: '', consultationType: 'live-chat' });
      await loadRequests();
    } catch (error: unknown) {
      let errorMessage = 'Failed to submit request';
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
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (user?.role !== 'student') {
    return <div className="min-h-screen flex items-center justify-center">Access denied</div>;
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-6xl mx-auto">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-6">Expert Consultation</h1>

            {/* Tabs */}
            <div className="flex space-x-4 mb-6 border-b border-gray-200 dark:border-gray-700">
              <button
                onClick={() => setView('request')}
                className={`px-4 py-2 font-semibold transition-colors ${
                  view === 'request'
                    ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Request Consultation
              </button>
              <button
                onClick={() => setView('history')}
                className={`px-4 py-2 font-semibold transition-colors ${
                  view === 'history'
                    ? 'text-primary-600 dark:text-primary-400 border-b-2 border-primary-600 dark:border-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                My Consultations
              </button>
            </div>

            {/* Request Consultation Form */}
            {view === 'request' && (
              <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Request Expert Consultation</h2>
                <form onSubmit={handleSubmitRequest} className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Select Expert <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={requestForm.expertId}
                      onChange={(e) => setRequestForm({ ...requestForm, expertId: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      required
                      disabled={experts.length === 0}
                    >
                      <option value="">{experts.length === 0 ? 'No experts available. Please contact support.' : 'Choose an expert...'}</option>
                      {experts.map((expert) => (
                        <option key={expert._id} value={expert._id}>
                          {expert.name} ({expert.role === 'instructor' ? 'Instructor' : 'Admin'})
                        </option>
                      ))}
                    </select>
                    {/* FIX: Show message if no experts available */}
                    {experts.length === 0 && (
                      <p className="mt-2 text-sm text-yellow-600 dark:text-yellow-400">
                        No experts are currently available. Please check back later or contact support.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Topic <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={requestForm.topic}
                      onChange={(e) => setRequestForm({ ...requestForm, topic: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      required
                    >
                      <option value="">Select a topic...</option>
                      <option value="Risk Management">Risk Management</option>
                      <option value="Market Structure">Market Structure</option>
                      <option value="Trading Psychology">Trading Psychology</option>
                      <option value="Technical Analysis">Technical Analysis</option>
                      <option value="Fundamental Analysis">Fundamental Analysis</option>
                      <option value="Strategy Development">Strategy Development</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Consultation Type <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-3 gap-4">
                      <label className={`p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                        requestForm.consultationType === 'live-chat'
                          ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-gray-300 dark:border-gray-600 hover:border-primary-300'
                      }`}>
                        <input
                          type="radio"
                          value="live-chat"
                          checked={requestForm.consultationType === 'live-chat'}
                          onChange={(e) => setRequestForm({ ...requestForm, consultationType: e.target.value as any })}
                          className="sr-only"
                        />
                        <div className="text-center">
                          <svg className="w-8 h-8 mx-auto mb-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                          </svg>
                          <span className="font-semibold text-gray-900 dark:text-white">Live Chat</span>
                        </div>
                      </label>
                      <label className={`p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                        requestForm.consultationType === 'audio-call'
                          ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-gray-300 dark:border-gray-600 hover:border-primary-300'
                      }`}>
                        <input
                          type="radio"
                          value="audio-call"
                          checked={requestForm.consultationType === 'audio-call'}
                          onChange={(e) => setRequestForm({ ...requestForm, consultationType: e.target.value as any })}
                          className="sr-only"
                        />
                        <div className="text-center">
                          <svg className="w-8 h-8 mx-auto mb-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                          </svg>
                          <span className="font-semibold text-gray-900 dark:text-white">Audio Call</span>
                          <span className="text-xs text-gray-500 block mt-1">(Placeholder)</span>
                        </div>
                      </label>
                      <label className={`p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                        requestForm.consultationType === 'video-call'
                          ? 'border-primary-600 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-gray-300 dark:border-gray-600 hover:border-primary-300'
                      }`}>
                        <input
                          type="radio"
                          value="video-call"
                          checked={requestForm.consultationType === 'video-call'}
                          onChange={(e) => setRequestForm({ ...requestForm, consultationType: e.target.value as any })}
                          className="sr-only"
                        />
                        <div className="text-center">
                          <svg className="w-8 h-8 mx-auto mb-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          <span className="font-semibold text-gray-900 dark:text-white">Video Call</span>
                          <span className="text-xs text-gray-500 block mt-1">(Placeholder)</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                      Description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={requestForm.description}
                      onChange={(e) => setRequestForm({ ...requestForm, description: e.target.value })}
                      placeholder="Describe your issue or question..."
                      rows={5}
                      className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? 'Submitting...' : 'Submit Request'}
                  </button>
                </form>
              </div>
            )}

            {/* Consultation History */}
            {view === 'history' && (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">My Consultations</h2>

                {/* Requests */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Pending Requests</h3>
                  {requests.filter(r => r.status === 'pending').length === 0 ? (
                    <p className="text-gray-500 dark:text-gray-400">No pending requests</p>
                  ) : (
                    <div className="space-y-3">
                      {requests.filter(r => r.status === 'pending').map((request) => (
                        <div key={request._id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-gray-900 dark:text-white">{request.expert?.name || 'Expert'}</p>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{request.topic}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                {formatDistanceToNow(new Date(request.createdAt), { addSuffix: true })}
                              </p>
                            </div>
                            <span className="px-3 py-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded-full text-sm font-semibold">
                              Pending
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Active Sessions */}
                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Active Sessions</h3>
                  {sessions.filter(s => s.status === 'active').length === 0 ? (
                    <p className="text-gray-500 dark:text-gray-400">No active sessions</p>
                  ) : (
                    <div className="space-y-3">
                      {sessions.filter(s => s.status === 'active').map((session) => (
                        <div key={session._id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-gray-900 dark:text-white">{session.expert?.name || 'Expert'}</p>
                              <p className="text-sm text-gray-600 dark:text-gray-400">{session.topic}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                                Started {formatDistanceToNow(new Date(session.startedAt), { addSuffix: true })}
                              </p>
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
                  <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Completed</h3>
                  {sessions.filter(s => s.status === 'completed').length === 0 ? (
                    <p className="text-gray-500 dark:text-gray-400">No completed consultations</p>
                  ) : (
                    <div className="space-y-3">
                      {sessions.filter(s => s.status === 'completed').map((session) => (
                        <div key={session._id} className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-gray-900 dark:text-white">{session.expert?.name || 'Expert'}</p>
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
          </div>
        </main>
      </div>
    </div>
  );
}








