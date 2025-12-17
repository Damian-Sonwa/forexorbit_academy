/**
 * Community Page - WhatsApp-style UI
 * Global community chat, one-to-one messaging, and Forex news feed
 */

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import BackButton from '@/components/BackButton';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';
import { format, formatDistanceToNow } from 'date-fns';

interface Message {
  _id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  senderPhoto?: string;
  type: 'text' | 'audio' | 'document' | 'video' | 'image';
  content: string;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  reactions?: Array<{ emoji: string; userId: string; userName: string }>;
  createdAt: Date | string;
  seenBy?: string[];
  delivered?: boolean;
}

interface Room {
  _id: string;
  name: string;
  type: 'global' | 'direct';
  participants: string[];
  lastMessage?: Message;
  unreadCount?: number;
  avatar?: string;
  isOnline?: boolean;
  lastSeen?: Date | string;
  isLocked?: boolean; // Whether the room is locked for this user
}

interface NewsItem {
  _id: string;
  title: string;
  description: string;
  category: string;
  content?: string;
  link?: string;
  createdAt: Date | string;
  createdBy?: string;
  isRead?: boolean; // Whether this news item has been read by the current user
  readBy?: string[]; // Array of user IDs who have read this news
}

export default function Community() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const { socket, connected, socketReady } = useSocket();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [showRoomSelection, setShowRoomSelection] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newsItems, setNewsItems] = useState<NewsItem[]>([]);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  // const [showNews, setShowNews] = useState(false); // Reserved for future use
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());
  const [isTyping, setIsTyping] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileType, setFileType] = useState<'image' | 'document' | 'video' | 'audio' | null>(null);
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [videoRecorder, setVideoRecorder] = useState<MediaRecorder | null>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<Set<string>>(new Set());
  const [messageSearchQuery, setMessageSearchQuery] = useState('');
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [page, setPage] = useState(1);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showNewsModal, setShowNewsModal] = useState(false);
  const [editingNews, setEditingNews] = useState<any>(null);
  const [newsEditForm, setNewsEditForm] = useState({
    title: '',
    description: '',
    category: 'market',
    content: '',
    link: '',
  });
  const [submittingNews, setSubmittingNews] = useState(false);

  // Debug: Log when editingNews changes
  useEffect(() => {
    if (editingNews !== null) {
      console.log('editingNews state changed:', editingNews);
    }
  }, [editingNews]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, authLoading, router]);

  useEffect(() => {
    if (user) {
      loadRooms();
      loadNews(); // Auto-load updates for all users including students
      if (connected) {
        setupSocketListeners();
        // Notify that user is online
        socket?.emit('userOnline');
      }
    }
    return () => {
      if (socket) {
        socket.off('message');
        socket.off('typing');
        socket.off('stopTyping');
        socket.off('userOnline');
        socket.off('userOffline');
        socket.off('userJoined');
        socket.off('messageDeleted');
        socket.off('userLeft');
      }
    };
  }, [user, connected, socket, user?.learningLevel, user?.role]);

  // CRITICAL FIX: Students must join "community_global" immediately on mount
  // Same room as admin/instructor - no placeholder rooms
  useEffect(() => {
    if (!socket || !user) return;

    // For students, always join "community_global" room immediately
    // This ensures students use the same room as admin/instructor
    if (user.role === 'student') {
      console.log('Student joining community_global room');
      console.log('Socket connected:', socket.connected);
      socket.emit('joinRoom', { roomId: 'community_global' });
    }
  }, [socket, user]);

  useEffect(() => {
    if (selectedRoom) {
      const roomIdStr = selectedRoom._id?.toString() || selectedRoom._id;
      
      // CRITICAL FIX: For students, use "community_global" instead of placeholder rooms
      // Students must join the same room as admin/instructor
      let actualRoomId = roomIdStr;
      if (user?.role === 'student' && typeof roomIdStr === 'string' && roomIdStr.startsWith('placeholder-')) {
        // Replace placeholder with community_global for students
        actualRoomId = 'community_global';
        console.log('Student: Replacing placeholder room with community_global');
      }

      setShowRoomSelection(false);
      setPage(1);
      setHasMoreMessages(true);
      // Clear previous messages and load messages for this specific room
      setMessages([]);
      // Load all messages for this room
      // For students using community_global, we need to handle this differently
      if (user?.role === 'student' && actualRoomId === 'community_global') {
        // For students, load messages from the Beginner room (which is the default accessible room)
        // But join the community_global socket room
        const beginnerRoom = rooms.find(r => r.name === 'Beginner' && !r._id.toString().startsWith('placeholder-'));
        if (beginnerRoom) {
          loadMessages(beginnerRoom._id.toString(), 1, false);
        } else {
          // If no Beginner room found, just join the socket room
          // Messages will come via socket
          setMessages([]);
        }
      } else {
        loadMessages(actualRoomId, 1, false);
      }
      // Join the room safely (will retry if socket not ready)
      joinRoomSafely(actualRoomId);
    }
    return () => {
      if (selectedRoom) {
        // Leave room when switching away - same for all roles
        const roomIdStr = selectedRoom._id?.toString() || selectedRoom._id;
        let actualRoomId = roomIdStr;
        if (user?.role === 'student' && typeof roomIdStr === 'string' && roomIdStr.startsWith('placeholder-')) {
          actualRoomId = 'community_global';
        }
        leaveRoom(actualRoomId);
      }
    };
  }, [selectedRoom?._id, user, rooms]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container && selectedRoom) {
      const scrollHandler = () => handleScroll();
      container.addEventListener('scroll', scrollHandler);
      return () => container.removeEventListener('scroll', scrollHandler);
    }
  }, [selectedRoom, page, loadingMessages, hasMoreMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const setupSocketListeners = () => {
    if (!socket) return;

    // Handle socket errors (e.g., access denied)
    socket.on('error', (data: { message: string }) => {
      console.error('Socket error:', data.message);
      setToastMessage(data.message || 'An error occurred');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    });

    socket.on('message', (message: Message) => {
      // CRITICAL FIX: For students, accept messages from "community_global" room
      // Students use the same room as admin/instructor
      const messageRoomId = message.roomId?.toString() || message.roomId;
      const selectedRoomId = selectedRoom?._id?.toString() || selectedRoom?._id;
      
      // Check if message is for current room
      const isForCurrentRoom = 
        (selectedRoom && (messageRoomId === selectedRoomId || messageRoomId === selectedRoom._id)) ||
        // For students, also accept messages from community_global when viewing any room
        (user?.role === 'student' && messageRoomId === 'community_global' && selectedRoom);
      
      if (isForCurrentRoom) {
        // Add message to state, avoiding duplicates
        setMessages((prev) => {
          // Check if message already exists (to avoid duplicates from optimistic update)
          const exists = prev.some(m => m._id === message._id);
          if (exists) {
            // Update existing message (in case Socket.io version has more data)
            return prev.map(m => m._id === message._id ? message : m);
          }
          return [...prev, message];
        });
        // Scroll to bottom when new message arrives
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
      // Update room's last message
      setRooms((prev) =>
        prev.map((room) =>
          room._id === message.roomId || room._id.toString() === message.roomId
            ? { ...room, lastMessage: message, unreadCount: room._id === selectedRoom?._id ? 0 : (room.unreadCount || 0) + 1 }
            : room
        )
      );
    });

    socket.on('userJoined', (data: { userId: string; userName: string; roomId?: string }) => {
      // Update online users count for the specific room
      if (data.roomId && selectedRoom && (data.roomId === selectedRoom._id.toString() || data.roomId === selectedRoom._id)) {
        setOnlineUsers((prev) => new Set(prev).add(data.userId));
      }
    });

    socket.on('userLeft', (data: { userId: string; roomId?: string }) => {
      // Update online users count for the specific room (level-specific)
      if (data.roomId && selectedRoom && (data.roomId === selectedRoom._id.toString() || data.roomId === selectedRoom._id?.toString())) {
        setOnlineUsers((prev) => {
          const newSet = new Set(prev);
          newSet.delete(data.userId);
          return newSet;
        });
      }
    });

    socket.on('typing', (data: { roomId: string; userId: string; userName: string }) => {
      // Only show typing indicator for the currently selected room (level-specific)
      const selectedRoomId = selectedRoom?._id?.toString();
      const dataRoomId = data.roomId?.toString() || data.roomId;
      if (selectedRoom && selectedRoomId === dataRoomId && data.userId !== user?.id) {
        setTypingUsers((prev) => new Set(prev).add(data.userName));
      }
    });

    socket.on('stopTyping', (data: { roomId: string; userId: string; userName?: string }) => {
      // Only handle stop typing for the currently selected room (level-specific)
      const selectedRoomId = selectedRoom?._id?.toString();
      const dataRoomId = data.roomId?.toString() || data.roomId;
      if (selectedRoom && selectedRoomId === dataRoomId) {
        setTypingUsers((prev) => {
          const newSet = new Set(prev);
          if (data.userName) {
            newSet.delete(data.userName);
          }
          return newSet;
        });
      }
    });

    socket.on('userOnline', (data: { userId: string }) => {
      setOnlineUsers((prev) => new Set(prev).add(data.userId));
      setRooms((prev) =>
        prev.map((room) =>
          room.participants?.includes(data.userId)
            ? { ...room, isOnline: true }
            : room
        )
      );
    });

    socket.on('userOffline', (data: { userId: string; lastSeen: Date }) => {
      setOnlineUsers((prev) => {
        const newSet = new Set(prev);
        newSet.delete(data.userId);
        return newSet;
      });
      setRooms((prev) =>
        prev.map((room) =>
          room.participants?.includes(data.userId)
            ? { ...room, isOnline: false, lastSeen: data.lastSeen }
            : room
        )
      );
    });

    // Handle message deletion
    socket.on('messageDeleted', (data: { messageId: string; roomId: string }) => {
      const currentRoomId = selectedRoom?._id?.toString() || selectedRoom?._id;
      const dataRoomId = data.roomId?.toString() || data.roomId;
      
      // Remove message if it's in the current room
      if (selectedRoom && (dataRoomId === currentRoomId || dataRoomId === selectedRoom._id?.toString())) {
        setMessages((prev) => {
          const filtered = prev.filter((m) => {
            const msgId = m._id?.toString() || m._id;
            return msgId !== data.messageId;
          });
          return filtered;
        });
      }
      
      // Update room's last message if the deleted message was the last one
      setRooms((prev) =>
        prev.map((room) => {
          const roomId = room._id?.toString() || room._id;
          if (roomId === dataRoomId || roomId === data.roomId) {
            // If the deleted message was the last message, clear it
            const lastMsgId = room.lastMessage?._id?.toString() || room.lastMessage?._id;
            if (lastMsgId === data.messageId) {
              return { ...room, lastMessage: undefined };
            }
          }
          return room;
        })
      );
    });
  };

  const loadRooms = async () => {
    try {
      const data = await apiClient.get('/community/rooms');
      
      // Ensure data is an array
      if (!Array.isArray(data)) {
        console.error('Invalid rooms data:', data);
        setRooms([]);
        return;
      }
      
      // Get all three main rooms (Beginner, Intermediate, Advanced)
      const mainRooms = data.filter((room: Room) => 
        room.type === 'global' && ['Beginner', 'Intermediate', 'Advanced'].includes(room.name)
      );
      
      // If no rooms returned from API, ensure we have at least the Beginner room
      // The API should create rooms, but if it doesn't, we'll show placeholders
      const roomNames = ['Beginner', 'Intermediate', 'Advanced'];
      const visibleRooms: Room[] = roomNames.map((name) => {
        const existingRoom = mainRooms.find((r) => r.name === name);
        if (existingRoom) {
          return existingRoom;
        }
        // Create placeholder room if API didn't return it
        // This ensures students always see at least the Beginner room
        return {
          _id: `placeholder-${name}`,
          name,
          type: 'global' as const,
          description: name === 'Beginner' 
            ? 'Perfect for newcomers learning basic concepts, market introductions, and simple analysis.'
            : name === 'Intermediate'
            ? 'For mid-level traders sharing strategies, chart analysis, and trading setups.'
            : 'For experienced traders discussing deep technical analysis, macro news, and advanced strategies.',
          isLocked: false, // Will be set correctly by API, but default to unlocked
          participants: [],
        };
      });
      
      // For students, the API already marks rooms as locked based on their learning level
      // We just need to show all rooms - locked ones will be disabled
      setRooms(visibleRooms);
    } catch (error: any) {
      console.error('Failed to load rooms:', error);
      // Set empty array on error to prevent blank page
      setRooms([]);
      // Show error message to user
      setToastMessage('Failed to load rooms. Please refresh the page.');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
    }
  };

  const loadMessages = async (roomId: string, pageNum: number = 1, append: boolean = false) => {
    // Skip loading messages for placeholder rooms (not valid ObjectIds)
    if (roomId.startsWith('placeholder-')) {
      console.warn('Cannot load messages for placeholder room:', roomId);
      setLoadingMessages(false);
      setMessages([]);
      return;
    }
    
    try {
      setLoadingMessages(true);
      // Load messages for this specific room (level-specific)
      const data = await apiClient.get<Message[]>(`/community/messages?roomId=${roomId}&page=${pageNum}&limit=50`);
      
      if (append) {
        // When loading older messages, prepend them
        setMessages((prev) => {
          // Filter out duplicates and ensure messages are for this room (level-specific)
          const existingIds = new Set(prev.map(m => m._id));
          const newMessages = data.filter((m: Message) => {
            const isForThisRoom = m.roomId === roomId || m.roomId?.toString() === roomId;
            return !existingIds.has(m._id) && isForThisRoom;
          });
          return [...newMessages, ...prev];
        });
        // Maintain scroll position
        const container = messagesContainerRef.current;
        if (container) {
          const scrollHeight = container.scrollHeight;
          setTimeout(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - scrollHeight;
            }
          }, 0);
        }
      } else {
        // Replace all messages for this room (level-specific)
        // Filter to ensure only messages for this specific room are shown
        const roomMessages = data.filter((m: Message) => {
          const messageRoomId = m.roomId?.toString() || m.roomId;
          return messageRoomId === roomId || messageRoomId === selectedRoom?._id?.toString();
        });
        setMessages(roomMessages);
        // Scroll to bottom when loading new room
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
      setHasMoreMessages(data.length === 50);
      // Mark messages as read for this room
      await apiClient.post(`/community/messages/read`, { roomId: roomId.toString() });
    } catch (error: any) {
      console.error('Failed to load messages:', error);
      const errorMessage = error.response?.data?.error || 'Failed to load messages';
      if (error.response?.status === 403) {
        // Access denied - room is locked
        setToastMessage(errorMessage);
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
        // Go back to room selection
        setSelectedRoom(null);
        setShowRoomSelection(true);
      }
    } finally {
      setLoadingMessages(false);
    }
  };

  // Load more messages when scrolling to top
  const handleScroll = () => {
    if (!messagesContainerRef.current || !selectedRoom || loadingMessages || !hasMoreMessages) return;

    const container = messagesContainerRef.current;
    // Load more when user scrolls near the top (within 100px)
    if (container.scrollTop < 100) {
      const nextPage = page + 1;
      setPage(nextPage);
      loadMessages(selectedRoom._id.toString(), nextPage, true);
    }
  };

  const loadNews = async () => {
    try {
      const data = await apiClient.get('/community/news');
      // Ensure data is an array
      if (Array.isArray(data)) {
        setNewsItems(data);
      } else {
        setNewsItems([]);
      }
    } catch (error) {
      console.error('Failed to load news:', error);
      setNewsItems([]); // Ensure empty array on error
    }
  };

  // Mark all news items as read when modal is opened
  const markAllNewsAsRead = async () => {
    try {
      const unreadNews = newsItems.filter((item) => !item.isRead);
      // Mark each unread news item as read
      await Promise.all(
        unreadNews.map((item) =>
          apiClient.post('/community/news/mark-read', { newsId: item._id }).catch((err) => {
            console.error(`Failed to mark news ${item._id} as read:`, err);
          })
        )
      );
      // Reload news to get updated read status
      await loadNews();
    } catch (error) {
      console.error('Failed to mark news as read:', error);
    }
  };

  // Calculate unread news count
  const unreadNewsCount = newsItems.filter((item) => !item.isRead).length;

  // Track pending room joins for retry after connection
  const pendingRoomJoinsRef = useRef<Set<string>>(new Set());

  // Safe room join - Always allow join, rooms are created automatically by socket.io
  // CRITICAL: Students must join "community_global" - same room as admin/instructor
  const joinRoomSafely = (roomId: string) => {
    let roomIdStr = roomId?.toString() || roomId;
    
    // CRITICAL FIX: For students, replace placeholder rooms with "community_global"
    // Students must join the same room as admin/instructor
    if (user?.role === 'student' && typeof roomIdStr === 'string' && roomIdStr.startsWith('placeholder-')) {
      roomIdStr = 'community_global';
      console.log('Student: Replacing placeholder room with community_global');
    }
    
    // Debug log for students
    if (user?.role === 'student') {
      console.log('Student joining room:', roomIdStr);
      console.log('Socket connected:', socket?.connected);
    }

    // Join room immediately if socket exists - room is created automatically
    // No blocking logic - rooms are auto-created by socket.io
    if (socket) {
      socket.emit('joinRoom', { roomId: roomIdStr });
      if (user?.role === 'student') {
        console.log('Student joined room:', roomIdStr);
      } else {
        console.log('Joined room:', roomIdStr);
      }
      pendingRoomJoinsRef.current.delete(roomIdStr);
    } else {
      // Store for retry after socket connects
      pendingRoomJoinsRef.current.add(roomIdStr);
      console.log('Socket not available, queuing room join for:', roomIdStr);
    }
  };

  // Retry pending room joins when socket connects
  useEffect(() => {
    if (socket && pendingRoomJoinsRef.current.size > 0) {
      const pendingRooms = Array.from(pendingRoomJoinsRef.current);
      console.log('Retrying pending room joins:', pendingRooms);
      pendingRooms.forEach((roomId) => {
        joinRoomSafely(roomId);
      });
    }
  }, [socket, rooms]);

  // Listen for room_joined confirmation
  useEffect(() => {
    if (!socket) return;

    const handleRoomJoined = (data: { roomId: string }) => {
      console.log('Room joined confirmed:', data.roomId);
      // Room is ready, can send messages
    };

    socket.on('room_joined', handleRoomJoined);

    return () => {
      socket.off('room_joined', handleRoomJoined);
    };
  }, [socket]);

  const joinRoom = (roomId: string) => {
    joinRoomSafely(roomId);
  };

  const leaveRoom = (roomId: string) => {
    if (socket && socketReady) {
      const roomIdStr = roomId?.toString() || roomId;
      // Skip placeholder rooms (log warning only)
      if (typeof roomIdStr === 'string' && roomIdStr.startsWith('placeholder-')) {
        console.warn('Skipping leave for placeholder room:', roomIdStr);
        return;
      }
      socket.emit('leaveRoom', { roomId: roomIdStr });
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate inputs
    if (!selectedRoom) {
      console.error('No room selected');
      setToastMessage('Please select a room to send messages.');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
      return;
    }
    
    // CRITICAL FIX: Remove blocking logic for placeholder rooms
    // Messages are sent via HTTP POST, socket.io handles broadcasting
    // Allow sending even if room appears to be placeholder - API will handle it
    const roomIdStr = selectedRoom._id?.toString() || selectedRoom._id;
    // Removed placeholder check - allow message sending
    // if (typeof roomIdStr === 'string' && roomIdStr.startsWith('placeholder-')) {
    //   console.warn('Cannot send message to placeholder room:', roomIdStr);
    //   setToastMessage('This room is not available yet. Please refresh the page.');
    //   setShowToast(true);
    //   setTimeout(() => setShowToast(false), 3000);
    //   return;
    // }
    
    if (!input.trim() && !selectedFile) {
      console.warn('Cannot send empty message');
      return;
    }
    
    // Messages can be sent via HTTP POST even if WebSocket is not connected
    // WebSocket is only needed for real-time updates, not for sending messages
    // Room is created automatically when first user joins, no need to wait

    // Check if room is locked
    if (selectedRoom.isLocked) {
      setToastMessage('This group unlocks when you complete the previous level.');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
      return;
    }

    // If there's a file selected, upload it instead of sending text
    if (selectedFile && fileType) {
      await handleFileUpload();
      return;
    }

    const messageContent = input.trim();
    setInput(''); // Clear input immediately for better UX
    setIsTyping(false);
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    try {
      console.log('Sending message:', { roomId: roomIdStr, content: messageContent });
      
      // Send message to API - it will broadcast to all room members via Socket.io
      // For students, use the actual room ID (Beginner room) for API, but socket room is "community_global"
      const response = await apiClient.post<{ message: Message }>('/community/messages', {
        roomId: roomIdStr,
        type: 'text',
        content: messageContent,
      });
      
      console.log('Message sent successfully:', response);

      // Track chat message sent event in GA4
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'chat_message_sent', {
          event_category: 'community',
          room_id: selectedRoom._id.toString(),
        });
      }
      
      // Optimistically add message for sender immediately (before Socket.io event)
      if (response?.message) {
        const optimisticMessage: Message = {
          ...response.message,
          roomId: selectedRoom._id.toString(),
          senderId: user?.id || '',
          senderName: user?.name || 'You',
          senderPhoto: (user as any)?.profilePhoto || null,
          delivered: true,
          seenBy: [user?.id || ''],
        };
        
        // Add to messages state immediately for sender
        setMessages((prev) => {
          // Check if message already exists (avoid duplicates)
          const exists = prev.some(m => m._id === optimisticMessage._id);
          if (exists) return prev;
          return [...prev, optimisticMessage];
        });
        
        // Scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
      
      // Message will also appear via Socket.io broadcast to all room members (including sender)
      // The Socket.io event will handle adding it for receivers and updating for sender
    } catch (error: any) {
      console.error('Failed to send message:', error);
      let errorMessage = 'Failed to send message';
      
      if (error.response) {
        errorMessage = error.response?.data?.error || `Error ${error.response.status}: ${error.response.statusText}`;
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      setToastMessage(errorMessage);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 5000);
      // Restore input on error
      setInput(messageContent);
    }
  };

  const handleTyping = () => {
    if (!selectedRoom || !connected || !socket) return;

    if (!isTyping) {
      setIsTyping(true);
      socket.emit('typing', { roomId: selectedRoom._id.toString() });
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      setIsTyping(false);
      socket.emit('stopTyping', { roomId: selectedRoom._id.toString() });
    }, 1000);
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!confirm('Are you sure you want to delete this message?')) return;

    // Optimistic update: Remove message immediately from UI
    setMessages((prev) => prev.filter((m) => m._id !== messageId));
    
    // Update room's last message if needed
    if (selectedRoom) {
      setRooms((prev) =>
        prev.map((room) => {
          if (room._id === selectedRoom._id || room._id.toString() === selectedRoom._id.toString()) {
            if (room.lastMessage?._id === messageId) {
              return { ...room, lastMessage: undefined };
            }
          }
          return room;
        })
      );
    }

    try {
      await apiClient.delete(`/community/messages/${messageId}`);
      // The Socket.io event will handle removing it from the UI for other users
      setToastMessage('Message deleted');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (error: any) {
      console.error('Failed to delete message:', error);
      const errorMessage = error.response?.data?.error || 'Failed to delete message';
      setToastMessage(errorMessage);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
      
      // Revert optimistic update on error - reload messages
      if (selectedRoom) {
        loadMessages(selectedRoom._id.toString(), 1);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Determine file type
    if (file.type.startsWith('image/')) {
      setFileType('image');
    } else if (file.type.startsWith('video/')) {
      setFileType('video');
    } else if (file.type.startsWith('audio/')) {
      setFileType('audio');
    } else {
      setFileType('document');
    }

    setSelectedFile(file);
  };

  const handleFileUpload = async () => {
    if (!selectedRoom || !selectedFile || !fileType) return;

    const fileToUpload = selectedFile;
    const fileTypeToUpload = fileType;
    
    // Clear file input immediately
    setSelectedFile(null);
    setFileType(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    // Reset recording states
    setRecording(false);
    setRecordingVideo(false);
    setMediaRecorder(null);
    setVideoRecorder(null);
    if (videoStream) {
      videoStream.getTracks().forEach((track) => track.stop());
      setVideoStream(null);
    }

    try {
      const formData = new FormData();
      formData.append('file', fileToUpload);
      formData.append('roomId', selectedRoom._id.toString()); // Level-specific room
      formData.append('type', fileTypeToUpload);

      // Upload file and get message response
      const response = await apiClient.post<{ message: Message }>('/community/messages/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });
      
      // Optimistically add message for sender immediately (before Socket.io event)
      if (response?.message) {
        const optimisticMessage: Message = {
          ...response.message,
          roomId: selectedRoom._id.toString(),
          senderId: user?.id || '',
          senderName: user?.name || 'You',
          senderPhoto: (user as any)?.profilePhoto || null,
          delivered: true,
          seenBy: [user?.id || ''],
        };
        
        // Add to messages state immediately for sender
        setMessages((prev) => {
          // Check if message already exists (avoid duplicates)
          const exists = prev.some(m => m._id === optimisticMessage._id);
          if (exists) return prev;
          return [...prev, optimisticMessage];
        });
        
        // Scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
      
      // Message will also appear via Socket.io broadcast to all room members (including sender)
    } catch (error) {
      console.error('Failed to upload file:', error);
      // Restore file on error
      setSelectedFile(fileToUpload);
      setFileType(fileTypeToUpload);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const file = new File([blob], 'audio-message.webm', { type: 'audio/webm' });
        setSelectedFile(file);
        setFileType('audio');
        stream.getTracks().forEach((track) => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setRecording(true);
    } catch (error) {
      console.error('Failed to start recording:', error);
      alert('Microphone access denied. Please enable microphone permissions.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && recording) {
      mediaRecorder.stop();
      setRecording(false);
      setMediaRecorder(null);
    }
  };

  // Start video recording from camera
  const startVideoRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const file = new File([blob], 'video-message.webm', { type: 'video/webm' });
        setSelectedFile(file);
        setFileType('video');
        stream.getTracks().forEach((track) => track.stop());
        setVideoStream(null);
      };

      recorder.start();
      setVideoRecorder(recorder);
      setVideoStream(stream);
      setRecordingVideo(true);
    } catch (error) {
      console.error('Failed to start video recording:', error);
      alert('Camera/microphone access denied. Please enable permissions.');
    }
  };

  // Stop video recording
  const stopVideoRecording = () => {
    if (videoRecorder && recordingVideo) {
      videoRecorder.stop();
      setRecordingVideo(false);
      setVideoRecorder(null);
      if (videoStream) {
        videoStream.getTracks().forEach((track) => track.stop());
        setVideoStream(null);
      }
    }
  };

  const handleReaction = async (messageId: string, emoji: string) => {
    try {
      await apiClient.post(`/community/messages/${messageId}/reaction`, { emoji });
      // Update local state optimistically
      setMessages((prev) =>
        prev.map((msg) =>
          msg._id === messageId
            ? {
                ...msg,
                reactions: [
                  ...(msg.reactions || []),
                  { emoji, userId: user?.id || '', userName: user?.name || 'You' },
                ],
              }
            : msg
        )
      );
    } catch (error) {
      console.error('Failed to add reaction:', error);
    }
  };

  // Common emojis organized by category
  const emojiCategories = {
    'Smileys & People': ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓'],
    'Gestures & Body': ['👋', '🤚', '🖐', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁', '👅', '👄'],
    'Objects & Symbols': ['💯', '🔢', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️'],
    'Food & Drink': ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶', '🌽', '🥕', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🥞', '🥓', '🥩', '🍗', '🍖', '🌭', '🍔', '🍟', '🍕', '🥪', '🥙', '🌮', '🌯', '🥗', '🥘', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🥠', '🥡', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕️', '🍵', '🥤', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🍾', '🧃', '🧉', '🧊'],
    'Activities & Sports': ['⚽️', '🏀', '🏈', '⚾️', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🏓', '🏸', '🥅', '🏒', '🏑', '🏏', '🥍', '🏹', '🎣', '🥊', '🥋', '🎽', '🛹', '🛷', '⛸', '🥌', '🎿', '⛷', '🏂', '🏋️', '🤼', '🤸', '🤺', '⛹️', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖', '🏵', '🎗', '🎫', '🎟', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♟', '🎯', '🎳', '🎮', '🎰', '🧩'],
    'Travel & Places': ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍', '🛵', '🚲', '🛴', '🛹', '🛼', '🚁', '🛸', '✈️', '🛫', '🛬', '🛩', '💺', '🚀', '🚂', '🚃', '🚄', '🚅', '🚆', '🚇', '🚈', '🚉', '🚊', '🚝', '🚞', '🚟', '🚠', '🚡', '⛱', '🎢', '🎡', '🎠', '⛲', '⛰', '🏔', '🗻', '🏕', '🏖', '🏜', '🏝', '🏞', '🏟', '🏛', '🏗', '🧱', '🏘', '🏚', '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '🗼', '🗽', '⛪', '🕌', '🛕', '🕍', '⛩', '🕋', '⛲', '⛺', '🌁', '🌃', '🏙', '🌄', '🌅', '🌆', '🌇', '🌉', '♨️', '🎠', '🎡', '🎢', '💈', '🎪', '🚂', '🚃', '🚄', '🚅', '🚆', '🚇', '🚈', '🚉', '🚊', '🚝', '🚞', '🚟', '🚠', '🚡', '🚀', '✈️', '🛫', '🛬', '🛩', '💺', '🚁', '🚟', '🚠', '🚡', '⛱', '🎢', '🎡', '🎠', '⛲', '⛰', '🏔', '🗻', '🏕', '🏖', '🏜', '🏝', '🏞', '🏟', '🏛', '🏗', '🧱', '🏘', '🏚', '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏯', '🏰', '🗼', '🗽', '⛪', '🕌', '🛕', '🕍', '⛩', '🕋', '⛲', '⛺', '🌁', '🌃', '🏙', '🌄', '🌅', '🌆', '🌇', '🌉', '♨️', '🎠', '🎡', '🎢', '💈', '🎪'],
  };

  const handleEmojiClick = (emoji: string) => {
    const input = inputRef.current;
    if (input) {
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const newValue = input.value.substring(0, start) + emoji + input.value.substring(end);
      setInput(newValue);
      // Set cursor position after emoji
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + emoji.length, start + emoji.length);
      }, 0);
    } else {
      setInput((prev) => prev + emoji);
    }
    setShowEmojiPicker(false);
  };

  // Close emoji picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(event.target as Node)) {
        setShowEmojiPicker(false);
      }
    };

    if (showEmojiPicker) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showEmojiPicker]);

  // Filter rooms based on search query (role-based filtering already done in loadRooms)
  const filteredRooms = rooms.filter((room) =>
    room.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter messages to ensure they're level-specific (only show messages for selected room)
  const filteredMessages = (messageSearchQuery
    ? messages.filter((message) =>
        message.content?.toLowerCase().includes(messageSearchQuery.toLowerCase())
      )
    : messages
  ).filter((message) => {
    // Ensure message is for the currently selected room (level-specific)
    if (!selectedRoom) return false;
    const messageRoomId = message.roomId?.toString() || message.roomId;
    const selectedRoomId = selectedRoom._id?.toString() || selectedRoom._id;
    return messageRoomId === selectedRoomId;
  });

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  // Room selection view
  if (showRoomSelection && !selectedRoom) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
        <Header />

        <main className="flex-1 pt-20 lg:pt-8 px-4 sm:px-6 lg:px-8 py-8">
          <div className="max-w-6xl mx-auto">
            {/* Back Button */}
            <div className="mb-6">
              <BackButton href="/dashboard" />
            </div>

            <div className="mb-8 flex items-center justify-between">
              <div>
                <h1 className="text-4xl font-display font-bold text-gray-900 dark:text-white mb-2">
                  Community Rooms
                </h1>
                <p className="text-gray-600 dark:text-gray-400">
                  Select a room to join and connect with fellow traders
                </p>
              </div>
              {/* View Updates / Add Update Button - Role-based */}
              {(user?.role === 'instructor' || user?.role === 'admin' || user?.role === 'superadmin') ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('Add Update button clicked - user role:', user?.role);
                    // Close news modal if open
                    setShowNewsModal(false);
                    // Immediately open create form modal
                    console.log('Setting editingNews to create new news');
                    setEditingNews({ _id: null });
                    setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                    console.log('State updated, modal should open');
                  }}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-md font-semibold text-sm transition-colors flex items-center space-x-2 shadow-md cursor-pointer z-10 relative"
                  style={{ pointerEvents: 'auto' }}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Add Update</span>
                </button>
              ) : (
                <button
                  onClick={async () => {
                    // Load fresh news data and open modal
                    await loadNews();
                    // Mark all news as read when opening the modal
                    await markAllNewsAsRead();
                    setShowNewsModal(true);
                  }}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-sm transition-colors flex items-center space-x-2 shadow-md"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                  <span>View Updates</span>
                  {unreadNewsCount > 0 && (
                    <span className="bg-white text-blue-600 rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">
                      {unreadNewsCount > 9 ? '9+' : unreadNewsCount}
                    </span>
                  )}
                </button>
              )}
            </div>

            {/* Room Selection Cards - Role-based display */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Show rooms based on role: Students see only their level, Admins/Instructors see all */}
              {rooms.length === 0 ? (
                <div className="col-span-full text-center py-12">
                  <p className="text-gray-500 dark:text-gray-400">No rooms available. Please contact support.</p>
                </div>
              ) : (
                rooms.map((room) => {
                  const onlineCount = room.participants?.filter((p) => onlineUsers.has(p)).length || 0;
                  const isLocked = room.isLocked || false;
                  // const userRole = user?.role; // Reserved for future use
                  
                  // Students can see all rooms but locked ones are disabled
                  // This ensures students can see the community page UI normally
                  
                  return (
                    <div
                      key={room._id}
                      className={`bg-white dark:bg-gray-800 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 transition-all ${
                        isLocked 
                          ? 'opacity-50 cursor-not-allowed' 
                          : 'hover:shadow-xl cursor-pointer transform hover:scale-105'
                      }`}
                      onClick={() => {
                        if (isLocked) {
                          setToastMessage('This group unlocks when you complete the previous level.');
                          setShowToast(true);
                          setTimeout(() => setShowToast(false), 3000);
                        } else {
                          setSelectedRoom(room);
                        }
                      }}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-2xl relative">
                          {room.name.charAt(0)}
                          {isLocked && (
                            <div className="absolute -top-1 -right-1 bg-gray-600 dark:bg-gray-400 rounded-full p-1">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          {!isLocked && (
                            <div className="flex items-center space-x-1 text-sm text-gray-600 dark:text-gray-400">
                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              <span>{onlineCount} online</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 flex items-center">
                        {room.name} Room
                        {isLocked && (
                          <svg className="w-5 h-5 ml-2 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                        )}
                      </h3>
                      <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
                        {isLocked 
                          ? 'Complete the previous level to unlock this group.'
                          : room.name === 'Beginner' && 'Perfect for newcomers learning basic concepts, market introductions, and simple analysis.'
                          || room.name === 'Intermediate' && 'For mid-level traders sharing strategies, chart analysis, and trading setups.'
                          || room.name === 'Advanced' && 'For experienced traders discussing deep technical analysis, macro news, and advanced strategies.'
                        }
                      </p>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isLocked) {
                            setToastMessage('This group unlocks when you complete the previous level.');
                            setShowToast(true);
                            setTimeout(() => setShowToast(false), 3000);
                          } else {
                            setSelectedRoom(room);
                          }
                        }}
                        disabled={isLocked}
                        className={`w-full px-6 py-3 rounded-xl font-semibold transition-colors shadow-md ${
                          isLocked
                            ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                            : 'bg-primary-600 hover:bg-primary-700 text-white'
                        }`}
                      >
                        {isLocked ? 'Locked' : 'Join Room'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </main>

        {/* Edit/Create News Modal - Room Selection View */}
        {editingNews && (
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center justify-center p-4" 
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setEditingNews(null);
                setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
              }
            }}
          >
            <div 
              className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col relative z-[101]"
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'relative', zIndex: 101 }}
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                    {editingNews._id ? (
                      <svg className="w-6 h-6 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                      </svg>
                    )}
                    {editingNews._id ? 'Edit Forex News Update' : 'Post Forex News Update'}
                  </h2>
                  <button
                    onClick={() => {
                      setEditingNews(null);
                      setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                    }}
                    className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Edit Form */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newsEditForm.title || !newsEditForm.description || !newsEditForm.category) {
                    setToastMessage('Please fill in all required fields');
                    setShowToast(true);
                    setTimeout(() => setShowToast(false), 3000);
                    return;
                  }
                  setSubmittingNews(true);
                  try {
                    if (editingNews._id) {
                      await apiClient.put(`/community/news/${editingNews._id}`, newsEditForm);
                      setToastMessage('News updated successfully!');
                    } else {
                      await apiClient.post('/community/news', newsEditForm);
                      setToastMessage('News posted successfully!');
                    }
                    setShowToast(true);
                    setTimeout(() => setShowToast(false), 3000);
                    setEditingNews(null);
                    setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                    await loadNews();
                  } catch (error: any) {
                    setToastMessage(error.response?.data?.error || error.message || `Failed to ${editingNews._id ? 'update' : 'post'} news`);
                    setShowToast(true);
                    setTimeout(() => setShowToast(false), 3000);
                  } finally {
                    setSubmittingNews(false);
                  }
                }}
                className="flex-1 overflow-y-auto p-6 space-y-4"
              >
                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={newsEditForm.title}
                    onChange={(e) => setNewsEditForm({ ...newsEditForm, title: e.target.value })}
                    placeholder="e.g., NFP Results: 200K Jobs Added"
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={newsEditForm.description}
                    onChange={(e) => setNewsEditForm({ ...newsEditForm, description: e.target.value })}
                    placeholder="Brief summary of the news update"
                    rows={3}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={newsEditForm.category}
                    onChange={(e) => setNewsEditForm({ ...newsEditForm, category: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  >
                    <option value="market">Market News</option>
                    <option value="nfp">NFP Results</option>
                    <option value="cpi">CPI Data</option>
                    <option value="fomc">FOMC Updates</option>
                    <option value="announcement">Announcement</option>
                    <option value="other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Content (Optional)
                  </label>
                  <textarea
                    value={newsEditForm.content}
                    onChange={(e) => setNewsEditForm({ ...newsEditForm, content: e.target.value })}
                    placeholder="Detailed content or analysis"
                    rows={5}
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    Link (Optional)
                  </label>
                  <input
                    type="url"
                    value={newsEditForm.link}
                    onChange={(e) => setNewsEditForm({ ...newsEditForm, link: e.target.value })}
                    placeholder="https://example.com/article"
                    className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingNews(null);
                      setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                    }}
                    className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold transition-colors hover:bg-gray-300 dark:hover:bg-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingNews}
                    className={`px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors ${
                      submittingNews ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {submittingNews ? (editingNews._id ? 'Updating...' : 'Posting...') : (editingNews._id ? 'Update News' : 'Post News')}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />

      {/* 3-Column Layout: Left (Rooms), Center (Chat), Right (Updates) */}
      {/* FIX: Ensure proper height constraints for mobile - use full viewport height minus header */}
      <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0 h-[calc(100vh-5rem)] lg:h-auto">
        {/* LEFT COLUMN: Rooms Sidebar + User Profile */}
        <div className="w-80 lg:w-96 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col hidden md:flex">
          {/* Header */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-primary-50 dark:bg-primary-900/20">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">Community</h1>
              <button
                onClick={() => setShowRoomSelection(true)}
                className="p-2 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors"
                title="Back to Room Selection"
              >
                <svg className="w-5 h-5 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                </svg>
              </button>
            </div>

            {/* Search */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search rooms..."
                className="w-full px-4 py-2 pl-10 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              <svg className="w-5 h-5 absolute left-3 top-2.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>


          {/* Room List */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-2">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 px-2">Trading Rooms</h3>
              {filteredRooms
                .filter((room) => room.type === 'global' && ['Beginner', 'Intermediate', 'Advanced'].includes(room.name))
                .map((room) => {
                  const onlineCount = room.participants?.filter((p) => onlineUsers.has(p)).length || 0;
                  const isLocked = room.isLocked || false;
                  return (
                    <div
                      key={room._id}
                      onClick={() => {
                        if (isLocked) {
                          setToastMessage('This group unlocks when you complete the previous level.');
                          setShowToast(true);
                          setTimeout(() => setShowToast(false), 3000);
                        } else {
                          setSelectedRoom(room);
                        }
                      }}
                      className={`p-3 mb-2 rounded-xl transition-colors ${
                        isLocked
                          ? 'opacity-50 cursor-not-allowed'
                          : 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      } ${
                        selectedRoom?._id === room._id ? 'bg-primary-50 dark:bg-primary-900/20 border-2 border-primary-300 dark:border-primary-700' : 'border-2 border-transparent'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className="relative">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold">
                            {room.name.charAt(0)}
                          </div>
                          {isLocked ? (
                            <div className="absolute -top-1 -right-1 bg-gray-600 dark:bg-gray-400 rounded-full p-0.5">
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                            </div>
                          ) : onlineCount > 0 && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center">
                              <span className="text-xs text-white font-bold">{onlineCount}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-gray-900 dark:text-white text-sm flex items-center">
                            {room.name}
                            {isLocked && (
                              <svg className="w-3 h-3 ml-1 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                            )}
                          </h3>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {isLocked ? 'Locked' : onlineCount > 0 ? `${onlineCount} online` : 'No one online'}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* User Profile Section at Bottom */}
          <div className="p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30">
            <div className="flex items-center space-x-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold">
                  {(user as any)?.profilePhoto ? (
                    <img src={(user as any).profilePhoto} alt={user?.name || user?.email || 'User'} className="w-full h-full rounded-full object-cover" />
                  ) : (
                    (user?.name || user?.email || 'U').charAt(0).toUpperCase()
                  )}
                </div>
                {connected && (
                  <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white dark:border-gray-800"></div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                  {user?.name || 'User'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {user?.email || ''}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 capitalize">
                  {user?.role || 'student'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* CENTER COLUMN: Chat Area */}
        {/* FIX: Add min-h-0 to allow flex shrinking and prevent overflow on mobile */}
        {selectedRoom ? (
          <div className="flex-1 flex flex-col bg-gray-100 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 min-h-0 overflow-hidden">
            {/* Chat Header - WhatsApp Style */}
            {/* FIX: Make header responsive - stack elements on mobile if needed */}
            <div className="bg-[#f0f2f5] dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-2 sm:px-4 py-2 sm:py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0 sticky top-0 z-10 shadow-sm flex-shrink-0">
              <div className="flex items-center space-x-2 sm:space-x-3 flex-1 min-w-0 w-full sm:w-auto">
                <button
                  onClick={() => setShowRoomSelection(true)}
                  className="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors mr-2"
                >
                  <svg className="w-6 h-6 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold">
                    {selectedRoom.avatar ? (
                      <img src={selectedRoom.avatar} alt={selectedRoom.name} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      selectedRoom.name.charAt(0).toUpperCase()
                    )}
                  </div>
                  {selectedRoom.type === 'global' && (
                    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white dark:border-gray-800 flex items-center justify-center">
                      <span className="text-xs text-white font-bold">
                        {selectedRoom.participants?.filter((p) => onlineUsers.has(p)).length || 0}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-gray-900 dark:text-white">{selectedRoom.name} Room</h2>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {selectedRoom.type === 'global' 
                      ? `${selectedRoom.participants?.filter((p) => onlineUsers.has(p)).length || 0} members online`
                      : selectedRoom.isOnline ? 'Online' : selectedRoom.lastSeen ? `Last seen ${formatDistanceToNow(new Date(selectedRoom.lastSeen), { addSuffix: true })}` : 'Offline'}
                  </p>
                </div>
              </div>
              {/* FIX: Make header actions responsive - stack on mobile, flex on larger screens */}
              <div className="flex items-center space-x-1 sm:space-x-2 w-full sm:w-auto flex-shrink-0">
                {/* View Updates / Add Update Button - Role-based */}
                {(user?.role === 'instructor' || user?.role === 'admin' || user?.role === 'superadmin') ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log('Add Update button clicked (chat header) - user role:', user?.role);
                      // Close news modal if open
                      setShowNewsModal(false);
                      // Immediately open create form modal
                      console.log('Setting editingNews to create new news (chat header)');
                      setEditingNews({ _id: null });
                      setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                      console.log('State updated, modal should open (chat header)');
                    }}
                    className="px-2 sm:px-3 py-1 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-md font-semibold text-xs transition-colors flex items-center space-x-1 sm:space-x-1.5 shadow-md cursor-pointer z-10 relative flex-shrink-0"
                    style={{ pointerEvents: 'auto' }}
                    title="Add Update"
                  >
                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span className="hidden sm:inline">Add Update</span>
                  </button>
                ) : (
                  <button
                    onClick={async () => {
                      // Load fresh news data and open modal
                      await loadNews();
                      // Mark all news as read when opening the modal
                      await markAllNewsAsRead();
                      setShowNewsModal(true);
                    }}
                    className="px-2 sm:px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-semibold text-xs transition-colors flex items-center space-x-1 sm:space-x-1.5 shadow-md flex-shrink-0"
                    title="View Updates from Admin or Instructors"
                  >
                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                    </svg>
                    <span className="hidden sm:inline">View Updates</span>
                    {unreadNewsCount > 0 && (
                      <span className="bg-white text-blue-600 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold">
                        {unreadNewsCount > 9 ? '9+' : unreadNewsCount}
                      </span>
                    )}
                  </button>
                )}
                {/* FIX: Search Messages - responsive width, prevents overflow on mobile */}
                <div className="relative flex-1 sm:flex-none min-w-0">
                  <input
                    type="text"
                    value={messageSearchQuery}
                    onChange={(e) => setMessageSearchQuery(e.target.value)}
                    placeholder="Search messages..."
                    className="w-full sm:w-32 md:w-40 px-2 sm:px-3 py-1.5 pl-6 sm:pl-8 text-xs sm:text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <svg className="w-3 h-3 sm:w-4 sm:h-4 absolute left-1.5 sm:left-2 top-1.5 sm:top-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* FIX: Messages container - add min-h-0 for proper flex shrinking, responsive padding */}
            <div 
              ref={messagesContainerRef}
              className="flex-1 overflow-y-auto p-2 sm:p-4 space-y-2 bg-[#ece5dd] dark:bg-gray-900 min-h-0"
              style={{
                backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cdefs%3E%3Cpattern id=\'grid\' width=\'100\' height=\'100\' patternUnits=\'userSpaceOnUse\'%3E%3Cpath d=\'M 100 0 L 0 0 0 100\' fill=\'none\' stroke=\'%23e0e0e0\' stroke-width=\'0.5\' opacity=\'0.3\'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width=\'100\' height=\'100\' fill=\'url(%23grid)\'/%3E%3C/svg%3E")',
                backgroundSize: '100px 100px',
              }}
              onScroll={handleScroll}
            >
              {loadingMessages && page > 1 && (
                <div className="flex justify-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                </div>
              )}
              {filteredMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                  <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">No messages yet</p>
                  <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">Start the conversation!</p>
                </div>
              ) : (
                filteredMessages.map((message) => (
                  <MessageBubble
                    key={message._id}
                    message={message}
                    isOwn={message.senderId === user?.id}
                    onReaction={handleReaction}
                    onDelete={handleDeleteMessage}
                  />
                ))
              )}
              {typingUsers.size > 0 && (
                <div className="flex items-center space-x-2 text-gray-500 dark:text-gray-400 text-sm italic">
                  <span>{Array.from(typingUsers).join(', ')}</span>
                  <span>is typing</span>
                  <span className="flex space-x-1">
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* FIX: Input Area - sticky at bottom, responsive padding, prevents cutoff on mobile */}
            <div className="bg-[#f0f2f5] dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-2 sm:p-3 sticky bottom-0 z-10 flex-shrink-0">
              {selectedFile && (
                <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {fileType === 'image' && (
                      <img src={URL.createObjectURL(selectedFile)} alt="Preview" className="w-16 h-16 object-cover rounded" />
                    )}
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{selectedFile.name}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleFileUpload}
                      className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold text-sm transition-colors"
                    >
                      Send
                    </button>
                    <button
                      onClick={() => {
                        setSelectedFile(null);
                        setFileType(null);
                      }}
                      className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* FIX: Form layout - responsive spacing, prevent overflow on mobile */}
              <form onSubmit={handleSendMessage} className="flex items-center gap-1 sm:gap-2 relative min-w-0">
                {/* FIX: Emoji Picker Button - responsive sizing */}
                <div className="relative" ref={emojiPickerRef}>
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className="p-1.5 sm:p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors flex-shrink-0"
                    title="Add emoji"
                  >
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>

                  {/* Emoji Picker Popup */}
                  {showEmojiPicker && (
                    <div className="absolute bottom-full left-0 mb-2 w-80 h-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col">
                      {/* Header */}
                      <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Emoji</h3>
                      </div>

                      {/* Emoji Categories */}
                      <div className="flex-1 overflow-y-auto p-3">
                        {Object.entries(emojiCategories).map(([category, emojis]) => (
                          <div key={category} className="mb-4">
                            <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase tracking-wide">
                              {category}
                            </h4>
                            <div className="grid grid-cols-8 gap-1">
                              {emojis.map((emoji, index) => (
                                <button
                                  key={`${category}-${index}`}
                                  type="button"
                                  onClick={() => handleEmojiClick(emoji)}
                                  className="w-10 h-10 flex items-center justify-center text-2xl hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors cursor-pointer"
                                  title={emoji}
                                >
                                  {emoji}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* FIX: File attach button - responsive sizing */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 sm:p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors flex-shrink-0"
                  title="Attach file"
                >
                  <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                  accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
                />

                {/* FIX: Video Recording Button - responsive text */}
                {recordingVideo ? (
                  <button
                    type="button"
                    onClick={stopVideoRecording}
                    className="flex-1 px-2 sm:px-4 py-2 sm:py-3 bg-red-600 hover:bg-red-700 text-white rounded-full font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center space-x-1 sm:space-x-2 min-w-0"
                  >
                    <span className="w-2 h-2 sm:w-3 sm:h-3 bg-white rounded-full animate-pulse flex-shrink-0"></span>
                    <span className="truncate">Recording Video... Tap to stop</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startVideoRecording}
                    className="p-1.5 sm:p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors flex-shrink-0"
                    title="Record video"
                  >
                    <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </button>
                )}

                {/* FIX: Audio Recording Button - responsive text */}
                {recording ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="flex-1 px-2 sm:px-4 py-2 sm:py-3 bg-red-600 hover:bg-red-700 text-white rounded-full font-semibold text-xs sm:text-sm transition-colors flex items-center justify-center space-x-1 sm:space-x-2 min-w-0"
                  >
                    <span className="w-2 h-2 sm:w-3 sm:h-3 bg-white rounded-full animate-pulse flex-shrink-0"></span>
                    <span className="truncate">Recording... Tap to stop</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={startRecording}
                      className="p-1.5 sm:p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors flex-shrink-0"
                      title="Record audio"
                    >
                      <svg className="w-5 h-5 sm:w-6 sm:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                      </svg>
                    </button>

                    {/* FIX: Textarea - responsive padding, ensure it doesn't push send button off screen */}
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        handleTyping();
                        // Auto-resize textarea
                        e.target.style.height = 'auto';
                        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
                      }}
                      onFocus={() => setShowEmojiPicker(false)}
                      placeholder="Type a message..."
                      rows={1}
                      className="flex-1 min-w-0 px-2 sm:px-4 py-2 sm:py-2.5 border-0 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-3xl focus:ring-2 focus:ring-primary-500 focus:outline-none text-xs sm:text-sm resize-none overflow-hidden max-h-32 shadow-sm"
                      style={{ minHeight: '36px' }}
                    />

                    {/* FIX: Send button - ensure it's always visible, responsive sizing */}
                    {/* Note: Button works even without WebSocket - messages sent via HTTP POST */}
                    <button
                      type="submit"
                      disabled={!input.trim()}
                      className="p-2 sm:p-2.5 bg-[#25d366] hover:bg-[#20ba5a] text-white rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-md flex-shrink-0"
                      title={!connected ? 'WebSocket disconnected - message will still be sent' : 'Send message'}
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </button>
                  </>
                )}
              </form>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-100 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700">
            <div className="text-center">
              <svg className="w-24 h-24 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-xl font-semibold text-gray-500 dark:text-gray-400">Select a room to start chatting</p>
            </div>
          </div>
        )}

        {/* RIGHT COLUMN: Forex Updates Panel */}
        <div className="w-80 lg:w-96 bg-white dark:bg-gray-800 flex flex-col hidden lg:flex">
          {/* Updates Header */}
          <div className="p-4 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 sticky top-0 z-10">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
                <svg className="w-5 h-5 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
                Forex Updates
              </h2>
              {/* Add Update Button (Admin/Instructor only) */}
              {(user?.role === 'instructor' || user?.role === 'admin' || user?.role === 'superadmin') && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditingNews({ _id: null });
                    setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-xs transition-colors flex items-center space-x-1.5 shadow-md"
                  title="Add New Update"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>Add</span>
                </button>
              )}
            </div>
            <p className="text-xs text-gray-600 dark:text-gray-400">Latest market news and updates</p>
          </div>

          {/* Updates List */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {newsItems.length === 0 ? (
              <div className="text-center py-8">
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                </svg>
                <p className="text-sm text-gray-500 dark:text-gray-400">No updates yet</p>
              </div>
            ) : (
              newsItems.map((news) => (
                <div
                  key={news._id}
                  className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 border border-gray-200 dark:border-gray-600 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-1 line-clamp-2">
                        {news.title}
                      </h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-2 line-clamp-2">
                        {news.description}
                      </p>
                      <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                          {news.category}
                        </span>
                        <span>{formatDistanceToNow(new Date(news.createdAt), { addSuffix: true })}</span>
                      </div>
                    </div>
                  </div>
                  {/* Edit/Delete Buttons (Admin/Instructor/Super Admin) */}
                  {(user?.role === 'admin' || user?.role === 'superadmin' || (user?.role === 'instructor' && news.createdBy === user?.id)) && (
                    <div className="flex items-center space-x-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-600">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setEditingNews(news);
                          setNewsEditForm({
                            title: news.title,
                            description: news.description,
                            category: news.category,
                            content: news.content || '',
                            link: news.link || '',
                          });
                        }}
                        className="flex-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold transition-colors flex items-center justify-center space-x-1"
                        title="Edit this update"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!confirm('Are you sure you want to delete this news update?')) return;
                          try {
                            await apiClient.delete(`/community/news/${news._id}`);
                            await loadNews();
                            setToastMessage('News deleted successfully');
                            setShowToast(true);
                            setTimeout(() => setShowToast(false), 3000);
                          } catch (error: any) {
                            alert(error.response?.data?.error || error.message || 'Failed to delete news');
                          }
                        }}
                        className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold transition-colors flex items-center justify-center space-x-1"
                        title="Delete this update"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                  {/* View Button (Students) */}
                  {user?.role === 'student' && (
                    <button
                      onClick={async () => {
                        await loadNews();
                        setShowNewsModal(true);
                      }}
                      className="w-full mt-3 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold transition-colors"
                    >
                      View Details
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Edit/Create News Modal - Main Chat View */}
      {editingNews && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-[100] flex items-center justify-center p-4" 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setEditingNews(null);
              setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
            }
          }}
        >
          <div 
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col relative z-[101]"
            onClick={(e) => e.stopPropagation()}
            style={{ position: 'relative', zIndex: 101 }}
          >
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                  {editingNews._id ? (
                    <svg className="w-6 h-6 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  ) : (
                    <svg className="w-6 h-6 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                    </svg>
                  )}
                  {editingNews._id ? 'Edit Forex News Update' : 'Post Forex News Update'}
                </h2>
                <button
                  onClick={() => {
                    setEditingNews(null);
                    setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                  }}
                  className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Edit Form */}
            <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!newsEditForm.title || !newsEditForm.description || !newsEditForm.category) {
                    setToastMessage('Please fill in all required fields');
                    setShowToast(true);
                    setTimeout(() => setShowToast(false), 3000);
                    return;
                  }
                  setSubmittingNews(true);
                  try {
                    if (editingNews._id) {
                      await apiClient.put(`/community/news/${editingNews._id}`, newsEditForm);
                      setToastMessage('News updated successfully!');
                    } else {
                      await apiClient.post('/community/news', newsEditForm);
                      setToastMessage('News posted successfully!');
                    }
                    setShowToast(true);
                    setTimeout(() => setShowToast(false), 3000);
                    setEditingNews(null);
                    setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                    await loadNews();
                  } catch (error: any) {
                    setToastMessage(error.response?.data?.error || error.message || `Failed to ${editingNews._id ? 'update' : 'post'} news`);
                    setShowToast(true);
                    setTimeout(() => setShowToast(false), 3000);
                  } finally {
                    setSubmittingNews(false);
                  }
                }}
              className="flex-1 overflow-y-auto p-6 space-y-4"
            >
              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newsEditForm.title}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, title: e.target.value })}
                  placeholder="e.g., NFP Results: 200K Jobs Added"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={newsEditForm.description}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, description: e.target.value })}
                  placeholder="Brief summary of the news update"
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={newsEditForm.category}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, category: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="market">Market News</option>
                  <option value="nfp">NFP Results</option>
                  <option value="cpi">CPI Data</option>
                  <option value="fomc">FOMC Updates</option>
                  <option value="announcement">Announcement</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Content (Optional)
                </label>
                <textarea
                  value={newsEditForm.content}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, content: e.target.value })}
                  placeholder="Detailed content or analysis"
                  rows={5}
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                  Link (Optional)
                </label>
                <input
                  type="url"
                  value={newsEditForm.link}
                  onChange={(e) => setNewsEditForm({ ...newsEditForm, link: e.target.value })}
                  placeholder="https://example.com/article"
                  className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditingNews(null);
                    setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                  }}
                  className="px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-semibold transition-colors hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingNews}
                  className={`px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-colors ${
                    submittingNews ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {submittingNews ? (editingNews._id ? 'Updating...' : 'Posting...') : (editingNews._id ? 'Update News' : 'Post News')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {showToast && (
        <div className="fixed bottom-4 right-4 bg-gray-900 dark:bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg z-50 flex items-center space-x-2">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Forex News Modal */}
      {showNewsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                  <svg className="w-6 h-6 mr-2 text-blue-600 dark:text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                  Important Updates
                </h2>
                <div className="flex items-center space-x-2">
                  {(user?.role === 'instructor' || user?.role === 'admin' || user?.role === 'superadmin') && (
                    <button
                      onClick={() => {
                        setShowNewsModal(false);
                        // Open edit modal with empty form for new news
                        setEditingNews({ _id: null });
                        setNewsEditForm({ title: '', description: '', category: 'market', content: '', link: '' });
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold text-sm transition-colors flex items-center space-x-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span>Post News</span>
                    </button>
                  )}
                  <button
                    onClick={() => setShowNewsModal(false)}
                    className="p-2 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* News List */}
            <div className="flex-1 overflow-y-auto p-6">
              {newsItems.length === 0 ? (
                <div className="text-center py-12">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
                  </svg>
                  <p className="text-gray-500 dark:text-gray-400">No updates available at the moment</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {newsItems.map((news) => (
                    <div
                      key={news._id}
                      className="p-4 bg-gray-50 dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600 hover:shadow-lg transition-shadow"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="px-2 py-1 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 text-xs font-semibold rounded capitalize">
                          {news.category}
                        </span>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {formatDistanceToNow(new Date(news.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-2">{news.title}</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-3 mb-2">{news.description}</p>
                      {news.content && (
                        <p className="text-xs text-gray-500 dark:text-gray-500 line-clamp-2 mb-2">{news.content}</p>
                      )}
                      <div className="flex items-center justify-between mt-3">
                        {news.link && (
                          <a
                            href={news.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            Read more →
                          </a>
                        )}
                        {/* Edit/Delete buttons - Admins and Super Admins can edit/delete ANY update, Instructors can only edit/delete their own */}
                        <div className="flex items-center space-x-2">
                          {/* Admins and Super Admins: Show buttons for ALL news items */}
                          {(user?.role === 'admin' || user?.role === 'superadmin') && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setShowNewsModal(false);
                                  setTimeout(() => {
                                    setEditingNews(news);
                                    setNewsEditForm({
                                      title: news.title,
                                      description: news.description,
                                      category: news.category,
                                      content: news.content || '',
                                      link: news.link || '',
                                    });
                                  }, 100);
                                }}
                                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold transition-colors flex items-center space-x-1 shadow-sm"
                                title="Edit this update"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                <span>Edit</span>
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!confirm('Are you sure you want to delete this news update?')) return;
                                  try {
                                    await apiClient.delete(`/community/news/${news._id}`);
                                    await loadNews();
                                    setShowNewsModal(false);
                                    setToastMessage('News deleted successfully');
                                    setShowToast(true);
                                    setTimeout(() => setShowToast(false), 3000);
                                  } catch (error: any) {
                                    alert(error.response?.data?.error || error.message || 'Failed to delete news');
                                  }
                                }}
                                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold transition-colors flex items-center space-x-1 shadow-sm"
                                title="Delete this update"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span>Delete</span>
                              </button>
                            </>
                          )}
                          {/* Instructors: Show buttons only for their own news */}
                          {user?.role === 'instructor' && news.createdBy === user?.id && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setShowNewsModal(false);
                                  setTimeout(() => {
                                    setEditingNews(news);
                                    setNewsEditForm({
                                      title: news.title,
                                      description: news.description,
                                      category: news.category,
                                      content: news.content || '',
                                      link: news.link || '',
                                    });
                                  }, 100);
                                }}
                                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold transition-colors flex items-center space-x-1 shadow-sm"
                                title="Edit this update"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                <span>Edit</span>
                              </button>
                              <button
                                onClick={async (e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (!confirm('Are you sure you want to delete this news update?')) return;
                                  try {
                                    await apiClient.delete(`/community/news/${news._id}`);
                                    await loadNews();
                                    setShowNewsModal(false);
                                    setToastMessage('News deleted successfully');
                                    setShowToast(true);
                                    setTimeout(() => setShowToast(false), 3000);
                                  } catch (error: any) {
                                    alert(error.response?.data?.error || error.message || 'Failed to delete news');
                                  }
                                }}
                                className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-semibold transition-colors flex items-center space-x-1 shadow-sm"
                                title="Delete this update"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span>Delete</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Audio Player Component with Progress Bar
function AudioPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(audio.duration);
    const handleEnded = () => setPlaying(false);

    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('loadedmetadata', updateDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', updateTime);
      audio.removeEventListener('loadedmetadata', updateDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
    setPlaying(!playing);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex items-center space-x-3 bg-gray-100 dark:bg-gray-700 rounded-lg p-3 w-full">
      <button
        onClick={togglePlay}
        className="w-10 h-10 rounded-full bg-primary-600 hover:bg-primary-700 text-white flex items-center justify-center transition-colors"
      >
        {playing ? (
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
        )}
      </button>
      <div className="flex-1">
        <div className="w-full bg-gray-300 dark:bg-gray-600 rounded-full h-2 mb-1">
          <div
            className="bg-primary-600 h-2 rounded-full transition-all"
            style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-600 dark:text-gray-400">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <audio ref={audioRef} src={src} className="hidden" />
    </div>
  );
}

// Message Bubble Component - WhatsApp Style
interface MessageBubbleProps {
  message: Message;
  isOwn: boolean;
  onReaction: (messageId: string, emoji: string) => void;
  onDelete: (messageId: string) => void;
}

function MessageBubble({ message, isOwn, onReaction, onDelete }: MessageBubbleProps) {
  const [showReactions, setShowReactions] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const reactions = ['👍', '❤️', '🔥', '😂'];

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  return (
    <div className={`flex items-end space-x-2 ${isOwn ? 'justify-end' : 'justify-start'} mb-1 group`}>
      {!isOwn && (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          {message.senderPhoto ? (
            <img src={message.senderPhoto} alt={message.senderName} className="w-full h-full rounded-full object-cover" />
          ) : (
            (message.senderName || 'U').charAt(0).toUpperCase()
          )}
        </div>
      )}
      <div className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} max-w-xs lg:max-w-md`}>
        {!isOwn && (
          <div className="flex items-center space-x-2 mb-1 px-1">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{message.senderName}</span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
          </div>
        )}
        <div
          className={`rounded-2xl px-3 py-2 shadow-sm ${
            isOwn
              ? 'bg-[#dcf8c6] dark:bg-[#056162] text-gray-900 dark:text-white rounded-br-sm'
              : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-bl-sm shadow-md'
          }`}
          style={{
            boxShadow: isOwn 
              ? '0 1px 2px rgba(0,0,0,0.1)' 
              : '0 1px 2px rgba(0,0,0,0.08)',
          }}
        >
          {message.type === 'text' && (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {/* Basic markdown-like rendering for charts and notes */}
              {message.content.split('\n').map((line, idx) => {
                // Simple markdown: **bold**, *italic*, `code`, # heading
                let processed = line;
                processed = processed.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
                processed = processed.replace(/\*(.*?)\*/g, '<em>$1</em>');
                processed = processed.replace(/`(.*?)`/g, '<code class="bg-gray-200 dark:bg-gray-700 px-1 rounded">$1</code>');
                processed = processed.replace(/^### (.*)$/gm, '<h3 class="font-bold text-xl mt-2 mb-1">$1</h3>');
                processed = processed.replace(/^## (.*)$/gm, '<h2 class="font-bold text-2xl mt-3 mb-2">$1</h2>');
                processed = processed.replace(/^# (.*)$/gm, '<h1 class="font-bold text-3xl mt-4 mb-3">$1</h1>');
                return <div key={idx} dangerouslySetInnerHTML={{ __html: processed }} />;
              })}
            </div>
          )}
          {message.type === 'image' && message.fileUrl && (
            <img src={message.fileUrl} alt="Shared image" className="rounded-lg max-w-full mb-2" />
          )}
          {message.type === 'video' && message.fileUrl && (
            <video src={message.fileUrl} controls className="rounded-lg max-w-full mb-2" />
          )}
          {message.type === 'audio' && message.fileUrl && (
            <AudioPlayer src={message.fileUrl} />
          )}
          {message.type === 'document' && message.fileUrl && (
            <a
              href={message.fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center space-x-2 p-2 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{message.fileName || 'Document'}</p>
                {message.fileSize && (
                  <p className="text-xs text-gray-500">{(message.fileSize / 1024 / 1024).toFixed(2)} MB</p>
                )}
              </div>
            </a>
          )}
          {message.reactions && message.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {message.reactions.map((reaction, index) => (
                <span
                  key={index}
                  className="px-2 py-1 bg-white/20 dark:bg-gray-700/50 rounded-full text-xs"
                  title={reaction.userName}
                >
                  {reaction.emoji}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end space-x-1 mt-0.5 px-1">
          {isOwn && (
            <>
              <span className="text-[10px] text-gray-500 dark:text-gray-400">
                {format(new Date(message.createdAt), 'HH:mm')}
              </span>
              {message.delivered ? (
                <svg className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </>
          )}
          {!isOwn && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {format(new Date(message.createdAt), 'HH:mm')}
            </span>
          )}
        </div>
        <div className="relative mt-0.5 px-1 flex items-center space-x-1">
          {/* Menu button (only for own messages) */}
          {isOwn && (
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowMenu(!showMenu)}
                className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                title="More options"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
              </button>
              {showMenu && (
                <div className="absolute bottom-full right-0 mb-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 min-w-[120px] z-10">
                  <button
                    onClick={() => {
                      onDelete(message._id);
                      setShowMenu(false);
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center space-x-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    <span>Delete</span>
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Reaction button */}
          <button
            onClick={() => setShowReactions(!showReactions)}
            className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            👍
          </button>
          {showReactions && (
            <div className="absolute bottom-full left-0 mb-2 flex space-x-2 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-2 border border-gray-200 dark:border-gray-700">
              {reactions.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => {
                    onReaction(message._id, emoji);
                    setShowReactions(false);
                  }}
                  className="text-2xl hover:scale-125 transition-transform"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

