/**
 * Lesson Summary Editor Component
 * Allows instructors to edit lesson summary
 */

import { useState, useRef, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';

interface Lesson {
  _id?: string;
  id?: string;
  title: string;
  lessonSummary?: {
    overview?: string;
    keyPoints?: string[];
    tradingNotes?: string;
    resources?: Array<{ name: string; url: string; type: string }>;
    screenshots?: Array<{ url: string; caption?: string }>;
  };
}

interface LessonSummaryEditorProps {
  lessonId: string;
  lesson: Lesson;
  onSave: () => void;
}

export default function LessonSummaryEditor({ lessonId, lesson, onSave }: LessonSummaryEditorProps) {
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState<{ [key: number]: boolean }>({});
  const [error, setError] = useState('');
  const fileInputRefs = useRef<{ [key: number]: HTMLInputElement | null }>({});
  const [formData, setFormData] = useState({
    overview: lesson.lessonSummary?.overview || '',
    keyPoints: lesson.lessonSummary?.keyPoints || [''],
    tradingNotes: lesson.lessonSummary?.tradingNotes || '',
    resources: lesson.lessonSummary?.resources || [],
    screenshots: lesson.lessonSummary?.screenshots || [],
  });

  /**
   * Update form data when lesson prop changes (when switching between lessons)
   */
  useEffect(() => {
    setFormData({
      overview: lesson.lessonSummary?.overview || '',
      keyPoints: lesson.lessonSummary?.keyPoints || [''],
      tradingNotes: lesson.lessonSummary?.tradingNotes || '',
      resources: lesson.lessonSummary?.resources || [],
      screenshots: lesson.lessonSummary?.screenshots || [],
    });
  }, [lesson]);

  const handleKeyPointChange = (index: number, value: string) => {
    const newKeyPoints = [...formData.keyPoints];
    newKeyPoints[index] = value;
    setFormData({ ...formData, keyPoints: newKeyPoints });
  };

  const addKeyPoint = () => {
    setFormData({ ...formData, keyPoints: [...formData.keyPoints, ''] });
  };

  const removeKeyPoint = (index: number) => {
    const newKeyPoints = formData.keyPoints.filter((_, i) => i !== index);
    setFormData({ ...formData, keyPoints: newKeyPoints.length > 0 ? newKeyPoints : [''] });
  };

  const handleResourceAdd = () => {
    setFormData({
      ...formData,
      resources: [...formData.resources, { name: '', url: '', type: 'pdf' }],
    });
  };

  const handleResourceChange = (index: number, field: string, value: string) => {
    const newResources = [...formData.resources];
    newResources[index] = { ...newResources[index], [field]: value };
    setFormData({ ...formData, resources: newResources });
  };

  const removeResource = (index: number) => {
    setFormData({
      ...formData,
      resources: formData.resources.filter((_, i) => i !== index),
    });
  };

  const handleScreenshotAdd = () => {
    setFormData({
      ...formData,
      screenshots: [...formData.screenshots, { url: '', caption: '' }],
    });
  };

  const handleScreenshotChange = (index: number, field: string, value: string) => {
    const newScreenshots = [...formData.screenshots];
    newScreenshots[index] = { ...newScreenshots[index], [field]: value };
    setFormData({ ...formData, screenshots: newScreenshots });
  };

  const removeScreenshot = (index: number) => {
    setFormData({
      ...formData,
      screenshots: formData.screenshots.filter((_, i) => i !== index),
    });
    // Clear file input ref
    if (fileInputRefs.current[index]) {
      fileInputRefs.current[index]!.value = '';
    }
    delete fileInputRefs.current[index];
  };

  const handleImageUpload = async (index: number, file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file');
      return;
    }

    setUploading({ ...uploading, [index]: true });
    setError('');

    try {
      const uploadFormData = new FormData();
      uploadFormData.append('file', file);

      const response = await fetch('/api/upload/visual-aid', {
        method: 'POST',
        headers: {
          // Don't set Content-Type, let browser set it with boundary
        },
        body: uploadFormData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const data = await response.json();
      
      // Update the screenshot URL
      const newScreenshots = [...formData.screenshots];
      if (newScreenshots[index]) {
        newScreenshots[index] = {
          ...newScreenshots[index],
          url: data.url,
        };
      } else {
        newScreenshots[index] = { url: data.url, caption: '' };
      }
      
      setFormData({ ...formData, screenshots: newScreenshots });
    } catch (error: any) {
      setError(error.message || 'Failed to upload image');
    } finally {
      setUploading({ ...uploading, [index]: false });
    }
  };

  const handleFileInputChange = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(index, file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      // Filter out empty key points
      const filteredKeyPoints = formData.keyPoints.filter((kp) => kp.trim() !== '');
      
      await apiClient.put(`/lessons/${lessonId}/summary`, {
        lessonSummary: {
          overview: formData.overview.trim(),
          keyPoints: filteredKeyPoints,
          tradingNotes: formData.tradingNotes.trim(),
          resources: formData.resources.filter((r) => r.name && r.url),
          screenshots: formData.screenshots.filter((s) => s.url),
          updatedAt: new Date(),
        },
      });

      onSave();
      // Reload page to show updated summary
      window.location.reload();
    } catch (error: any) {
      setError(error.response?.data?.error || error.message || 'Failed to save summary');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-xl">
          <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
        </div>
      )}

      {/* Overview */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Lesson Overview
        </label>
        <textarea
          value={formData.overview}
          onChange={(e) => setFormData({ ...formData, overview: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
          rows={4}
          placeholder="Write a comprehensive overview of this lesson..."
        />
      </div>

      {/* Key Points */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Key Points
        </label>
        <div className="space-y-2">
          {formData.keyPoints.map((point, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={point}
                onChange={(e) => handleKeyPointChange(index, e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder={`Key point ${index + 1}`}
              />
              {formData.keyPoints.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeKeyPoint(index)}
                  className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addKeyPoint}
            className="px-4 py-2 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg font-medium text-sm transition-colors"
          >
            + Add Key Point
          </button>
        </div>
      </div>

      {/* Trading Notes */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Trading Notes
        </label>
        <textarea
          value={formData.tradingNotes}
          onChange={(e) => setFormData({ ...formData, tradingNotes: e.target.value })}
          className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
          rows={4}
          placeholder="Add trading notes, tips, or important reminders..."
        />
      </div>

      {/* Resources */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Downloadable Resources
        </label>
        <div className="space-y-3">
          {formData.resources.map((resource, index) => (
            <div key={index} className="flex gap-2">
              <input
                type="text"
                value={resource.name}
                onChange={(e) => handleResourceChange(index, 'name', e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="Resource name"
              />
              <input
                type="url"
                value={resource.url}
                onChange={(e) => handleResourceChange(index, 'url', e.target.value)}
                className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="URL"
              />
              <select
                value={resource.type}
                onChange={(e) => handleResourceChange(index, 'type', e.target.value)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              >
                <option value="pdf">PDF</option>
                <option value="image">Image</option>
                <option value="document">Document</option>
                <option value="spreadsheet">Spreadsheet</option>
                <option value="other">Other</option>
              </select>
              <button
                type="button"
                onClick={() => removeResource(index)}
                className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={handleResourceAdd}
            className="px-4 py-2 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg font-medium text-sm transition-colors"
          >
            + Add Resource
          </button>
        </div>
      </div>

      {/* Visual Aids (Charts & Screenshots) */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Visual Aids (Charts & Screenshots)
        </label>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
          Upload images or provide URLs for charts, graphs, and visual aids
        </p>
        <div className="space-y-4">
          {formData.screenshots.map((screenshot, index) => (
            <div key={index} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
              <div className="flex gap-2">
                {/* Image Upload Button */}
                <div className="flex-shrink-0">
                  <input
                    ref={(el) => { fileInputRefs.current[index] = el; }}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileInputChange(index, e)}
                    className="hidden"
                    id={`visual-aid-upload-${index}`}
                  />
                  <label
                    htmlFor={`visual-aid-upload-${index}`}
                    className={`inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer transition-colors ${
                      uploading[index]
                        ? 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                        : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                    }`}
                  >
                    {uploading[index] ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Uploading...
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Upload Image
                      </>
                    )}
                  </label>
                </div>
                
                {/* URL Input */}
                <input
                  type="url"
                  value={screenshot.url}
                  onChange={(e) => handleScreenshotChange(index, 'url', e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  placeholder="Or enter image URL"
                />
                
                {/* Remove Button */}
                <button
                  type="button"
                  onClick={() => removeScreenshot(index)}
                  className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Caption Input */}
              <input
                type="text"
                value={screenshot.caption || ''}
                onChange={(e) => handleScreenshotChange(index, 'caption', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="Caption (e.g., 'RSI Indicator showing overbought levels')"
              />
              
              {/* Preview - Only show image when URL exists, no placeholder */}
              {screenshot.url ? (
                <div className="mt-3">
                  <img
                    src={screenshot.url}
                    alt={screenshot.caption || 'Visual aid preview'}
                    className="w-full h-auto max-w-full rounded-lg border-2 border-gray-300 dark:border-gray-600"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      const container = img.parentElement;
                      if (container) {
                        img.style.display = 'none';
                        // Show error message
                        if (!container.querySelector('.image-error')) {
                          const errorDiv = document.createElement('div');
                          errorDiv.className = 'image-error text-red-500 text-sm p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800';
                          errorDiv.textContent = `Failed to load image from: ${screenshot.url}`;
                          container.appendChild(errorDiv);
                        }
                      }
                    }}
                    onLoad={(e) => {
                      // Hide any error messages when image loads successfully
                      const img = e.target as HTMLImageElement;
                      const container = img.parentElement;
                      if (container) {
                        const errorDiv = container.querySelector('.image-error');
                        if (errorDiv) {
                          errorDiv.remove();
                        }
                        img.style.display = 'block';
                      }
                    }}
                  />
                </div>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            onClick={handleScreenshotAdd}
            className="w-full px-4 py-2 text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20 rounded-lg font-medium text-sm transition-colors border-2 border-dashed border-primary-300 dark:border-primary-700"
          >
            + Add Visual Aid
          </button>
        </div>
      </div>

      {/* Submit Buttons */}
      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={onSave}
          className="px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-xl font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Saving...' : 'Save Summary'}
        </button>
      </div>
    </form>
  );
}





