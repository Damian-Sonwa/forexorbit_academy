/**
 * How it works
 * Walks a visitor through the real ForexOrbit flow: account, course, lessons,
 * demo desk, progress, and the support around them.
 */

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  LineChart,
  Menu,
  MessageCircle,
  ShieldAlert,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const studentSteps = [
  {
    icon: UserPlus,
    title: 'Create a free account',
    text: 'Sign up with your name, email, and a password, then choose Student. Student accounts open straight away.',
    points: ['No card needed to sign up', 'Sign in from any device with the same email'],
  },
  {
    icon: GraduationCap,
    title: 'Tell us where you are starting',
    text: 'Onboarding asks about your trading experience, background, and the topics you want. It is optional, and you can edit it later from your profile.',
    points: ['Beginner, intermediate, or advanced', 'Your level sets the community room you join'],
  },
  {
    icon: BookOpen,
    title: 'Pick a course and enroll',
    text: 'Browse the catalogue by subject and level, then enroll in the course that fits. Enrolling is free.',
    points: ['Market structure, the chart, the calendar, and the trade', 'Unenrolling keeps your history if you return'],
  },
  {
    icon: Video,
    title: 'Learn one lesson at a time',
    text: 'Each lesson can carry a video, written notes, resources, a quiz, and a live market signal panel. The first lesson of a course is free to open.',
    points: [
      'A one-time Paystack checkout unlocks the remaining lessons of a paid course',
      'Instructors can attach assignments for you to submit',
    ],
  },
  {
    icon: LineChart,
    title: 'Practise on the demo desk',
    text: 'Follow the MetaTrader demo account guide, complete demo trading tasks, and log each trade in your journal.',
    points: ['Virtual money only', 'The desk never places a real market order'],
  },
  {
    icon: BarChart3,
    title: 'Track your progress',
    text: 'Your dashboard shows enrolled courses and the next lesson to finish. Assignments and challenges earn points toward badges and the leaderboard.',
    points: ['Progress is saved to your account', 'Pick up where you stopped on any device'],
  },
];

const support = [
  {
    icon: Users,
    title: 'Community rooms',
    text: 'Ask questions in a room that matches your level. Share images, audio, or video, and follow market updates posted by instructors.',
    href: '/community',
    cta: 'Open the community',
  },
  {
    icon: MessageCircle,
    title: 'Expert consultations',
    text: 'Choose an expert with published times and send a request. Once they confirm, the session runs on Google Meet or Zoom. The booking flow has no charge.',
    href: '/consultations',
    cta: 'Book a consultation',
  },
  {
    icon: ClipboardCheck,
    title: 'Help desk',
    text: 'Guides for your account, lessons, payments, and common fixes, all in one place.',
    href: '/help',
    cta: 'Visit help',
  },
];

const instructorSteps = [
  'Sign up and choose Instructor. A super admin reviews and approves the account.',
  'Build courses with ordered lessons, video, notes, resources, and quizzes.',
  'Set assignments, grade submissions, and review assignment analytics.',
  'Post market updates and answer questions in the community.',
];

