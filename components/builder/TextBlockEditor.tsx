/**
 * Rich text for one text block. Quill (already used by the app) edits it, but the block stores
 * Quill's Delta (text runs + allowed formats), never HTML; the server checks it again
 * (lib/course-content.js normalizeDelta) and students see it through components/course/RichText.
 * Only the formats below exist in the toolbar; pasted colours, fonts and images are dropped.
 */

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef } from 'react';
import 'react-quill/dist/quill.snow.css';
import type { DeltaOp } from '@/lib/course-content';

type QuillEditor = { getContents: () => { ops: DeltaOp[] }; setContents: (d: { ops: DeltaOp[] }) => void; root: HTMLElement };
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
};

export default function TextBlockEditor({ ops, importHtml, onChange, placeholder, readOnly, label }: Props) {
  const ref = useRef<QuillHandle | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Uncontrolled: the editor owns its text while it is open; the parent receives every change.
  const initial = useMemo(() => (importHtml !== undefined ? importHtml : { ops: ops && ops.length ? ops : [{ insert: '\n' }] }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const modules = useMemo(() => ({
    toolbar: [
      [{ header: 2 }, { header: 3 }],
      ['bold', 'italic', 'underline', 'strike', 'code'],
      [{ list: 'ordered' }, { list: 'bullet' }, 'blockquote'],
      ['link'],
      ['clean'],
    ],
    clipboard: { matchVisual: false },
  }), []);

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
        placeholder={placeholder || 'Write here. Use the toolbar for headings, lists, emphasis and links.'}
        modules={modules}
        formats={TEXT_FORMATS}
        onChange={(_html: string, _delta: unknown, source: string, editor: { getContents: () => { ops: DeltaOp[] } }) => {
          if (source === 'user' || source === 'api') onChangeRef.current(editor.getContents().ops);
        }}
      />
    </div>
  );
}
