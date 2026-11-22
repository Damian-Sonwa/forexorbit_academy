/**
 * Course preview for owners: the course page and every lesson as an enrolled student sees them,
 * built from the saved course with the student components (course cover, intro, outline, lesson
 * header, body renderer, activities). Nothing is recorded and no draft is published; the banner
 * says so. Unsaved edits are previewed inside the builder (Student preview on a lesson).
 */

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import Header from '@/components/Header';
import CourseCover from '@/components/CourseCover';
import CourseIntro from '@/components/course/CourseIntro';
import LessonOutline, { moduleHeadings } from '@/components/student/LessonOutline';
import LessonPreview, { PreviewBanner, type PreviewQuiz } from '@/components/course/LessonPreview';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { sanitizeForStudentView } from '@/lib/html-sanitizer';
import type { BuilderCourse } from '@/lib/course-curriculum';

const one = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');

export default function CoursePreviewPage() {
  const router = useRouter();
  const courseId = one(router.query.courseId);
  const lessonId = one(router.query.lesson);
  const { user, loading, isAuthenticated } = useAuth();
  const [data, setData] = useState<BuilderCourse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<PreviewQuiz>(null);

  useEffect(() => {
    if (loading) return;
    if (!isAuthenticated) void router.replace('/login');
    else if (user && !['instructor', 'admin', 'superadmin'].includes(user.role)) void router.replace('/dashboard');
  }, [loading, isAuthenticated, user, router]);

  useEffect(() => {
    if (!router.isReady || !user || !courseId) return;
    apiClient.get<BuilderCourse>(`/courses/${courseId}/builder`).then(setData).catch(() => setError('This course does not exist, or it is not assigned to you.'));
  }, [router.isReady, user, courseId]);

  const order = useMemo(() => (data ? data.modules.flatMap((m) => m.lessonIds) : []), [data]);
  const lesson = data?.lessons.find((l) => l.id === lessonId) || null;

  useEffect(() => {
    setQuiz(null);
    if (!lesson?.quiz) return;
    let alive = true;
    apiClient.get<{ questions: NonNullable<PreviewQuiz>['questions']; settings: { status: string } }>(`/quizzes/${lesson.id}`)
      .then((q) => { if (alive) setQuiz({ questions: q.questions || [], status: q.settings?.status }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [lesson?.id, lesson?.quiz]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !user) return null;
  if (error) return <div className="min-h-screen"><Header /><main className="mx-auto max-w-xl px-4 py-24 text-center"><p className="text-ink-muted">{error}</p></main></div>;
  if (!data) return <div className="min-h-screen"><Header /><main className="mx-auto max-w-6xl px-4 py-24"><div className="h-64 animate-pulse rounded-2xl bg-surface-2" /></main></div>;

  const modules = data.modules.filter((m) => !m.implicit).map((m) => ({ id: m.id, title: m.title }));
  const outlineLessons = order.map((id) => {
    const l = data.lessons.find((x) => x.id === id)!;
    return { _id: l.id, courseId, title: l.title, moduleId: data.modules.find((m) => m.lessonIds.includes(id))?.id || null, isFreePreview: l.isFreePreview };
  });
  const headings = moduleHeadings(outlineLessons, modules);
  const link = (id: string | null) => `/builder/${courseId}/preview${id ? `?lesson=${id}` : ''}`;
  const position = lesson ? order.indexOf(lesson.id) + 1 : 0;
  let moduleTitle: string | null = null;
  for (let i = position - 1; i >= 0; i -= 1) { if (headings[i]) { moduleTitle = headings[i]; break; } }
  const assetNames = Object.fromEntries(data.assets.map((a) => [a.id, { name: a.name, bytes: a.bytes }]));
  const go = (id: string | null) => void router.push(link(id), undefined, { shallow: true });

  return (
    <div className="min-h-screen bg-[var(--fo-bg)]">
      <Head><title>{`Preview · ${data.course.title || 'Course'}`}</title></Head>
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:px-10">
        <PreviewBanner>
          <Link href={`/builder/${courseId}${lesson ? `?lesson=${lesson.id}` : ''}`} className="btn btn-secondary btn-sm" data-testid="back-to-builder"><ArrowLeft className="h-4 w-4" aria-hidden />Back to builder</Link>
        </PreviewBanner>
        {data.course.status !== 'published' && <p className="mb-4 text-sm text-ink-muted">This course is {data.course.status.replace('_', ' ')}: students cannot see it yet.</p>}

        {!lesson ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8" data-testid="preview-landing">
            <div className="lg:col-span-2">
              <div className="panel-hero mb-6">
                <div className="relative">
                  <CourseCover course={{ _id: data.course.id, title: data.course.title, thumbnail: data.course.thumbnail } as never} aspect="aspect-[16/9] sm:aspect-[21/9]" className="rounded-none" />
                  <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--fo-surface-1)] via-[color-mix(in_srgb,var(--fo-surface-1)_35%,transparent)] to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                    <div className="mb-3 flex flex-wrap items-center gap-2">{data.course.difficulty && <span className="chip backdrop-blur-md">{data.course.difficulty}</span>}{data.course.category && <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">{data.course.category}</span>}</div>
                    <h1 className="page-title break-words sm:!text-[2.5rem]">{data.course.title || 'Untitled course'}</h1>
                  </div>
                </div>
                <div className="p-5 pt-2 sm:p-7 sm:pt-3">
                  <div className="mb-5"><CourseIntro summary={data.course.summary} objectives={data.course.objectives} prerequisites={data.course.prerequisites} estimatedHours={data.course.estimatedHours} lessons={order.length} /></div>
                  {data.course.description && <div className="rich-html-readable mb-4 text-base leading-relaxed"><div dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(data.course.description) }} /></div>}
                </div>
              </div>
              <div className="card rounded-2xl p-5 sm:p-7">
                <p className="page-kicker">Curriculum</p>
                <h2 className="mb-5 mt-2 section-title !text-xl">Course lessons</h2>
                {order.length === 0 ? <p className="text-ink-muted">This course has no lessons yet.</p> : (
                  <div className="space-y-2.5">
                    {order[0] && <button type="button" className="btn btn-primary mb-2 w-full justify-center py-3 sm:w-auto" onClick={() => go(order[0])}>Start the first lesson</button>}
                    {outlineLessons.map((l, i) => (
                      <div key={l._id}>
                        {headings[i] && <h3 className="pb-1 pt-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-subtle first:pt-0" data-testid="course-module">{headings[i]}</h3>}
                        <button type="button" onClick={() => go(l._id)} className="group flex w-full items-center gap-4 rounded-xl border border-line bg-surface-1 p-4 text-left hover:border-line-strong sm:p-5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary-500/50 bg-tint text-sm font-semibold text-primary-600 num dark:text-primary-300">{i + 1}</span>
                          <span className="min-w-0 flex-1 font-semibold text-ink" dangerouslySetInnerHTML={{ __html: sanitizeForStudentView(l.title || 'Untitled lesson') }} />
                          {l.isFreePreview && <span className="chip chip-brand">Free preview</span>}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-2"><button type="button" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink" onClick={() => go(null)}><ArrowLeft className="h-4 w-4" aria-hidden />Back to Course</button></div>
            <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start lg:gap-8">
              <div className="lg:order-2 lg:sticky lg:top-20">
                <LessonOutline courseId={courseId} lessons={outlineLessons} currentLessonId={lesson.id} modules={modules} linkFor={(id) => link(id)} />
              </div>
              <div className="min-w-0 lg:order-1">
                <LessonPreview
                  courseId={courseId}
                  lesson={lesson}
                  title={lesson.title}
                  blocks={lesson.blocks}
                  position={position}
                  total={order.length}
                  moduleTitle={moduleTitle}
                  quiz={quiz}
                  resolveAsset={(assetId) => `/api/courses/${courseId}/assets?assetId=${assetId}`}
                  assetNames={assetNames}
                  prev={position > 1 ? { label: 'Previous lesson', onClick: () => go(order[position - 2]) } : null}
                  next={position < order.length ? { label: 'Next lesson', onClick: () => go(order[position]) } : null}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
