/**
 * Landing page
 * Combines the device hero and the dark portfolio layout
 * with ForexOrbit courses, practice, and signup.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Check,
  GraduationCap,
  LineChart,
  Menu,
  MessageCircle,
  Play,
  Shield,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import CourseCard from '@/components/CourseCard';
import { useAuth } from '@/hooks/useAuth';
import { useCourses } from '@/hooks/useCourses';
import { apiClient } from '@/lib/api-client';

const levels = ['Beginner', 'Intermediate', 'Advanced', 'Demo desk', 'Live classes'];

const paths = [
  { pair: 'Foundation', name: 'Market structure', note: 'Candles, sessions, and how a quote moves', progress: 'Start here' },
  { pair: 'Price action', name: 'Charts that mean something', note: 'Levels, trends, and when a setup is incomplete', progress: 'Core path' },
  { pair: 'Risk', name: 'Size, stop, and review', note: 'The part that keeps a good idea from becoming a bad trade', progress: 'Practice' },
];

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [filters, setFilters] = useState({ category: '', difficulty: '', search: '' });
  const { courses, loading, enroll, unenroll } = useCourses(filters);
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
          <Link href="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-[#F28C28]/50 bg-black text-sm text-[#F28C28]">FO</span>
            Forex<span className="text-[#F28C28]">Orbit</span>
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
        <section className="relative overflow-hidden bg-[#07080c]">
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[55%] bg-[radial-gradient(circle_at_center,#4A2506_0%,transparent_70%)]" aria-hidden />
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-24">
            <div>
              <p className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-[#F28C28]">
                <Sparkles className="h-4 w-4" aria-hidden />
                Forex, on your orbit
              </p>
              <h1 className="font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
                Learn the market
                <span className="mt-2 block text-[#F28C28]">your way.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/75">
                Structured lessons, a demo desk, and instructors who stay with the chart after the video ends. Built for people who want a routine, not a signal feed.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href={accountHref} className="inline-flex items-center justify-center gap-2 rounded-full bg-[#F28C28] px-6 py-3 font-semibold text-[#102017]">
                  {accountLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a href="#practice" className="inline-flex items-center justify-center gap-2 rounded-full border border-[#F28C28]/70 px-6 py-3 font-semibold text-white/90 hover:bg-white/5">
                  <Play className="h-4 w-4" aria-hidden />
                  How practice works
                </a>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-md pb-16 pt-10">
              <div className="absolute -left-6 top-16 hidden h-28 w-28 rounded-full bg-[#F28C28]/20 blur-2xl sm:block" aria-hidden />
              <div className="relative rounded-[2rem] border border-white/10 bg-[#101214] p-4 shadow-2xl shadow-black/50">
                <div className="mb-4 flex items-center justify-between text-xs text-white/50">
                  <span>EUR/USD · lesson chart</span>
                  <span className="text-[#F28C28]">Study mode</span>
                </div>
                <svg viewBox="0 0 320 150" className="h-36 w-full" role="img" aria-label="Sample lesson chart">
                  <path d="M0 110 C 40 100, 50 70, 80 78 S 130 120, 160 90 S 220 40, 260 55 S 300 90, 320 70" fill="none" stroke="#F28C28" strokeWidth="3" />
                  <path d="M0 120 C 40 112, 70 90, 110 96 S 170 130, 210 100 S 270 80, 320 88" fill="none" stroke="#F8B56A" strokeWidth="2" opacity="0.8" />
                </svg>
                <ul className="mt-2 space-y-2 text-sm">
                  {['Read the session', 'Mark the level', 'Write the risk before the entry'].map((step, index) => (
                    <li key={step} className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2">
                      <span>{index + 1}. {step}</span>
                      <span className="text-xs text-[#F28C28]">Lesson</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="absolute right-2 top-0 rounded-2xl border border-white/10 bg-[#101214]/95 p-4 shadow-xl">
                <p className="text-xs text-white/50">Lesson progress</p>
                <p className="font-display text-3xl font-bold text-[#F28C28]">Keep going</p>
              </div>
              <div className="absolute bottom-0 left-4 rounded-2xl border border-white/10 bg-[#101214] px-4 py-3 shadow-xl">
                <p className="text-xs text-white/50">Today&apos;s desk</p>
                <p className="font-semibold">Demo practice · no live order</p>
              </div>
            </div>
          </div>
          <div className="mx-auto flex max-w-7xl flex-wrap gap-3 px-4 pb-10 sm:px-6">
            {levels.map((level) => (
              <span key={level} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/75">{level}</span>
            ))}
          </div>
        </section>

        <section id="practice" className="bg-[#07080c] py-20">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2">
            <div>
              <p className="text-sm font-semibold text-[#F28C28]">Work the chart with us</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">Build a routine that survives the next session.</h2>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {[
                  { icon: BookOpen, title: 'Guided courses', text: 'Lessons in order, with the next one waiting when this one is done.' },
                  { icon: LineChart, title: 'Demo desk', text: 'Practice the idea on a demo account before it is a real decision.' },
                  { icon: Users, title: 'Room for questions', text: 'Community rooms stay with your learning level.' },
                ].map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <item.icon className="mb-3 h-5 w-5 text-[#F28C28]" aria-hidden />
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-white/60">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl border border-white/10 bg-[#101214] p-6">
              <p className="text-sm text-[#F28C28]">Your study list</p>
              <p className="mt-1 font-display text-2xl font-bold">Three paths, one desk</p>
              <ul className="mt-6 space-y-3">
                {paths.map((path) => (
                  <li key={path.pair} className="flex items-center justify-between rounded-2xl bg-black/25 px-4 py-3">
                    <div>
                      <p className="font-semibold">{path.name}</p>
                      <p className="text-xs text-white/50">{path.pair} · {path.note}</p>
                    </div>
                    <span className="text-xs font-semibold text-[#F28C28]">{path.progress}</span>
                  </li>
                ))}
              </ul>
              <Link href="/demo-trading" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#F28C28]">
                Open the demo desk <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden bg-[#07080c] py-20">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="grid gap-4 sm:grid-cols-2">
              {paths.map((path) => (
                <article key={path.name} className="rounded-3xl border border-white/10 bg-[#12182a]/90 p-5 shadow-xl">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/40">{path.pair}</p>
                  <h3 className="mt-3 font-display text-2xl font-bold">{path.name}</h3>
                  <p className="mt-2 text-sm text-white/60">{path.note}</p>
                </article>
              ))}
            </div>
            <div>
              <p className="text-sm font-semibold text-[#F28C28]">Academy portfolio</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">Start a path today. Keep the history when you pause.</h2>
              <ul className="mt-8 space-y-4">
                {[
                  { icon: LineChart, title: 'Lessons that stay yours', text: 'Unenrolling keeps the record. Coming back does not wipe the work.' },
                  { icon: Shield, title: 'Practice without a live ticket', text: 'The demo desk is for repetition. It does not place a market order.' },
                  { icon: GraduationCap, title: 'A person on the other side', text: 'Book a consultation when a chart needs a second set of eyes.' },
                ].map((item) => (
                  <li key={item.title} className="flex gap-4">
                    <span className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#F28C28]/15 text-[#F28C28]">
                      <item.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <div>
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="text-sm text-white/60">{item.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
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
            <div className="rounded-3xl border border-white/10 bg-[#101214] p-6">
              <div className="flex items-end gap-2">
                {[40, 68, 52, 80, 64, 90, 74].map((height) => (
                  <span key={height} className="w-full rounded-t-md bg-gradient-to-t from-[#7C3C08] to-[#F28C28]" style={{ height: `${height}px` }} />
                ))}
              </div>
              <p className="mt-4 text-sm text-white/60">A week of lessons completed. The bars are a picture of the habit, not a profit claim.</p>
            </div>
          </div>
        </section>

        <section className="bg-[#07080c] py-20 text-white">
          <div id="courses" className="mx-auto max-w-7xl px-4 sm:px-6">
            <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-sm font-semibold text-[#F28C28]">The catalog</p>
                <h2 className="font-display text-4xl font-bold tracking-tight">Courses you can open today</h2>
              </div>
              <Link href="/courses" className="text-sm font-semibold text-[#F28C28]">View the full list</Link>
            </div>
            <div className="mb-8 grid gap-3 sm:grid-cols-3">
              <input
                type="search"
                value={filters.search}
                onChange={(event) => setFilters({ ...filters, search: event.target.value })}
                placeholder="Search courses"
                className="rounded-2xl border border-white/10 bg-[#101214] px-4 py-3 text-sm text-white outline-none ring-[#F28C28] focus:ring-2"
              />
              <select value={filters.category} onChange={(event) => setFilters({ ...filters, category: event.target.value })} className="rounded-2xl border border-white/10 bg-[#101214] px-4 py-3 text-sm text-white">
                <option value="">All categories</option>
                <option value="basics">Basics</option>
                <option value="technical">Technical analysis</option>
                <option value="fundamental">Fundamental analysis</option>
                <option value="trading">Trading strategies</option>
              </select>
              <select value={filters.difficulty} onChange={(event) => setFilters({ ...filters, difficulty: event.target.value })} className="rounded-2xl border border-white/10 bg-[#101214] px-4 py-3 text-sm text-white">
                <option value="">All levels</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </div>
            {loading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="h-48 animate-pulse rounded-2xl bg-[#101214]" />
                ))}
              </div>
            ) : courses.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#101214] px-6 py-16 text-center">
                <BookOpen className="mx-auto mb-3 h-8 w-8 text-white/40" aria-hidden />
                <p className="font-semibold">No courses match those filters.</p>
                <button type="button" className="mt-3 text-sm font-semibold text-[#F28C28]" onClick={() => setFilters({ category: '', difficulty: '', search: '' })}>Clear filters</button>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {courses.map((course) => (
                  <CourseCard key={course._id || course.id} course={course} onEnroll={enroll} onUnenroll={unenroll} />
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
                { href: '/community', icon: Users, title: 'Community', text: 'Talk with people on the same learning level, in the room that matches it.' },
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
            <p className="font-display text-xl font-bold">Forex<span className="text-[#F28C28]">Orbit</span></p>
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
