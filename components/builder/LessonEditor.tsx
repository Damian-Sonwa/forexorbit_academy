/**
 * The lesson workspace: title, content blocks, activities, and a live student preview of the
 * unsaved state through the same renderer students get. Saving is automatic
 * (components/builder/useLessonAutosave.ts); conflicts and recovered work are explained in place.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CloudOff, Eye, History, Loader2, PenLine } from 'lucide-react';
import { AddBlockMenu, BlockEditor, BlockFrame, copyBlocks, emptyBlock } from '@/components/builder/BlockEditors';
import ActivitiesPanel from '@/components/builder/ActivitiesPanel';
import AiAssistantPanel from '@/components/builder/AiAssistantPanel';
import { lessonAsText, wordCount } from '@/lib/lesson-generation';
import LessonPreview, { PreviewBanner, type PreviewQuiz } from '@/components/course/LessonPreview';
import { useLessonAutosave, type LessonDraft, type SaveStatus } from '@/components/builder/useLessonAutosave';
import { apiClient } from '@/lib/api-client';
import type { Block, BlockType, ReadinessIssue } from '@/lib/course-content';
import type { BuilderAsset, BuilderLesson } from '@/lib/course-curriculum';

export function SaveIndicator({ status, savedAt, onSave }: { status: SaveStatus; savedAt: Date | null; onSave?: () => void }) {
  const map: Record<SaveStatus, { text: string; Icon: typeof CheckCircle2; tone: string }> = {
    saved: { text: savedAt ? `Saved ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'All changes saved', Icon: CheckCircle2, tone: 'text-ink-subtle' },
    dirty: { text: 'Unsaved changes', Icon: PenLine, tone: 'text-amber-700 dark:text-amber-300' },
    saving: { text: 'Saving…', Icon: Loader2, tone: 'text-ink-subtle' },
    retrying: { text: 'Not saved yet, retrying', Icon: CloudOff, tone: 'text-amber-700 dark:text-amber-300' },
    invalid: { text: 'Not saved', Icon: AlertTriangle, tone: 'text-red-600' },
    conflict: { text: 'Changed elsewhere', Icon: AlertTriangle, tone: 'text-red-600' },
  };
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${m.tone}`} role="status" aria-live="polite" data-testid="save-status" data-status={status}>
      <m.Icon className={`h-3.5 w-3.5 ${status === 'saving' ? 'animate-spin' : ''}`} aria-hidden />
      {m.text}
      {onSave && (status === 'dirty' || status === 'retrying') && <button type="button" className="ml-1 font-semibold text-primary-600 hover:underline dark:text-primary-400" onClick={onSave}>Save now</button>}
    </span>
  );
}

type Props = {
  courseId: string;
  lesson: BuilderLesson;
  position: number;
  total: number;
  moduleTitle: string | null;
  assets: BuilderAsset[];
  editable: boolean;
  issues: ReadinessIssue[];
  view: 'edit' | 'preview';
  onViewChange: (v: 'edit' | 'preview') => void;
  onSaved: (lessonId: string, draft: LessonDraft, revision: number) => void;
  onDirtyChange: (lessonId: string, dirty: boolean) => void;
  onAssetAdded: (asset: BuilderAsset) => void;
  onActivitiesChanged: () => void;
  onQuizSaved: (lessonId: string, s: { questions: number; status: string }) => void;
  onReload: () => void;
  /** The course is published or archived: accepted AI changes reach students at once. */
  live: boolean;
  onAiApplied: (message: string) => void;
  prev: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
  onSelect: (lessonId: string) => void;
};

