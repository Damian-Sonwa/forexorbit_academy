/**
 * VideoPlayer Component
 * Displays video content using react-player
 */

import dynamic from 'next/dynamic';
import { useState } from 'react';

// Dynamically import react-player to avoid SSR issues
const ReactPlayer = dynamic(() => import('react-player'), { ssr: false });

interface VideoPlayerProps {
  url: string;
  onProgress?: (progress: number) => void;
  onEnded?: () => void;
}

export default function VideoPlayer({ url, onProgress, onEnded }: VideoPlayerProps) {
  const [playing, setPlaying] = useState(false);

  if (!url) {
    return (
      <div className="w-full aspect-video bg-gray-900 rounded-lg flex items-center justify-center">
        <p className="text-gray-400">No video URL provided</p>
      </div>
    );
  }

  return (
    <div className="w-full aspect-video bg-gray-900 rounded-lg overflow-hidden">
      <ReactPlayer
        url={url}
        playing={playing}
        controls
        width="100%"
        height="100%"
        onProgress={(state) => onProgress?.(state.playedSeconds)}
        onEnded={onEnded}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
    </div>
  );
}

