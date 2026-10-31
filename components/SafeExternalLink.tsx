/**
 * A link to an instructor-supplied address (lesson resources). Rendered as a link only when the
 * address passes the course URL policy (lib/safe-url.js: http(s) or relative); otherwise the
 * same content is shown without a link, so a stored `javascript:` or `data:` address can never
 * run in the page. The API refuses such addresses on save; this covers values stored earlier.
 */
import type { ReactNode } from 'react';
import { safeLinkUrl } from '@/lib/safe-url';

export default function SafeExternalLink({
  href,
  className,
  children,
}: {
  href: unknown;
  className?: string;
  children: ReactNode;
}) {
  const url = safeLinkUrl(href);
  if (!url) {
    return (
      <div className={className} aria-disabled="true" title="This link is not available">
        {children}
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
    </a>
  );
}