export default function LessonEditor(props: Props) {
  const { courseId, lesson, editable, view } = props;
  const initial = useMemo<LessonDraft>(() => ({ title: lesson.title, blocks: lesson.blocks, isFreePreview: lesson.isFreePreview }), [lesson.id, lesson.revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const auto = useLessonAutosave({
    lessonId: lesson.id,
    initial,
    revision: lesson.revision,
    enabled: editable,
    onSaved: (d, r) => props.onSaved(lesson.id, d, r),
  });
  const { draft, update } = auto;
  const dirty = auto.status !== 'saved';
  const { onDirtyChange } = props;
  useEffect(() => { onDirtyChange(lesson.id, dirty); }, [dirty, lesson.id, onDirtyChange]);

  const [quiz, setQuiz] = useState<PreviewQuiz>(null);
  useEffect(() => {
    if (view !== 'preview' || !lesson.quiz) { setQuiz(null); return; }
    let alive = true;
    apiClient.get<{ questions: NonNullable<PreviewQuiz>['questions']; settings: { status: string } }>(`/quizzes/${lesson.id}`)
      .then((q) => { if (alive) setQuiz({ questions: q.questions || [], status: q.settings?.status }); })
      .catch(() => { if (alive) setQuiz(null); });
    return () => { alive = false; };
  }, [view, lesson.id, lesson.quiz]);

  const setBlocks = (blocks: Block[]) => update({ ...draft, blocks });
  const insertAt = (index: number, type: BlockType) => {
    const blocks = [...draft.blocks];
    blocks.splice(index, 0, emptyBlock(type));
    setBlocks(blocks);
  };
  const assetNames = useMemo(() => Object.fromEntries(props.assets.map((a) => [a.id, { name: a.name, bytes: a.bytes }])), [props.assets]);
  const resolveAsset = (assetId: string) => `/api/courses/${courseId}/assets?assetId=${assetId}`;
  const issueFor = (blockId: string) => props.issues.find((i) => i.blockId === blockId)?.message.replace(/^"[^"]*" /, '');
  const lessonIssues = props.issues.filter((i) => !i.blockId);

  return (
    <div className="min-w-0" data-testid="lesson-editor">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-xl border border-line bg-surface-1 p-0.5" role="tablist" aria-label="Lesson view">
          <button type="button" role="tab" aria-selected={view === 'edit'} onClick={() => props.onViewChange('edit')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${view === 'edit' ? 'bg-tint text-ink' : 'text-ink-subtle hover:text-ink'}`} data-testid="view-edit"><PenLine className="h-4 w-4" aria-hidden />Edit</button>
          <button type="button" role="tab" aria-selected={view === 'preview'} onClick={() => props.onViewChange('preview')} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${view === 'preview' ? 'bg-tint text-ink' : 'text-ink-subtle hover:text-ink'}`} data-testid="view-preview"><Eye className="h-4 w-4" aria-hidden />Student preview</button>
        </div>
        <span className="ml-auto"><SaveIndicator status={auto.status} savedAt={auto.savedAt} onSave={() => void auto.save()} /></span>
      </div>

      {auto.recovered && (
        <div className="notice notice-caution mb-4 flex flex-wrap items-center gap-3 text-sm" role="alert" data-testid="recovered">
          <History className="h-4 w-4" aria-hidden />
          <span className="flex-1">Unsaved changes to this lesson from {new Date(auto.recovered.at).toLocaleString()} were kept in this browser.{auto.recovered.revision !== lesson.revision ? ' The lesson has been saved since then, so restoring replaces that newer version.' : ''}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={auto.restore}>Restore them</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={auto.discardRecovered}>Discard</button>
        </div>
      )}
      {auto.status === 'conflict' && (
        <div className="notice notice-caution mb-4 space-y-2 text-sm" role="alert" data-testid="conflict">
          <p><strong>This lesson was saved from somewhere else</strong> (another tab or another editor) after you opened it. Your changes are not lost: they are kept here and in this browser.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={props.onReload}>Load the latest version</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={async () => {
              try { const fresh = await apiClient.get<{ lessons: BuilderLesson[] }>(`/courses/${courseId}/builder`); const current = fresh.lessons.find((l) => l.id === lesson.id); if (current) await auto.overwrite(current.revision); } catch { /* the status explains */ }
            }}>Keep my version and overwrite</button>
          </div>
        </div>
      )}
      {(auto.status === 'invalid' || auto.status === 'retrying') && auto.message && (
        <p className={`notice ${auto.status === 'invalid' ? 'notice-caution' : 'notice-brand'} mb-4 text-sm`} role="alert">{auto.message}</p>
      )}
      {!editable && (
        <p className="notice notice-brand mb-4 text-sm">This course is in review or live, so only an administrator can change its content. To edit it yourself, withdraw it from review on the Publish tab.</p>
      )}

      {view === 'preview' ? (
        <>
          <PreviewBanner />
          <LessonPreview
            courseId={courseId}
            lesson={lesson}
            title={draft.title}
            blocks={draft.blocks}
            position={props.position}
            total={props.total}
            moduleTitle={props.moduleTitle}
            quiz={quiz}
            resolveAsset={resolveAsset}
            assetNames={assetNames}
            prev={props.prev ? { label: 'Previous lesson', onClick: () => props.onSelect(props.prev!.id) } : null}
            next={props.next ? { label: 'Next lesson', onClick: () => props.onSelect(props.next!.id) } : null}
          />
        </>
      ) : (
        <div className="space-y-6">
          <div>
            <p className="page-kicker mb-2">Lesson {props.position} of {props.total}{props.moduleTitle ? ` · ${props.moduleTitle}` : ''}</p>
            <input
              className="w-full border-0 border-b border-transparent bg-transparent pb-1 font-display text-[1.75rem] font-semibold leading-tight tracking-[-0.02em] text-ink outline-none placeholder:text-ink-subtle focus:border-primary-500 sm:text-[2rem]"
              placeholder="Lesson title"
              maxLength={500}
              value={draft.title}
              readOnly={!editable}
              onChange={(e) => update({ ...draft, title: e.target.value })}
              aria-label="Lesson title"
              data-testid="lesson-title"
            />
            <label className="mt-3 inline-flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" className="h-4 w-4 accent-[var(--fo-brand)]" checked={draft.isFreePreview} disabled={!editable} onChange={(e) => update({ ...draft, isFreePreview: e.target.checked })} />
              Free preview (anyone signed in can open this lesson before buying the course)
            </label>
          </div>

          <AiAssistantPanel
            courseId={courseId}
            lessonId={lesson.id}
            lessonTitle={draft.title}
            words={wordCount(lessonAsText({ blocks: draft.blocks, description: lesson.legacy.description, content: lesson.legacy.content }).replace(/\[\[MEDIA:[^\]]+\]\][^\n]*/g, ''))}
            currentBlocks={draft.blocks}
            legacy={lesson.legacy}
            revision={auto.revision}
            saveStatus={auto.status}
            editable={editable}
            live={props.live}
            resolveAsset={resolveAsset}
            assetNames={assetNames}
            onApplied={props.onAiApplied}
          />

          {lessonIssues.length > 0 && (
            <ul className="space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-800 dark:text-amber-200" data-testid="lesson-issues">
              {lessonIssues.map((i, n) => <li key={n} className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />{i.message}</li>)}
            </ul>
          )}

          <div className="space-y-6" data-testid="block-list">
            {draft.blocks.length === 0 && (
              <div className="rounded-2xl border border-dashed border-line px-6 py-10 text-center">
                <p className="font-display text-lg font-semibold text-ink">Start this lesson</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">Add text, a video, images, files and callouts. Students see the blocks in this order.</p>
              </div>
            )}
            {draft.blocks.map((block, index) => (
              <BlockFrame
                key={block.id}
                block={block}
                index={index}
                count={draft.blocks.length}
                readOnly={!editable}
                issue={issueFor(block.id)}
                onMove={(delta) => { const blocks = [...draft.blocks]; const [b] = blocks.splice(index, 1); blocks.splice(index + delta, 0, b); setBlocks(blocks); }}
                onDuplicate={() => { const blocks = [...draft.blocks]; blocks.splice(index + 1, 0, copyBlocks([block])[0]); setBlocks(blocks); }}
                onRemove={() => {
                  const significant = block.type === 'text' || block.type === 'legacy' || ('assetId' in block && block.assetId);
                  if (significant && !window.confirm('Delete this block and everything in it?')) return;
                  setBlocks(draft.blocks.filter((b) => b.id !== block.id));
                }}
                onInsert={(type) => insertAt(index + 1, type)}
              >
                <BlockEditor
                  block={block}
                  courseId={courseId}
                  assets={props.assets}
                  legacy={lesson.legacy}
                  readOnly={!editable}
                  onChange={(next) => setBlocks(draft.blocks.map((b) => (b.id === block.id ? next : b)))}
                  onAssetAdded={props.onAssetAdded}
                />
              </BlockFrame>
            ))}
            {editable && <AddBlockMenu onAdd={(type) => insertAt(draft.blocks.length, type)} />}
          </div>

          <div className="border-t border-line pt-6">
            <h3 className="mb-1 font-display text-base font-semibold text-ink">Activities</h3>
            <p className="mb-4 text-sm text-ink-muted">Shown to students after the lesson content, in this order.</p>
            <ActivitiesPanel courseId={courseId} lesson={lesson} editable={editable} onChanged={props.onActivitiesChanged} onQuizSaved={(s) => props.onQuizSaved(lesson.id, s)} />
          </div>
        </div>
      )}
    </div>
  );
}
