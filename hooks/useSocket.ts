/**
 * useSocket Hook
 * Manages Socket.io connection and real-time events
 */

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3000';

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [marketSignal, setMarketSignal] = useState<any>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Get token from localStorage
    const token = localStorage.getItem('token');
    if (!token) {
      console.log('No token found, skipping socket connection');
      return;
    }

    let newSocket: Socket | null = null;
    let connectTimeout: NodeJS.Timeout | null = null;

    // Wait for page to be fully loaded before connecting (helps with Firefox)
    const connectSocket = () => {
      // Initialize socket connection with improved configuration
      newSocket = io(SOCKET_URL, {
        path: '/api/socket',
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
        timeout: 20000,
        forceNew: false,
        upgrade: true,
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
  }, []);

  const joinLesson = (lessonId: string) => {
    if (socket) {
      socket.emit('joinLesson', lessonId);
    }
  };

  const leaveLesson = (lessonId: string) => {
    if (socket) {
      socket.emit('leaveLesson', lessonId);
    }
  };

  const sendChatMessage = (lessonId: string, text: string) => {
    if (socket) {
      socket.emit('chatMessage', { lessonId, text });
    }
  };

  const updateProgress = (courseId: string, lessonId: string) => {
    if (socket) {
      socket.emit('progressUpdate', { courseId, lessonId });
    }
  };

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


