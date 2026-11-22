/**
 * Course builder (instructors, admins, Super Admin): one workspace for a course's details,
 * curriculum, lesson content, files and publishing. The same page serves both dashboards; what a
 * member may do comes from the server (GET /api/courses/:id/builder `permissions`) and every change
 * is checked again by its API.
 *
 * Content is stored once (lib/course-content.js) and students see it through the same components
 * the preview uses (components/course/*).
 */

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Eye, FileText, FolderOpen, LayoutList, Rocket, Settings2 } from 'lucide-react';
import Header from '@/components/Header';
import CurriculumPanel, { type OutlineLessonInfo } from '@/components/builder/CurriculumPanel';
import LessonEditor from '@/components/builder/LessonEditor';
import { DetailsPanel, FilesPanel, PublishPanel, STATUS_LABEL } from '@/components/builder/CoursePanels';
import { copyBlocks } from '@/components/builder/BlockEditors';
import type { LessonDraft } from '@/components/builder/useLessonAutosave';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { courseReadiness, lessonKinds, readingMinutes, type ReadinessIssue } from '@/lib/course-content';
import type { BuilderAsset, BuilderCourse } from '@/lib/course-curriculum';
import { addModule, curriculumPayload, deleteModule, materialize, moveModule, placeLesson, placeModule, renameModule, stepLesson, type BuilderModule } from '@/lib/curriculum-ops';

type Tab = 'content' | 'details' | 'files' | 'publish';
const TABS: Array<{ id: Tab; label: string; Icon: typeof LayoutList }> = [
  { id: 'content', label: 'Curriculum & content', Icon: LayoutList },
  { id: 'details', label: 'Details', Icon: Settings2 },
  { id: 'files', label: 'Files', Icon: FolderOpen },
  { id: 'publish', label: 'Publish', Icon: Rocket },
];

function errorText(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: string } } })?.response?.data?.error || fallback;
}
const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

/** Builder lessons in the shape lib/course-content.js readiness expects. */
function readinessInput(data: BuilderCourse) {
  return {
    course: { ...data.course, modules: data.modules.filter((m) => !m.implicit).map((m) => ({ id: m.id, title: m.title })) },
    // The builder's blocks (stored, or derived from a pre-builder lesson) with the legacy HTML they may point at.
    lessons: data.lessons.map((l) => ({ _id: l.id, title: l.title, order: l.order, moduleId: l.moduleId, blocks: l.blocks, description: l.legacy.description, content: l.legacy.content })),
    quizzes: new Map(data.lessons.filter((l) => l.quiz).map((l) => [l.id, l.quiz!])),
    assetIds: new Set(data.assets.map((a) => a.id)),
  };
}

