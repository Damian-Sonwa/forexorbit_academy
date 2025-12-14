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
    if (!token) return;

    // Initialize socket connection
    const newSocket = io(SOCKET_URL, {
      path: '/api/socket',
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      console.log('Socket connected');
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      console.log('Socket disconnected');
      setConnected(false);
    });

    newSocket.on('marketSignal', (signal) => {
      setMarketSignal(signal);
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    return () => {
      newSocket.close();
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
  };
}

