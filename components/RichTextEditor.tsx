'use client';

import { useRef } from 'react';
import dynamic from 'next/dynamic';

// Dynamically import TinyMCE to avoid SSR issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Editor = dynamic(
  () => import('@tinymce/tinymce-react').then((mod: any) => mod.Editor),
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

/**
 * Reusable RichTextEditor component using TinyMCE
 * Used for course description, lesson content, and other rich-text fields
 */
export default function RichTextEditor({
  value,
  onChange,
  height = 300,
  disabled = false,
  onBlur,
}: RichTextEditorProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);

  return (
    <div className="w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden">
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Editor
        onInit={(evt: any, editor: any) => (editorRef.current = editor)}
        value={value}
        onEditorChange={onChange}
        onBlur={onBlur}
        disabled={disabled}
        init={{
          apiKey: process.env.NEXT_PUBLIC_TINYMCE_API_KEY || 'your-api-key',
          height: height,
          menubar: true,
          branding: false,
          plugins: [
            'advlist autolink lists link image charmap print preview anchor',
            'searchreplace visualblocks code fullscreen',
            'insertdatetime media table paste code help wordcount',
          ],
          toolbar:
            'undo redo | formatselect | bold italic underline | fontfamily fontsize | ' +
            'forecolor backcolor | alignleft aligncenter alignright alignjustify | ' +
            'bullist numlist outdent indent | link image media table | ' +
            'removeformat | code | help',
          fontsize_formats: '8px 10px 12px 14px 16px 18px 20px 22px 24px 26px 28px 32px 36px 48px 60px 72px',
          font_family_formats:
            'Arial=arial,helvetica,sans-serif;' +
            'Times New Roman=times new roman,times,serif;' +
            'Courier New=courier new,courier,monospace;' +
            'Georgia=georgia,serif;' +
            'Verdana=verdana,geneva,sans-serif;' +
            'Comic Sans MS=comic sans ms,cursive;' +
            'Trebuchet MS=trebuchet ms,sans-serif;' +
            'Impact=impact,sans-serif;',
          content_style:
            'body { font-family: Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333; }' +
            'h1 { font-size: 28px; font-weight: bold; margin: 16px 0; }' +
            'h2 { font-size: 24px; font-weight: bold; margin: 14px 0; }' +
            'h3 { font-size: 20px; font-weight: bold; margin: 12px 0; }' +
            'h4 { font-size: 16px; font-weight: bold; margin: 10px 0; }' +
            'h5 { font-size: 14px; font-weight: bold; margin: 8px 0; }' +
            'h6 { font-size: 12px; font-weight: bold; margin: 8px 0; }' +
            'p { margin: 10px 0; }' +
            'ul, ol { margin: 10px 0; padding-left: 20px; }' +
            'li { margin: 5px 0; }' +
            'blockquote { border-left: 4px solid #ccc; padding-left: 16px; margin: 10px 0; color: #666; }' +
            'code { background-color: #f4f4f4; padding: 2px 4px; border-radius: 3px; font-family: monospace; }' +
            'pre { background-color: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; }' +
            'table { border-collapse: collapse; width: 100%; margin: 10px 0; }' +
            'td, th { border: 1px solid #ddd; padding: 8px; text-align: left; }' +
            'th { background-color: #f0f0f0; font-weight: bold; }' +
            'a { color: #0066cc; text-decoration: none; }' +
            'a:hover { text-decoration: underline; }' +
            'img { max-width: 100%; height: auto; margin: 10px 0; }',
          formats: {
            bold: { inline: 'strong' },
            italic: { inline: 'em' },
            underline: { inline: 'u' },
          },
          link_target_list: [
            { title: 'None', value: '' },
            { title: 'New window', value: '_blank' },
          ],
          table_toolbar: 'tableprops tabledelete | tableinsertrowbefore tableinsertrowafter tabledeleterow | tableinsertcolbefore tableinsertcolafter tabledeletecol',
          relative_urls: false,
          remove_script_host: false,
        }}
      />
    </div>
  );
}