export default function HowItWorks() {
  const { isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const accountHref = isAuthenticated ? '/dashboard' : '/signup';

  return (
    <div className="landing-shell min-h-screen bg-[#07080c] text-white">
      <Head>
        <title>How it works | ForexOrbit Academy</title>
        <meta
          name="description"
          content="How ForexOrbit Academy works: create an account, enroll in a course, learn lesson by lesson, practise on the demo desk, and track your progress."
        />
      </Head>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#07080c]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link
            href="/"
            aria-label="FX Orbit Academy home"
            className="flex shrink-0 items-center rounded-md transition-opacity duration-200 hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#faf8f4] dark:focus-visible:ring-offset-[#07080c]"
          >
            <BrandLogo priority className="h-8 sm:h-9" />
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-white/75 lg:flex">
            <Link href="/#courses" className="hover:text-white">Courses</Link>
            <Link href="/how-it-works" className="text-white" aria-current="page">How it works</Link>
            <Link href="/community" className="hover:text-white">Community</Link>
            <Link href="/consultations" className="hover:text-white">Consultations</Link>
            <Link href="/about" className="hover:text-white">About</Link>
          </nav>
          <div className="hidden items-center gap-3 sm:flex">
            {!isAuthenticated && (
              <Link href="/login" className="rounded-full border border-primary-500/70 px-4 py-2 text-sm font-semibold hover:bg-white/5">Sign in</Link>
            )}
            <Link href={accountHref} className="rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-white">{isAuthenticated ? 'Dashboard' : 'Sign up'}</Link>
          </div>
          <button type="button" className="rounded-lg border border-white/15 p-2 lg:hidden" aria-expanded={menuOpen} aria-label="Open menu" onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="space-y-3 border-t border-white/10 px-4 py-4 text-sm lg:hidden">
            <Link href="/#courses" className="block">Courses</Link>
            <Link href="/how-it-works" className="block">How it works</Link>
            <Link href="/community" className="block">Community</Link>
            <Link href="/consultations" className="block">Consultations</Link>
            <Link href="/about" className="block">About</Link>
            <div className="flex gap-3 pt-2">
              {!isAuthenticated && <Link href="/login" className="rounded-full border border-primary-500/70 px-4 py-2">Sign in</Link>}
              <Link href={accountHref} className="rounded-full bg-primary-500 px-4 py-2 font-semibold text-neutral-950">{isAuthenticated ? 'Dashboard' : 'Sign up'}</Link>
            </div>
          </div>
        )}
      </header>

      <main>
        <section className="theme-light-island bg-[#faf8f4] text-[#171717]">
          <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">How it works</p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              From your first lesson to <span className="text-primary-600">a routine you can repeat.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[#525252] sm:text-lg">
              ForexOrbit pairs structured courses with a demo desk, level-based community rooms, and expert consultations. Here is the path a student follows, step by step.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href={accountHref} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary-500 px-6 py-3 font-semibold text-neutral-950">
                {isAuthenticated ? 'Open dashboard' : 'Create a free account'}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/#courses" className="inline-flex items-center justify-center rounded-full border border-primary-600/50 px-6 py-3 font-semibold hover:bg-primary-500/10">
                Browse courses
              </Link>
            </div>
          </div>
        </section>

        <section className="bg-[#07080c] py-20 lg:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-400">For students</p>
            <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl">Six steps, in the order the app takes you through them.</h2>
            <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {studentSteps.map((step, index) => (
                <li key={step.title} className="theme-light-island flex flex-col rounded-2xl border border-[#eadfce] bg-[#f6f3ec] p-6 text-[#1c1917] shadow-[0_10px_24px_-18px_rgba(0,0,0,0.45)]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-500 text-neutral-950">
                      <step.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="text-sm font-semibold text-primary-700">Step {index + 1}</span>
                  </div>
                  <h3 className="mt-5 font-display text-xl font-bold">{step.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#525252]">{step.text}</p>
                  <ul className="mt-4 space-y-2 border-t border-[#eadfce] pt-4 text-sm text-[#3f3a35]">
                    {step.points.map((point) => (
                      <li key={point} className="flex gap-2">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" aria-hidden />
                        {point}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="theme-light-island bg-[#ffffff] py-20 text-[#171717] lg:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">When you get stuck</p>
            <h2 className="mx-auto mt-4 max-w-2xl text-center font-display text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl">People to ask, at every level.</h2>
            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {support.map((item) => (
                <article key={item.title} className="flex flex-col rounded-2xl border border-[#e5e5e5] p-6 shadow-[0_10px_24px_-18px_rgba(23,23,23,0.28)]">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-500 text-neutral-950">
                    <item.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <h3 className="mt-5 font-display text-xl font-bold">{item.title}</h3>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-[#525252]">{item.text}</p>
                  <Link href={item.href} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary-700 hover:underline">
                    {item.cta} <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-[#07080c] py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-400">For instructors</p>
              <h2 className="mt-4 font-display text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl">Teach the chart you know.</h2>
              <ul className="mt-8 space-y-4">
                {instructorSteps.map((item, index) => (
                  <li key={item} className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary-500/60 text-sm font-semibold text-primary-600 dark:text-primary-400">{index + 1}</span>
                    <p className="pt-1 text-white/80">{item}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-5">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <h3 className="font-display text-lg font-bold">Certificates are on the way</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70">Course completion is already tracked on your account. Downloadable certificates will arrive in a later release.</p>
              </div>
              <div className="rounded-2xl border border-primary-500/30 bg-primary-500/[0.06] p-6">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden />
                  <h3 className="font-display text-lg font-bold">Education only</h3>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-white/70">
                  ForexOrbit Academy teaches and lets you practise with virtual money. It provides no brokerage service or financial advice. Trading forex carries a substantial risk of loss.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-[radial-gradient(circle_at_center,#4A2506_0%,#07080c_62%)] py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">Your first lesson is ready when you are.</h2>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href={accountHref} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary-500 px-6 py-3 font-semibold text-neutral-950">
                {isAuthenticated ? 'Open dashboard' : 'Start learning'}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/demo-trading" className="inline-flex items-center justify-center rounded-full border border-white/25 px-6 py-3 font-semibold hover:bg-white/5">
                See the demo desk
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#07080c]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-white/55 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} ForexOrbit Academy</p>
          <nav className="flex flex-wrap gap-5">
            <Link href="/about" className="hover:text-white">About</Link>
            <Link href="/help" className="hover:text-white">Help</Link>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
            <Link href="/terms" className="hover:text-white">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
