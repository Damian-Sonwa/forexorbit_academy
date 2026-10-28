import Link from 'next/link';
import type { ReactNode } from 'react';
import BrandLogo from '@/components/BrandLogo';

export const authFieldClass =
  'mt-1 w-full border-0 border-b border-[#d9d3c8] bg-transparent py-1.5 text-base text-[#171717] outline-none transition-colors placeholder:text-[#737373] focus:border-[#F28C28]';

export const authLabelClass = 'block text-sm font-medium text-[#525252]';

export const authHelperClass = 'mt-1 text-sm leading-snug text-[#525252]';

export const authButtonClass =
  'mt-5 flex min-h-11 w-full items-center justify-center rounded-full bg-[#F28C28] px-6 py-2.5 text-base font-semibold text-[#102017] transition-colors hover:bg-[#e07d1c] disabled:cursor-not-allowed disabled:opacity-50';

export function AuthFrame({
  title,
  lead,
  children,
  switcher,
}: {
  title: string;
  lead: string;
  children: ReactNode;
  switcher: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#faf8f4] text-[#171717]">
      <header className="px-6 pt-6 sm:px-10 lg:px-12">
        <Link href="/" aria-label="FX Orbit Academy home" className="inline-flex transition-opacity duration-200 hover:opacity-85">
          <BrandLogo variant="dark" priority className="h-9 sm:h-10" />
        </Link>
      </header>
      <main className="mx-auto grid w-full max-w-7xl items-center gap-6 px-6 py-6 sm:px-10 md:grid-cols-[minmax(0,1.35fr)_minmax(18rem,20rem)] md:gap-8 lg:min-h-[calc(100vh-5rem)] lg:grid-cols-[minmax(0,1.45fr)_minmax(22rem,26rem)] lg:gap-12 lg:px-12">
        <div className="flex min-w-0 items-center justify-center">
          <img
            src="/images/young-trader-forex.webp"
            alt="Young trader with a laptop and floating forex pair panels"
            width={1222}
            height={1287}
            className="h-auto w-auto max-h-[22rem] max-w-full object-contain sm:max-h-[26rem] md:max-h-[min(34rem,74vh)] lg:max-h-[min(48rem,calc(100vh-5.5rem))]"
          />
        </div>
        <div className="mx-auto w-full min-w-0 max-w-md md:mx-0 md:max-w-none">
          <h1 className="font-display text-3xl font-semibold tracking-tight text-[#171717]">{title}</h1>
          <p className="mt-2 text-sm leading-snug text-[#525252]">{lead}</p>
          <div className="mt-5">{children}</div>
          <p className="mt-4 text-sm leading-snug text-[#525252]">{switcher}</p>
        </div>
      </main>
    </div>
  );
}
