/**
 * useSocket Hook
 * Manages Socket.io connection and real-time events.
 * Connects only after auth is ready and the user is signed in. The handshake is authenticated by
 * the HttpOnly session cookie, which the browser sends to the page's own origin; no token is read
 * or passed by script. The server ends the socket (`session_ended`) when the session ends.
 */

import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuth } from '@/hooks/useAuth';

const SOCKET_PATH = '/api/socket';

function useSocketConnection() {
  const { isAuthenticated, loading: authLoading, refreshUser } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [marketSignal, setMarketSignal] = useState<any>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;

    // Wait for AuthProvider to hydrate; only connect when signed in.
    if (authLoading) return;
    if (!isAuthenticated) {
      setConnected(false);
      setSocket(null);
      return;
    }

    let newSocket: Socket | null = null;
    let connectTimeout: NodeJS.Timeout | null = null;

    // Wait for page to be fully loaded before connecting (helps with Firefox)
    const connectSocket = () => {
      // Always the page's own origin: the session cookie is host-only and is not sent elsewhere.
      // Split hosting proxies /api/socket to the socket server (docs/phase-4-5/rollout-plan.md).
      const socketUrl = window.location.origin;

      newSocket = io(socketUrl, {
        path: SOCKET_PATH,
        transports: ['websocket', 'polling'], // Allow upgrade from polling → websocket
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        timeout: 20000,
        forceNew: false,
        upgrade: true,
        withCredentials: true,
      });

      // The server ended this session (sign-out elsewhere, expiry, revocation): re-check it, which
      // signs this tab out when it has really ended.
      newSocket.on('session_ended', () => {
        void refreshUser();
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
  }, [authLoading, isAuthenticated, refreshUser]);

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

type SocketApi = ReturnType<typeof useSocketConnection>;

const SocketContext = createContext<SocketApi | null>(null);

export function SocketProvider({ children }: { children: ReactNode }) {
  const value = useSocketConnection();
  return createElement(SocketContext.Provider, { value }, children);
}

export function useSocket() {
  const value = useContext(SocketContext);
  if (!value) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return value;
}


