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
  const [isInitialized, setIsInitialized] = React.useState(false);

  // Update editor content when value prop changes (for switching between topics)
  React.useEffect(() => {
    if (!editorRef.current || !isInitialized) return;

    const editor = editorRef.current as any;
    // Always sync the editor content with the value prop to ensure consistency across topic switches
    if (editor?.setContent) {
      try {
        editor.setContent(value || '');
      } catch (err) {
        console.warn('Failed to sync editor content:', err);
      }
    }
  }, [value, isInitialized]);

  return (
    <div className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
      <Editor
        onInit={(evt: any, editor: TinyMCEEditor | any) => {
          editorRef.current = editor;
          setIsInitialized(true);
          // Set initial content on init
          if (editor?.setContent && value) {
            editor.setContent(value);
          }
        }}
        value={value}
        onEditorChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        apiKey='gaz94mfy7gknyb05b6a91k0d0eykt6kgebi4jf2q5kyzvj8p'
        init={{
          height,
          plugins: [
            'anchor', 'autolink', 'charmap', 'codesample', 'emoticons', 'image', 'link', 'lists', 'media', 'searchreplace', 'table', 'visualblocks', 'wordcount',
            'checklist', 'mediaembed', 'casechange', 'formatpainter', 'pageembed', 'a11ychecker', 'tinymcespellchecker', 'permanentpen', 'powerpaste', 'advtable', 'advcode', 'advtemplate', 'ai', 'uploadcare', 'mentions', 'tinycomments', 'tableofcontents', 'footnotes', 'mergetags', 'autocorrect', 'typography', 'inlinecss', 'markdown', 'importword', 'exportword', 'exportpdf'
          ],
          toolbar: 'undo redo | blocks fontfamily fontsize | bold italic underline strikethrough | link image media table mergetags | addcomment showcomments | spellcheckdialog a11ycheck typography uploadcare | align lineheight | checklist numlist bullist indent outdent | emoticons charmap | removeformat',
          tinycomments_mode: 'embedded',
          tinycomments_author: 'Author name',
          mergetags_list: [
            { value: 'First.Name', title: 'First Name' },
            { value: 'Email', title: 'Email' },
          ],
          ai_request: (request: any, respondWith: any) => respondWith.string(() => Promise.reject('See docs to implement AI Assistant')),
          uploadcare_public_key: 'c95635c56a53e8832491',
          images_upload_handler: async (blobInfo: any) => {
            const formData = new FormData();
            formData.append('image', blobInfo.blob(), blobInfo.filename());

            const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
            
            const response = await fetch('/api/upload/instructor', {
              method: 'POST',
              body: formData,
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });

            if (!response.ok) {
              throw new Error('Image upload failed');
            }

            const data = await response.json();
            return data.url || data.imageUrl || data.secureUrl;
          },
        }}
        initialValue="Welcome to TinyMCE!"
      />
    </div>
  );
}
