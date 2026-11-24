/**
 * Renders builder rich text (a validated Quill Delta, lib/course-content.js) as React elements.
 * Text is always a React text node and links are checked again (lib/safe-url.js), so nothing in a
 * lesson is ever parsed as HTML. Colours and sizes come from fixed lists mapped to classes here, so
 * they stay readable in both themes. Used by the student lesson page and every preview.
 */

import { Fragment } from 'react';
import { deltaToLines, groupLines, type DeltaOp, type Line, type Segment } from '@/lib/course-content';
import { safeLinkUrl } from '@/lib/safe-url';

const SIZE: Record<string, string> = { small: 'text-[0.85em]', large: 'text-[1.25em] leading-snug', huge: 'text-[1.65em] leading-tight' };
const COLOR: Record<string, string> = {
  '#c24e00': 'text-[#c24e00] dark:text-[#ff9a4d]',
  '#a16207': 'text-[#8a5406] dark:text-[#f4c04f]',
  '#172b45': 'text-[#172b45] dark:text-[#a9c4e6]',
  '#1d4ed8': 'text-[#1d4ed8] dark:text-[#8ab4ff]',
  '#15803d': 'text-[#15803d] dark:text-[#6bd18f]',
  '#b91c1c': 'text-[#b91c1c] dark:text-[#f79a9a]',
  '#6b7280': 'text-[#5b6472] dark:text-[#a8b0bd]',
};
const HIGHLIGHT: Record<string, string> = {
  '#fff3c4': 'bg-[#fff3c4] dark:bg-[#f4c04f]/25',
  '#ffe3cc': 'bg-[#ffe3cc] dark:bg-[#ff8a33]/25',
  '#dcebfa': 'bg-[#dcebfa] dark:bg-[#8ab4ff]/25',
  '#d9f5e3': 'bg-[#d9f5e3] dark:bg-[#6bd18f]/25',
  '#fde0e0': 'bg-[#fde0e0] dark:bg-[#f79a9a]/25',
};
const ALIGN: Record<string, string> = { center: 'text-center', right: 'text-right', justify: 'text-justify' };

function Seg({ seg }: { seg: Segment }) {
  let node: React.ReactNode = seg.text;
  if (seg.code) node = <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[0.9em]">{node}</code>;
  if (seg.bold) node = <strong>{node}</strong>;
  if (seg.italic) node = <em>{node}</em>;
  if (seg.underline) node = <u>{node}</u>;
  if (seg.strike) node = <s>{node}</s>;
  if (seg.script === 'sub') node = <sub>{node}</sub>;
  if (seg.script === 'super') node = <sup>{node}</sup>;
  const classes = [seg.size && SIZE[seg.size], seg.color && COLOR[seg.color], seg.background && HIGHLIGHT[seg.background] && `${HIGHLIGHT[seg.background]} rounded-sm px-0.5 box-decoration-clone`].filter(Boolean).join(' ');
  if (classes) node = <span className={classes}>{node}</span>;
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
const lineClass = (line: Line) => `${INDENT[line.indent || 0]} ${line.align ? ALIGN[line.align] || '' : ''} ${line.kind === 'li' && (line.align === 'center' || line.align === 'right') ? 'list-inside' : ''}`.trim();

export default function RichText({ ops }: { ops: DeltaOp[] }) {
  const groups = groupLines(deltaToLines(ops));
  return (
    <div className="lesson-prose space-y-4 text-[1.0625rem] leading-relaxed text-ink [overflow-wrap:anywhere]">
      {groups.map((g, i) => {
        if (g.kind === 'list') {
          const List = g.list === 'ordered' ? 'ol' : 'ul';
          return (
            <List key={i} className={`space-y-1.5 pl-6 ${g.list === 'ordered' ? 'list-decimal' : 'list-disc'} marker:text-primary-500`}>
              {g.items.map((item, j) => (
                <li key={j} className={lineClass(item)}>
                  <Inline line={item} />
                </li>
              ))}
            </List>
          );
        }
        const line = g as Line;
        const extra = lineClass(line);
        if (line.kind === 'h2') return <h2 key={i} className={`pt-2 font-display text-xl font-semibold tracking-[-0.01em] text-ink sm:text-[1.375rem] ${extra}`}><Inline line={line} /></h2>;
        if (line.kind === 'h3') return <h3 key={i} className={`pt-1 font-display text-lg font-semibold text-ink ${extra}`}><Inline line={line} /></h3>;
        if (line.kind === 'h4') return <h4 key={i} className={`font-display text-base font-semibold text-ink ${extra}`}><Inline line={line} /></h4>;
        if (line.kind === 'quote') return <blockquote key={i} className={`border-l-2 border-primary-500 pl-4 italic text-ink-muted ${extra}`}><Inline line={line} /></blockquote>;
        if (!line.segments.length) return <Fragment key={i} />;
        return <p key={i} className={extra}><Inline line={line} /></p>;
      })}
    </div>
  );
}
