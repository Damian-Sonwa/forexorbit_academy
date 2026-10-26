/**
 * AI Assistant Page
 * Dedicated page for AI learning assistance
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';
import LoadingSpinner from '@/components/LoadingSpinner';
import AIAssistant from '@/components/AIAssistant';
import { useAuth } from '@/hooks/useAuth';
import { AlertTriangle, BookOpen, Lightbulb, Target } from 'lucide-react';

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
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />

        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:ml-0 pt-14 lg:pt-6 overflow-y-auto w-full">
          {/* Hero Header Section */}
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="page-kicker mb-2">Study help</p>
              <h1 className="page-title">AI learning assistant</h1>
              <p className="mt-2 max-w-xl text-sm text-neutral-600">
                Ask about Forex concepts, lessons, and practice questions.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700">
              <span className="h-2 w-2 rounded-full bg-green-600" />
              Ready
            </div>
          </div>

          {/* AI Assistant Component */}
          <div className="animate-in fade-in duration-300">
            <AIAssistant />
          </div>

          {/* Help Section */}
          <div className="mt-8 bg-white rounded-2xl shadow-lg border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">How to Use AI Assistant</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start space-x-3">
                <Lightbulb className="h-6 w-6 shrink-0 text-primary-600" aria-hidden />
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Ask Questions</h3>
                  <p className="text-sm text-gray-600">Ask any question about Forex trading, concepts, or lessons</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <BookOpen className="h-6 w-6 shrink-0 text-neutral-700" aria-hidden />
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Get Explanations</h3>
                  <p className="text-sm text-gray-600">Receive clear, level-appropriate explanations</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <Target className="h-6 w-6 shrink-0 text-neutral-700" aria-hidden />
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Learning Guidance</h3>
                  <p className="text-sm text-gray-600">Get suggestions for your next learning steps</p>
                </div>
              </div>
              <div className="flex items-start space-x-3">
                <AlertTriangle className="h-6 w-6 shrink-0 text-amber-700" aria-hidden />
                <div>
                  <h3 className="font-semibold text-gray-900 mb-1">Educational Only</h3>
                  <p className="text-sm text-gray-600">AI responses are for educational purposes only</p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <Footer />
    </div>
  );
}

