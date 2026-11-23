/**
 * Editing controls for each content block. The block's data is exactly what is stored and what
 * components/course/LessonBlocks renders; these controls only change it. Uploads show progress and
 * can be retried or replaced; files go to the course's private storage (/api/courses/:id/assets),
 * images to the existing lesson image route (/api/upload/instructor).
 */

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Code2, Copy, FileText, Heading, Image as ImageIcon, Info, Link2, Minus, Paperclip, Plus, RefreshCw, Trash2, Type, UploadCloud, Video, X } from 'lucide-react';
import TextBlockEditor from '@/components/builder/TextBlockEditor';
import { imageProblem, uploadWithProgress, type UploadHandle } from '@/components/builder/upload';
import { prepareImage } from '@/components/builder/image-prepare';
import { formatBytes } from '@/components/course/LessonBlocks';
import { acceptAttribute } from '@/lib/course-asset-files';
import { fileKindOf, newId, type Block, type BlockType, type CalloutTone, type DeltaOp } from '@/lib/course-content';
import { sanitizeForStudentView } from '@/lib/html-sanitizer';
import type { BuilderAsset } from '@/lib/course-curriculum';

export const BLOCK_MENU: Array<{ type: BlockType; label: string; hint: string; Icon: typeof Type }> = [
  { type: 'text', label: 'Text', hint: 'Paragraphs, lists, emphasis, links', Icon: Type },
  { type: 'heading', label: 'Heading', hint: 'A section title', Icon: Heading },
  { type: 'video', label: 'Video', hint: 'YouTube, Vimeo or an uploaded video', Icon: Video },
  { type: 'image', label: 'Image', hint: 'A chart, diagram or screenshot', Icon: ImageIcon },
  { type: 'file', label: 'File', hint: 'PDF, document, spreadsheet, slides', Icon: Paperclip },
  { type: 'callout', label: 'Callout', hint: 'A tip, note, caution or key point', Icon: Info },
  { type: 'link', label: 'Link', hint: 'An external learning resource', Icon: Link2 },
  { type: 'code', label: 'Example', hint: 'A worked example in fixed-width text', Icon: Code2 },
  { type: 'divider', label: 'Divider', hint: 'A visual break', Icon: Minus },
];

/**
 * Images waiting to be uploaded into a newly created image block (pasted or dropped into a text
 * block). The image block's editor takes its file from here when it appears and uploads it.
 */
export const pendingImages = new Map<string, File>();

export function emptyBlock(type: BlockType): Block {
  const id = newId();
  switch (type) {
    case 'heading': return { id, type, text: '', level: 2 };
    case 'text': return { id, type, ops: [{ insert: '\n' }] };
    case 'callout': return { id, type, tone: 'tip', title: '', text: '' };
    case 'image': return { id, type, url: '', alt: '', caption: '' };
    case 'video': return { id, type, url: '', caption: '' };
    case 'file': return { id, type, url: '', title: '', kind: 'file' };
    case 'link': return { id, type, url: '', title: '', description: '' };
    case 'code': return { id, type, text: '', label: '' };
    case 'divider': return { id, type };
    default: return { id, type: 'text', ops: [{ insert: '\n' }] };
  }
}

/** A copy with fresh ids (duplicating a block or a lesson). */
export function copyBlocks(blocks: Block[]): Block[] {
  return blocks.map((b) => ({ ...JSON.parse(JSON.stringify(b)), id: newId() }));
}

