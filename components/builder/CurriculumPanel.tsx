/**
 * The course outline in the builder: modules and their lessons, in the order students get them.
 * Drag a lesson (or a module by its handle) to reorder; the arrow buttons and "Move to" menu do the
 * same from the keyboard. Every change is saved at once as one curriculum (lib/curriculum-ops.js).
 */

import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, FileText, GripVertical, Image as ImageIcon, Link2, ListChecks, MoreHorizontal, Paperclip, Pencil, Plus, Trash2, Video } from 'lucide-react';
import type { BuilderModule } from '@/lib/curriculum-ops';

export type OutlineLessonInfo = {
  id: string;
  title: string;
  kinds: string[];
  minutes: number;
  hasQuiz: boolean;
  activities: number;
  issues: number;
  dirty?: boolean;
  isFreePreview: boolean;
};

type Props = {
  modules: BuilderModule[];
  lessons: Record<string, OutlineLessonInfo>;
  selectedLessonId: string | null;
  editable: boolean;
  busy: boolean;
  onSelect: (lessonId: string) => void;
  onAddLesson: (moduleId: string) => void;
  onAddModule: () => void;
  onRenameModule: (moduleId: string, title: string) => void;
  onDeleteModule: (moduleId: string) => void;
  onMoveModule: (moduleId: string, delta: number) => void;
  onPlaceModule: (moduleId: string, toIndex: number) => void;
  onPlaceLesson: (lessonId: string, moduleId: string, toIndex?: number) => void;
  onStepLesson: (lessonId: string, delta: number) => void;
  onDuplicateLesson: (lessonId: string) => void;
  onDeleteLesson: (lessonId: string) => void;
};

const KIND_ICON: Record<string, typeof FileText> = { text: FileText, video: Video, file: Paperclip, image: ImageIcon, link: Link2 };

type Drag = { type: 'lesson' | 'module'; id: string } | null;

