/**
 * Consultation Chat Page
 * Real-time chat, voice, and video communication for consultations
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';
import { formatDistanceToNow } from 'date-fns';
import AgoraCall from '@/components/AgoraCall';

interface ConsultationMessage {
  _id: string;
  sessionId: string;
  senderId: string;
  senderName: string;
  senderPhoto?: string;
  type: 'text' | 'image' | 'file';
  content: string;
  fileUrl?: string;
  fileName?: string;
  createdAt: string;
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
  student?: {
    _id: string;
    name: string;
    email: string;
    profilePhoto?: string;
  };
  expert?: {
    _id: string;
    name: string;
    email: string;
    profilePhoto?: string;
  };
}

export default function ConsultationChat() {
  const router = useRouter();
  const { sessionId } = router.query;
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { socket, connected, socketReady } = useSocket();
  const [session, setSession] = useState<ConsultationSession | null>(null);
  const [messages, setMessages] = useState<ConsultationMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Agora call state - replaces broken WebRTC
  const [agoraCallType, setAgoraCallType] = useState<'voice' | 'video' | null>(null);
  const [agoraToken, setAgoraToken] = useState<string | null>(null);
  const [agoraAppId, setAgoraAppId] = useState<string>('');
  const [agoraChannel, setAgoraChannel] = useState<string>('');
  const [loadingAgoraToken, setLoadingAgoraToken] = useState(false);

  // Check URL query for auto-starting Agora calls
  useEffect(() => {
    if (router.query.call === 'voice' && sessionId && typeof sessionId === 'string' && session?.status === 'active') {
      handleStartAgoraCall('voice');
    } else if (router.query.call === 'video' && sessionId && typeof sessionId === 'string' && session?.status === 'active') {
      handleStartAgoraCall('video');
    }
  }, [router.query, sessionId, session?.status]);

  // Load session and messages
  useEffect(() => {
    if (!sessionId || typeof sessionId !== 'string') return;

    const loadSession = async () => {
      try {
        setLoading(true);
        const [sessionData, messagesData] = await Promise.all([
          apiClient.get<ConsultationSession>(`/consultations/sessions/${sessionId}`),
          apiClient.get<ConsultationMessage[]>(`/consultations/messages?sessionId=${sessionId}`),
        ]);
        setSession(sessionData);
        setMessages(messagesData || []);
      } catch (error) {
        console.error('Failed to load session:', error);
        alert('Failed to load consultation session');
        router.push('/consultations');
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, [sessionId, router]);

  // Join consultation room via socket - Non-blocking, always allow typing
  useEffect(() => {
    if (!socket || !sessionId || typeof sessionId !== 'string') return;

    // Join consultation room immediately - room is created automatically by socket.io
    socket.emit('joinConsultation', { sessionId });
    console.log('Joined consultation room:', sessionId);

    // Listen for room joined confirmation
    const handleRoomJoined = (data: { sessionId: string }) => {
      if (data.sessionId === sessionId) {
        console.log('Consultation room joined confirmed:', sessionId);
      }
    };

    // Listen for consultation messages
    const handleMessage = (message: ConsultationMessage) => {
      if (message.sessionId === sessionId) {
        setMessages((prev) => {
          // Avoid duplicates
          if (prev.some((m) => m._id === message._id)) return prev;
          return [...prev, message];
        });
      }
    };

    socket.on('consultation_room_joined', handleRoomJoined);
    socket.on('consultationMessage', handleMessage);

    // Agora calls don't need WebRTC signaling - removed broken WebRTC event listeners

    return () => {
      socket.off('consultation_room_joined', handleRoomJoined);
      socket.off('consultationMessage', handleMessage);
      socket.emit('leaveConsultation', { sessionId });
    };
  }, [socket, sessionId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message - Allow sending immediately, only check if socket exists (not connection status)
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !sessionId || typeof sessionId !== 'string' || sending) return;

    const messageContent = input.trim();
    setInput(''); // Clear input immediately for better UX
    setSending(true);

    try {
      // Send message via HTTP POST - works even if WebSocket is not connected
      // WebSocket is only needed for real-time updates, not for sending messages
      const response = await apiClient.post<{ message: ConsultationMessage }>('/consultations/messages', {
        sessionId,
        type: 'text',
        content: messageContent,
      });

      // Message will be added via socket event, but add optimistically
      if (response.message) {
        setMessages((prev) => {
          if (prev.some((m) => m._id === response.message._id)) return prev;
          return [...prev, response.message];
        });
      }
    } catch (error: any) {
      console.error('Failed to send message:', error);
      alert(error.response?.data?.error || 'Failed to send message');
      setInput(messageContent); // Restore input on error
    } finally {
      setSending(false);
    }
  };

  // Start Agora call - Replaces broken WebRTC
  const handleStartAgoraCall = async (callType: 'voice' | 'video') => {
    if (!sessionId || typeof sessionId !== 'string' || !user || session?.status !== 'active') {
      alert('Consultation must be active to start a call');
      return;
    }

    try {
      setLoadingAgoraToken(true);
      setAgoraCallType(callType);

      // Generate Agora token
      const response = await apiClient.post<{
        token: string;
        appId: string;
        channel: string;
        uid: string | number;
      }>('/consultations/agora-token', {
        sessionId,
        uid: user.id || user._id || Date.now(), // Use user ID or timestamp as UID
      });

      setAgoraToken(response.token);
      setAgoraAppId(response.appId);
      setAgoraChannel(response.channel);
      setLoadingAgoraToken(false);
    } catch (error: any) {
      console.error('Error starting Agora call:', error);
      alert(error.response?.data?.error || 'Failed to start call. Please try again.');
      setAgoraCallType(null);
      setLoadingAgoraToken(false);
    }
  };

  // End Agora call
  const handleEndAgoraCall = () => {
    setAgoraCallType(null);
    setAgoraToken(null);
    setAgoraAppId('');
    setAgoraChannel('');
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading consultation...</p>
      </div>
    );
  }

  if (!isAuthenticated || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Session not found or access denied</p>
      </div>
    );
  }

  const otherUser = user?.role === 'student' ? session.expert : session.student;
  const isStudent = user?.role === 'student';

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {otherUser?.profilePhoto && (
                  <img
                    src={otherUser.profilePhoto}
                    alt={otherUser.name}
                    className="w-10 h-10 rounded-full"
                  />
                )}
                <div>
                  <h1 className="text-lg font-bold text-gray-900 dark:text-white">
                    {otherUser?.name || 'Consultation'}
                  </h1>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{session.topic}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Agora Call Controls - Replaces broken WebRTC buttons */}
                {session.status === 'active' && (
                  <>
                    {!agoraCallType && (
                      <>
                        <button
                          onClick={() => handleStartAgoraCall('voice')}
                          disabled={loadingAgoraToken}
                          className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          title="Start voice call"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                          </svg>
                          Voice Call
                        </button>
                        <button
                          onClick={() => handleStartAgoraCall('video')}
                          disabled={loadingAgoraToken}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          title="Start video call"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Video Call
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Agora Call Component - Replaces broken WebRTC */}
          {session.status === 'active' && agoraCallType && agoraToken && agoraAppId && agoraChannel && (
            <div className="px-4 pt-4">
              <AgoraCall
                appId={agoraAppId}
                channel={agoraChannel}
                token={agoraToken}
                uid={user?.id || user?._id || Date.now()}
                callType={agoraCallType}
                onCallEnd={handleEndAgoraCall}
              />
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-500 dark:text-gray-400">No messages yet. Start the conversation!</p>
              </div>
            ) : (
              messages.map((message) => {
                const isOwn = message.senderId === user?.id;
                return (
                  <div
                    key={message._id}
                    className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`flex gap-3 max-w-[70%] ${isOwn ? 'flex-row-reverse' : 'flex-row'}`}>
                      {!isOwn && message.senderPhoto && (
                        <img
                          src={message.senderPhoto}
                          alt={message.senderName}
                          className="w-8 h-8 rounded-full flex-shrink-0"
                        />
                      )}
                      <div className={`rounded-lg p-3 ${isOwn ? 'bg-primary-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white'}`}>
                        {!isOwn && (
                          <p className="text-xs font-semibold mb-1 opacity-80">{message.senderName}</p>
                        )}
                        <p className="text-sm">{message.content}</p>
                        <p className={`text-xs mt-1 ${isOwn ? 'text-primary-100' : 'text-gray-500 dark:text-gray-400'}`}>
                          {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSendMessage} className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message..."
                disabled={sending}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </form>
        </main>
      </div>

    </div>
  );
}