export function AddBlockMenu({ onAdd, compact }: { onAdd: (type: BlockType) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={compact ? 'flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-1 text-ink-subtle shadow-sm hover:border-primary-500 hover:text-primary-600' : 'btn btn-secondary w-full justify-center border-dashed'} aria-label="Add a content block" data-testid={compact ? 'insert-block' : 'add-block'}>
        <Plus className="h-4 w-4" aria-hidden />{!compact && 'Add content'}
      </button>
      {open && (
        <div role="menu" className="absolute left-1/2 z-30 mt-2 grid w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 grid-cols-1 gap-1 rounded-2xl border border-line bg-surface-1 p-2 shadow-lift sm:grid-cols-2" onMouseLeave={() => setOpen(false)}>
          {BLOCK_MENU.map(({ type, label, hint, Icon }) => (
            <button key={type} type="button" role="menuitem" onClick={() => { setOpen(false); onAdd(type); }} className="flex items-start gap-3 rounded-xl p-2.5 text-left hover:bg-tint" data-testid={`add-${type}`}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600 dark:text-primary-400"><Icon className="h-4 w-4" aria-hidden /></span>
              <span><span className="block text-sm font-semibold text-ink">{label}</span><span className="block text-xs text-ink-subtle">{hint}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type UploadState = { name: string; fraction: number; error?: string; file?: File; handle?: UploadHandle } | null;

function useUpload(courseId: string, onDone: (asset: BuilderAsset) => void) {
  const [state, setState] = useState<UploadState>(null);
  const start = (file: File) => {
    const handle = uploadWithProgress(`/api/courses/${courseId}/assets`, 'file', file, (fraction) => setState((s) => (s ? { ...s, fraction } : s)));
    setState({ name: file.name, fraction: 0, file, handle });
    handle.promise
      .then((body) => { setState(null); onDone(body.asset as BuilderAsset); })
      .catch((err: Error & { status?: number }) => { if (err.status === -1) setState(null); else setState({ name: file.name, fraction: 0, error: err.message, file }); });
  };
  return { state, start, retry: () => state?.file && start(state.file), cancel: () => { state?.handle?.abort(); setState(null); } };
}

function UploadBar({ state, onRetry, onCancel }: { state: NonNullable<UploadState>; onRetry: () => void; onCancel: () => void }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 text-sm ${state.error ? 'border-red-500/40 bg-red-500/5' : 'border-line bg-surface-2'}`} role={state.error ? 'alert' : 'status'}>
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-ink">{state.error ? state.error : `Uploading ${state.name}`}</span>
        {state.error ? (
          <span className="flex shrink-0 gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5" aria-hidden />Retry</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Dismiss</button>
          </span>
        ) : (
          <button type="button" className="text-xs font-semibold text-ink-subtle hover:text-ink" onClick={onCancel}>Cancel</button>
        )}
      </div>
      {!state.error && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--fo-line)]" aria-hidden>
          <div className="h-full rounded-full bg-primary-500 transition-[width]" style={{ width: `${Math.round(state.fraction * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

function DropZone({ accept, label, hint, onFile, disabled }: { accept: string; label: string; hint: string; onFile: (f: File) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f && !disabled) onFile(f); }}
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${over ? 'border-primary-500 bg-primary-500/5' : 'border-line'}`}
    >
      <UploadCloud className="h-6 w-6 text-ink-subtle" aria-hidden />
      <p className="text-sm text-ink"><button type="button" className="font-semibold text-primary-600 hover:underline disabled:opacity-50 dark:text-primary-400" onClick={() => input.current?.click()} disabled={disabled}>{label}</button> or drop it here</p>
      <p className="text-xs text-ink-subtle">{hint}</p>
      <input ref={input} type="file" accept={accept} className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
    </div>
  );
}

type EditorProps = {
  block: Block;
  courseId: string;
  assets: BuilderAsset[];
  legacy: { description: string; content: string };
  readOnly: boolean;
  onChange: (block: Block) => void;
  onAssetAdded: (asset: BuilderAsset) => void;
  /** A text block received an image: split it at the cursor and put the image there. */
  onTextImage?: (file: File, split: { before: DeltaOp[]; after: DeltaOp[] }) => void;
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-subtle">{hint}</span>}
    </label>
  );
}

function SourceTabs({ mode, setMode }: { mode: 'upload' | 'link'; setMode: (m: 'upload' | 'link') => void }) {
  return (
    <div className="inline-flex rounded-xl border border-line p-0.5 text-xs font-semibold" role="tablist">
      {(['upload', 'link'] as const).map((m) => (
        <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 ${mode === m ? 'bg-tint text-ink' : 'text-ink-subtle hover:text-ink'}`}>{m === 'upload' ? 'Upload' : 'Link'}</button>
      ))}
    </div>
  );
}

function AssetSummary({ asset, onReplace, onRemove, readOnly }: { asset: BuilderAsset | undefined; onReplace: () => void; onRemove: () => void; readOnly: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <FileText className="h-4 w-4 shrink-0 text-ink-subtle" aria-hidden />
      <span className="min-w-0 flex-1 text-sm">
        {asset ? <><span className="block truncate font-medium text-ink">{asset.name}</span><span className="text-xs text-ink-subtle">{formatBytes(asset.bytes)} · stored privately</span></>
          : <span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />The file is missing. Upload it again.</span>}
      </span>
      {!readOnly && (
        <span className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onReplace}>Replace</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onRemove} aria-label="Remove file from this block"><X className="h-4 w-4" aria-hidden /></button>
        </span>
      )}
    </div>
  );
}

function MediaSource({ block, courseId, assets, readOnly, kind, onChange, onAssetAdded }: EditorProps & { kind: 'video' | 'file'; block: Extract<Block, { type: 'video' | 'file' }> }) {
  const [mode, setMode] = useState<'upload' | 'link'>(block.url && !block.assetId ? 'link' : 'upload');
  const [replacing, setReplacing] = useState(false);
  const upload = useUpload(courseId, (asset) => {
    onAssetAdded(asset);
    setReplacing(false);
    if (block.type === 'file') onChange({ ...block, assetId: asset.id, url: undefined, name: asset.name, bytes: asset.bytes ?? undefined, kind: fileKindOf(asset.name), title: block.title || asset.name.replace(/\.[^.]+$/, '') });
    else onChange({ ...block, assetId: asset.id, url: undefined });
  });
  const asset = block.assetId ? assets.find((a) => a.id === block.assetId) : undefined;
  const accept = acceptAttribute(kind);
  const hint = kind === 'video' ? 'MP4, MOV or WebM, up to 100 MB. Students stream it; it has no public address.' : 'PDF, Word, Excel, PowerPoint, OpenDocument, CSV, text or ZIP, up to 25 MB. Stored privately; enrolled students download it.';
  return (
    <div className="space-y-3">
      {!readOnly && <SourceTabs mode={mode} setMode={setMode} />}
      {mode === 'upload' ? (
        <>
          {upload.state ? <UploadBar state={upload.state} onRetry={upload.retry} onCancel={upload.cancel} />
            : block.assetId && !replacing ? <AssetSummary asset={asset} readOnly={readOnly} onReplace={() => setReplacing(true)} onRemove={() => onChange({ ...block, assetId: undefined, url: '' })} />
              : !readOnly && <DropZone accept={accept} label={kind === 'video' ? 'Choose a video' : 'Choose a file'} hint={hint} onFile={upload.start} />}
          {replacing && !upload.state && <button type="button" className="text-xs font-semibold text-ink-subtle hover:text-ink" onClick={() => setReplacing(false)}>Keep the current file</button>}
          {assets.filter((a) => (kind === 'video' ? a.kind === 'video' : a.kind !== 'video')).length > 0 && !readOnly && !upload.state && (
            <Field label="Or use a file already uploaded to this course">
              <select className="input mt-1.5 w-full" value={block.assetId || ''} onChange={(e) => { const a = assets.find((x) => x.id === e.target.value); if (!a) return; onChange(block.type === 'file' ? { ...block, assetId: a.id, url: undefined, name: a.name, bytes: a.bytes ?? undefined, kind: fileKindOf(a.name), title: block.title || a.name.replace(/\.[^.]+$/, '') } : { ...block, assetId: a.id, url: undefined }); }}>
                <option value="">Choose…</option>
                {assets.filter((a) => (kind === 'video' ? a.kind === 'video' : a.kind !== 'video')).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          )}
        </>
      ) : (
        <Field label={kind === 'video' ? 'Video link' : 'File link'} hint={kind === 'video' ? 'YouTube, Vimeo, or a direct link to a video file.' : 'A link starting with https:// (Google Drive, Dropbox, your site).'}>
          <input className="input mt-1.5 w-full" type="url" inputMode="url" placeholder="https://" value={block.url || ''} readOnly={readOnly} onChange={(e) => onChange({ ...block, url: e.target.value, assetId: undefined, ...(block.type === 'file' ? { kind: fileKindOf(e.target.value) } : {}) } as Block)} />
        </Field>
      )}
    </div>
  );
}

function ImageEditor({ block, readOnly, onChange }: EditorProps & { block: Extract<Block, { type: 'image' }> }) {
  const [state, setState] = useState<UploadState>(null);
  // Upload (to R2, Cloudinary or the app's own database, whichever the server has) or a link to an
  // image hosted anywhere.
  const [mode, setMode] = useState<'upload' | 'link'>('upload');
  // The latest block and onChange, so an upload that finishes later never writes stale data.
  const latest = useRef({ block, onChange });
  latest.current = { block, onChange };
  const start = async (original: File) => {
    if (/heic|heif/i.test(original.type) || /\.(heic|heif)$/i.test(original.name)) { setState({ name: original.name, fraction: 0, error: imageProblem(original) || '' }); return; }
    setState({ name: original.name, fraction: 0 });
    const file = await prepareImage(original);
    const problem = imageProblem(file);
    if (problem) { setState({ name: original.name, fraction: 0, error: problem }); return; }
    const handle = uploadWithProgress('/api/upload/instructor', 'image', file, (fraction) => setState((s) => (s ? { ...s, fraction } : s)));
    setState({ name: original.name, fraction: 0, file: original, handle });
    handle.promise
      .then((body) => {
        setState(null);
        const url = String(body.url || body.imageUrl || body.secureUrl || '');
        const current = latest.current.block;
        latest.current.onChange({ ...current, url, alt: current.alt || original.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') });
      })
      .catch((err: Error & { status?: number }) => setState(err.status === -1 ? null : { name: original.name, fraction: 0, error: err.message, file: original }));
  };
  // An image pasted or dropped into a text block arrives here as a new image block to upload.
  useEffect(() => {
    const pending = pendingImages.get(block.id);
    if (pending) { pendingImages.delete(block.id); void start(pending); }
  }, [block.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      {!readOnly && <SourceTabs mode={mode} setMode={setMode} />}
      {mode === 'link' && (
        <Field label="Image link" hint="A direct link to a JPEG, PNG, GIF or WebP image, starting with https://. The image stays on that site, so it disappears if the site removes it.">
          <input className="input mt-1.5 w-full" type="url" inputMode="url" placeholder="https://" value={block.url} readOnly={readOnly} onChange={(e) => onChange({ ...block, url: e.target.value.trim() })} data-testid="image-link" />
        </Field>
      )}
      {state ? <UploadBar state={state} onRetry={() => state.file && start(state.file)} onCancel={() => { state.handle?.abort(); setState(null); }} />
        : block.url ? (
          <div className="flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={block.url} alt="" className="h-16 w-24 rounded-lg border border-line object-cover" />
            {!readOnly && <><label className="btn btn-secondary btn-sm cursor-pointer">Replace<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) start(f); }} /></label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ ...block, url: '' })}>Remove</button></>}
          </div>
        ) : !readOnly && mode === 'upload' && <DropZone accept="image/jpeg,image/png,image/webp,image/gif" label="Choose an image" hint="JPEG, PNG, WebP or GIF, up to 10 MB. If uploads are not available, use Link." onFile={start} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Description for screen readers" hint="What the image shows, in one sentence.">
          <input className="input mt-1.5 w-full" maxLength={300} value={block.alt} readOnly={readOnly} onChange={(e) => onChange({ ...block, alt: e.target.value })} />
        </Field>
        <Field label="Caption (optional)">
          <input className="input mt-1.5 w-full" maxLength={300} value={block.caption} readOnly={readOnly} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
        </Field>
      </div>
    </div>
  );
}

