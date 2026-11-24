/**
 * Rich text for one text block. Quill (already used by the app) edits it, but the block stores
 * Quill's Delta (text runs + allowed formats), never HTML; the server checks it again
 * (lib/course-content.js normalizeDelta) and students see it through components/course/RichText.
 * Only the formats below exist in the toolbar; other pasted colours, sizes and fonts are dropped. An
 * image or a table is not stored inside the text: the block is split at the cursor and it becomes
 * its own block there (onImage, onTable), shown to students like any other block.
 */

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'react-quill/dist/quill.snow.css';
import EmojiPicker from '@/components/builder/EmojiPicker';
import { TEXT_ALIGNS, TEXT_COLORS, TEXT_HIGHLIGHTS, TEXT_SIZES, type DeltaOp } from '@/lib/course-content';

type Split = { before: DeltaOp[]; after: DeltaOp[] };
type QuillEditor = {
  getContents: (index?: number, length?: number) => { ops: DeltaOp[] };
  setContents: (d: { ops: DeltaOp[] }) => void;
  getSelection: (focus?: boolean) => { index: number; length: number } | null;
  setSelection: (index: number, length: number, source?: string) => void;
  insertText: (index: number, text: string, source?: string) => void;
  deleteText: (index: number, length: number, source?: string) => void;
  getLength: () => number;
  getModule: (name: string) => { container?: HTMLElement; undo?: () => void; redo?: () => void };
  root: HTMLElement;
};
type QuillHandle = { getEditor: () => QuillEditor };

const svg = (path: string) => `<svg viewBox="0 0 18 18" fill="none" class="ql-fo-icon" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICONS: Record<string, string> = {
  undo: svg('<path class="ql-stroke" d="M4 7h7a4 4 0 0 1 0 8H7"/><path class="ql-stroke" d="M7 4 4 7l3 3"/>'),
  redo: svg('<path class="ql-stroke" d="M14 7H7a4 4 0 0 0 0 8h4"/><path class="ql-stroke" d="m11 4 3 3-3 3"/>'),
  emoji: svg('<circle class="ql-stroke" cx="9" cy="9" r="6.5"/><path class="ql-stroke" d="M6.3 10.8a3.2 3.2 0 0 0 5.4 0M6.8 7.2h.01M11.2 7.2h.01"/>'),
  table: svg('<rect class="ql-stroke" x="2.5" y="3.5" width="13" height="11" rx="1.2"/><path class="ql-stroke" d="M2.5 7.5h13M2.5 11h13M7 7.5v7M11.3 7.5v7"/>'),
};

const ReactQuill = dynamic(
  async () => {
    const { default: RQ } = await import('react-quill');
    const icons = (RQ as unknown as { Quill: { import: (name: string) => unknown } }).Quill.import('ui/icons') as Record<string, string>;
    Object.assign(icons, ICONS);
    function Forwarded({ forwardedRef, ...props }: Record<string, unknown> & { forwardedRef: React.Ref<QuillHandle> }) {
      const Component = RQ as unknown as React.ComponentType<Record<string, unknown>>;
      return <Component ref={forwardedRef} {...props} />;
    }
    return Forwarded;
  },
  { ssr: false, loading: () => <div className="min-h-[9rem] animate-pulse rounded-xl border border-line bg-surface-2" /> }
) as unknown as React.ComponentType<Record<string, unknown> & { forwardedRef: React.Ref<QuillHandle> }>;

export const TEXT_FORMATS = ['header', 'size', 'bold', 'italic', 'underline', 'strike', 'script', 'code', 'color', 'background', 'align', 'list', 'bullet', 'indent', 'blockquote', 'link'];

/** Toolbar control -> what it does, for tooltips and screen readers. */
const LABELS: Array<[string, string]> = [
  ['.ql-undo', 'Undo'], ['.ql-redo', 'Redo'], ['.ql-header', 'Heading'], ['.ql-size', 'Font size'], ['.ql-bold', 'Bold'], ['.ql-italic', 'Italic'],
  ['.ql-underline', 'Underline'], ['.ql-strike', 'Strikethrough'], ['.ql-script[value=sub]', 'Subscript'], ['.ql-script[value=super]', 'Superscript'],
  ['.ql-code', 'Inline code'], ['.ql-color', 'Text colour'], ['.ql-background', 'Highlight'], ['.ql-align', 'Alignment'],
  ['.ql-list[value=ordered]', 'Numbered list'], ['.ql-list[value=bullet]', 'Bulleted list'], ['.ql-indent[value="-1"]', 'Decrease indent'], ['.ql-indent[value="+1"]', 'Increase indent'],
  ['.ql-blockquote', 'Quote'], ['.ql-link', 'Link'], ['.ql-emoji', 'Emoji'], ['.ql-image', 'Image'], ['.ql-table', 'Table'], ['.ql-clean', 'Clear formatting'],
];

type Props = {
  ops?: DeltaOp[];
  /** Earlier lesson HTML to convert into editable text (legacy content). */
  importHtml?: string;
  onChange: (ops: DeltaOp[]) => void;
  placeholder?: string;
  readOnly?: boolean;
  label: string;
  /** An image was added at the cursor: the text before and after it. */
  onImage?: (file: File, split: Split) => void;
  /** A table was asked for at the cursor. */
  onTable?: (split: Split) => void;
};

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list || []).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
}

/** rgb(194, 78, 0) -> #c24e00; palette colours come back from the page in this form when pasted. */
function hex(value: unknown) {
  const m = typeof value === 'string' ? /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value) : null;
  return m ? `#${m.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : String(value || '').toLowerCase();
}

