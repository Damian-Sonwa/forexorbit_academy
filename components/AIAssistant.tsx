/**
 * AI Assistant Component
 * Chat-style panel for AI learning assistance
 */

import { useState, useRef, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { apiFetch } from '@/lib/api-fetch';
import { useAuth } from '@/hooks/useAuth';
import { AlertTriangle, Send } from 'lucide-react';

// AI calls go to the page's own origin; the AI key stays on the server.

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const SUGGESTIONS = ['What is a pip?', 'Explain risk management', 'How do I read a candlestick?', 'What is a stop-loss?'];

export default function AIAssistant() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Ask about a forex concept, a lesson or a practice question.',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  // The question box grows with its text, up to its max height.
  useEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${box.scrollHeight + 2}px`;
  }, [input]);

  useEffect(() => {
    // Ask this build's API whether AI is configured.
    const checkAIConfig = async () => {
      try {
        const response = await apiFetch('/api/ai/check-config', {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        
        if (response.ok) {
          const data = await response.json();
          setAiConfigured(data.configured);
          console.log('[AI Assistant] AI configured:', data.configured);
        } else {
          console.warn('[AI Assistant] Failed to check AI config:', response.status, response.statusText);
          setAiConfigured(false);
        }
      } catch (error) {
        console.error('[AI Assistant] Error checking AI config:');
        setAiConfigured(false);
      }
    };
    
    checkAIConfig();
  }, []);

  const ask = async (question: string) => {
    if (!question.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: question.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const userLevel = user?.learningLevel || (user as any)?.studentDetails?.tradingLevel || 'beginner';
      
      const response = await apiFetch('/api/ai/answer-question', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: userMessage.content,
          userLevel,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to get AI response' }));
        throw new Error(errorData.error || `Request failed with status code ${response.status}`);
      }

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.answer,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to get AI response';
      setError(errorMessage);
      
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again later.',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
    }
  };

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    void ask(input);
  };

  const started = messages.some((m) => m.role === 'user');

  return (
    <section aria-label="AI learning assistant" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-panel">
      {/* Messages: this list scrolls, the page does not. */}
      <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 sm:py-6" role="log" aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`min-w-0 max-w-[88%] rounded-2xl px-4 py-2.5 sm:max-w-[75%] ${message.role === 'user' ? 'rounded-br-md bg-primary-500 text-neutral-950' : 'rounded-bl-md bg-surface-3 text-ink'}`}>
              <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed [overflow-wrap:anywhere]">{message.content}</p>
              {message.id !== '1' && <p className={`mt-1 text-2xs ${message.role === 'user' ? 'text-neutral-950/70' : 'text-ink-subtle'}`}>{message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>}
            </div>
          </div>
        ))}
        {!started && aiConfigured !== false && (
          <div className="flex flex-col items-start gap-2 pt-1 sm:flex-row sm:flex-wrap">
            {SUGGESTIONS.map((text) => (
              <button key={text} type="button" onClick={() => void ask(text)} disabled={loading} className="min-h-[2.75rem] rounded-full border border-line px-4 py-2 text-left text-sm font-medium text-ink hover:border-primary-500 hover:bg-tint">{text}</button>
            ))}
          </div>
        )}
        {loading && (
          <div className="flex justify-start" role="status" aria-label="The assistant is answering">
            <div className="flex gap-1 rounded-2xl rounded-bl-md bg-surface-3 px-4 py-3.5">
              {[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 rounded-full bg-[var(--fo-text-subtle)] motion-safe:animate-bounce" style={{ animationDelay: `${i * 0.1}s` }} />)}
            </div>
          </div>
        )}
        {error && <p className="notice notice-caution text-sm" role="alert">{error}</p>}
      </div>

      <form onSubmit={handleSend} className="shrink-0 border-t border-line px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        {aiConfigured === false && (
          <p className="notice notice-caution mb-3 flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />AI service is not configured. Please contact your administrator to enable AI features.</p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
            }}
            placeholder="Ask a question…"
            aria-label="Your question"
            disabled={loading || aiConfigured === false}
            className="input max-h-36 min-h-[3rem] min-w-0 flex-1 resize-none !text-base"
          />
          <button type="submit" disabled={loading || !input.trim() || aiConfigured === false} className="btn btn-primary h-12 w-12 shrink-0 !px-0 sm:w-auto sm:!px-5" aria-label="Send">
            <Send className="h-5 w-5 sm:hidden" aria-hidden /><span className="hidden sm:inline">Send</span>
          </button>
        </div>
        <p className="mt-2 text-center text-2xs text-ink-subtle">AI answers can be wrong. For education only.</p>
      </form>
    </section>
  );
}