const TONES: Array<{ id: CalloutTone; label: string }> = [{ id: 'tip', label: 'Tip' }, { id: 'info', label: 'Note' }, { id: 'warning', label: 'Caution' }, { id: 'key', label: 'Key point' }];

export function BlockEditor(props: EditorProps) {
  const { block, readOnly, onChange } = props;
  switch (block.type) {
    case 'heading':
      return (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input className="input w-full flex-1 font-display text-lg font-semibold" placeholder="Section heading" maxLength={200} value={block.text} readOnly={readOnly} onChange={(e) => onChange({ ...block, text: e.target.value })} aria-label="Heading text" />
          <select className="input w-full sm:w-36" value={block.level} disabled={readOnly} onChange={(e) => onChange({ ...block, level: Number(e.target.value) === 3 ? 3 : 2 })} aria-label="Heading level">
            <option value={2}>Heading</option>
            <option value={3}>Subheading</option>
          </select>
        </div>
      );
    case 'text':
      return <TextBlockEditor ops={block.ops} readOnly={readOnly} label="Text" onImage={props.onTextImage} onChange={(ops) => { if (JSON.stringify(ops) !== JSON.stringify(block.ops)) onChange({ ...block, ops }); }} />;
    case 'callout':
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Callout type">
            {TONES.map((t) => <button key={t.id} type="button" role="radio" aria-checked={block.tone === t.id} disabled={readOnly} onClick={() => onChange({ ...block, tone: t.id })} className={`rounded-full border px-3 py-1 text-xs font-semibold ${block.tone === t.id ? 'border-primary-500 bg-primary-500/10 text-primary-700 dark:text-primary-300' : 'border-line text-ink-muted'}`}>{t.label}</button>)}
          </div>
          <input className="input w-full" placeholder="Title (optional)" maxLength={120} value={block.title} readOnly={readOnly} onChange={(e) => onChange({ ...block, title: e.target.value })} aria-label="Callout title" />
          <textarea className="input min-h-[5rem] w-full" placeholder="What students should notice" maxLength={4000} value={block.text} readOnly={readOnly} onChange={(e) => onChange({ ...block, text: e.target.value })} aria-label="Callout text" />
        </div>
      );
    case 'image':
      return <ImageEditor {...props} block={block} />;
    case 'video':
      return (
        <div className="space-y-3">
          <MediaSource {...props} block={block} kind="video" />
          <Field label="Caption (optional)"><input className="input mt-1.5 w-full" maxLength={300} value={block.caption} readOnly={readOnly} onChange={(e) => onChange({ ...block, caption: e.target.value })} /></Field>
        </div>
      );
    case 'file':
      return (
        <div className="space-y-3">
          <MediaSource {...props} block={block} kind="file" />
          <Field label="Title students see" hint="For example: Trading plan template.">
            <input className="input mt-1.5 w-full" maxLength={200} value={block.title} readOnly={readOnly} onChange={(e) => onChange({ ...block, title: e.target.value })} />
          </Field>
        </div>
      );
    case 'link':
      return (
        <div className="space-y-3">
          <Field label="Link"><input className="input mt-1.5 w-full" type="url" inputMode="url" placeholder="https://" value={block.url} readOnly={readOnly} onChange={(e) => onChange({ ...block, url: e.target.value })} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" hint="Say what it is, not just the address."><input className="input mt-1.5 w-full" maxLength={200} value={block.title} readOnly={readOnly} onChange={(e) => onChange({ ...block, title: e.target.value })} /></Field>
            <Field label="Why it is useful (optional)"><input className="input mt-1.5 w-full" maxLength={500} value={block.description} readOnly={readOnly} onChange={(e) => onChange({ ...block, description: e.target.value })} /></Field>
          </div>
        </div>
      );
    case 'code':
      return (
        <div className="space-y-3">
          <input className="input w-full" placeholder="Label (optional), e.g. Position size calculation" maxLength={80} value={block.label} readOnly={readOnly} onChange={(e) => onChange({ ...block, label: e.target.value })} aria-label="Example label" />
          <textarea className="input min-h-[8rem] w-full font-mono text-sm" spellCheck={false} maxLength={20000} value={block.text} readOnly={readOnly} onChange={(e) => onChange({ ...block, text: e.target.value })} aria-label="Example text" />
        </div>
      );
    case 'divider':
      return <hr className="border-line" />;
    case 'legacy':
      return <LegacyEditor {...props} block={block} />;
    default:
      return null;
  }
}