export default function CourseBuilderPage() {
  const router = useRouter();
  const courseId = one(router.query.courseId);
  const { user, loading: authLoading, isAuthenticated } = useAuth();
  const [data, setData] = useState<BuilderCourse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [showOutline, setShowOutline] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const tab = (['content', 'details', 'files', 'publish'].includes(one(router.query.tab)) ? one(router.query.tab) : 'content') as Tab;
  const selected = one(router.query.lesson) || null;

  useEffect(() => {
    if (authLoading) return;
    if (!isAuthenticated) void router.replace(`/login?next=${encodeURIComponent(router.asPath)}`);
    else if (user && !['instructor', 'admin', 'superadmin'].includes(user.role)) void router.replace('/dashboard');
  }, [authLoading, isAuthenticated, user, router]);

  const load = useCallback(async () => {
    if (!courseId) return;
    try {
      const next = await apiClient.get<BuilderCourse>(`/courses/${courseId}/builder`);
      setData(next);
      setLoadError(null);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setLoadError(status === 404 ? 'This course does not exist, or it is not assigned to you.' : errorText(err, 'The course could not be loaded.'));
    }
  }, [courseId]);
  useEffect(() => { if (router.isReady && user) void load(); }, [router.isReady, user, load]);

  const go = useCallback((patch: Record<string, string | null>) => {
    const query: Record<string, string> = { courseId };
    const merged = { tab, lesson: selected, ...patch };
    if (merged.tab && merged.tab !== 'content') query.tab = merged.tab;
    if (merged.lesson) query.lesson = merged.lesson;
    void router.replace({ pathname: '/builder/[courseId]', query }, undefined, { shallow: true });
  }, [courseId, router, selected, tab]);

  // Open the first lesson when none is chosen.
  useEffect(() => {
    if (!data || tab !== 'content') return;
    const ids = data.modules.flatMap((m) => m.lessonIds);
    if ((!selected || !ids.includes(selected)) && ids.length) go({ lesson: ids[0] });
  }, [data, selected, tab, go]);

  const readiness = useMemo(() => (data ? courseReadiness(readinessInput(data)) : null), [data]);
  const editable = Boolean(data?.permissions.editContent);
  const order = useMemo(() => (data ? data.modules.flatMap((m) => m.lessonIds) : []), [data]);

  const outlineLessons = useMemo(() => {
    const map: Record<string, OutlineLessonInfo> = {};
    for (const l of data?.lessons || []) {
      map[l.id] = {
        id: l.id, title: l.title, kinds: l.kinds, minutes: l.minutes, hasQuiz: Boolean(l.quiz && l.quiz.questions > 0),
        activities: l.assignments.length + l.practicalTasks.length,
        issues: readiness ? readiness.issues.filter((i) => i.lessonId === l.id && i.level === 'error').length : 0,
        dirty: dirty[l.id], isFreePreview: l.isFreePreview,
      };
    }
    return map;
  }, [data, readiness, dirty]);

  const saveCurriculum = async (next: BuilderModule[] | null) => {
    if (!data || !next) return;
    const previous = data;
    setBusy(true); setNotice(null);
    setData({ ...data, modules: next });
    try {
      const res = await apiClient.put<{ version: number; modules: Array<{ id: string; title: string }> }>(`/courses/${courseId}/curriculum`, { version: data.curriculumVersion, modules: curriculumPayload(next) });
      setData((d) => (d ? { ...d, curriculumVersion: res.version, modules: next.map((m) => ({ ...m, implicit: false })), lessons: d.lessons.map((l) => { const m = next.find((x) => x.lessonIds.includes(l.id)); return { ...l, moduleId: m ? m.id : l.moduleId }; }) } : d));
    } catch (err) {
      setData(previous);
      setNotice({ tone: 'warn', text: errorText(err, 'The curriculum could not be saved.') });
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) await load();
    } finally { setBusy(false); }
  };

  const addLesson = async (moduleId: string, copyOf?: string) => {
    if (!data) return;
    setBusy(true); setNotice(null);
    try {
      // A lesson can join a real module; with the implicit module, the curriculum is made real first.
      let target = moduleId;
      if (data.modules.some((m) => m.implicit)) {
        const res = await apiClient.put<{ version: number; modules: Array<{ id: string; title: string }> }>(`/courses/${courseId}/curriculum`, { version: data.curriculumVersion, modules: curriculumPayload(materialize(data.modules)) });
        target = res.modules[Math.max(0, data.modules.findIndex((m) => m.id === moduleId))].id;
      }
      const source = copyOf ? data.lessons.find((l) => l.id === copyOf) : null;
      const body = source
        ? { courseId, moduleId: target, title: `${source.title || 'Untitled lesson'} (copy)`.slice(0, 500), blocks: copyBlocks(source.blocks.filter((b) => b.type !== 'legacy')), isFreePreview: false }
        : { courseId, moduleId: target, title: 'Untitled lesson', blocks: [] };
      const created = await apiClient.post<{ id: string }>('/lessons', body);
      await load();
      go({ lesson: created.id, tab: 'content' });
      setView('edit');
      if (source && source.blocks.some((b) => b.type === 'legacy')) setNotice({ tone: 'warn', text: 'Duplicated. Earlier (pre-builder) text was not copied; convert it to editable text first to include it.' });
      else if (source && (source.quiz || source.assignments.length)) setNotice({ tone: 'ok', text: 'Duplicated the lesson content. Quizzes, assignments and tasks stay with the original lesson.' });
    } catch (err) {
      setNotice({ tone: 'warn', text: errorText(err, 'The lesson could not be added.') });
      await load();
    } finally { setBusy(false); }
  };

  const confirmDeleteLesson = async (lessonId: string) => {
    setBusy(true); setNotice(null);
    try {
      await apiClient.delete(`/lessons/${lessonId}`);
      setDeleting(null);
      const idx = order.indexOf(lessonId);
      await load();
      go({ lesson: order[idx + 1] || order[idx - 1] || null });
      setNotice({ tone: 'ok', text: 'Lesson deleted.' });
    } catch (err) {
      setNotice({ tone: 'warn', text: errorText(err, 'The lesson could not be deleted.') });
    } finally { setBusy(false); }
  };

  const onLessonSaved = useCallback((lessonId: string, draft: LessonDraft, revision: number) => {
    setData((d) => (d ? { ...d, lessons: d.lessons.map((l) => (l.id === lessonId ? { ...l, title: draft.title, blocks: draft.blocks, isFreePreview: draft.isFreePreview, revision, usesBlocks: true, kinds: lessonKinds({ blocks: draft.blocks }), minutes: readingMinutes({ blocks: draft.blocks, description: l.legacy.description, content: l.legacy.content }) } : l)) } : d));
  }, []);
  const onDirtyChange = useCallback((lessonId: string, value: boolean) => setDirty((m) => (m[lessonId] === value ? m : { ...m, [lessonId]: value })), []);
  const onAssetAdded = useCallback((a: BuilderAsset) => setData((d) => (d ? { ...d, assets: [...d.assets.filter((x) => x.id !== a.id), a] } : d)), []);

  const jumpTo = (i: ReadinessIssue) => {
    if (i.area === 'details') go({ tab: 'details' });
    else if (i.lessonId) { go({ tab: 'content', lesson: i.lessonId }); setView('edit'); if (i.blockId) setTimeout(() => document.getElementById(`edit-block-${i.blockId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300); }
    else go({ tab: 'content' });
  };

  if (authLoading || !user) return null;
  const backHref = user.role === 'instructor' ? '/instructor/dashboard?section=courses' : '/admin/courses';

  if (loadError || !data) {
    return (
      <div className="min-h-screen bg-[var(--fo-bg)]">
        <Header />
        <main className="mx-auto max-w-3xl px-4 py-24 text-center">
          {loadError ? (
            <>
              <h1 className="font-display text-2xl font-semibold text-ink">Course unavailable</h1>
              <p className="mt-2 text-ink-muted">{loadError}</p>
              <div className="mt-6 flex justify-center gap-3"><button type="button" className="btn btn-primary" onClick={() => void load()}>Try again</button><Link href={backHref} className="btn btn-secondary">Back to courses</Link></div>
            </>
          ) : (
            <div className="space-y-4" aria-busy="true"><div className="mx-auto h-8 w-64 animate-pulse rounded-lg bg-surface-2" /><div className="mx-auto h-64 animate-pulse rounded-2xl bg-surface-2" /></div>
          )}
        </main>
      </div>
    );
  }

  const lesson = data.lessons.find((l) => l.id === selected) || null;
  const position = lesson ? order.indexOf(lesson.id) + 1 : 0;
  const moduleOf = lesson ? data.modules.find((m) => m.lessonIds.includes(lesson.id)) : null;
  const status = STATUS_LABEL[data.course.status];
  const deletingLesson = deleting ? data.lessons.find((l) => l.id === deleting) : null;

  return (
    <div className="min-h-screen bg-[var(--fo-bg)]">
      <Head><title>{`${data.course.title || 'Untitled course'} · Course builder`}</title></Head>
      <Header />
      <div className="sticky top-16 z-30 border-b border-line bg-[color-mix(in_srgb,var(--fo-bg)_92%,transparent)] backdrop-blur" data-testid="builder-bar">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <Link href={backHref} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Courses</span></Link>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-semibold text-ink sm:text-lg" data-testid="builder-title">{data.course.title || 'Untitled course'}</p>
            <p className="flex items-center gap-2 text-xs text-ink-subtle">
              <span className={`rounded-full px-2 py-0.5 font-semibold ${status.tone}`} data-testid="builder-status">{status.label}</span>
              {data.course.instructor && <span className="hidden truncate sm:inline">Instructor: {data.course.instructor.name}</span>}
              {readiness && !readiness.ready && <button type="button" className="font-semibold text-amber-700 hover:underline dark:text-amber-300" onClick={() => go({ tab: 'publish' })}>{readiness.errors} to fix</button>}
            </p>
          </div>
          <Link href={`/builder/${courseId}/preview${lesson ? `?lesson=${lesson.id}` : ''}`} className="btn btn-secondary btn-sm" data-testid="preview-course"><Eye className="h-4 w-4" aria-hidden />Preview course</Link>
        </div>
        <nav className="mx-auto flex max-w-[90rem] gap-1 overflow-x-auto px-4 sm:px-6" aria-label="Builder sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => go({ tab: t.id })} aria-current={tab === t.id ? 'page' : undefined} className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm font-semibold ${tab === t.id ? 'border-primary-500 text-ink' : 'border-transparent text-ink-subtle hover:text-ink'}`} data-testid={`tab-${t.id}`}>
              <t.Icon className="h-4 w-4" aria-hidden />{t.label}
            </button>
          ))}
        </nav>
      </div>

      {notice && (
        <div className="mx-auto max-w-[90rem] px-4 pt-4 sm:px-6">
          <p className={`notice ${notice.tone === 'ok' ? 'notice-brand' : 'notice-caution'} flex items-center justify-between gap-3 text-sm`} role="status">{notice.text}<button type="button" className="text-xs font-semibold" onClick={() => setNotice(null)}>Dismiss</button></p>
        </div>
      )}
      {data.truncated && <p className="mx-auto max-w-[90rem] px-4 pt-4 text-sm text-amber-700 sm:px-6">This course has more lessons than the builder shows at once (500).</p>}

      <main className="mx-auto max-w-[90rem] px-4 pb-24 pt-6 sm:px-6">
        {tab === 'content' && (
          <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-10">
            <aside className="lg:sticky lg:top-[9.5rem] lg:max-h-[calc(100vh-11rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
              <button type="button" className="btn btn-secondary mb-3 w-full justify-between lg:hidden" aria-expanded={showOutline} onClick={() => setShowOutline((v) => !v)}>
                <span className="inline-flex items-center gap-2"><LayoutList className="h-4 w-4" aria-hidden />Curriculum · {order.length} lessons</span><span className="text-xs text-ink-subtle">{showOutline ? 'Hide' : 'Show'}</span>
              </button>
              <div className={`${showOutline ? 'block' : 'hidden'} lg:block`}>
                <CurriculumPanel
                  modules={data.modules}
                  lessons={outlineLessons}
                  selectedLessonId={selected}
                  editable={editable}
                  busy={busy}
                  onSelect={(id) => { go({ lesson: id }); setShowOutline(false); }}
                  onAddLesson={(m) => void addLesson(m)}
                  onAddModule={() => void saveCurriculum(addModule(data.modules))}
                  onRenameModule={(id, title) => void saveCurriculum(renameModule(data.modules, id, title))}
                  onDeleteModule={(id) => {
                    const m = data.modules.find((x) => x.id === id);
                    if (!m) return;
                    if (m.lessonIds.length && !window.confirm(`Delete "${m.title || 'this module'}"? Its ${m.lessonIds.length} lesson(s) move to the neighbouring module; no lesson is deleted.`)) return;
                    void saveCurriculum(deleteModule(data.modules, id));
                  }}
                  onMoveModule={(id, d) => void saveCurriculum(moveModule(data.modules, id, d))}
                  onPlaceModule={(id, i) => void saveCurriculum(placeModule(data.modules, id, i))}
                  onPlaceLesson={(l, m, i) => void saveCurriculum(placeLesson(data.modules, l, m, i))}
                  onStepLesson={(l, d) => void saveCurriculum(stepLesson(data.modules, l, d))}
                  onDuplicateLesson={(l) => { const m = data.modules.find((x) => x.lessonIds.includes(l)); if (m) void addLesson(m.id, l); }}
                  onDeleteLesson={(l) => setDeleting(l)}
                />
              </div>
            </aside>
            <section className="min-w-0">
              {lesson ? (
                <LessonEditor
                  key={lesson.id}
                  courseId={courseId}
                  lesson={lesson}
                  position={position}
                  total={order.length}
                  moduleTitle={moduleOf && !moduleOf.implicit ? moduleOf.title : null}
                  assets={data.assets}
                  editable={editable}
                  issues={readiness ? readiness.issues.filter((i) => i.lessonId === lesson.id) : []}
                  view={view}
                  onViewChange={setView}
                  onSaved={onLessonSaved}
                  onDirtyChange={onDirtyChange}
                  onAssetAdded={onAssetAdded}
                  onActivitiesChanged={() => void load()}
                  onQuizSaved={(id, s) => setData((d) => (d ? { ...d, lessons: d.lessons.map((l) => (l.id === id ? { ...l, quiz: s } : l)) } : d))}
                  onReload={() => void load()}
                  live={data.course.status === 'published' || data.course.status === 'archived'}
                  onAiApplied={(message) => { setNotice({ tone: 'ok', text: message }); void load(); }}
                  prev={position > 1 ? { id: order[position - 2], title: '' } : null}
                  next={position < order.length ? { id: order[position], title: '' } : null}
                  onSelect={(id) => go({ lesson: id })}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center" data-testid="empty-course">
                  <FileText className="mx-auto h-8 w-8 text-ink-subtle" aria-hidden />
                  <h2 className="mt-3 font-display text-xl font-semibold text-ink">Build the curriculum</h2>
                  <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">Organise the course into modules and lessons. Each lesson holds text, video, images, files and activities.</p>
                  {editable && <button type="button" className="btn btn-primary mt-5" onClick={() => void addLesson(data.modules[0].id)} disabled={busy} data-testid="first-lesson">Add the first lesson</button>}
                </div>
              )}
            </section>
          </div>
        )}
        {tab === 'details' && <DetailsPanel course={data.course} editable={editable} issues={readiness ? readiness.issues.filter((i) => i.area === 'details') : []} onConflict={() => void load()} onSaved={(d, updatedAt) => setData((x) => (x ? { ...x, course: { ...x.course, ...d, objectives: d.objectives.filter((o) => o.trim()), updatedAt } } : x))} />}
        {tab === 'files' && <FilesPanel courseId={courseId} assets={data.assets} editable={editable} onAdded={onAssetAdded} onRemoved={(id) => setData((d) => (d ? { ...d, assets: d.assets.filter((a) => a.id !== id) } : d))} />}
        {tab === 'publish' && readiness && <PublishPanel data={{ ...data, readiness }} onIssue={jumpTo} onChanged={() => void load()} />}
      </main>

      {deletingLesson && <DeleteLessonDialog lesson={deletingLesson} busy={busy} onCancel={() => setDeleting(null)} onConfirm={() => void confirmDeleteLesson(deletingLesson.id)} />}
    </div>
  );
}

