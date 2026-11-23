/**
 * Rich text for one text block. Quill (already used by the app) edits it, but the block stores
 * Quill's Delta (text runs + allowed formats), never HTML; the server checks it again
 * (lib/course-content.js normalizeDelta) and students see it through components/course/RichText.
 * Only the formats below exist in the toolbar; pasted colours and fonts are dropped. An image
 * (toolbar button, paste or drop) is not stored inside the text: the block is split at the cursor
 * and the image becomes its own image block there (onImage), so it is uploaded, captioned and
 * shown to students like any other image.
 */

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef } from 'react';
import 'react-quill/dist/quill.snow.css';
import type { DeltaOp } from '@/lib/course-content';

type QuillEditor = {
  getContents: (index?: number, length?: number) => { ops: DeltaOp[] };
  setContents: (d: { ops: DeltaOp[] }) => void;
  getSelection: (focus?: boolean) => { index: number; length: number } | null;
  getLength: () => number;
  root: HTMLElement;
};
type QuillHandle = { getEditor: () => QuillEditor };

const ReactQuill = dynamic(
  async () => {
    const { default: RQ } = await import('react-quill');
    function Forwarded({ forwardedRef, ...props }: Record<string, unknown> & { forwardedRef: React.Ref<QuillHandle> }) {
      const Component = RQ as unknown as React.ComponentType<Record<string, unknown>>;
      return <Component ref={forwardedRef} {...props} />;
    }
    return Forwarded;
  },
  { ssr: false, loading: () => <div className="min-h-[9rem] animate-pulse rounded-xl border border-line bg-surface-2" /> }
) as unknown as React.ComponentType<Record<string, unknown> & { forwardedRef: React.Ref<QuillHandle> }>;

export const TEXT_FORMATS = ['header', 'bold', 'italic', 'underline', 'strike', 'list', 'bullet', 'indent', 'blockquote', 'code', 'link'];

type Props = {
  ops?: DeltaOp[];
  /** Earlier lesson HTML to convert into editable text (legacy content). */
  importHtml?: string;
  onChange: (ops: DeltaOp[]) => void;
  placeholder?: string;
  readOnly?: boolean;
  label: string;
  /** An image was added at the cursor: the text before and after it. */
  onImage?: (file: File, split: { before: DeltaOp[]; after: DeltaOp[] }) => void;
};

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list || []).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
}

export default function TextBlockEditor({ ops, importHtml, onChange, placeholder, readOnly, label, onImage }: Props) {
  const onImageRef = useRef(onImage);
  onImageRef.current = onImage;
  const ref = useRef<QuillHandle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Uncontrolled: the editor owns its text while it is open; the parent receives every change.
  const initial = useMemo(() => (importHtml !== undefined ? importHtml : { ops: ops && ops.length ? ops : [{ insert: '\n' }] }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Splits the text at the cursor (or at the end) and hands the image over.
  const placeImage = (file: File, at?: number) => {
    const editor = ref.current?.getEditor?.();
    const handler = onImageRef.current;
    if (!editor || !handler) return;
    const length = editor.getLength();
    const index = Math.max(0, Math.min(at ?? editor.getSelection()?.index ?? length - 1, length - 1));
    const before = editor.getContents(0, index).ops;
    const last = before[before.length - 1];
    if (!last || typeof last.insert !== 'string' || !last.insert.endsWith('\n')) before.push({ insert: '\n' });
    handler(file, { before, after: editor.getContents(index).ops });
  };
  const placeImageRef = useRef(placeImage);
  placeImageRef.current = placeImage;

  const modules = useMemo(() => ({
    toolbar: {
      container: [
        [{ header: 2 }, { header: 3 }],
        ['bold', 'italic', 'underline', 'strike', 'code'],
        [{ list: 'ordered' }, { list: 'bullet' }, 'blockquote'],
        ['link', ...(onImageRef.current ? ['image'] : [])],
        ['clean'],
      ],
      handlers: {
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
    clipboard: { matchVisual: false },
  }), []);

  // Pasted or dropped images (screenshots, files from the desktop) become image blocks.
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
    <div className="builder-quill" aria-label={label}>
      <ReactQuill
        forwardedRef={ref}
        theme="snow"
        defaultValue={initial}
        readOnly={readOnly}
        placeholder={placeholder || (onImage ? 'Write here. Use the toolbar for headings, lists, emphasis and links. Paste or drop an image to add it here.' : 'Write here. Use the toolbar for headings, lists, emphasis and links.')}
        modules={modules}
        formats={TEXT_FORMATS}
        onChange={(_html: string, _delta: unknown, source: string, editor: { getContents: () => { ops: DeltaOp[] } }) => {
          if (source === 'user' || source === 'api') onChangeRef.current(editor.getContents().ops);
        }}
      />
    </div>
  );
}
