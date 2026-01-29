import * as React from 'react';
import dynamic from 'next/dynamic';
import type { Editor as TinyMCEEditor } from '@tinymce/tinymce-react';

// Dynamically import TinyMCE to avoid SSR issues
// Use `any` to avoid typing mismatches from the tinyMCE module during dynamic import
const Editor = dynamic<any>(
  () => import('@tinymce/tinymce-react').then((mod: any) => mod.Editor),
  { ssr: false }
);

interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  height?: number;
  disabled?: boolean;
  onBlur?: () => void;
}

export default function RichTextEditor({
  value,
  onChange,
  height = 300,
  disabled = false,
  onBlur,
}: RichTextEditorProps) {
  const editorRef = React.useRef<TinyMCEEditor | null>(null); // ✅ Use TinyMCEEditor type

  // Update editor content when value prop changes
  React.useEffect(() => {
    if (editorRef.current && value !== undefined) {
      // Use the correct method to update editor content
      const editor = editorRef.current as any;
      if (editor && editor.getContent) {
        // Only update if the current content differs from the new value
        const currentContent = editor.getContent();
        if (currentContent !== value) {
          editor.setContent(value);
        }
      }
    }
  }, [value]);

  return (
    <div className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
      <Editor
        onInit={(evt: any, editor: TinyMCEEditor | any) => (editorRef.current = editor)}
        value={value}
        onEditorChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        apiKey='gaz94mfy7gknyb05b6a91k0d0eykt6kgebi4jf2q5kyzvj8p'
        init={{
          height,
          plugins: [
            'anchor', 'autolink', 'charmap', 'codesample', 'emoticons', 'link', 'lists', 'media', 'searchreplace', 'table', 'visualblocks', 'wordcount',
            'checklist', 'mediaembed', 'casechange', 'formatpainter', 'pageembed', 'a11ychecker', 'tinymcespellchecker', 'permanentpen', 'powerpaste', 'advtable', 'advcode', 'advtemplate', 'ai', 'uploadcare', 'mentions', 'tinycomments', 'tableofcontents', 'footnotes', 'mergetags', 'autocorrect', 'typography', 'inlinecss', 'markdown', 'importword', 'exportword', 'exportpdf'
          ],
          toolbar: 'undo redo | blocks fontfamily fontsize | bold italic underline strikethrough | link media table mergetags | addcomment showcomments | spellcheckdialog a11ycheck typography uploadcare | align lineheight | checklist numlist bullist indent outdent | emoticons charmap | removeformat',
          tinycomments_mode: 'embedded',
          tinycomments_author: 'Author name',
          mergetags_list: [
            { value: 'First.Name', title: 'First Name' },
            { value: 'Email', title: 'Email' },
          ],
          ai_request: (request: any, respondWith: any) => respondWith.string(() => Promise.reject('See docs to implement AI Assistant')),
          uploadcare_public_key: 'c95635c56a53e8832491',
        }}
        initialValue="Welcome to TinyMCE!"
      />
    </div>
  );
}
