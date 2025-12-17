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
  const [showVideoCall, setShowVideoCall] = useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'ongoing' | 'ended'>('idle');

  // Check URL query for auto-starting calls
  useEffect(() => {
    if (router.query.call === 'voice' && sessionId && typeof sessionId === 'string') {
      setShowVoiceCall(true);
      setTimeout(() => {
        handleStartVoiceCall();
      }, 1000);
    } else if (router.query.call === 'video' && sessionId && typeof sessionId === 'string') {
      setShowVideoCall(true);
      setTimeout(() => {
        handleStartVideoCall();
      }, 1000);
    }
  }, [router.query, sessionId]);

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

    // Listen for call events
    socket.on('consultationCallOffer', (data: { sessionId: string; type: 'voice' | 'video'; from: string }) => {
      if (data.sessionId === sessionId) {
        setCallStatus('calling');
        if (data.type === 'video') {
          setShowVideoCall(true);
        } else {
          setShowVoiceCall(true);
        }
      }
    });

    socket.on('consultationCallAnswer', (data: { sessionId: string; accepted: boolean }) => {
      if (data.sessionId === sessionId) {
        if (data.accepted) {
          setCallStatus('ongoing');
        } else {
          setCallStatus('idle');
          setShowVideoCall(false);
          setShowVoiceCall(false);
        }
      }
    });

    socket.on('consultationCallEnd', (data: { sessionId: string }) => {
      if (data.sessionId === sessionId) {
        setCallStatus('idle');
        setShowVideoCall(false);
        setShowVoiceCall(false);
      }
    });

    return () => {
      socket.off('consultation_room_joined', handleRoomJoined);
      socket.off('consultationMessage', handleMessage);
      socket.off('consultationCallOffer');
      socket.off('consultationCallAnswer');
      socket.off('consultationCallEnd');
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

  // Start voice call
  const handleStartVoiceCall = () => {
    if (!socket || !sessionId || typeof sessionId !== 'string') return;
    setCallStatus('calling');
    setShowVoiceCall(true);
    socket.emit('consultationCallOffer', { sessionId, type: 'voice' });
  };

  // Start video call
  const handleStartVideoCall = () => {
    if (!socket || !sessionId || typeof sessionId !== 'string') return;
    setCallStatus('calling');
    setShowVideoCall(true);
    socket.emit('consultationCallOffer', { sessionId, type: 'video' });
  };

  // End call
  const handleEndCall = () => {
    if (!socket || !sessionId || typeof sessionId !== 'string') return;
    socket.emit('consultationCallEnd', { sessionId });
    setCallStatus('idle');
    setShowVideoCall(false);
    setShowVoiceCall(false);
  };

  // Answer call
  const handleAnswerCall = (accepted: boolean) => {
    if (!socket || !sessionId || typeof sessionId !== 'string') return;
    socket.emit('consultationCallAnswer', { sessionId, accepted });
    if (!accepted) {
      setCallStatus('idle');
      setShowVideoCall(false);
      setShowVoiceCall(false);
    } else {
      setCallStatus('ongoing');
    }
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
                {/* Communication Controls */}
                <button
                  onClick={handleStartVoiceCall}
                  disabled={callStatus === 'calling' || callStatus === 'ongoing' || !connected}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  Voice Call
                </button>
                <button
                  onClick={handleStartVideoCall}
                  disabled={callStatus === 'calling' || callStatus === 'ongoing' || !connected}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Video Call
                </button>
                {callStatus !== 'idle' && (
                  <button
                    onClick={handleEndCall}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    End Call
                  </button>
                )}
              </div>
            </div>
          </div>

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

      {/* Voice Call Modal */}
      {showVoiceCall && (
        <VoiceCallModal
          sessionId={sessionId as string}
          otherUser={otherUser}
          callStatus={callStatus}
          onAnswer={handleAnswerCall}
          onEnd={handleEndCall}
          onClose={() => {
            setShowVoiceCall(false);
            setCallStatus('idle');
          }}
        />
      )}

      {/* Video Call Modal */}
      {showVideoCall && (
        <VideoCallModal
          sessionId={sessionId as string}
          otherUser={otherUser}
          callStatus={callStatus}
          onAnswer={handleAnswerCall}
          onEnd={handleEndCall}
          onClose={() => {
            setShowVideoCall(false);
            setCallStatus('idle');
          }}
        />
      )}
    </div>
  );
}

