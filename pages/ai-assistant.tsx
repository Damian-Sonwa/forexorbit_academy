/**
 * AI Assistant Page
 * Dedicated page for AI learning assistance
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import AIAssistant from '@/components/AIAssistant';
import { useAuth } from '@/hooks/useAuth';

export default function AIAssistantPage() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!authLoading && isAuthenticated && user?.role !== 'student') {
      router.push('/dashboard');
      return;
    }
  }, [isAuthenticated, authLoading, user, router]);

  if (authLoading) {
    return <LoadingSpinner message="Loading..." fullScreen />;
  }

  if (!isAuthenticated || user?.role !== 'student') {
    return null;
  }

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden">
      <Header />
      {/* The chat fills the screen under the header: only its messages scroll. */}
      <div className="relative flex min-h-0 flex-1">
        <Sidebar />
        <main className="mx-auto flex min-h-0 w-full min-w-0 max-w-5xl flex-1 flex-col px-2 pb-2 pt-[3.75rem] sm:px-6 sm:pb-4 lg:pt-6">
          <h1 className="pb-3 pl-2 font-display text-xl font-semibold tracking-[-0.02em] text-ink max-lg:sr-only sm:pl-0">AI learning assistant</h1>
          <AIAssistant />
        </main>
      </div>
    </div>
  );
}

