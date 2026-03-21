/**
 * Lesson Summary View Component
 * Displays lesson summary for students (read-only)
 */

import { format } from 'date-fns';

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
    updatedAt?: Date | string;
  };
}

interface LessonSummaryViewProps {
  lesson: Lesson;
}

function computeLessonVisualSummary(lesson: Lesson) {
  const summary = lesson.lessonSummary?.overview
    ? lesson.lessonSummary
    : (lesson as any).summary
      ? { overview: (lesson as any).summary, updatedAt: lesson.lessonSummary?.updatedAt }
      : lesson.lessonSummary;

  const lessonResources = (lesson as any).resources || [];
  const summaryResources = summary && 'resources' in summary ? summary.resources || [] : [];

  const allResources = [
    ...summaryResources.map((r: any) => ({
      name: r.name || r.title || 'Resource',
      url: r.url,
      type: r.type || 'link',
    })),
    ...lessonResources.map((r: any) => ({
      name: r.title || r.name || 'Resource',
      url: r.url,
      type: r.type || 'link',
    })),
  ];

  const screenshots = (lesson.lessonSummary?.screenshots ||
    (summary && 'screenshots' in summary ? summary.screenshots : undefined) ||
    []) as Array<{ url: string; caption?: string }>;

  const enrichedSummary = summary
    ? {
        ...summary,
        resources: allResources.length > 0 ? allResources : 'resources' in summary ? summary.resources : [],
        screenshots: screenshots.length > 0 ? screenshots : 'screenshots' in summary ? summary.screenshots : [],
      }
    : null;

  const hasVisualContent = Boolean(
    (enrichedSummary && 'keyPoints' in enrichedSummary && enrichedSummary.keyPoints && enrichedSummary.keyPoints.length > 0) ||
      (enrichedSummary && 'tradingNotes' in enrichedSummary && enrichedSummary.tradingNotes) ||
      (screenshots && screenshots.length > 0)
  );

  return { enrichedSummary, screenshots, hasVisualContent };
}

/** True when the lesson has key points, trading notes, or screenshot visual aids (used to hide empty sections). */
export function hasLessonVisualAids(lesson: Lesson): boolean {
  return computeLessonVisualSummary(lesson).hasVisualContent;
}

export default function LessonSummaryView({ lesson }: LessonSummaryViewProps) {
  const { enrichedSummary, screenshots, hasVisualContent } = computeLessonVisualSummary(lesson);

  if (!hasVisualContent) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Note: Overview has been moved to Lesson Content section */}
      
      {/* Key Points */}
      {enrichedSummary && 'keyPoints' in enrichedSummary && enrichedSummary.keyPoints && enrichedSummary.keyPoints.length > 0 && (
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-4 border border-green-100 dark:border-green-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 flex items-center">
            <svg className="w-5 h-5 mr-2 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Key Points
          </h3>
          <ul className="space-y-2">
            {enrichedSummary.keyPoints.map((point, index) => (
              <li key={index} className="flex items-start">
                <span className="flex-shrink-0 w-6 h-6 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full flex items-center justify-center text-xs font-bold mr-3 mt-0.5">
                  {index + 1}
                </span>
                <span className="text-gray-700 dark:text-gray-300">{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Trading Notes */}
      {enrichedSummary && 'tradingNotes' in enrichedSummary && enrichedSummary.tradingNotes && (
        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 rounded-xl p-4 border border-yellow-100 dark:border-yellow-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2 flex items-center">
            <svg className="w-5 h-5 mr-2 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            Trading Notes
          </h3>
          <div className="prose prose-sm max-w-none text-gray-700 dark:text-gray-300">
            <p className="whitespace-pre-wrap leading-snug">{enrichedSummary.tradingNotes}</p>
          </div>
        </div>
      )}

      {/* Screenshots/Charts */}
      {screenshots && screenshots.length > 0 && (
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-xl p-4 border border-indigo-100 dark:border-indigo-800">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {screenshots.map((screenshot: any, index: number) => (
              <div key={index} className="relative group">
                {screenshot.url ? (
                  <img
                    src={screenshot.url}
                    alt={screenshot.caption || `Screenshot ${index + 1}`}
                    className="w-full h-auto max-w-full rounded-lg border border-gray-200 dark:border-gray-700 group-hover:shadow-lg transition-shadow"
                    onError={(e) => {
                      console.error('Failed to load image:', screenshot.url);
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : null}
                {screenshot.caption && (
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400 text-center">{screenshot.caption}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last Updated */}
      {enrichedSummary && 'updatedAt' in enrichedSummary && enrichedSummary.updatedAt && (
        <div className="text-xs text-gray-500 dark:text-gray-400 text-right">
          Last updated: {format(new Date(enrichedSummary.updatedAt), 'PPp')}
        </div>
      )}
    </div>
  );
}

