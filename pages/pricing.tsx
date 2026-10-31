/**
 * Pricing
 * The one-time course price from lib/course-price.js, the Paystack service fee the customer pays,
 * what stays free, how a payment unlocks a course, and how refunds are handled.
 */

import { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';
import ThemeToggle from '@/components/ThemeToggle';
import { ArrowRight, Check, CreditCard, Lock, Menu, Receipt, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import {
  COURSE_LOCAL_CARD_FEE_KOBO,
  COURSE_LOCAL_CARD_TOTAL_KOBO,
  COURSE_PRICE_KOBO,
  COURSE_PRICE_LABEL,
  CUSTOMER_PAYS_PAYSTACK_FEES,
  formatNairaAndKobo,
} from '@/lib/course-price';

const included = [
  'Every lesson in the course, in order',
  'Every quiz in the course',
  'Lesson videos, notes, and resources',
  'Your progress saved to your account',
];

const free = [
  { title: 'Your account', text: 'Signing up needs no card.' },
  { title: 'Enrolling', text: 'Enroll in any course at no charge.' },
  { title: 'Free previews', text: 'Selected courses offer free preview lessons, so you can judge them before you pay.' },
  { title: 'Demo lessons', text: 'Lessons marked as demo are always free.' },
  { title: 'The demo desk', text: 'Practise with virtual money. The desk never places a real order.' },
  { title: 'Community rooms', text: 'Ask questions in the room that matches your level.' },
  { title: 'Booking a consultation', text: 'The booking flow has no charge.' },
];

const steps = [
  { icon: Lock, title: 'Open a locked lesson', text: 'A paid lesson shows the course price, the service fee, and an "Unlock full course" button.' },
  { icon: CreditCard, title: 'Pay on Paystack', text: 'Paystack shows the exact total, including its service fee, before you confirm. ForexOrbit never sees or stores card details.' },
  { icon: ShieldCheck, title: 'We confirm with Paystack', text: 'Our server checks the payment with Paystack before it unlocks the course.' },
  { icon: Receipt, title: 'Keep your record', text: 'Every payment and refund appears on your Payments page.' },
];

const faqs = [
  {
    q: 'Is this a subscription?',
    a: 'No. You pay once per course. There is no renewal and nothing is charged again.',
  },
  {
    q: 'Does one payment unlock every course?',
    a: 'No. A payment unlocks the course you bought it for. Each course is paid for separately.',
  },
  {
    q: 'Why is the total more than the course price?',
    a: 'Paystack charges a service fee on each payment, and you pay it on top of the course price. The fee depends on your card and payment method, so the total Paystack shows at checkout is the amount you pay. The course price itself stays the same.',
  },
  {
    q: 'I paid but the course is still locked.',
    a: 'Open the locked lesson and choose "Check payment status". If it still does not unlock, contact support with the payment reference from your Paystack receipt.',
  },
  {
    q: 'Which currency do you charge in?',
    a: 'Nigerian naira (NGN). A card in another currency is converted by your bank, which may add its own charges.',
  },
];

export default function Pricing() {
  const { isAuthenticated } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const accountHref = isAuthenticated ? '/dashboard' : '/signup';
  const priceExact = formatNairaAndKobo(COURSE_PRICE_KOBO);
  const feeExact = formatNairaAndKobo(COURSE_LOCAL_CARD_FEE_KOBO);
  const totalExact = formatNairaAndKobo(COURSE_LOCAL_CARD_TOTAL_KOBO);

  return (
    <div className="landing-shell min-h-screen bg-[#07080c] text-white">
      <Head>
        <title>Pricing | ForexOrbit Academy</title>
        <meta
          name="description"
          content={`ForexOrbit Academy pricing: ${COURSE_PRICE_LABEL} once per course plus the Paystack service fee. Free previews on selected courses, demo lessons, the demo desk, and the community are free.`}
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
            <Link href="/how-it-works" className="hover:text-white">How it works</Link>
            <Link href="/pricing" className="text-white" aria-current="page">Pricing</Link>
            <Link href="/community" className="hover:text-white">Community</Link>
            <Link href="/about" className="hover:text-white">About</Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 lg:ml-0">
            <ThemeToggle className="text-white/80 hover:bg-white/10 hover:text-white" />
          </div>
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
            <Link href="/pricing" className="block">Pricing</Link>
            <Link href="/community" className="block">Community</Link>
            <Link href="/about" className="block">About</Link>
            <div className="flex gap-3 pt-2">
              {!isAuthenticated && <Link href="/login" className="rounded-full border border-primary-500/70 px-4 py-2">Sign in</Link>}
              <Link href={accountHref} className="rounded-full bg-primary-500 px-4 py-2 font-semibold text-neutral-950">{isAuthenticated ? 'Dashboard' : 'Sign up'}</Link>
            </div>
          </div>
        )}
      </header>

      <main>
        <section className="theme-section bg-[#faf8f4] text-[#171717]">
          <div className="mx-auto max-w-4xl px-4 pb-10 pt-16 text-center sm:px-6 sm:pt-20">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">Pricing</p>
            <h1 className="mt-4 font-display text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl">
              One price per course. <span className="text-primary-600">Pay once.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-[#525252] sm:text-lg">
              Enroll for free and try free previews on selected courses. When you want the whole course, one Paystack payment unlocks every lesson and quiz in it.
            </p>
          </div>

          <div className="mx-auto grid max-w-5xl gap-6 px-4 pb-16 sm:px-6 sm:pb-20 lg:grid-cols-[1.1fr_1fr]">
            <article className="flex flex-col rounded-3xl border-2 border-primary-500 bg-white p-8 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.45)]">
              <h2 className="font-display text-xl font-bold">Full course</h2>
              <p className="mt-1 text-sm text-[#525252]">Per course, one-time payment, plus the Paystack service fee</p>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="font-display text-5xl font-bold tracking-tight">{COURSE_PRICE_LABEL}</span>
                <span className="text-sm text-[#525252]">NGN</span>
              </p>
              {CUSTOMER_PAYS_PAYSTACK_FEES ? (
                <p className="mt-2 text-sm text-[#525252]">
                  plus the Paystack service fee (about {feeExact} with a Nigerian card)
                </p>
              ) : null}
              <ul className="mt-6 space-y-3 border-t border-[#e5e5e5] pt-6 text-sm">
                {included.map((item) => (
                  <li key={item} className="flex gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
              <Link href={isAuthenticated ? '/courses' : '/signup'} className="mt-8 inline-flex items-center justify-center gap-2 rounded-full bg-primary-500 px-6 py-3 font-semibold text-neutral-950 hover:bg-primary-400">
                {isAuthenticated ? 'Choose a course' : 'Create a free account'}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </article>

            <article className="flex flex-col rounded-3xl border border-[#eadfce] bg-[#f6f3ec] p-8">
              <h2 className="font-display text-xl font-bold">What you pay at checkout</h2>
              {CUSTOMER_PAYS_PAYSTACK_FEES ? (
                <>
                  <dl className="mt-6 space-y-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-[#525252]">Course price</dt>
                      <dd className="font-semibold tabular-nums">{priceExact}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-[#525252]">Paystack service fee (Nigerian card, estimate)</dt>
                      <dd className="font-semibold tabular-nums">{feeExact}</dd>
                    </div>
                    <div className="flex justify-between gap-4 border-t border-[#d9ccb8] pt-3 text-base">
                      <dt className="font-bold">Total payable (estimate)</dt>
                      <dd className="font-bold tabular-nums">{totalExact}</dd>
                    </div>
                  </dl>
                  <p className="mt-6 text-sm leading-relaxed text-[#525252]">
                    You pay Paystack&apos;s service fee on top of the course price. Paystack sets the fee, and it depends on your card and payment method: cards issued outside Nigeria and some other methods cost more.
                  </p>
                  <p className="mt-3 text-sm font-semibold leading-relaxed text-[#171717]">
                    The total Paystack shows before you confirm is the exact amount you pay.
                  </p>
                </>
              ) : (
                <>
                  <dl className="mt-6 space-y-3 text-sm">
                    <div className="flex justify-between gap-4 text-base">
                      <dt className="font-bold">Total</dt>
                      <dd className="font-bold tabular-nums">{priceExact}</dd>
                    </div>
                  </dl>
                  <p className="mt-6 text-sm leading-relaxed text-[#525252]">Paystack shows the exact total before you confirm.</p>
                </>
              )}
            </article>
          </div>
        </section>

        <section className="bg-[#07080c] py-20 lg:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-400">Free with an account</p>
            <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl">Most of ForexOrbit costs nothing.</h2>
            <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {free.map((item) => (
                <li key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <div className="flex items-center gap-2">
                    <Check className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden />
                    <h3 className="font-display text-lg font-bold">{item.title}</h3>
                  </div>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">{item.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="theme-section bg-[#ffffff] py-20 text-[#171717] lg:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <p className="text-center text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">How paying works</p>
            <h2 className="mx-auto mt-4 max-w-2xl text-center font-display text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl">From a locked lesson to an open course.</h2>
            <ol className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {steps.map((step, index) => (
                <li key={step.title} className="flex flex-col rounded-2xl border border-[#e5e5e5] p-6 shadow-[0_10px_24px_-18px_rgba(23,23,23,0.28)]">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-500 text-neutral-950">
                      <step.icon className="h-5 w-5" aria-hidden />
                    </span>
                    <span className="text-sm font-semibold text-primary-700">Step {index + 1}</span>
                  </div>
                  <h3 className="mt-5 font-display text-lg font-bold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-[#525252]">{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-[#07080c] py-20">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <div className="rounded-2xl border border-primary-500/30 bg-primary-500/[0.06] p-6 self-start">
              <div className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-primary-600 dark:text-primary-400" aria-hidden />
                <h2 className="font-display text-lg font-bold">Refunds</h2>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-white/70">
                Each refund request is reviewed individually. Contact support with the payment reference from your Paystack receipt.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-white/70">
                An approved refund is sent back through Paystack and shows on your Payments page. A full refund may end your access to that course.
              </p>
              <Link href="/support" className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary-600 hover:underline dark:text-primary-400">
                Contact support <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
            <div>
              <h2 className="font-display text-3xl font-bold leading-[1.15] tracking-tight">Questions about paying</h2>
              <dl className="mt-8 divide-y divide-white/10 border-y border-white/10">
                {faqs.map((item) => (
                  <div key={item.q} className="py-5">
                    <dt className="font-semibold">{item.q}</dt>
                    <dd className="mt-2 text-sm leading-relaxed text-white/70">{item.a}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        <section className="bg-[radial-gradient(circle_at_center,#4A2506_0%,#07080c_62%)] py-20">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">Enroll free. Pay only for the courses you want in full.</h2>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href={accountHref} className="inline-flex items-center justify-center gap-2 rounded-full bg-primary-500 px-6 py-3 font-semibold text-neutral-950">
                {isAuthenticated ? 'Open dashboard' : 'Start learning'}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link href="/how-it-works" className="inline-flex items-center justify-center rounded-full border border-white/25 px-6 py-3 font-semibold hover:bg-white/5">
                See how it works
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
