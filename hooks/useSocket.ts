/**
 * useSocket Hook
 * Manages Socket.io connection and real-time events.
 * Connects only after auth is ready and the user is logged in (avoids "No token" noise and matches server JWT gate).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/hooks/useAuth';

const SOCKET_PATH = '/api/socket';

const getSocketUrl = (): string => {
  const fromEnv = process.env.NEXT_PUBLIC_SOCKET_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');

  const apiBase =
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_API_URL?.trim();
  if (apiBase && /^https?:\/\//i.test(apiBase)) {
    try {
      return new URL(apiBase).origin;
    } catch {
      /* fall through */
    }
  }

  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    return window.location.origin;
  }
  return 'https://forexorbit-academy.onrender.com';
};

export function useSocket() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [marketSignal, setMarketSignal] = useState<any>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;

    // Wait for AuthProvider to hydrate; only connect when logged in (token present + user session).
    if (authLoading) return;
    if (!isAuthenticated) {
      setConnected(false);
      setSocket(null);
      return;
    }

    const token = localStorage.getItem('token')?.trim();
    if (!token) {
      return;
    }

    let newSocket: Socket | null = null;
    let connectTimeout: NodeJS.Timeout | null = null;

    // Wait for page to be fully loaded before connecting (helps with Firefox)
    const connectSocket = () => {
      // Always connect to Render backend - no fallbacks
      const socketUrl = getSocketUrl();
      console.log('Connecting to socket server:', socketUrl);
      
      // Initialize socket connection with production-ready configuration
      // Force websocket + polling fallback for Render/Vercel compatibility
      newSocket = io(socketUrl, {
        path: SOCKET_PATH,
        auth: { token },
        transports: ['websocket', 'polling'], // Allow upgrade from polling → websocket
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        timeout: 20000,
        forceNew: false,
        upgrade: true,
        withCredentials: true, // Required for CORS with credentials
      });

      newSocket.on('connect', () => {
        console.log('Socket connected');
        setConnected(true);
      });

      newSocket.on('disconnect', (reason) => {
        console.log('Socket disconnected:', reason);
        setConnected(false);
      });

      newSocket.on('connect_error', (error) => {
        console.error('Socket connection error:', error.message);
        setConnected(false);
      });

      newSocket.on('reconnect', (attemptNumber) => {
        console.log('Socket reconnected after', attemptNumber, 'attempts');
        setConnected(true);
      });

      newSocket.on('reconnect_attempt', (attemptNumber) => {
        console.log('Socket reconnection attempt', attemptNumber);
      });

      newSocket.on('reconnect_error', (error) => {
        console.error('Socket reconnection error:', error.message);
      });

      newSocket.on('reconnect_failed', () => {
        console.error('Socket reconnection failed after all attempts');
        setConnected(false);
      });

      newSocket.on('marketSignal', (signal) => {
        setMarketSignal(signal);
      });

      socketRef.current = newSocket;
      setSocket(newSocket);
    };

    // Wait for window to be ready, then connect with a small delay
    if (typeof window !== 'undefined') {
      if (document.readyState === 'complete') {
        // Page already loaded, connect immediately with small delay
        connectTimeout = setTimeout(connectSocket, 100);
      } else {
        // Wait for page to load, then connect
        window.addEventListener('load', () => {
          connectTimeout = setTimeout(connectSocket, 100);
        }, { once: true });
      }
    }

    return () => {
      if (connectTimeout) {
        clearTimeout(connectTimeout);
      }
      if (newSocket) {
        newSocket.removeAllListeners();
        newSocket.close();
        newSocket = null;
      }
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [authLoading, isAuthenticated]);

  const joinLesson = useCallback((lessonId: string) => {
    if (socket) {
      socket.emit('joinLesson', lessonId);
    }
  }, [socket]);

  const leaveLesson = useCallback((lessonId: string) => {
    if (socket) {
      socket.emit('leaveLesson', lessonId);
    }
  }, [socket]);

  const sendChatMessage = useCallback((lessonId: string, text: string) => {
    if (socket) {
      socket.emit('chatMessage', { lessonId, text });
    }
  }, [socket]);

  const updateProgress = useCallback((courseId: string, lessonId: string) => {
    if (socket) {
      socket.emit('progressUpdate', { courseId, lessonId });
    }
  }, [socket]);

  const onChatMessage = (callback: (message: any) => void) => {
    if (socket) {
      socket.on('chatMessage', callback);
      return () => socket.off('chatMessage', callback);
    }
  };

  const onProgressUpdated = (callback: (data: any) => void) => {
    if (socket) {
      socket.on('progressUpdated', callback);
      return () => socket.off('progressUpdated', callback);
    }
  };

  // Community room methods
  const joinRoom = (roomId: string) => {
    if (socket) {
      socket.emit('joinRoom', { roomId });
    }
  };

  const leaveRoom = (roomId: string) => {
    if (socket) {
      socket.emit('leaveRoom', { roomId });
    }
  };

  const sendTyping = (roomId: string) => {
    if (socket) {
      socket.emit('typing', { roomId });
    }
  };

  const sendStopTyping = (roomId: string) => {
    if (socket) {
      socket.emit('stopTyping', { roomId });
    }
  };

  const notifyOnline = () => {
    if (socket) {
      socket.emit('userOnline');
    }
  };

  return {
    socket,
    connected,
    marketSignal,
    joinLesson,
    leaveLesson,
    sendChatMessage,
    updateProgress,
    onChatMessage,
    onProgressUpdated,
    // Community methods
    joinRoom,
    leaveRoom,
    sendTyping,
    sendStopTyping,
    notifyOnline,
  };
}