export default function CurriculumPanel(props: Props) {
  const { modules, lessons, selectedLessonId, editable, busy } = props;
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<Drag>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const total = modules.reduce((n, m) => n + m.lessonIds.length, 0);
  let number = 0;

  const startRename = (m: BuilderModule) => { setRenaming(m.id); setDraft(m.title); };
  const commitRename = (m: BuilderModule) => {
    const title = draft.trim();
    setRenaming(null);
    if (title !== m.title) props.onRenameModule(m.id, title);
  };

  const dropLesson = (moduleId: string, index?: number) => {
    if (drag?.type === 'lesson') props.onPlaceLesson(drag.id, moduleId, index);
    setDrag(null); setDropAt(null);
  };

  return (
    <nav aria-label="Curriculum" className="flex flex-col" data-testid="curriculum">
      <div className="flex items-center justify-between gap-2 px-1 pb-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-ink">Curriculum</h2>
          <p className="text-xs text-ink-subtle num">{modules.filter((m) => !m.implicit).length || 1} module{modules.length === 1 ? '' : 's'} · {total} lesson{total === 1 ? '' : 's'}</p>
        </div>
        {editable && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={props.onAddModule} disabled={busy} data-testid="add-module">
            <Plus className="h-4 w-4" aria-hidden />Module
          </button>
        )}
      </div>

      <ol className="space-y-3">
        {modules.map((m, mi) => {
          const isCollapsed = collapsed[m.id];
          const label = m.implicit ? 'Lessons' : m.title || 'Untitled module';
          return (
            <li
              key={m.id}
              className={`rounded-2xl border bg-surface-1 transition-colors ${dropAt === `module:${m.id}` ? 'border-primary-500' : 'border-line'}`}
              data-testid="curriculum-module"
              onDragOver={(e) => { if (drag) { e.preventDefault(); setDropAt(`module:${m.id}`); } }}
              onDragLeave={() => setDropAt((v) => (v === `module:${m.id}` ? null : v))}
              onDrop={(e) => {
                e.preventDefault();
                if (drag?.type === 'module') { props.onPlaceModule(drag.id, mi); setDrag(null); setDropAt(null); }
                else dropLesson(m.id);
              }}
            >
              <div className="flex items-center gap-1.5 px-2.5 py-2">
                {editable && !m.implicit && (
                  <span
                    draggable={!busy}
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; setDrag({ type: 'module', id: m.id }); }}
                    onDragEnd={() => { setDrag(null); setDropAt(null); }}
                    className="cursor-grab text-ink-subtle hover:text-ink"
                    title="Drag to reorder modules"
                    aria-hidden
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>
                )}
                <button type="button" className="rounded p-0.5 text-ink-subtle hover:text-ink" aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${label}`} onClick={() => setCollapsed((c) => ({ ...c, [m.id]: !c[m.id] }))}>
                  <ChevronDown className={`h-4 w-4 transition-transform ${isCollapsed ? '-rotate-90' : ''}`} aria-hidden />
                </button>
                {renaming === m.id ? (
                  <input
                    autoFocus
                    value={draft}
                    maxLength={200}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => commitRename(m)}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitRename(m); if (e.key === 'Escape') setRenaming(null); }}
                    className="input min-h-0 flex-1 py-1 text-sm"
                    aria-label="Module title"
                  />
                ) : (
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-semibold ${m.title || m.implicit ? 'text-ink' : 'italic text-ink-subtle'}`}>{label}</span>
                    <span className="block text-2xs text-ink-subtle num">{m.lessonIds.length} lesson{m.lessonIds.length === 1 ? '' : 's'}</span>
                  </span>
                )}
                {editable && renaming !== m.id && (
                  <div className="relative">
                    <button type="button" className="rounded-lg p-1.5 text-ink-subtle hover:bg-tint hover:text-ink" aria-label={`Module actions for ${label}`} aria-haspopup="menu" aria-expanded={menu === `m:${m.id}`} onClick={() => setMenu(menu === `m:${m.id}` ? null : `m:${m.id}`)}>
                      <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </button>
                    {menu === `m:${m.id}` && (
                      <div role="menu" className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-line bg-surface-1 py-1 shadow-lift" onMouseLeave={() => setMenu(null)}>
                        <MenuItem onClick={() => { setMenu(null); startRename(m); }} Icon={Pencil}>Rename</MenuItem>
                        <MenuItem onClick={() => { setMenu(null); props.onMoveModule(m.id, -1); }} Icon={ChevronUp} disabled={mi === 0 || busy}>Move up</MenuItem>
                        <MenuItem onClick={() => { setMenu(null); props.onMoveModule(m.id, 1); }} Icon={ChevronDown} disabled={mi === modules.length - 1 || busy}>Move down</MenuItem>
                        <MenuItem onClick={() => { setMenu(null); props.onDeleteModule(m.id); }} Icon={Trash2} danger disabled={modules.length <= 1 || busy}>Delete module</MenuItem>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!isCollapsed && (
                <ol className="border-t border-line py-1">
                  {m.lessonIds.length === 0 && (
                    <li className="px-4 py-3 text-xs text-ink-subtle">No lessons yet. {editable ? 'Add one, or drag a lesson here.' : ''}</li>
                  )}
                  {m.lessonIds.map((lessonId, li) => {
                    number += 1;
                    const lesson = lessons[lessonId];
                    if (!lesson) return null;
                    const selected = lessonId === selectedLessonId;
                    const firstOverall = mi === 0 && li === 0;
                    const lastOverall = mi === modules.length - 1 && li === m.lessonIds.length - 1;
                    return (
                      <li
                        key={lessonId}
                        draggable={editable && !busy}
                        onDragStart={(e) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; setDrag({ type: 'lesson', id: lessonId }); }}
                        onDragEnd={() => { setDrag(null); setDropAt(null); }}
                        onDragOver={(e) => { if (drag?.type === 'lesson') { e.preventDefault(); e.stopPropagation(); setDropAt(`lesson:${lessonId}`); } }}
                        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropLesson(m.id, li); }}
                        className={`group relative ${dropAt === `lesson:${lessonId}` ? 'before:absolute before:inset-x-3 before:top-0 before:h-0.5 before:rounded before:bg-primary-500' : ''} ${drag?.id === lessonId ? 'opacity-50' : ''}`}
                        data-testid="curriculum-lesson"
                      >
                        <div className={`flex items-center gap-2 pl-3 pr-1.5 ${selected ? 'bg-tint' : 'hover:bg-[color-mix(in_srgb,var(--fo-text)_4%,transparent)]'}`}>
                          <button type="button" onClick={() => props.onSelect(lessonId)} className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2.5 py-2 text-left" aria-current={selected ? 'true' : undefined}>
                            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold num ${selected ? 'bg-primary-500 text-neutral-950' : 'border border-[var(--fo-line-strong)] text-ink-subtle'}`}>{number}</span>
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate text-sm ${selected ? 'font-semibold text-ink' : 'text-ink'} ${lesson.title ? '' : 'italic text-ink-subtle'}`}>{lesson.title || 'Untitled lesson'}</span>
                              <span className="mt-0.5 flex items-center gap-1.5 text-ink-subtle">
                                {lesson.kinds.map((k) => { const Icon = KIND_ICON[k]; return Icon ? <Icon key={k} className="h-3 w-3" aria-label={k} /> : null; })}
                                {lesson.hasQuiz && <ListChecks className="h-3 w-3" aria-label="quiz" />}
                                {lesson.minutes > 0 && <span className="text-2xs num">{lesson.minutes} min</span>}
                                {lesson.isFreePreview && <span className="text-2xs font-semibold text-primary-600 dark:text-primary-400">Free</span>}
                                {lesson.kinds.length === 0 && !lesson.hasQuiz && <span className="text-2xs">Empty</span>}
                              </span>
                            </span>
                            {lesson.dirty ? <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" aria-label="Unsaved changes" />
                              : lesson.issues > 0 ? <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-2xs font-semibold text-amber-700 dark:text-amber-300" title="Needs attention before publishing">{lesson.issues}</span> : null}
                          </button>
                          {editable && (
                            <div className="relative flex items-center opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                              <button type="button" className="rounded p-1 text-ink-subtle hover:text-ink disabled:opacity-30" aria-label={`Move ${lesson.title || 'lesson'} up`} disabled={firstOverall || busy} onClick={() => props.onStepLesson(lessonId, -1)}><ChevronUp className="h-4 w-4" aria-hidden /></button>
                              <button type="button" className="rounded p-1 text-ink-subtle hover:text-ink disabled:opacity-30" aria-label={`Move ${lesson.title || 'lesson'} down`} disabled={lastOverall || busy} onClick={() => props.onStepLesson(lessonId, 1)}><ChevronDown className="h-4 w-4" aria-hidden /></button>
                              <button type="button" className="rounded p-1 text-ink-subtle hover:text-ink" aria-label={`More actions for ${lesson.title || 'lesson'}`} aria-haspopup="menu" aria-expanded={menu === `l:${lessonId}`} onClick={() => setMenu(menu === `l:${lessonId}` ? null : `l:${lessonId}`)}><MoreHorizontal className="h-4 w-4" aria-hidden /></button>
                              {menu === `l:${lessonId}` && (
                                <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-line bg-surface-1 py-1 shadow-lift" onMouseLeave={() => setMenu(null)}>
                                  {modules.length > 1 && (
                                    <>
                                      <p className="px-3 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-ink-subtle">Move to</p>
                                      {modules.filter((x) => x.id !== m.id).map((x) => (
                                        <MenuItem key={x.id} onClick={() => { setMenu(null); props.onPlaceLesson(lessonId, x.id); }} disabled={busy}>{x.title || 'Untitled module'}</MenuItem>
                                      ))}
                                      <div className="my-1 border-t border-line" />
                                    </>
                                  )}
                                  <MenuItem onClick={() => { setMenu(null); props.onDuplicateLesson(lessonId); }} Icon={Copy} disabled={busy}>Duplicate</MenuItem>
                                  <MenuItem onClick={() => { setMenu(null); props.onDeleteLesson(lessonId); }} Icon={Trash2} danger disabled={busy}>Delete lesson</MenuItem>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {editable && (
                    <li>
                      <button type="button" className="flex min-h-[40px] w-full items-center gap-2 px-4 text-sm font-medium text-primary-600 hover:bg-tint disabled:opacity-50 dark:text-primary-400" onClick={() => props.onAddLesson(m.id)} disabled={busy} data-testid="add-lesson">
                        <Plus className="h-4 w-4" aria-hidden />Add lesson
                      </button>
                    </li>
                  )}
                </ol>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function MenuItem({ children, onClick, Icon, danger, disabled }: { children: React.ReactNode; onClick: () => void; Icon?: typeof Plus; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${danger ? 'text-red-600 hover:bg-red-500/10 dark:text-red-400' : 'text-ink hover:bg-tint'}`}>
      {Icon && <Icon className="h-4 w-4" aria-hidden />}
      <span className="truncate">{children}</span>
    </button>
  );
}
