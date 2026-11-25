/**
 * The lesson body: one renderer for every place a lesson is shown (student lesson page, the
 * builder's live preview and the course preview), so what an author previews is what students see.
 *
 * Blocks come from lib/course-content.js (lessonBlocks: stored builder blocks, or blocks derived
 * from a lesson saved before the builder). Files and uploaded videos reach students only through
 * the gated document route (lib/lesson-documents.js); in preview, `resolveAsset` maps an uploaded
 * file to the builder's owner-only link so unsaved content can be previewed too.
 */

import { useRef } from 'react';
import { AlertTriangle, Download, ExternalLink, FileSpreadsheet, FileText, Info, KeyRound, Lightbulb, Link2, Presentation, X } from 'lucide-react';
import VideoPlayer from '@/components/VideoPlayer';
import RichText from '@/components/course/RichText';
import { lessonBlocks, type Block, type CalloutTone, type FileKind } from '@/lib/course-content';
import { sanitizeForStudentView } from '@/lib/html-sanitizer';
import { safeLinkUrl } from '@/lib/safe-url';

type LessonLike = { _id?: string; id?: string; blocks?: Block[] | null; description?: string | null; content?: string | null; [key: string]: unknown };

type Props = {
  lesson: LessonLike;
  /** Overrides the lesson's blocks (the builder's unsaved state). */
  blocks?: Block[];
  mode: 'student' | 'preview';
  /** Preview: link for an uploaded file or video by asset id. */
  resolveAsset?: (assetId: string) => string | null;
  /** Preview: names of uploaded files, so file cards show them. */
  assetNames?: Record<string, { name: string; bytes: number | null }>;
  videoResumeKey?: string | null;
  onVideoEnded?: () => void;
  onVideoProgress?: (seconds: number) => void;
};

const CALLOUT: Record<CalloutTone, { label: string; Icon: typeof Info; tone: string }> = {
  info: { label: 'Note', Icon: Info, tone: 'border-sky-500/40 bg-sky-500/[0.06] text-sky-700 dark:text-sky-300' },
  tip: { label: 'Tip', Icon: Lightbulb, tone: 'border-primary-500/45 bg-primary-500/[0.07] text-primary-700 dark:text-primary-300' },
  warning: { label: 'Caution', Icon: AlertTriangle, tone: 'border-amber-500/50 bg-amber-500/[0.07] text-amber-700 dark:text-amber-300' },
  key: { label: 'Key point', Icon: KeyRound, tone: 'border-emerald-500/45 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300' },
};

const FILE_LABEL: Record<FileKind, string> = { pdf: 'PDF', doc: 'Document', sheet: 'Spreadsheet', slides: 'Slides', text: 'Text file', archive: 'ZIP archive', file: 'File' };

function FileIcon({ kind }: { kind: FileKind }) {
  const Icon = kind === 'sheet' ? FileSpreadsheet : kind === 'slides' ? Presentation : FileText;
  return <Icon className="h-5 w-5" aria-hidden />;
}

export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function Unavailable({ what }: { what: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 text-sm text-ink-subtle" data-testid="block-unavailable">
      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
      {what}
    </div>
  );
}

function blockUrl(block: { url?: string | null; assetId?: string }, mode: Props['mode'], resolveAsset?: Props['resolveAsset']): string | null {
  // Students receive gated links in place of asset ids; staff and previews resolve them.
  if (block.assetId && !block.url) return resolveAsset ? resolveAsset(block.assetId) : null;
  // A stored link that is not http(s) or a relative path (for example javascript:) is never rendered.
  return safeLinkUrl(block.url) || null;
}

/** Callout text is plain text; lines typed as "• item" or "1. item" hang so wrapped lines align. */
function CalloutText({ text }: { text: string }) {
  return (
    <div className="lesson-small mt-1.5 space-y-1 break-words">
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        const marked = /^\s*([•–-]|\d{1,2}[.)])\s+(.+)$/.exec(line);
        if (!marked) return <p key={i}>{line}</p>;
        return (
          <p key={i} className="flex gap-2">
            <span className={`shrink-0 ${/\d/.test(marked[1]) ? 'min-w-[1.35em] tabular-nums' : ''}`}>{marked[1]}</span>{' '}
            <span className="min-w-0">{marked[2]}</span>
          </p>
        );
      })}
    </div>
  );
}

