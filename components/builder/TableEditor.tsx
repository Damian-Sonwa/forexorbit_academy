/**
 * Editor for a table block: plain-text cells, a header row, column alignment, and rows and columns
 * added or removed beside the current cell. Pasting cells copied from Excel or Google Sheets fills
 * the table from the current cell. Enter moves down (and adds a row at the end); Tab is the browser's.
 */

import { useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Trash2 } from 'lucide-react';
import { LIMITS, type Block, type ColumnAlign } from '@/lib/course-content';

type TableBlock = Extract<Block, { type: 'table' }>;
const ALIGNS: Array<[ColumnAlign, string, typeof AlignLeft]> = [['left', 'Align column left', AlignLeft], ['center', 'Centre column', AlignCenter], ['right', 'Align column right', AlignRight]];

export default function TableEditor({ block, readOnly, onChange }: { block: TableBlock; readOnly: boolean; onChange: (block: Block) => void }) {
  const [at, setAt] = useState({ r: 0, c: 0 });
  const grid = useRef<HTMLTableElement>(null);
  const rows = block.rows;
  const cols = rows[0].length;
  const r = Math.min(at.r, rows.length - 1);
  const c = Math.min(at.c, cols - 1);

  const focus = (row: number, col: number) => setTimeout(() => grid.current?.querySelector<HTMLTextAreaElement>(`[data-cell="${row}-${col}"]`)?.focus(), 0);
  const setRows = (next: string[][], align = block.align) => onChange({ ...block, rows: next, align });
  const setCell = (row: number, col: number, value: string) => setRows(rows.map((x, i) => (i === row ? x.map((v, j) => (j === col ? value : v)) : x)));
  const addRow = (index: number) => {
    if (rows.length >= LIMITS.tableRows) return;
    setRows([...rows.slice(0, index), Array(cols).fill(''), ...rows.slice(index)]);
    focus(index, c);
  };
  const addCol = (index: number) => {
    if (cols >= LIMITS.tableCols) return;
    setRows(rows.map((x) => [...x.slice(0, index), '', ...x.slice(index)]), [...block.align.slice(0, index), 'left', ...block.align.slice(index)]);
    focus(r, index);
  };
  const paste = (e: React.ClipboardEvent, row: number, col: number) => {
    const text = e.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n').replace(/\n$/, '');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const cells = text.split('\n').map((line) => line.split('\t'));
    const height = Math.min(LIMITS.tableRows, Math.max(rows.length, row + cells.length));
    const width = Math.min(LIMITS.tableCols, Math.max(cols, col + Math.max(...cells.map((x) => x.length))));
    const next = Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_x, j) => {
      const pasted = cells[i - row]?.[j - col];
      return i >= row && j >= col && pasted !== undefined ? pasted.trim().slice(0, LIMITS.tableCell) : rows[i]?.[j] ?? '';
    }));
    setRows(next, Array.from({ length: width }, (_, j) => block.align[j] || 'left'));
  };

  const tool = 'inline-flex h-9 min-w-[2.25rem] items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-muted hover:bg-tint hover:text-ink disabled:opacity-35';
  return (
    <div className="space-y-3" data-testid="table-editor">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded-xl border border-line bg-surface-2 p-1" role="toolbar" aria-label="Table tools">
          <span className="px-1.5 text-2xs text-ink-subtle">Row</span>
          <button type="button" className={tool} title="Add a row above" aria-label="Add a row above" disabled={rows.length >= LIMITS.tableRows} onClick={() => addRow(r)}><ArrowUp className="h-4 w-4" aria-hidden />+</button>
          <button type="button" className={tool} title="Add a row below" aria-label="Add a row below" disabled={rows.length >= LIMITS.tableRows} onClick={() => addRow(r + 1)}><ArrowDown className="h-4 w-4" aria-hidden />+</button>
          <button type="button" className={tool} title="Delete this row" aria-label="Delete this row" disabled={rows.length <= 1} onClick={() => setRows(rows.filter((_, i) => i !== r))}><Trash2 className="h-4 w-4" aria-hidden /></button>
          <span className="ml-2 px-1.5 text-2xs text-ink-subtle">Column</span>
          <button type="button" className={tool} title="Add a column before" aria-label="Add a column before" disabled={cols >= LIMITS.tableCols} onClick={() => addCol(c)}><ArrowLeft className="h-4 w-4" aria-hidden />+</button>
          <button type="button" className={tool} title="Add a column after" aria-label="Add a column after" disabled={cols >= LIMITS.tableCols} onClick={() => addCol(c + 1)}><ArrowRight className="h-4 w-4" aria-hidden />+</button>
          <button type="button" className={tool} title="Delete this column" aria-label="Delete this column" disabled={cols <= 1} onClick={() => setRows(rows.map((x) => x.filter((_, j) => j !== c)), block.align.filter((_, j) => j !== c))}><Trash2 className="h-4 w-4" aria-hidden /></button>
          {ALIGNS.map(([id, label, Icon]) => (
            <button key={id} type="button" className={`${tool} ${block.align[c] === id ? 'bg-tint !text-ink' : ''}`} title={label} aria-label={label} aria-pressed={block.align[c] === id} onClick={() => setRows(rows, block.align.map((a, j) => (j === c ? id : a)))}><Icon className="h-4 w-4" aria-hidden /></button>
          ))}
          <label className="ml-auto flex min-h-[2.25rem] items-center gap-2 px-2 text-xs font-semibold text-ink-muted"><input type="checkbox" className="h-4 w-4 accent-[var(--fo-brand)]" checked={block.header} onChange={(e) => onChange({ ...block, header: e.target.checked })} />Header row</label>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table ref={grid} className="w-full border-collapse text-sm">
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={block.header && i === 0 ? 'bg-surface-3 font-semibold' : ''}>
                {row.map((cell, j) => (
                  <td key={j} className={`min-w-[7.5rem] border border-line p-0 align-top ${!readOnly && i === r && j === c ? 'shadow-[inset_0_0_0_2px_var(--fo-brand)]' : ''}`}>
                    <textarea
                      rows={1}
                      data-cell={`${i}-${j}`}
                      aria-label={`Row ${i + 1}, column ${j + 1}`}
                      value={cell}
                      maxLength={LIMITS.tableCell}
                      readOnly={readOnly}
                      onFocus={() => setAt({ r: i, c: j })}
                      onPaste={(e) => paste(e, i, j)}
                      onChange={(e) => setCell(i, j, e.target.value.replace(/\n/g, ' '))}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        if (i + 1 < rows.length) focus(i + 1, j);
                        else addRow(rows.length);
                      }}
                      style={{ textAlign: block.align[j] || 'left' }}
                      className="block min-h-[2.75rem] w-full resize-none bg-transparent px-3 py-2.5 text-ink outline-none [field-sizing:content]"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <input className="input w-full" placeholder="Caption (optional)" aria-label="Table caption" maxLength={LIMITS.caption} value={block.caption} readOnly={readOnly} onChange={(e) => onChange({ ...block, caption: e.target.value })} />
      {!readOnly && <p className="text-xs text-ink-subtle">You can paste cells straight from Excel or Google Sheets.</p>}
    </div>
  );
}
