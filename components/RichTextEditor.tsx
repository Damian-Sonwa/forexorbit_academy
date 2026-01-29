// @ts-nocheck
import * as React from 'react';
import dynamic from 'next/dynamic';
import type { Editor as TinyMCEEditor } from '@tinymce/tinymce-react';

// Dynamically import TinyMCE to avoid SSR issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Editor = dynamic(
  () => import('@tinymce/tinymce-react').then(mod => mod.Editor),
  { ssr: false }
) as any;

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

  return (
    <div className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
      <Editor
        onInit={(evt: any, editor: TinyMCEEditor | any) => (editorRef.current = editor)}
        value={value}
        onEditorChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        apiKey={process.env.NEXT_PUBLIC_TINYMCE_API_KEY}
        init={{
          height,
          menubar: true,
          branding: false,
          plugins: [
            'advlist', 'autolink', 'lists', 'link', 'image', 'charmap', 'anchor',
            'searchreplace', 'visualblocks', 'code', 'fullscreen', 'insertdatetime',
            'media', 'table', 'preview', 'help', 'wordcount',
            'checklist','mediaembed','casechange','formatpainter','pageembed',
            'a11ychecker','tinymcespellchecker','permanentpen','powerpaste',
            'advtable','advcode','advtemplate','ai','uploadcare','mentions',
            'tinycomments','tableofcontents','footnotes','mergetags','autocorrect',
            'typography','inlinecss','markdown','importword','exportword','exportpdf'
          ],
          toolbar:
            'undo redo | blocks fontfamily fontsize | bold italic underline strikethrough | ' +
            'link media table mergetags | addcomment showcomments | spellcheckdialog a11ycheck typography uploadcare | ' +
            'align lineheight | checklist numlist bullist indent outdent | emoticons charmap | removeformat',
          content_style: 'body { font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; }',
          tinycomments_mode: 'embedded',
          tinycomments_author: 'Instructor Name',
          mergetags_list: [
            { value: 'First.Name', title: 'First Name' },
            { value: 'Email', title: 'Email' },
          ],
          uploadcare_public_key: 'c95635c56a53e8832491',
          table_toolbar: 'tableprops tabledelete | tableinsertrowbefore tableinsertrowafter tabledeleterow | tableinsertcolbefore tableinsertcolafter tabledeletecol',
          relative_urls: false,
          remove_script_host: false,
        }}
      />
    </div>
  );
}
