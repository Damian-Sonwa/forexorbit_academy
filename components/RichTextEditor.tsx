'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import 'react-quill/dist/quill.snow.css';

const ReactQuill = dynamic(
  async () => {
    const { default: RQ } = await import('react-quill');
    return RQ;
  },
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[200px] bg-gray-100 dark:bg-gray-700 animate-pulse rounded-lg border border-gray-300 dark:border-gray-600" />
    ),
  }
) as React.ComponentType<{
  theme?: string;
  value?: string;
  onChange?: (content: string) => void;
  onBlur?: () => void;
  modules?: Record<string, unknown>;
  formats?: string[];
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}>;

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
  placeholder,
}: RichTextEditorProps) {
  // Keep in sync when parent loads content asynchronously (react-quill can miss prop updates)
  const [innerValue, setInnerValue] = React.useState(value ?? '');
  React.useEffect(() => {
    setInnerValue(value ?? '');
  }, [value]);

  const modules = React.useMemo(
    () => ({
      toolbar: {
        container: [
          [{ header: [1, 2, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          [{ indent: '-1' }, { indent: '+1' }],
          ['link', 'image'],
          ['clean'],
        ],
        handlers: {
          image: function (this: { quill: { getSelection: (b: boolean) => { index: number } | null; getLength: () => number; insertEmbed: (i: number, type: string, value: string) => void } }) {
            const quill = this.quill;
            const input = document.createElement('input');
            input.setAttribute('type', 'file');
            input.setAttribute('accept', 'image/*');
            input.click();
            input.onchange = async () => {
              const file = input.files?.[0];
              if (!file) return;
              try {
                const formData = new FormData();
                formData.append('image', file, file.name);

                const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
                if (!token) {
                  throw new Error('No authentication token found. Please log in again.');
                }

                const response = await fetch('/api/upload/instructor', {
                  method: 'POST',
                  body: formData,
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                });

                if (!response.ok) {
                  const errorData = await response.json().catch(() => ({ error: 'Upload failed' }));
                  throw new Error(errorData.error || `Upload failed with status ${response.status}`);
                }

                const data = await response.json();
                const imageUrl = data.url || data.imageUrl || data.secureUrl;
                if (!imageUrl) {
                  throw new Error('No image URL returned from server');
                }

                const range = quill.getSelection(true);
                const index = range ? range.index : Math.max(0, quill.getLength() - 1);
                quill.insertEmbed(index, 'image', imageUrl);
              } catch (error: unknown) {
                const message = error instanceof Error ? error.message : 'Image upload failed';
                console.error('Image upload error:', error);
                alert(message);
              }
            };
          },
        },
      },
    }),
    []
  );

  const formats = React.useMemo(
    () => [
      'header',
      'bold',
      'italic',
      'underline',
      'strike',
      'list',
      'bullet',
      'indent',
      'link',
      'image',
    ],
    []
  );

  return (
    <div
      className="rich-text-editor-root w-full bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden"
      style={{ ['--rich-editor-min-height' as string]: `${height}px` }}
    >
      <ReactQuill
        theme="snow"
        value={innerValue}
        onChange={(html) => {
          setInnerValue(html);
          onChange(html);
        }}
        onBlur={onBlur}
        modules={modules}
        formats={formats}
        readOnly={disabled}
        placeholder={placeholder}
        className="rich-text-editor-quill"
      />
    </div>
  );
}