// Voice Call Modal Component
function VoiceCallModal({
  sessionId,
  otherUser,
  callStatus,
  onAnswer,
  onEnd,
  onClose,
}: {
  sessionId: string;
  otherUser?: { name: string; profilePhoto?: string };
  callStatus: 'idle' | 'calling' | 'ongoing' | 'ended';
  onAnswer: (accepted: boolean) => void;
  onEnd: () => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [muted, setMuted] = useState(false);
  const localAudioRef = useRef<HTMLAudioElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    if (callStatus === 'ongoing') {
      initializeVoiceCall();
    }
    return () => {
      cleanupCall();
    };
  }, [callStatus]);

  const initializeVoiceCall = async () => {
    try {
      // Get user media (audio only)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setLocalStream(stream);
      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }

      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      // Add local stream tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Handle remote stream
      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = event.streams[0];
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('consultationIceCandidate', {
            sessionId,
            candidate: event.candidate,
          });
        }
      };

      peerConnectionRef.current = pc;

      // Socket signaling
      if (socket) {
        socket.on('consultationOffer', async (data: { sessionId: string; offer: RTCSessionDescriptionInit }) => {
          if (data.sessionId === sessionId && pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('consultationAnswer', { sessionId, answer });
          }
        });

        socket.on('consultationAnswer', async (data: { sessionId: string; answer: RTCSessionDescriptionInit }) => {
          if (data.sessionId === sessionId && pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          }
        });

        socket.on('consultationIceCandidate', async (data: { sessionId: string; candidate: RTCIceCandidateInit }) => {
          if (data.sessionId === sessionId && pc && data.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        });
      }
    } catch (error) {
      console.error('Error initializing voice call:', error);
      alert('Failed to start voice call. Please check your microphone permissions.');
    }
  };

  const cleanupCall = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8 max-w-md w-full">
        <div className="text-center mb-6">
          {otherUser?.profilePhoto && (
            <img
              src={otherUser.profilePhoto}
              alt={otherUser.name}
              className="w-24 h-24 rounded-full mx-auto mb-4"
            />
          )}
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            {callStatus === 'calling' ? 'Calling...' : 'Voice Call'}
          </h2>
          <p className="text-gray-600 dark:text-gray-400">{otherUser?.name || 'Consultation'}</p>
        </div>

        {callStatus === 'calling' && (
          <div className="flex justify-center gap-4 mb-6">
            <button
              onClick={() => onAnswer(true)}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-full font-semibold transition-colors"
            >
              Answer
            </button>
            <button
              onClick={() => onAnswer(false)}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-full font-semibold transition-colors"
            >
              Decline
            </button>
          </div>
        )}

        {callStatus === 'ongoing' && (
          <div className="flex justify-center gap-4 mb-6">
            <button
              onClick={() => setMuted(!muted)}
              className={`px-6 py-3 rounded-full font-semibold transition-colors ${
                muted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600 hover:bg-gray-700'
              } text-white`}
            >
              {muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              onClick={onEnd}
              className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-full font-semibold transition-colors"
            >
              End Call
            </button>
          </div>
        )}

        <div className="flex justify-center">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            Close
          </button>
        </div>

        {/* Hidden audio elements */}
        <audio ref={localAudioRef} autoPlay muted={muted} />
        <audio ref={remoteAudioRef} autoPlay />
      </div>
    </div>
  );
}

