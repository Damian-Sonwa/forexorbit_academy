/**
 * Renders builder rich text (a validated Quill Delta, lib/course-content.js) as React elements.
 * Text is always a React text node and links are checked again (lib/safe-url.js), so nothing in a
 * lesson is ever parsed as HTML. Used by the student lesson page and every preview.
 */

import { Fragment } from 'react';
import { deltaToLines, groupLines, type DeltaOp, type Line, type Segment } from '@/lib/course-content';
import { safeLinkUrl } from '@/lib/safe-url';

function Seg({ seg }: { seg: Segment }) {
  let node: React.ReactNode = seg.text;
  if (seg.code) node = <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.9em]">{node}</code>;
  if (seg.bold) node = <strong>{node}</strong>;
  if (seg.italic) node = <em>{node}</em>;
  if (seg.underline) node = <u>{node}</u>;
  if (seg.strike) node = <s>{node}</s>;
  const href = seg.link ? safeLinkUrl(seg.link) : null;
  if (href) {
    const external = /^https?:\/\//i.test(href);
    node = (
      <a href={href} className="font-medium text-primary-600 underline decoration-primary-500/40 underline-offset-2 hover:decoration-primary-500 dark:text-primary-400" {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {node}
      </a>
    );
  }
  return <>{node}</>;
}

function Inline({ line }: { line: Line }) {
  if (!line.segments.length) return <br />;
  return (
    <>
      {line.segments.map((seg, i) => (
        <Seg key={i} seg={seg} />
      ))}
    </>
  );
}

const INDENT = ['', 'ml-6', 'ml-12', 'ml-16', 'ml-20'];

export default function RichText({ ops }: { ops: DeltaOp[] }) {
  const groups = groupLines(deltaToLines(ops));
  return (
    <div className="lesson-prose space-y-4 text-[1.0625rem] leading-relaxed text-ink">
      {groups.map((g, i) => {
        if (g.kind === 'list') {
          const List = g.list === 'ordered' ? 'ol' : 'ul';
          return (
            <List key={i} className={`space-y-1.5 pl-6 ${g.list === 'ordered' ? 'list-decimal' : 'list-disc'} marker:text-primary-500`}>
              {g.items.map((item, j) => (
                <li key={j} className={INDENT[item.indent || 0]}>
                  <Inline line={item} />
                </li>
              ))}
            </List>
          );
        }
        const line = g as Line;
        const indent = INDENT[line.indent || 0];
        if (line.kind === 'h2') return <h2 key={i} className={`pt-2 font-display text-xl font-semibold tracking-[-0.01em] text-ink sm:text-[1.375rem] ${indent}`}><Inline line={line} /></h2>;
        if (line.kind === 'h3') return <h3 key={i} className={`pt-1 font-display text-lg font-semibold text-ink ${indent}`}><Inline line={line} /></h3>;
        if (line.kind === 'quote') return <blockquote key={i} className={`border-l-2 border-primary-500 pl-4 italic text-ink-muted ${indent}`}><Inline line={line} /></blockquote>;
        if (!line.segments.length) return <Fragment key={i} />;
        return <p key={i} className={indent}><Inline line={line} /></p>;
      })}
    </div>
  );
}