/** Content written before the builder: shown as students see it, convertible to an editable text block. */
function LegacyEditor({ block, legacy, readOnly, onChange }: EditorProps & { block: Extract<Block, { type: 'legacy' }> }) {
  const [converting, setConverting] = useState(false);
  const html = legacy[block.field] || '';
  if (converting) {
    return <TextBlockEditor importHtml={html} label="Converted text" onChange={(ops) => onChange({ id: block.id, type: 'text', ops })} />;
  }
  return (
    <div className="space-y-3">
      <div className="max-h-72 overflow-y-auto rounded-xl border border-line bg-surface-2 p-4">
        <div className="rich-html-readable text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(html) }} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-xs text-ink-subtle">Written before the course builder. It is shown to students as above. Convert it to edit it here.</p>
        {!readOnly && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConverting(true)} data-testid="convert-legacy">Convert to editable text</button>}
      </div>
    </div>
  );
}

const TYPE_LABEL: Record<BlockType, string> = { heading: 'Heading', text: 'Text', callout: 'Callout', image: 'Image', video: 'Video', file: 'File', link: 'Link', code: 'Example', divider: 'Divider', legacy: 'Earlier content' };

export function BlockFrame({ block, index, count, readOnly, issue, children, onMove, onDuplicate, onRemove, onInsert }: {
  block: Block; index: number; count: number; readOnly: boolean; issue?: string; children: React.ReactNode;
  onMove: (delta: number) => void; onDuplicate: () => void; onRemove: () => void; onInsert: (type: BlockType) => void;
}) {
  const Icon = BLOCK_MENU.find((m) => m.type === block.type)?.Icon || FileText;
  return (
    <div className="group relative" id={`edit-block-${block.id}`} data-testid="block-editor" data-block-type={block.type}>
      <div className={`rounded-2xl border bg-surface-1 transition-colors focus-within:border-primary-500/60 ${issue ? 'border-amber-500/60' : 'border-line'}`}>
        <div className="flex items-center gap-2 border-b border-line px-3 py-1.5">
          <Icon className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
          <span className="text-2xs font-semibold uppercase tracking-[0.12em] text-ink-subtle">{TYPE_LABEL[block.type]}</span>
          {issue && <span className="ml-1 flex items-center gap-1 text-2xs font-medium text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3 w-3" aria-hidden />{issue}</span>}
          {!readOnly && (
            <span className="ml-auto flex items-center gap-0.5">
              <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)} Icon={ArrowUp} />
              <IconButton label="Move down" disabled={index === count - 1} onClick={() => onMove(1)} Icon={ArrowDown} />
              <IconButton label="Duplicate block" onClick={onDuplicate} Icon={Copy} />
              <IconButton label="Delete block" onClick={onRemove} Icon={Trash2} danger />
            </span>
          )}
        </div>
        <div className="p-3 sm:p-4">{children}</div>
      </div>
      {!readOnly && (
        <div className="pointer-events-none absolute inset-x-0 -bottom-3.5 z-10 flex justify-center opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
          <AddBlockMenu compact onAdd={onInsert} />
        </div>
      )}
    </div>
  );
}

function IconButton({ label, onClick, Icon, disabled, danger }: { label: string; onClick: () => void; Icon: typeof Plus; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={`rounded-lg p-1.5 disabled:opacity-30 ${danger ? 'text-ink-subtle hover:bg-red-500/10 hover:text-red-600' : 'text-ink-subtle hover:bg-tint hover:text-ink'}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}