function DeleteLessonDialog({ lesson, busy, onCancel, onConfirm }: { lesson: BuilderCourse['lessons'][number]; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const significant = lesson.blocks.length > 0 || Boolean(lesson.quiz) || lesson.assignments.length > 0 || lesson.practicalTasks.length > 0;
  const [typed, setTyped] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onCancel]);
  const ok = !significant || typed.trim().toLowerCase() === 'delete';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="delete-lesson-title">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface-1 p-5 shadow-lift">
        <h2 id="delete-lesson-title" className="font-display text-lg font-semibold text-ink">Delete “{lesson.title || 'Untitled lesson'}”?</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>The lesson and its {lesson.blocks.length} content block{lesson.blocks.length === 1 ? '' : 's'} are removed for everyone.</li>
          {lesson.quiz && <li>Its quiz is removed. Students’ recorded quiz results are kept.</li>}
          {(lesson.assignments.length > 0 || lesson.practicalTasks.length > 0) && <li>Assignments and practical tasks linked to it stay in the course, with their submissions and grades.</li>}
          <li>Students’ completed-lesson history is kept; progress is recounted against the remaining lessons.</li>
        </ul>
        {significant && (
          <label className="mt-4 block text-sm text-ink">Type <strong>delete</strong> to confirm
            <input ref={ref} className="input mt-1.5 w-full" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="confirm-delete-input" />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn-primary bg-red-600 hover:bg-red-700" disabled={!ok || busy} onClick={onConfirm} data-testid="confirm-delete">{busy ? 'Deleting…' : 'Delete lesson'}</button>
        </div>
      </div>
    </div>
  );
}