/** Keeps only the palette's colours and the known sizes and alignments of pasted text. */
function cleanPasted(_node: Node, delta: { ops: DeltaOp[] }) {
  for (const op of delta.ops) {
    const a = op.attributes;
    if (!a) continue;
    for (const [key, allowed] of [['color', TEXT_COLORS], ['background', TEXT_HIGHLIGHTS]] as const) {
      if (a[key] === undefined) continue;
      const value = hex(a[key]);
      if (allowed.includes(value)) a[key] = value;
      else delete a[key];
    }
    if (a.size !== undefined && !TEXT_SIZES.includes(String(a.size))) delete a.size;
    if (a.align !== undefined && !TEXT_ALIGNS.includes(String(a.align))) delete a.align;
    if (a.header === 1) a.header = 2;
    else if (typeof a.header === 'number' && a.header > 4) a.header = 4;
  }
  return delta;
}

export default function TextBlockEditor({ ops, importHtml, onChange, placeholder, readOnly, label, onImage, onTable }: Props) {
  const onImageRef = useRef(onImage);
  onImageRef.current = onImage;
  const onTableRef = useRef(onTable);
  onTableRef.current = onTable;
  const ref = useRef<QuillHandle | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Where the emoji panel inserts: the cursor when it was opened, moving on after each emoji.
  const [emojiAt, setEmojiAt] = useState<{ index: number; length: number } | null>(null);
  // Uncontrolled: the editor owns its text while it is open; the parent receives every change.
  const initial = useMemo(() => (importHtml !== undefined ? importHtml : { ops: ops && ops.length ? ops : [{ insert: '\n' }] }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // The text before and after the cursor (or the end), for something placed there as its own block.
  const splitAt = (at?: number): Split | null => {
    const editor = ref.current?.getEditor?.();
    if (!editor) return null;
    const length = editor.getLength();
    const index = Math.max(0, Math.min(at ?? editor.getSelection()?.index ?? length - 1, length - 1));
    const before = editor.getContents(0, index).ops;
    const last = before[before.length - 1];
    const after = editor.getContents(index).ops;
    if (!last || typeof last.insert !== 'string' || !last.insert.endsWith('\n')) {
      // The cut line keeps its own format (alignment, list, heading), stored on its line break.
      const end = after.find((op) => op.insert.includes('\n'));
      before.push(end && /^\n+$/.test(end.insert) && end.attributes ? { insert: '\n', attributes: end.attributes } : { insert: '\n' });
    }
    return { before, after };
  };
  const placeImage = (file: File, at?: number) => {
    const split = onImageRef.current ? splitAt(at) : null;
    if (split) onImageRef.current!(file, split);
  };
  const placeImageRef = useRef(placeImage);
  placeImageRef.current = placeImage;
  const placeTableRef = useRef<() => void>(() => undefined);
  placeTableRef.current = () => {
    const split = onTableRef.current ? splitAt() : null;
    if (split) onTableRef.current!(split);
  };

  const pickEmoji = (emoji: string) => {
    const editor = ref.current?.getEditor?.();
    if (!editor || !emojiAt) return;
    if (emojiAt.length) editor.deleteText(emojiAt.index, emojiAt.length, 'user');
    editor.insertText(emojiAt.index, emoji, 'user');
    const index = emojiAt.index + emoji.length;
    editor.setSelection(index, 0, 'user');
    setEmojiAt({ index, length: 0 });
  };

  const modules = useMemo(() => ({
    toolbar: {
      container: [
        ['undo', 'redo'],
        [{ header: [2, 3, 4, false] }, { size: ['small', false, 'large', 'huge'] }],
        ['bold', 'italic', 'underline', 'strike'],
        [{ color: [false, ...TEXT_COLORS] }, { background: [false, ...TEXT_HIGHLIGHTS] }],
        [{ align: [false, 'center', 'right', 'justify'] }, { list: 'bullet' }, { list: 'ordered' }, { indent: '-1' }, { indent: '+1' }],
        ['blockquote', 'code', { script: 'sub' }, { script: 'super' }],
        ['link', 'emoji', ...(onImageRef.current ? ['image'] : []), ...(onTableRef.current ? ['table'] : [])],
        ['clean'],
      ],
      handlers: {
        undo: () => ref.current?.getEditor?.().getModule('history').undo?.(),
        redo: () => ref.current?.getEditor?.().getModule('history').redo?.(),
        emoji: () => {
          const editor = ref.current?.getEditor?.();
          if (!editor) return;
          const at = editor.getSelection(true) || { index: editor.getLength() - 1, length: 0 };
          setEmojiAt((open) => (open ? null : { index: at.index, length: at.length }));
        },
        table: () => placeTableRef.current(),
        // Opens the file chooser; the image goes where the cursor is.
        image: () => {
          const editor = ref.current?.getEditor?.();
          const at = editor?.getSelection(true)?.index;
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/jpeg,image/png,image/webp,image/gif';
          input.onchange = () => { const file = imageFiles(input.files)[0]; if (file) placeImageRef.current(file, at); };
          input.click();
        },
      },
    },
    clipboard: { matchVisual: false, matchers: [[1, cleanPasted]] },
  }), []);

  // Pasted or dropped images (screenshots, files from the desktop) become image blocks, and every
  // toolbar control gets a name.
  useEffect(() => {
    if (readOnly) return;
    let root: HTMLElement | null = null;
    const onPaste = (e: ClipboardEvent) => {
      const file = imageFiles(e.clipboardData?.files)[0];
      if (!file || !onImageRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      placeImageRef.current(file);
    };
    const onDragOver = (e: DragEvent) => { if (onImageRef.current && Array.from(e.dataTransfer?.items || []).some((i) => i.kind === 'file')) e.preventDefault(); };
    const onDrop = (e: DragEvent) => {
      const file = imageFiles(e.dataTransfer?.files)[0];
      if (!file || !onImageRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      placeImageRef.current(file);
    };
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const editor = ref.current?.getEditor?.();
      if (editor) {
        clearInterval(timer);
        root = editor.root;
        root.addEventListener('paste', onPaste, true);
        root.addEventListener('dragover', onDragOver, true);
        root.addEventListener('drop', onDrop, true);
        const toolbar = editor.getModule('toolbar').container;
        for (const [selector, name] of LABELS) {
          toolbar?.querySelectorAll<HTMLElement>(`button${selector}, span${selector}`).forEach((el) => {
            el.title = name;
            (el.matches('button') ? el : el.querySelector('.ql-picker-label') || el).setAttribute('aria-label', name);
          });
        }
      } else if (tries > 100) clearInterval(timer);
    }, 100);
    return () => {
      clearInterval(timer);
      if (root) {
        root.removeEventListener('paste', onPaste, true);
        root.removeEventListener('dragover', onDragOver, true);
        root.removeEventListener('drop', onDrop, true);
      }
    };
  }, [readOnly]);

  // Converted legacy HTML is handed to the parent once, as text it can save.
  useEffect(() => {
    if (importHtml === undefined) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const editor = ref.current?.getEditor?.();
      if (editor) {
        clearInterval(timer);
        onChangeRef.current(editor.getContents().ops);
      } else if (tries > 50) clearInterval(timer);
    }, 100);
    return () => clearInterval(timer);
  }, [importHtml]);

  return (
    <div ref={box} className="builder-quill relative" aria-label={label}>
      <ReactQuill
        forwardedRef={ref}
        theme="snow"
        defaultValue={initial}
        readOnly={readOnly}
        placeholder={placeholder || (onImage ? 'Write here. Paste or drop an image to add it here.' : 'Write here.')}
        modules={modules}
        formats={TEXT_FORMATS}
        onChange={(_html: string, _delta: unknown, source: string, editor: { getContents: () => { ops: DeltaOp[] } }) => {
          if (source === 'user' || source === 'api') onChangeRef.current(editor.getContents().ops);
        }}
      />
      {emojiAt && <EmojiPicker onPick={pickEmoji} onClose={() => setEmojiAt(null)} className="right-2 top-12" />}
    </div>
  );
}
