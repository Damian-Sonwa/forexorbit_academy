import type { ReactNode } from 'react';
import Link from 'next/link';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';

export function CommunityShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <div className="flex flex-1 lg:items-start">
        <Sidebar />
        <main className="theme-light-island mx-auto w-full max-w-6xl flex-1 bg-[#ffffff] px-4 py-8 pt-16 text-[#171717] sm:px-6 lg:py-10 lg:pt-8">{children}</main>
      </div>
      <Footer />
    </div>
  );
}

export function CommunityLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center justify-center rounded-full bg-primary-500 px-5 py-2.5 text-sm font-semibold text-neutral-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">
      {children}
    </Link>
  );
}