// Video Call Modal Component
function VideoCallModal({
  sessionId,
  otherUser,
  callStatus,
  onAnswer,
  onEnd,
  onClose,
}: {
  sessionId: string;
  otherUser?: { name: string; profilePhoto?: string };
  callStatus: 'idle' | 'calling' | 'ongoing' | 'ended';
  onAnswer: (accepted: boolean) => void;
  onEnd: () => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { socket } = useSocket();
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    if (callStatus === 'ongoing') {
      initializeVideoCall();
    }
    return () => {
      cleanupCall();
    };
  }, [callStatus]);

  const initializeVideoCall = async () => {
    try {
      // Get user media (audio + video)
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });

      // Add local stream tracks
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Handle remote stream
      pc.ontrack = (event) => {
        setRemoteStream(event.streams[0]);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && socket) {
          socket.emit('consultationIceCandidate', {
            sessionId,
            candidate: event.candidate,
          });
        }
      };

      peerConnectionRef.current = pc;

      // Socket signaling (same as voice call)
      if (socket) {
        socket.on('consultationOffer', async (data: { sessionId: string; offer: RTCSessionDescriptionInit }) => {
          if (data.sessionId === sessionId && pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('consultationAnswer', { sessionId, answer });
          }
        });

        socket.on('consultationAnswer', async (data: { sessionId: string; answer: RTCSessionDescriptionInit }) => {
          if (data.sessionId === sessionId && pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          }
        });

        socket.on('consultationIceCandidate', async (data: { sessionId: string; candidate: RTCIceCandidateInit }) => {
          if (data.sessionId === sessionId && pc && data.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        });
      }
    } catch (error) {
      console.error('Error initializing video call:', error);
      alert('Failed to start video call. Please check your camera and microphone permissions.');
    }
  };

  const cleanupCall = () => {
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach((track) => {
        track.enabled = videoOff;
      });
      setVideoOff(!videoOff);
    }
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = muted;
      });
      setMuted(!muted);
    }
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex items-center justify-center">
      <div className="relative w-full h-full flex flex-col">
        {/* Remote Video */}
        <div className="flex-1 bg-gray-900 flex items-center justify-center">
          {remoteStream ? (
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="text-center text-white">
              {otherUser?.profilePhoto && (
                <img
                  src={otherUser.profilePhoto}
                  alt={otherUser.name}
                  className="w-32 h-32 rounded-full mx-auto mb-4"
                />
              )}
              <p className="text-xl">{otherUser?.name || 'Waiting for connection...'}</p>
            </div>
          )}
        </div>

        {/* Local Video (Picture-in-Picture) */}
        {localStream && (
          <div className="absolute bottom-20 right-4 w-48 h-36 bg-gray-800 rounded-lg overflow-hidden">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Controls */}
        <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 p-4">
          <div className="flex justify-center items-center gap-4">
            {callStatus === 'calling' && (
              <>
                <button
                  onClick={() => onAnswer(true)}
                  className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-full font-semibold transition-colors"
                >
                  Answer
                </button>
                <button
                  onClick={() => onAnswer(false)}
                  className="px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-full font-semibold transition-colors"
                >
                  Decline
                </button>
              </>
            )}

            {callStatus === 'ongoing' && (
              <>
                <button
                  onClick={toggleMute}
                  className={`p-3 rounded-full font-semibold transition-colors ${
                    muted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600 hover:bg-gray-700'
                  } text-white`}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {muted ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    )}
                  </svg>
                </button>
                <button
                  onClick={toggleVideo}
                  className={`p-3 rounded-full font-semibold transition-colors ${
                    videoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600 hover:bg-gray-700'
                  } text-white`}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    {videoOff ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    )}
                  </svg>
                </button>
                <button
                  onClick={onEnd}
                  className="p-3 bg-red-600 hover:bg-red-700 text-white rounded-full font-semibold transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

