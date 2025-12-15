/**
 * Chat Component
 * Real-time chat for lesson rooms
 */

import { useState, useEffect, useRef } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';

interface Message {
  id: string;
  lessonId?: string;
  senderName: string;
  text: string;
  createdAt: Date | string;
}

interface ChatProps {
  lessonId: string;
}

export default function Chat({ lessonId }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { joinLesson, leaveLesson, sendChatMessage, onChatMessage, connected } = useSocket();

  useEffect(() => {
    // Load existing messages
    const loadMessages = async () => {
      try {
        const data = await apiClient.get<Message[]>(`/messages?lessonId=${lessonId}`);
        setMessages(data);
      } catch (error) {
        console.error('Failed to load messages:', error);
      } finally {
        setLoading(false);
      }
    };

    loadMessages();

    // Join lesson room when connected
    if (connected) {
      joinLesson(lessonId);
      console.log('Joined lesson room:', lessonId);
    }

    // Listen for new messages
    const cleanup = onChatMessage((message: Message) => {
      if (message.lessonId === lessonId) {
        setMessages((prev) => [...prev, message]);
      }
    });

    return () => {
      leaveLesson(lessonId);
      cleanup?.();
    };
  }, [lessonId, connected, joinLesson]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) {
      console.warn('Cannot send empty message');
      return;
    }
    
    if (!connected) {
      console.error('Cannot send message: socket not connected');
      alert('Connection lost. Please refresh the page.');
      return;
    }

    try {
      sendChatMessage(lessonId, input.trim());
      setInput('');
    } catch (error) {
      console.error('Error sending message:', error);
      alert('Failed to send message. Please try again.');
    }
  };

  if (loading) {
    return <div className="p-4 text-center text-gray-500">Loading chat...</div>;
  }

  return (
    <div className="flex flex-col h-[400px] sm:h-96 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Messages */}
      {/* FIX: Mobile responsive - adjusted height and padding for mobile devices */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 bg-gray-50">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="text-gray-500 text-sm font-medium">No messages yet</p>
            <p className="text-gray-400 text-xs mt-1">Start the conversation!</p>
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="flex flex-col group">
              <div className="flex items-center space-x-2 mb-1">
                <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white text-xs font-bold">
                  {message.senderName.charAt(0).toUpperCase()}
                </div>
                <span className="text-sm font-semibold text-gray-900">{message.senderName}</span>
                <span className="text-xs text-gray-400">
                  {format(new Date(message.createdAt), 'HH:mm')}
                </span>
              </div>
              <div className="ml-10">
                <p className="text-sm text-gray-700 bg-white rounded-xl px-4 py-2 shadow-sm border border-gray-100 inline-block">
                  {message.text}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      {/* FIX: Mobile responsive - ensure input and button are always visible and not cut off */}
      <form onSubmit={handleSend} className="border-t border-gray-200 p-2 sm:p-3 md:p-4 bg-white flex-shrink-0">
        <div className="flex gap-2 sm:gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={connected ? "Type a message..." : "Connecting..."}
            disabled={!connected}
            className="flex-1 min-w-0 px-3 py-2 sm:px-4 sm:py-2 md:px-4 md:py-3 text-sm sm:text-base border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!connected || !input.trim()}
            className="min-w-[44px] px-3 py-2 sm:px-4 sm:py-2 md:px-6 md:py-3 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-semibold transition-colors shadow-sm flex-shrink-0 flex items-center justify-center"
          >
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}

