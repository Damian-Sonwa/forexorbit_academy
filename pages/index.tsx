/**
 * Landing page
 * Combines the device hero and the dark portfolio layout
 * with ForexOrbit courses, practice, and signup.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';
import {
  ArrowRight,
  BookOpen,
  Check,
  GraduationCap,
  LineChart,
  Menu,
  MessageCircle,
  Shield,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useCourses, type Course } from '@/hooks/useCourses';
import { apiClient } from '@/lib/api-client';
import { loginHref } from '@/lib/login-redirect';
import { sanitizeForStudentView, stripHtml } from '@/lib/html-sanitizer';

const levels = ['Beginner', 'Intermediate', 'Advanced', 'Demo desk'];

const subjectLabels: Record<string, string> = {
  basics: 'Market structure',
  technical: 'The chart',
  fundamental: 'The calendar',
  trading: 'The trade',
};

function catalogSubject(category: string) {
  return subjectLabels[category] || category;
}

const catalogPhotos = [
  '/images/catalog/digital-forex.webp',
  '/images/catalog/global-network.webp',
  '/images/catalog/trading-floor.webp',
  '/images/catalog/golden-investment.webp',
  '/images/catalog/chart-analysis.webp',
  '/images/catalog/forex-dashboard.webp',
];

function catalogImage(course: Course, index: number) {
  if (course.thumbnail) return course.thumbnail;
  return catalogPhotos[index];
}

function levelLabel(difficulty: string) {
  if (!difficulty) return 'Course';
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

function CatalogEntry({
  course,
  index,
  isAuthenticated,
  onEnroll,
}: {
  course: Course;
  index: number;
  isAuthenticated: boolean;
  onEnroll: (courseId: string) => void;
}) {
  const courseId = course._id || course.id || '';
  const courseHref = isAuthenticated ? `/courses/${courseId}` : loginHref(`/courses/${courseId}`);
  const description = stripHtml(sanitizeForStudentView(course.description || ''));
  const lessonCount = course.lessons?.length;
  const imageSrc = catalogImage(course, index);
  const meta = [levelLabel(course.difficulty), lessonCount ? `${lessonCount} ${lessonCount === 1 ? 'lesson' : 'lessons'}` : catalogSubject(course.category)]
    .filter(Boolean)
    .join(' · ');

  return (
    <article className="flex h-full flex-col rounded-2xl border border-[#eadfce] bg-[#f6f3ec] p-3 text-[#1c1917]">
      <Link href={courseHref} className="block overflow-hidden rounded-xl bg-[#07080c]" aria-label={course.title}>
        {imageSrc ? (
          <img src={imageSrc} alt="" className="aspect-[16/10] w-full object-cover" />
        ) : (
          <div className="flex aspect-[16/10] items-center justify-center">
            <BookOpen className="h-10 w-10 text-[#F28C28]" aria-hidden />
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col px-3 pb-4 pt-5">
        <p className="text-sm text-[#6f675f]">{meta}</p>
        <h3 className="mt-2 font-display text-xl font-bold tracking-tight text-[#1c1917]">
          <Link href={courseHref}>{course.title}</Link>
        </h3>
        {description ? <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-[#6f675f]">{description}</p> : null}
        <div className="mt-auto pt-6">
          {isAuthenticated && !course.enrolled ? (
            <button
              type="button"
              onClick={() => onEnroll(courseId)}
              className="rounded-lg border border-[#F28C28] px-5 py-2 text-xs font-semibold tracking-wide text-[#F28C28] hover:bg-[#F28C28] hover:text-[#102017]"
            >
              ENROLL
            </button>
          ) : (
            <Link
              href={courseHref}
              className="inline-block rounded-lg border border-[#F28C28] px-5 py-2 text-xs font-semibold tracking-wide text-[#F28C28] hover:bg-[#F28C28] hover:text-[#102017]"
            >
              {course.enrolled ? 'CONTINUE' : 'OPEN COURSE'}
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

const paths = [
  { pair: 'Foundation', name: 'Market structure', note: 'Candles, sessions, and how a quote moves', progress: 'Start here' },
  { pair: 'Price action', name: 'Charts that mean something', note: 'Levels, trends, and when a setup is incomplete', progress: 'Core path' },
  { pair: 'Risk', name: 'Size, stop, and review', note: 'The part that keeps a good idea from becoming a bad trade', progress: 'Practice' },
];

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [filters, setFilters] = useState({ category: '', difficulty: '', search: '' });
  const { courses, loading, enroll } = useCourses(filters);
  const [menuOpen, setMenuOpen] = useState(false);
  const [instructors, setInstructors] = useState<Array<{ _id?: string; id?: string; name?: string; title?: string; description?: string; imageUrl?: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<typeof instructors>('/instructors')
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setInstructors(data);
      })
      .catch(() => {
        if (!cancelled) setInstructors([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const accountHref = isAuthenticated ? '/dashboard' : '/signup';
  const accountLabel = isAuthenticated ? 'Open dashboard' : 'Start learning';

  return (
    <div className="landing-shell min-h-screen bg-[#07080c] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07080c]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link
            href="/"
            aria-label="FX Orbit Academy home"
            className="flex shrink-0 items-center rounded-md transition-opacity duration-200 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F28C28] focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf8f4] dark:focus-visible:ring-offset-[#07080c]"
          >
            <BrandLogo priority className="h-8 sm:h-9" />
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-white/75 lg:flex">
            <a href="#courses" className="hover:text-white">Courses</a>
            <a href="#practice" className="hover:text-white">Practice</a>
            <Link href="/community" className="hover:text-white">Community</Link>
            <Link href="/consultations" className="hover:text-white">Consultations</Link>
            <Link href="/about" className="hover:text-white">About</Link>
          </nav>
          <div className="hidden items-center gap-3 sm:flex">
            <Link href="/login" className="rounded-full border border-[#F28C28]/70 px-4 py-2 text-sm font-semibold hover:bg-white/5">Sign in</Link>
            <Link href={accountHref} className="rounded-full bg-[#F28C28] px-4 py-2 text-sm font-semibold text-[#102017] hover:bg-white">{isAuthenticated ? 'Dashboard' : 'Sign up'}</Link>
          </div>
          <button type="button" className="rounded-lg border border-white/15 p-2 lg:hidden" aria-expanded={menuOpen} aria-label="Open menu" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="space-y-3 border-t border-white/10 px-4 py-4 text-sm lg:hidden">
            <a href="#courses" className="block" onClick={() => setMenuOpen(false)}>Courses</a>
            <a href="#practice" className="block" onClick={() => setMenuOpen(false)}>Practice</a>
            <Link href="/community" className="block">Community</Link>
            <Link href="/consultations" className="block">Consultations</Link>
            <Link href="/about" className="block">About</Link>
            <div className="flex gap-3 pt-2">
              <Link href="/login" className="rounded-full border border-[#F28C28]/70 px-4 py-2">Sign in</Link>
              <Link href={accountHref} className="rounded-full bg-[#F28C28] px-4 py-2 font-semibold text-[#102017]">{isAuthenticated ? 'Dashboard' : 'Sign up'}</Link>
            </div>
          </div>
        )}
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#faf8f4] text-[#171717]">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-16 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.12fr)] xl:gap-12 xl:py-20">
            <div>
              <p className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-[#9A4E0C]">
                <Sparkles className="h-4 w-4" aria-hidden />
                Forex, made understandable.
              </p>
              <h1 className="font-display text-[2rem] font-bold leading-[1.08] tracking-tight text-[#171717] sm:text-5xl xl:text-[2.5rem] xl:leading-[1.05]">
                <span className="block">Stop guessing.</span>
                <span className="mt-1 block text-[#C85E0E] sm:mt-2">
                  <span className="sm:hidden">Start<br />understanding</span>
                  <span className="hidden sm:inline">Start understanding</span>
                </span>
                <span className="mt-1 block sm:mt-2">the market.</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-[#525252] sm:text-lg">
                From your first candlestick to your next practice setup, build your market knowledge through structured lessons, guided exercises, and a learning community that helps you keep growing. Learn the reasoning behind the chart, not just what to do next.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link href={accountHref} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#F28C28] px-6 py-3 font-semibold text-[#102017]">
                  {accountLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/how-it-works" className="inline-flex items-center justify-center gap-2 rounded-full border border-[#C85E0E]/50 px-6 py-3 font-semibold text-[#171717] hover:bg-[#F28C28]/10">
                  How it works
                </Link>
              </div>
            </div>

            <div className="mx-auto w-full max-w-[42rem] xl:max-w-none">
              <img
                src="/images/smd.webp"
                alt="EUR/USD lesson chart showing trend identification, support and resistance, risk management, and review steps"
                width={1536}
                height={1024}
                {...{ fetchpriority: 'high' }}
                decoding="async"
                className="mx-auto h-auto w-full drop-shadow-[0_16px_28px_rgba(23,23,23,0.08)]"
              />
            </div>
          </div>
          <div className="mx-auto flex max-w-7xl flex-wrap gap-3 px-4 pb-10 sm:px-6">
            {levels.map((level) => (
              <span key={level} className="rounded-full border border-[#e7e2da] bg-white px-4 py-2 text-sm text-[#525252]">{level}</span>
            ))}
          </div>
        </section>

        <section id="practice" className="bg-[#07080c] py-20 lg:py-24">
          <div className="mx-auto grid max-w-6xl items-start gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#F28C28]">Work the chart with us</p>
              <h2 className="mt-4 max-w-lg font-display text-4xl font-bold leading-[1.12] tracking-tight text-white sm:text-5xl">Build a trading routine that outlasts the session.</h2>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-white/80 sm:text-lg">
                Learn to read the chart, practise your decisions, and build a repeatable process. Your next lesson is ready when you are.
              </p>
              <ul className="mt-8 max-w-md space-y-3">
                {[
                  { title: 'Guided courses', text: 'Lessons in order' },
                  { title: 'Demo desk', text: 'Practice before a real decision' },
                  { title: 'Room for questions', text: 'A room that matches your level' },
                ].map((item) => (
                  <li key={item.title}>
                    <div className="rounded-2xl border border-[#eadfce] bg-[#f6f3ec] px-5 py-4 shadow-[0_8px_20px_-14px_rgba(0,0,0,0.45)]">
                      <p className="text-base font-semibold text-[#1c1917]">{item.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-[#525252]">{item.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[1.75rem] border border-[#eadfce] bg-[#f6f3ec] p-7 shadow-[0_12px_28px_-18px_rgba(0,0,0,0.45)] sm:p-8">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F28C28] text-[#102017]">
                <LineChart className="h-6 w-6" aria-hidden />
              </span>
              <ul className="mt-6 space-y-3">
                {paths.map((path) => (
                  <li key={path.pair} className="flex items-center justify-between gap-4 rounded-2xl border border-[#eadfce] bg-[#ffffff] px-4 py-3.5">
                    <div className="min-w-0">
                      <p className="font-semibold text-[#1c1917]">{path.name}</p>
                      <p className="mt-1 text-sm leading-relaxed text-[#525252]">{path.note}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#F28C28] px-3 py-1 text-xs font-semibold text-[#102017]">{path.progress}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm leading-relaxed text-[#525252]">The demo desk is for practice. It does not place a real market order.</p>
              <Link href="/demo-trading" className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#F28C28] px-5 py-2.5 text-sm font-semibold text-[#102017]">
                Open the demo desk <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>
        </section>

        <section className="bg-[#ffffff] py-20 text-[#171717] lg:py-28">
          <div className="mx-auto max-w-6xl bg-[#ffffff] px-4 sm:px-6">
            <p className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-[#9A4E0C]">Academy portfolio</p>
            <h2 className="mx-auto mt-4 max-w-3xl text-center font-display text-4xl font-bold leading-[1.12] tracking-tight text-[#171717] sm:text-5xl">
              Start a path today. <span className="text-[#C85E0E]">Keep the history when you pause.</span>
            </h2>
            <div className="mt-14 grid gap-5 md:grid-cols-3">
              {[
                { icon: LineChart, title: 'Open the path', text: 'Unenrolling keeps the record. Coming back does not wipe the work.' },
                { icon: Shield, title: 'Practice on the desk', text: 'The demo desk is for repetition. It does not place a market order.' },
                { icon: GraduationCap, title: 'Ask a person', text: 'Book a consultation when a chart needs a second set of eyes.' },
              ].map((item, index) => (
                <article key={item.title} className="rounded-2xl border border-[#e5e5e5] bg-[#ffffff] px-6 py-9 text-center shadow-[0_10px_24px_-18px_rgba(23,23,23,0.28)]">
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#F28C28] text-[#102017]">
                    <item.icon className="h-6 w-6" aria-hidden />
                  </span>
                  <h3 className="mt-5 font-display text-xl font-bold text-[#171717]">{index + 1}. {item.title}</h3>
                  <div className="mx-auto mt-4 h-8 w-px bg-[#F28C28]" aria-hidden />
                  <p className="mt-4 text-sm font-medium leading-relaxed text-[#525252]">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#07080c] py-20">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-[#F28C28]">Study anywhere</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-tight">The lesson, the desk, and the room travel together.</h2>
              <p className="mt-4 max-w-lg text-white/65">Phone, laptop, or the hour between other work. Progress stays on the account, and the next lesson is the one you have not finished.</p>
              <ul className="mt-8 grid grid-cols-2 gap-3 text-sm">
                {['Lessons in order', 'Demo journal', 'Level rooms', 'Instructor notes'].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-white/80">
                    <Check className="h-4 w-4 text-[#F28C28]" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <img
              src="/images/financial-learning-dashboard-devices.webp"
              alt="Phone and laptop showing a financial foundations lesson with progress on both screens"
              width={1536}
              height={1024}
              loading="lazy"
              decoding="async"
              className="h-auto w-full"
            />
          </div>
        </section>

        <section id="courses" className="bg-[#07080c] py-16 text-white sm:py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                type="search"
                value={filters.search}
                onChange={(event) => setFilters({ ...filters, search: event.target.value })}
                placeholder="Find a course"
                aria-label="Find a course"
                className="rounded-xl border border-white/10 bg-[#101214] px-4 py-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-[#F28C28]"
              />
              <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })} aria-label="Subject" className="rounded-xl border border-white/10 bg-[#101214] px-4 py-3 text-sm text-white">
                <option value="">Every subject</option>
                <option value="basics">Market structure</option>
                <option value="technical">The chart</option>
                <option value="fundamental">The calendar</option>
                <option value="trading">The trade</option>
              </select>
              <select value={filters.difficulty} onChange={(event) => setFilters({ ...filters, difficulty: event.target.value })} aria-label="Level" className="rounded-xl border border-white/10 bg-[#101214] px-4 py-3 text-sm text-white">
                <option value="">Every level</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            {loading ? (
              <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-80 animate-pulse rounded-2xl bg-[#101214]" />
                ))}
              </div>
            ) : courses.length === 0 ? (
              <div className="mt-8 rounded-2xl border border-white/10 bg-[#101214] px-6 py-16 text-center">
                <BookOpen className="mx-auto mb-3 h-8 w-8 text-white/40" aria-hidden />
                <p className="text-lg font-semibold">No course matches that search.</p>
                <button type="button" className="mt-4 text-sm font-semibold text-[#F28C28]" onClick={() => setFilters({ category: '', difficulty: '', search: '' })}>Show every course</button>
              </div>
            ) : (
              <div className="mt-8 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
                {courses.map((course, index) => (
                  <CatalogEntry
                    key={course._id || course.id}
                    course={course}
                    index={index}
                    isAuthenticated={isAuthenticated}
                    onEnroll={enroll}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        {instructors.length > 0 && (
          <section className="bg-[#07080c] py-20">
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <h2 className="text-center font-display text-4xl font-bold">People who teach the chart</h2>
              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {instructors.map((instructor) => (
                  <article key={instructor._id || instructor.id || instructor.name} className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-[#F28C28]/20 text-xl font-bold">
                      {instructor.imageUrl ? <img src={instructor.imageUrl} alt="" className="h-full w-full object-cover" /> : (instructor.name || 'F').charAt(0)}
                    </div>
                    <h3 className="font-semibold">{instructor.name}</h3>
                    <p className="text-sm text-[#F28C28]">{instructor.title}</p>
                    <p className="mt-2 text-sm text-white/60">{instructor.description}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="bg-[radial-gradient(circle_at_center,#4A2506_0%,#07080c_62%)] py-20">
          <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
            <p className="text-sm text-white/60">Always on <span className="text-[#F28C28]">your side</span></p>
            <h2 className="mt-3 font-display text-4xl font-bold sm:text-5xl">Be early to the next lesson, not the next rumor.</h2>
            <div className="mt-10 grid gap-4 text-left sm:grid-cols-3">
              {[
                { href: '/help', icon: MessageCircle, title: 'Help', text: 'Questions about an account, a lesson, or a payment go to the help desk.' },
                { href: '/community', icon: Users, title: 'Community', text: 'Ask a question, follow a discussion, and learn from other members.' },
                { href: '/courses', icon: GraduationCap, title: 'Academy', text: 'Open a course, finish the lesson, and leave a record you can return to.' },
              ].map((item) => (
                <Link key={item.title} href={item.href} className="rounded-3xl border border-white/10 bg-black/20 p-6 hover:border-[#F28C28]/40">
                  <item.icon className="h-6 w-6 text-[#F28C28]" aria-hidden />
                  <h3 className="mt-4 font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm text-white/60">{item.text}</p>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#07080c]">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
          <div>
            <Link href="/" aria-label="FX Orbit Academy home" className="inline-flex transition-opacity duration-200 hover:opacity-85">
              <BrandLogo className="h-11" />
            </Link>
            <p className="mt-3 text-sm leading-relaxed text-white/55">A forex academy with courses, a demo desk, and rooms for the questions that show up after the lesson.</p>
          </div>
          <div>
            <p className="font-semibold">Learn</p>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              <li><Link href="/courses" className="hover:text-white">Courses</Link></li>
              <li><Link href="/demo-trading" className="hover:text-white">Demo desk</Link></li>
              <li><Link href="/community" className="hover:text-white">Community</Link></li>
              <li><Link href="/consultations" className="hover:text-white">Consultations</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold">Information</p>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              <li><Link href="/about" className="hover:text-white">About</Link></li>
              <li><Link href="/help" className="hover:text-white">Help</Link></li>
              <li><Link href="/privacy" className="hover:text-white">Privacy</Link></li>
              <li><Link href="/terms" className="hover:text-white">Terms</Link></li>
            </ul>
          </div>
          <div>
            <p className="font-semibold">Account</p>
            <ul className="mt-3 space-y-2 text-sm text-white/60">
              <li><Link href="/login" className="hover:text-white">Sign in</Link></li>
              <li><Link href="/signup" className="hover:text-white">Create an account</Link></li>
              <li><Link href="/dashboard" className="hover:text-white">Dashboard</Link></li>
            </ul>
          </div>
        </div>
        <p className="border-t border-white/10 px-4 py-6 text-center text-xs text-white/40">© {new Date().getFullYear()} ForexOrbit Academy</p>
      </footer>
    </div>
  );
}