/** A lesson image that opens enlarged, so chart labels can be read on a phone. */
function ZoomImage({ src, alt, className }: { src: string; alt: string; className: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className="block w-full cursor-zoom-in rounded-xl" aria-label={alt ? `Enlarge image: ${alt}` : 'Enlarge image'} onClick={() => dialog.current?.showModal()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" className={className} />
      </button>
      <dialog ref={dialog} aria-label={alt || 'Image'} className="m-auto max-h-[100dvh] max-w-[100vw] bg-transparent p-0 backdrop:bg-black/85" onClick={() => dialog.current?.close()}>
        <div className="max-h-[100dvh] max-w-[100vw] overflow-auto p-2 sm:p-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} loading="lazy" className="h-auto w-[52rem] max-w-none rounded-lg bg-white sm:w-auto sm:max-w-full" />
        </div>
        <button type="button" aria-label="Close image" className="fixed right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-white"><X className="h-5 w-5" aria-hidden /></button>
      </dialog>
    </>
  );
}

function VideoBlock({ block, mode, resolveAsset, resumeKey, onEnded, onProgress }: { block: Extract<Block, { type: 'video' }>; mode: Props['mode']; resolveAsset?: Props['resolveAsset']; resumeKey?: string | null; onEnded?: () => void; onProgress?: (s: number) => void }) {
  const url = blockUrl(block, mode, resolveAsset);
  const uploaded = Boolean(block.assetId) || (url ? url.startsWith('/api/') : false);
  if (!url || block.available === false) return <Unavailable what={uploaded || block.assetId ? 'This video is not available right now.' : 'No video has been added here yet.'} />;
  return (
    <figure>
      <div className="panel-instrument overflow-hidden rounded-2xl border border-line p-1.5 shadow-panel">
        {uploaded ? (
          // An uploaded file is served through an access-checked redirect; the browser's own player
          // follows it. Linked videos (YouTube, Vimeo, files) use the shared player.
          <video className="aspect-video w-full rounded-xl bg-black" controls preload="metadata" src={url} onEnded={onEnded} controlsList="nodownload">
            Your browser cannot play this video.
          </video>
        ) : (
          <VideoPlayer url={url} resumeKey={resumeKey ?? null} onEnded={onEnded} onProgress={onProgress} />
        )}
      </div>
      {block.caption && <figcaption className="lesson-caption text-center">{block.caption}</figcaption>}
    </figure>
  );
}

function FileBlock({ block, mode, resolveAsset, assetNames }: { block: Extract<Block, { type: 'file' }>; mode: Props['mode']; resolveAsset?: Props['resolveAsset']; assetNames?: Props['assetNames'] }) {
  const href = blockUrl(block, mode, resolveAsset);
  const meta = block.assetId && assetNames ? assetNames[block.assetId] : undefined;
  const size = formatBytes(block.bytes ?? meta?.bytes);
  const title = block.title || block.name || meta?.name || FILE_LABEL[block.kind];
  const available = Boolean(href) && block.available !== false;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-1 p-3.5 sm:gap-4 sm:p-4 sm:flex-nowrap" data-testid="block-file">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400">
        <FileIcon kind={block.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[0.9375rem] font-medium leading-snug text-ink">{title}</span>
        <span className="mt-0.5 block text-xs text-ink-subtle">
          {FILE_LABEL[block.kind]}
          {size ? ` · ${size}` : ''}
          {!available ? ' · not available' : ''}
        </span>
      </span>
      {available ? (
        <a href={href!} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm w-full sm:w-auto">
          {block.kind === 'pdf' ? <ExternalLink className="h-4 w-4" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
          {block.kind === 'pdf' ? 'Open PDF' : 'Download'}
        </a>
      ) : (
        <span className="text-xs text-ink-subtle">Unavailable</span>
      )}
    </div>
  );
}

function BlockView({ block, lesson, ...rest }: { block: Block; lesson: LessonLike } & Omit<Props, 'lesson' | 'blocks'>) {
  switch (block.type) {
    case 'heading': {
      if (!block.text) return null;
      const H = block.level === 3 ? 'h3' : 'h2';
      return <H className={`${block.level === 3 ? 'lesson-h3' : 'lesson-h2'} ${block.align === 'center' ? 'text-center' : block.align === 'right' ? 'text-right' : ''}`}>{block.text}</H>;
    }
    case 'text':
      return <RichText ops={block.ops} />;
    case 'callout': {
      if (!block.text && !block.title) return null;
      const c = CALLOUT[block.tone] || CALLOUT.info;
      return (
        <aside className={`rounded-xl border-l-[3px] px-4 py-3 sm:px-5 sm:py-3.5 ${c.tone}`} role="note">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <c.Icon className="h-4 w-4" aria-hidden />
            {block.title || c.label}
          </p>
          {block.text && <CalloutText text={block.text} />}
        </aside>
      );
    }
    case 'image': {
      const src = safeLinkUrl(block.url);
      if (!src) return rest.mode === 'preview' ? <Unavailable what="No image has been added here yet." /> : null;
      return (
        <figure>
          <ZoomImage src={src} alt={block.alt || ''} className={`h-auto max-h-[70vh] w-auto rounded-xl border border-line object-contain ${block.align === 'left' ? 'mr-auto' : block.align === 'right' ? 'ml-auto' : 'mx-auto'} ${block.size === 'small' ? 'max-w-[min(100%,18rem)]' : block.size === 'medium' ? 'max-w-[min(100%,32rem)]' : 'max-w-full'}`} />
          {block.caption && <figcaption className={`lesson-caption ${block.align === 'left' ? 'text-left' : block.align === 'right' ? 'text-right' : 'text-center'}`}>{block.caption}</figcaption>}
        </figure>
      );
    }
    case 'video':
      return <VideoBlock block={block} mode={rest.mode} resolveAsset={rest.resolveAsset} resumeKey={rest.videoResumeKey} onEnded={rest.onVideoEnded} onProgress={rest.onVideoProgress} />;
    case 'file':
      return <FileBlock block={block} mode={rest.mode} resolveAsset={rest.resolveAsset} assetNames={rest.assetNames} />;
    case 'link': {
      const href = safeLinkUrl(block.url, { allowRelative: false });
      if (!href) return rest.mode === 'preview' ? <Unavailable what="No link has been added here yet." /> : null;
      let host = '';
      try { host = new URL(href).hostname.replace(/^www\./, ''); } catch { host = ''; }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 rounded-xl border border-line bg-surface-1 p-3.5 sm:gap-4 sm:p-4 transition-colors hover:border-line-strong" data-testid="block-link">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-600 dark:text-primary-400"><Link2 className="h-5 w-5" aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block break-words text-[0.9375rem] font-medium leading-snug text-ink group-hover:underline">{block.title || host || href}</span>
            {block.description && <span className="mt-0.5 block text-sm text-ink-muted">{block.description}</span>}
            {host && <span className="mt-0.5 block text-xs text-ink-subtle">{host}</span>}
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
        </a>
      );
    }
    case 'code':
      if (!block.text) return null;
      return (
        <figure className="overflow-hidden rounded-xl border border-line bg-surface-2">
          {block.label && <figcaption className="border-b border-line px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-ink-subtle">{block.label}</figcaption>}
          <pre className="whitespace-pre-wrap break-words px-4 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink sm:text-sm"><code>{block.text}</code></pre>
        </figure>
      );
    case 'table': {
      if (!block.rows.some((r) => r.some((cell) => cell.trim()))) return rest.mode === 'preview' ? <Unavailable what="This table is empty." /> : null;
      const head = block.header ? block.rows[0] : null;
      // Columns holding sentences stay wide enough to read; on a phone the table scrolls sideways.
      const wide = (block.rows[0] || []).map((_, i) => block.rows.some((row) => (row[i] || '').length > 24));
      const cell = (i: number) => ({ textAlign: block.align[i] || ('left' as const), minWidth: wide[i] ? '9.5rem' : undefined });
      return (
        <figure>
          <div className="overflow-x-auto rounded-xl border border-line bg-surface-1" tabIndex={0} role="region" aria-label={block.caption || 'Table'}>
            <table className="lesson-small w-full border-collapse">
              {head && <thead><tr className="bg-surface-3">{head.map((text, i) => <th key={i} scope="col" style={cell(i)} className="min-w-[5.5rem] border-b border-line px-3 py-2 font-semibold break-words sm:px-4 sm:py-2.5">{text}</th>)}</tr></thead>}
              <tbody className="divide-y divide-[var(--fo-line)]">
                {block.rows.slice(head ? 1 : 0).map((row, r) => <tr key={r}>{row.map((text, i) => <td key={i} style={cell(i)} className="min-w-[5.5rem] px-3 py-2 align-top break-words sm:px-4 sm:py-2.5">{text}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          {block.caption && <figcaption className="lesson-caption text-center">{block.caption}</figcaption>}
        </figure>
      );
    }
    case 'divider':
      return <hr className="border-line" />;
    case 'legacy': {
      const html = typeof lesson[block.field] === 'string' ? (lesson[block.field] as string) : '';
      if (!html.trim()) return null;
      // Lessons written before the builder: stored HTML shown through the existing sanitizer.
      return (
        <div className="rich-html-readable lesson-body break-words">
          <div dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(html) }} />
        </div>
      );
    }
    default:
      return null;
  }
}

export default function LessonBlocks({ lesson, blocks, ...rest }: Props) {
  const list = blocks ?? lessonBlocks(lesson);
  if (!list.length) {
    return rest.mode === 'preview' ? <Unavailable what="This lesson has no content yet." /> : null;
  }
  return (
    <div className="lesson-blocks lesson-body" data-testid="lesson-blocks">
      {list.map((block) => (
        <div key={block.id} data-block={block.type} data-level={block.type === 'heading' ? block.level : undefined} id={`block-${block.id}`} className="scroll-mt-24">
          <BlockView block={block} lesson={lesson} {...rest} />
        </div>
      ))}
    </div>
  );
}
