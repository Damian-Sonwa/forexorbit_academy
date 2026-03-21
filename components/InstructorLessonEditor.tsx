'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { apiClient } from '@/lib/api-client';
import 'react-quill/dist/quill.snow.css';

const ReactQuill = dynamic(
  async () => {
    const { default: RQ } = await import('react-quill');
    return RQ;
  },
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[400px] bg-gray-100 animate-pulse rounded-lg border border-gray-300" />
    ),
  }
) as React.ComponentType<{
  theme?: string;
  value?: string;
  onChange?: (content: string) => void;
  modules?: Record<string, unknown>;
  formats?: string[];
  className?: string;
}>;

interface InstructorLessonEditorProps {
  lessonId: string;
  courseId: string;
  initialContent?: string;
  onSave?: () => void;
}

export default function InstructorLessonEditor({
  lessonId,
  initialContent = '',
  onSave,
}: InstructorLessonEditorProps) {
  const [content, setContent] = useState(initialContent);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const autosaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedContentRef = useRef(initialContent);

  const modules = useMemo(
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
          image: function (this: {
            quill: {
              getSelection: (b: boolean) => { index: number } | null;
              getLength: () => number;
              insertEmbed: (i: number, type: string, value: string) => void;
            };
          }) {
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

  const formats = useMemo(
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

  useEffect(() => {
    setContent(initialContent);
    lastSavedContentRef.current = initialContent;
    setSaveStatus('idle');
    setErrorMessage('');
  }, [initialContent]);

  const handleAutosave = useCallback(async () => {
    if (content === lastSavedContentRef.current || !content.trim()) {
      return;
    }

    try {
      setSaveStatus('saving');
      setErrorMessage('');

      const updatedLesson = {
        content,
        lastModified: new Date().toISOString(),
      };

      const response: unknown = await apiClient.put(`/lessons/${lessonId}`, updatedLesson);

      if (response && typeof response === 'object' && 'success' in response && (response as { success: boolean }).success) {
        lastSavedContentRef.current = content;
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
        setErrorMessage(
          response && typeof response === 'object' && 'message' in response
            ? String((response as { message?: string }).message)
            : 'Failed to autosave'
        );
      }
    } catch {
      setSaveStatus('error');
      setErrorMessage('Autosave failed. Please save manually.');
    }
  }, [content, lessonId]);

  useEffect(() => {
    autosaveTimerRef.current = setInterval(() => {
      void handleAutosave();
    }, 30000);
    return () => {
      if (autosaveTimerRef.current) clearInterval(autosaveTimerRef.current);
    };
  }, [handleAutosave]);

  const handleSave = async () => {
    if (!content.trim()) {
      setErrorMessage('Lesson content cannot be empty');
      return;
    }

    try {
      setIsSaving(true);
      setSaveStatus('saving');
      setErrorMessage('');

      const updatedLesson = {
        content,
        lastModified: new Date().toISOString(),
      };

      const response: unknown = await apiClient.put(`/lessons/${lessonId}`, updatedLesson);

      if (response && typeof response === 'object' && 'success' in response && (response as { success: boolean }).success) {
        lastSavedContentRef.current = content;
        setSaveStatus('saved');
        setErrorMessage('');
        onSave?.();
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
        setErrorMessage(
          response && typeof response === 'object' && 'message' in response
            ? String((response as { message?: string }).message)
            : 'Failed to save lesson content'
        );
      }
    } catch (error) {
      setSaveStatus('error');
      setErrorMessage('Error saving lesson content. Please try again.');
      console.error('Save error:', error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full bg-white border border-gray-200 rounded-lg p-4 sm:p-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Lesson Content Editor</h3>
        <p className="text-sm text-gray-600 mt-1">
          Create and edit your lesson content with a rich text editor.
        </p>
      </div>

      {errorMessage && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <svg
            className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-sm text-red-700">{errorMessage}</span>
        </div>
      )}

      <div
        className="mb-4 border border-gray-300 rounded-lg overflow-hidden instructor-lesson-quill"
        style={{ ['--instructor-lesson-editor-h' as string]: '500px' }}
      >
        <ReactQuill
          key={lessonId}
          theme="snow"
          value={content}
          onChange={setContent}
          modules={modules}
          formats={formats}
          className="instructor-lesson-quill-inner"
        />
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isSaving && saveStatus === 'saving' && (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-200 border-t-blue-600 rounded-full animate-spin" />
              <span className="text-sm text-blue-600 font-medium">Saving...</span>
            </div>
          )}
          {saveStatus === 'saved' && (
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-green-600"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm text-green-600 font-medium">Saved</span>
            </div>
          )}
          {saveStatus === 'error' && (
            <div className="flex items-center gap-2">
              <svg
                className="w-4 h-4 text-red-600"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-sm text-red-600 font-medium">Save failed</span>
            </div>
          )}
          {saveStatus === 'idle' && !isSaving && (
            <span className="text-sm text-gray-500">Autosaves every 30 seconds</span>
          )}
        </div>
      </div>

      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className={`px-6 py-2 rounded-lg font-semibold text-white transition-colors ${
            isSaving ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {isSaving ? 'Saving...' : 'Save Manually'}
        </button>
      </div>

      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-xs sm:text-sm text-blue-700">
          💡 <strong>Tip:</strong> Your content autosaves every 30 seconds. You can also click
          &quot;Save Manually&quot; to save immediately.
        </p>
      </div>
    </div>
  );
}
