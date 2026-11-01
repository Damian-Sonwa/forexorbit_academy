/**
 * Lesson PDF and resources (Phase 7). For students every link is the app path
 * GET /api/lessons/:id/document?item=..., which checks access again before redirecting to the
 * stored document, so a link copied before access was revoked stops working. Documents open in
 * a new tab, where the browser's own viewer works on desktop and phone alike. A stored link that
 * cannot be served is listed as unavailable instead of rendered.
 */

import SafeExternalLink from '@/components/SafeExternalLink';
import type { LessonResource } from '@/hooks/useLesson';

type Props = {
  pdfUrl?: string | null;
  pdfAvailable?: boolean;
  resources?: LessonResource[];
};

type Item = { key: string; title: string; type: string; href: string | null };

function DocumentIcon({ type }: { type: string }) {
  const d =
    type === 'link'
      ? 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1'
      : type === 'pdf'
        ? 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z'
        : 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z';
  return (
    <svg className="h-6 w-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  );
}

const TYPE_LABEL: Record<string, string> = { pdf: 'PDF', link: 'Link', slide: 'Slides', doc: 'Document', video: 'Video', file: 'File' };

export default function LessonDocuments({ pdfUrl, pdfAvailable, resources }: Props) {
  const items: Item[] = [];
  if (pdfUrl || pdfAvailable === false) {
    items.push({ key: 'pdf', title: 'Lesson PDF', type: 'pdf', href: pdfUrl || null });
  }
  (Array.isArray(resources) ? resources : []).forEach((resource, index) => {
    const href = resource && resource.available !== false && resource.url ? resource.url : null;
    items.push({
      key: `r${index}`,
      title: (resource && resource.title) || `Resource ${index + 1}`,
      type: (resource && resource.type) || 'file',
      href,
    });
  });
  if (!items.length) return null;

  return (
    <section className="mb-4 rounded-xl border border-gray-100 bg-white p-4 shadow-sm sm:rounded-2xl sm:p-6 dark:border-gray-700 dark:bg-gray-800" data-testid="lesson-documents">
      <h2 className="mb-1 text-xl font-bold text-gray-900 sm:text-2xl dark:text-white">Lesson documents</h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-300">Documents open in a new tab.</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const inner = (
            <>
              <span className="mr-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-400/10">
                <DocumentIcon type={item.type} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-gray-900 dark:text-white">{item.title}</span>
                <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">
                  {item.href ? TYPE_LABEL[item.type] || 'File' : 'Unavailable'}
                </span>
              </span>
            </>
          );
          return (
            <li key={item.key}>
              {item.href ? (
                // SafeExternalLink applies the URL policy again (lib/safe-url.js) and opens a new tab.
                <SafeExternalLink
                  href={item.href}
                  className="flex min-h-[44px] items-center rounded-xl border-2 border-gray-200 bg-gray-50 p-3 transition-all hover:border-primary-300 hover:bg-primary-50 dark:border-gray-600 dark:bg-gray-900/40"
                >
                  {inner}
                </SafeExternalLink>
              ) : (
                <div className="flex min-h-[44px] items-center rounded-xl border-2 border-dashed border-gray-200 p-3 opacity-70 dark:border-gray-600" aria-disabled="true">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
