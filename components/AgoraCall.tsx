/**
 * Agora Call Component
 * Replaces broken WebRTC with Agora SDK for voice and video calls
 * Only shows for approved consultations
 */

import { useEffect, useRef, useState } from 'react';

// Import Agora types only (not the SDK itself) to avoid SSR issues
// The SDK will be dynamically imported only on client side
type IAgoraRTCClient = any;
type ILocalAudioTrack = any;
type ILocalVideoTrack = any;
type IRemoteAudioTrack = any;
type IRemoteVideoTrack = any;

// Define remote user type based on Agora SDK structure
// The user object from user-published event has uid, audioTrack, and videoTrack properties
type RemoteUser = {
  uid: string | number;
  audioTrack?: IRemoteAudioTrack;
  videoTrack?: IRemoteVideoTrack;
};

interface AgoraCallProps {
  appId: string;
  channel: string;
  token: string | null;
  uid: string | number;
  callType: 'voice' | 'video';
  onCallEnd?: () => void;
  onCallConnected?: () => void; // Callback when call successfully connects
}

export default function AgoraCall({ appId, channel, token, uid, callType, onCallEnd, onCallConnected }: AgoraCallProps) {
  const [joined, setJoined] = useState(false);
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  
  const clientRef = useRef<IAgoraRTCClient | null>(null);
  const localAudioTrackRef = useRef<ILocalAudioTrack | null>(null);
  const localVideoTrackRef = useRef<ILocalVideoTrack | null>(null);
  const localVideoContainerRef = useRef<HTMLDivElement>(null);
  const remoteVideoContainerRef = useRef<HTMLDivElement>(null);
  const initTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ensure component only runs on client
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Don't initialize if not mounted (SSR guard)
    if (!mounted || typeof window === 'undefined') return;
    
    // Don't initialize if required props are missing
    if (!appId || !channel || !token) {
      console.warn('AgoraCall: Missing required props', { 
        appId: !!appId, 
        channel: !!channel, 
        token: !!token,
        appIdValue: appId ? appId.substring(0, 8) + '...' : 'missing',
        channelValue: channel || 'missing',
        tokenValue: token ? token.substring(0, 20) + '...' : 'missing',
      });
      setError('Missing required Agora configuration. Please try starting the call again.');
      setLoading(false);
      return;
    }
    
    // Prevent multiple initializations
    if (clientRef.current) {
      console.log('AgoraCall: Already initialized, skipping...');
      return;
    }
    
    const init = async () => {
      // Add timeout to prevent infinite loading
      initTimeoutRef.current = setTimeout(() => {
        console.error('AgoraCall: Initialization timeout after 30 seconds');
        setError('Call initialization timed out. Please try again.');
        setLoading(false);
      }, 30000); // 30 second timeout
      try {
        setLoading(true);
        setError(null);
        console.log('AgoraCall: Starting initialization...', { appId, channel, callType });

        // Dynamically import Agora SDK only on client side
        const AgoraRTC = (await import('agora-rtc-sdk-ng')).default;
        console.log('AgoraCall: SDK loaded');

        // Create Agora client
        const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
        clientRef.current = client;

        // Helper function to wait for container with ID
        const waitForContainer = (containerId: string, fallbackRef: React.RefObject<HTMLDivElement> | null, maxAttempts = 20) => {
          return new Promise<HTMLElement>((resolve, reject) => {
            let attempts = 0;
            const checkContainer = () => {
              const container = document.getElementById(containerId);
              if (container) {
                const rect = container.getBoundingClientRect();
                // Check if container has non-zero dimensions
                if (rect.width > 0 && rect.height > 0) {
                  console.log(`AgoraCall: Container ${containerId} found with dimensions:`, rect.width, 'x', rect.height);
                  resolve(container);
                  return;
                }
              }
              attempts++;
              if (attempts >= maxAttempts) {
                // Fallback: use ref container if ID not found
                if (fallbackRef?.current) {
                  console.warn(`AgoraCall: Using ref fallback for ${containerId}`);
                  resolve(fallbackRef.current);
                  return;
                }
                reject(new Error(`${containerId} container not found or has zero dimensions`));
                return;
              }
              setTimeout(checkContainer, 100);
            };
            checkContainer();
          });
        };

        // Handle remote user events
        client.on('user-published', async (user, mediaType) => {
          try {
            await client.subscribe(user, mediaType);
            
            if (mediaType === 'video') {
              const remoteVideoTrack = user.videoTrack;
              if (remoteVideoTrack) {
                // Wait for remote-video container to be available
                const remoteContainer = await waitForContainer('remote-video', remoteVideoContainerRef);
                // Agora SDK will handle playsinline for iOS Safari automatically
                await remoteVideoTrack.play(remoteContainer);
                console.log('AgoraCall: Remote video playing in container');
              }
            }
            
            if (mediaType === 'audio') {
              const remoteAudioTrack = user.audioTrack;
              if (remoteAudioTrack) {
                remoteAudioTrack.play();
                console.log('AgoraCall: Remote audio playing');
              }
            }
            
            setRemoteUsers((prev) => {
              if (prev.find((u) => u.uid === user.uid)) return prev;
              return [...prev, { uid: user.uid, audioTrack: user.audioTrack, videoTrack: user.videoTrack }];
            });
          } catch (err) {
            console.error('AgoraCall: Error handling user-published event:', err);
            // Don't throw - allow other media types to continue
          }
        });

        client.on('user-unpublished', (user, mediaType) => {
          if (mediaType === 'video') {
            const remotePlayerContainer = document.getElementById(`remote-${user.uid}`);
            if (remotePlayerContainer) {
              remotePlayerContainer.remove();
            }
          }
          
          setRemoteUsers((prev) => prev.filter((u) => u.uid !== user.uid));
        });

        // CRITICAL: Validate token before joining
        if (!token) {
          throw new Error('Agora token is required');
        }

        // Join channel with token
        await client.join(appId, channel, token, uid);
        console.log('Agora client joined channel:', channel);

        // Create local tracks based on call type
        console.log('AgoraCall: Creating local tracks...', { callType });
        try {
          if (callType === 'video') {
            // Create camera video track explicitly with facingMode: "user" (front-facing camera)
            const videoTrack = await AgoraRTC.createCameraVideoTrack({ facingMode: 'user' });
            console.log('AgoraCall: Camera video track created');
            
            // Create microphone audio track
            const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
            console.log('AgoraCall: Microphone audio track created');
            
            localAudioTrackRef.current = audioTrack;
            localVideoTrackRef.current = videoTrack;

            // Wait for container to be available in DOM
            // Ensure local-video container exists and has non-zero dimensions
            const localVideoContainer = await waitForContainer('local-video', localVideoContainerRef);
            
            // Play local video - Agora SDK will handle playsinline for iOS Safari automatically
            // The SDK creates a video element inside the container with proper attributes
            await videoTrack.play(localVideoContainer);
            console.log('AgoraCall: Local video playing in container');

            // Publish both audio and video tracks together
            await client.publish([audioTrack, videoTrack]);
            console.log('AgoraCall: Video and audio tracks published');
          } else {
            // Voice only
            const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
            console.log('AgoraCall: Audio track created');
            localAudioTrackRef.current = audioTrack;

            // Publish track
            await client.publish([audioTrack]);
            console.log('AgoraCall: Audio track published');
          }
        } catch (trackError: any) {
          console.error('AgoraCall: Error creating/publishing tracks:', trackError);
          // Check if it's a permission error
          if (trackError.name === 'NotAllowedError' || trackError.message?.includes('permission')) {
            throw new Error('Microphone/Camera permission denied. Please allow access and try again.');
          }
          throw trackError;
        }

        // CRITICAL: Clear error state once join() and publish() succeed
        setError(null);
        setJoined(true);
        setLoading(false);
        if (initTimeoutRef.current) {
          clearTimeout(initTimeoutRef.current);
          initTimeoutRef.current = null;
        }
        console.log('AgoraCall: Initialization complete - call is active');
        
        // Notify parent that call connected successfully
        if (onCallConnected) {
          onCallConnected();
        }
      } catch (err: any) {
        if (initTimeoutRef.current) {
          clearTimeout(initTimeoutRef.current);
          initTimeoutRef.current = null;
        }
        console.error('AgoraCall: Initialization error:', err);
        console.error('AgoraCall: Error details:', {
          name: err.name,
          message: err.message,
          code: err.code,
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
        });
        
        // Provide user-friendly error messages
        let errorMessage = 'Failed to initialize call. ';
        if (err.name === 'NotAllowedError' || err.message?.includes('permission')) {
          errorMessage += 'Please allow microphone/camera access and try again.';
        } else if (err.message?.includes('token') || err.code === 'DYNAMIC_KEY_TIMEOUT') {
          errorMessage += 'Token expired or invalid. Please try starting the call again.';
        } else if (err.message?.includes('network') || err.code === 'NETWORK_ERROR') {
          errorMessage += 'Network error. Please check your connection and try again.';
        } else if (err.code === 'INVALID_APP_ID' || err.message?.includes('appId')) {
          errorMessage += 'Invalid Agora configuration. Please contact support.';
        } else {
          errorMessage += err.message || 'Please try again.';
        }
        
        setError(errorMessage);
        setLoading(false);
        
        // Clean up on error
        try {
          if (clientRef.current) {
            await clientRef.current.leave();
            clientRef.current = null;
          }
        } catch (cleanupErr) {
          console.error('AgoraCall: Cleanup error:', cleanupErr);
        }
      }
    };

    init();
    
    // Cleanup function - only runs when component unmounts or props change
    return () => {
      // Clear timeout if still running
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
      }
      
      const cleanup = async () => {
        try {
          console.log('AgoraCall: Cleaning up...');
          
          // Stop and close local tracks
          if (localAudioTrackRef.current) {
            localAudioTrackRef.current.stop();
            localAudioTrackRef.current.close();
            localAudioTrackRef.current = null;
          }
          if (localVideoTrackRef.current) {
            localVideoTrackRef.current.stop();
            localVideoTrackRef.current.close();
            localVideoTrackRef.current = null;
          }

          // Leave channel
          if (clientRef.current) {
            await clientRef.current.leave();
            clientRef.current = null;
          }

          // Clear remote video containers
          if (remoteVideoContainerRef.current) {
            remoteVideoContainerRef.current.innerHTML = '';
          }
          
          // Reset state
          setJoined(false);
          setRemoteUsers([]);
          console.log('AgoraCall: Cleanup complete');
        } catch (err) {
          console.error('AgoraCall: Cleanup error:', err);
        }
      };

      cleanup();
    };
  }, [mounted, appId, channel, token, uid, callType]); // Only re-initialize if these change

  const toggleMute = async () => {
    if (localAudioTrackRef.current) {
      if (isMuted) {
        await localAudioTrackRef.current.setEnabled(true);
        setIsMuted(false);
      } else {
        await localAudioTrackRef.current.setEnabled(false);
        setIsMuted(true);
      }
    }
  };

  const toggleVideo = async () => {
    if (localVideoTrackRef.current && callType === 'video') {
      if (isVideoOff) {
        await localVideoTrackRef.current.setEnabled(true);
        setIsVideoOff(false);
      } else {
        await localVideoTrackRef.current.setEnabled(false);
        setIsVideoOff(true);
      }
    }
  };

  const handleEndCall = () => {
    if (onCallEnd) {
      onCallEnd();
    }
  };

  // Don't render anything during SSR - prevent Agora SDK from being evaluated
  if (!mounted || typeof window === 'undefined') {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-4 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <p className="text-sm text-gray-600 dark:text-gray-400">Loading call...</p>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-4 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-2"></div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Initializing {callType} call...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 mb-4 border border-red-200 dark:border-red-800">
        <div className="flex items-center justify-between">
          <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          <button
            onClick={handleEndCall}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 mb-4 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${joined ? 'bg-green-500' : 'bg-gray-400'}`}></div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {callType === 'video' ? 'Video Call' : 'Voice Call'} {joined ? '- Connected' : '- Connecting...'}
          </span>
        </div>
        <button
          onClick={handleEndCall}
          className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-semibold transition-colors"
        >
          End Call
        </button>
      </div>

      {/* Video Display */}
      {callType === 'video' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Remote Video */}
          <div 
            className="relative bg-gray-900 rounded-lg overflow-hidden" 
            style={{ minHeight: '300px', width: '100%' }}
          >
            {/* Explicit ID for remote video container - required for Agora playback */}
            {/* Agora SDK will create video element inside this container */}
            <div 
              id="remote-video" 
              ref={remoteVideoContainerRef} 
              className="w-full h-full"
              style={{ minHeight: '300px', width: '100%', position: 'relative' }}
            />
            {remoteUsers.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <p className="text-gray-400">Waiting for other participant...</p>
              </div>
            )}
          </div>

          {/* Local Video */}
          <div 
            className="relative bg-gray-900 rounded-lg overflow-hidden" 
            style={{ minHeight: '300px', width: '100%' }}
          >
            {/* Explicit ID for local video container - required for Agora playback */}
            {/* Agora SDK will create video element inside this container with playsinline for iOS */}
            <div 
              id="local-video" 
              ref={localVideoContainerRef} 
              className="w-full h-full"
              style={{ minHeight: '300px', width: '100%', position: 'relative' }}
            />
            {isVideoOff && (
              <div className="absolute inset-0 flex items-center justify-center bg-gray-800 pointer-events-none z-10">
                <p className="text-gray-400">Camera Off</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Voice Only Display */}
      {callType === 'voice' && (
        <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-8 mb-4">
          <div className="text-center">
            <div className="w-24 h-24 bg-primary-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {remoteUsers.length > 0 ? 'Connected' : 'Waiting for other participant...'}
            </p>
          </div>
        </div>
      )}

      {/* Call Controls */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={toggleMute}
          className={`p-3 rounded-full transition-colors ${
            isMuted
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white'
          }`}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {isMuted ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            )}
          </svg>
        </button>

        {callType === 'video' && (
          <button
            onClick={toggleVideo}
            className={`p-3 rounded-full transition-colors ${
              isVideoOff
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-white'
            }`}
            title={isVideoOff ? 'Turn Camera On' : 'Turn Camera Off'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        )}

        <button
          onClick={handleEndCall}
          className="p-3 rounded-full bg-red-600 hover:bg-red-700 text-white transition-colors"
          title="End Call"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

