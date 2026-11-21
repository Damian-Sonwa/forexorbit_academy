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
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-12 pt-20 text-ink sm:px-6 lg:px-10 lg:pt-10">{children}</main>
      </div>
      <Footer />
    </div>
  );
}

export function CommunityLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="btn btn-primary inline-flex items-center justify-center px-5 py-2.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">
      {children}
    </Link>
  );
}
