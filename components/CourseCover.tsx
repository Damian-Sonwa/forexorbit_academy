/**
 * Course cover image with a fixed aspect ratio.
 * Uses the course's own thumbnail when it has one; otherwise one of the academy's catalog
 * photos, chosen from the course id so a course shows the same picture on every page.
 * A thumbnail that fails to load falls back to that catalog photo.
 */
import { useEffect, useState } from 'react';
import { cloudinaryDisplayUrl } from '@/lib/cloudinary-url';

export const CATALOG_PHOTOS = [
  '/images/catalog/digital-forex.webp',
  '/images/catalog/global-network.webp',
  '/images/catalog/trading-floor.webp',
  '/images/catalog/golden-investment.webp',
  '/images/catalog/chart-analysis.webp',
  '/images/catalog/forex-dashboard.webp',
];

export function fallbackCover(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return CATALOG_PHOTOS[hash % CATALOG_PHOTOS.length];
}

export function courseCoverSrc(course: { _id?: string; id?: string; title?: string; thumbnail?: string | null }): string {
  const thumbnail = typeof course.thumbnail === 'string' ? course.thumbnail.trim() : '';
  // Cloudinary uploads are requested at display size in an automatic format, not as the original.
  return thumbnail ? cloudinaryDisplayUrl(thumbnail) : fallbackCover(String(course._id || course.id || course.title || ''));
}

interface CourseCoverProps {
  course: { _id?: string; id?: string; title?: string; thumbnail?: string | null };
  className?: string;
  /** Tailwind aspect class; 16:10 suits the mixed catalog photos. */
  aspect?: string;
  priority?: boolean;
}

export default function CourseCover({ course, className = '', aspect = 'aspect-[16/10]', priority = false }: CourseCoverProps) {
  const fallback = fallbackCover(String(course._id || course.id || course.title || ''));
  const [src, setSrc] = useState(() => courseCoverSrc(course));

  useEffect(() => {
    setSrc(courseCoverSrc(course));
  }, [course.thumbnail, course._id, course.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={`relative overflow-hidden bg-neutral-100 dark:bg-neutral-900 ${aspect} ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover object-center"
        onError={() => {
          if (src !== fallback) setSrc(fallback);
        }}
      />
    </div>
  );
}
