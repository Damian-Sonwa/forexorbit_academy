/**
 * VideoPlayer Component
 * Displays video content using react-player (YouTube, Vimeo and direct video files).
 *
 * Phase 7: loading and buffering indicators, an error state with retry (also retried when the
 * browser comes back online), and resume from the last position where the player supports
 * seeking (lib/playback-position.ts). Playback never marks a lesson complete: `onEnded` only
 * tells the page the video finished; completion is the student's explicit action.
 */

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SAVE_INTERVAL_MS,
  browserStorage,
  clearPosition,
  readPosition,
  resumePosition,
  writePosition,
} from '@/lib/playback-position';

// Dynamically import react-player to avoid SSR issues
const ReactPlayer = dynamic(() => import('react-player'), { ssr: false });

interface VideoPlayerProps {
  url: string;
  /** localStorage key for the resume position (lib/playback-position.ts); null disables resume. */
  resumeKey?: string | null;
  onProgress?: (playedSeconds: number) => void;
  onEnded?: () => void;
}

type SeekablePlayer = { seekTo: (amount: number, type?: 'seconds' | 'fraction') => void; getDuration: () => number };

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

export default function VideoPlayer({ url, resumeKey = null, onProgress, onEnded }: VideoPlayerProps) {
  const [ready, setReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const playerRef = useRef<SeekablePlayer | null>(null);
  const lastSaved = useRef(0);
  const resumed = useRef(false);

  // A new video (next lesson) starts from a clean state.
  useEffect(() => {
    setReady(false);
    setBuffering(false);
    setFailed(false);
    setResumedAt(null);
    resumed.current = false;
    lastSaved.current = 0;
  }, [url, resumeKey]);

  const retry = useCallback(() => {
    setFailed(false);
    setReady(false);
    resumed.current = false;
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!failed || typeof window === 'undefined') return;
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [failed, retry]);

  const handleReady = useCallback((player: unknown) => {
    setReady(true);
    setFailed(false);
    const seekable = player as SeekablePlayer;
    playerRef.current = seekable;
    if (resumed.current) return;
    resumed.current = true;
    const saved = readPosition(browserStorage(), resumeKey);
    let duration = NaN;
    try {
      duration = seekable.getDuration();
    } catch {
      duration = NaN;
    }
    const at = resumePosition(saved, duration);
    if (at != null) {
      try {
        seekable.seekTo(at, 'seconds');
        setResumedAt(at);
      } catch {
        // Seeking is not supported by this source; play from the start.
      }
    }
  }, [resumeKey]);

  const handleProgress = useCallback((state: { playedSeconds: number }) => {
    onProgress?.(state.playedSeconds);
    const now = Date.now();
    if (resumeKey && now - lastSaved.current >= SAVE_INTERVAL_MS && state.playedSeconds > 0) {
      lastSaved.current = now;
      writePosition(browserStorage(), resumeKey, state.playedSeconds);
    }
  }, [onProgress, resumeKey]);

  const handlePause = useCallback(() => {
    const player = playerRef.current as unknown as { getCurrentTime?: () => number } | null;
    const t = player && typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : NaN;
    if (resumeKey && Number.isFinite(t)) writePosition(browserStorage(), resumeKey, t);
  }, [resumeKey]);

  const handleEnded = useCallback(() => {
    // Finished: the next visit starts from the beginning. This is not lesson completion.
    clearPosition(browserStorage(), resumeKey);
    onEnded?.();
  }, [resumeKey, onEnded]);

  const startOver = useCallback(() => {
    clearPosition(browserStorage(), resumeKey);
    setResumedAt(null);
    try {
      playerRef.current?.seekTo(0, 'seconds');
    } catch {
      // ignore
    }
  }, [resumeKey]);

  if (!url) {
    return (
      <div className="w-full aspect-video bg-gray-900 rounded-lg flex items-center justify-center">
        <p className="text-gray-400">No video URL provided</p>
      </div>
    );
  }

  return (
    <div data-testid="lesson-video">
      <div className="relative w-full aspect-video bg-gray-900 rounded-lg overflow-hidden">
        {!failed && (
          <ReactPlayer
            key={attempt}
            url={url}
            controls
            playsinline
            width="100%"
            height="100%"
            progressInterval={1000}
            onReady={handleReady}
            onProgress={handleProgress}
            onPause={handlePause}
            onBuffer={() => setBuffering(true)}
            onBufferEnd={() => setBuffering(false)}
            onPlay={() => setBuffering(false)}
            onError={() => {
              setFailed(true);
              setBuffering(false);
            }}
            onEnded={handleEnded}
          />
        )}
        {!failed && (!ready || buffering) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-live="polite">
            <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />
              {ready ? 'Buffering…' : 'Loading video…'}
            </span>
          </div>
        )}
        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center" role="alert">
            <p className="text-sm font-medium text-white">The video could not be played.</p>
            <p className="max-w-sm text-xs text-gray-300">
              Check your connection. If the problem continues, the video may have been moved or removed.
            </p>
            <button
              type="button"
              onClick={retry}
              className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-100"
            >
              Try again
            </button>
          </div>
        )}
      </div>
      {resumedAt != null && !failed && (
        <p className="mt-2 flex flex-wrap items-center gap-2 px-1 text-xs text-gray-600 dark:text-gray-300" data-testid="video-resumed">
          <span>Resumed at {formatTime(resumedAt)}.</span>
          <button type="button" onClick={startOver} className="font-semibold text-primary-600 underline-offset-2 hover:underline">
            Start over
          </button>
        </p>
      )}
    </div>
  );
}
