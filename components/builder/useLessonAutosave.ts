/**
 * Autosave for one lesson in the builder.
 *
 *   - Saves 1.2 s after the last change (one request at a time; changes made during a save are
 *     saved right after it), and on demand ("Save now").
 *   - Each save sends the revision it is based on; if someone else saved the lesson since, the
 *     server answers 409 and nothing is overwritten (status "conflict").
 *   - A copy of unsaved work is kept in this browser (localStorage) until the server confirms the
 *     save, so a refresh, a crash or a lost connection does not lose it; on reopening, the copy is
 *     offered back.
 *   - Network and server errors are retried with backoff (2 s, 5 s, 10 s, then every 30 s);
 *     validation errors are shown and not retried.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import type { Block } from '@/lib/course-content';

export type LessonDraft = { title: string; blocks: Block[]; isFreePreview: boolean };
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'retrying' | 'invalid' | 'conflict';
type Backup = LessonDraft & { revision: number; at: string };

const DEBOUNCE_MS = 1200;
const BACKOFF = [2000, 5000, 10000, 30000];

function backupKey(lessonId: string) {
  return `fo-builder-lesson:${lessonId}`;
}

export function readBackup(lessonId: string): Backup | null {
  try {
    const raw = window.localStorage.getItem(backupKey(lessonId));
    return raw ? (JSON.parse(raw) as Backup) : null;
  } catch {
    return null;
  }
}

function writeBackup(lessonId: string, backup: Backup | null) {
  try {
    if (backup) window.localStorage.setItem(backupKey(lessonId), JSON.stringify(backup));
    else window.localStorage.removeItem(backupKey(lessonId));
  } catch {
    // Storage may be full or blocked; saving to the server still works.
  }
}

function same(a: LessonDraft, b: LessonDraft) {
  return a.title === b.title && a.isFreePreview === b.isFreePreview && JSON.stringify(a.blocks) === JSON.stringify(b.blocks);
}

function errorOf(err: unknown): { status: number; code?: string; error?: string; revision?: number } {
  const r = (err as { response?: { status?: number; data?: { code?: string; error?: string; revision?: number } } })?.response;
  return { status: r?.status || 0, code: r?.data?.code, error: r?.data?.error, revision: r?.data?.revision };
}

export function useLessonAutosave({ lessonId, initial, revision, enabled, onSaved }: {
  lessonId: string;
  initial: LessonDraft;
  revision: number;
  enabled: boolean;
  onSaved: (draft: LessonDraft, revision: number) => void;
}) {
  const [draft, setDraft] = useState<LessonDraft>(initial);
  const [status, setStatus] = useState<SaveStatus>('saved');
  const [message, setMessage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [recovered, setRecovered] = useState<Backup | null>(null);
  const draftRef = useRef(draft);
  const savedRef = useRef(initial);
  const revisionRef = useRef(revision);
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  // A different lesson (or a reload from the server) starts clean, and offers back unsaved work.
  const loadedLesson = useRef<string | null>(null);
  useEffect(() => {
    // Our own save raises the revision too; only a different lesson or a reload resets the editor.
    if (loadedLesson.current === lessonId && revision === revisionRef.current) return;
    loadedLesson.current = lessonId;
    setDraft(initial);
    draftRef.current = initial;
    savedRef.current = initial;
    revisionRef.current = revision;
    setStatus('saved');
    setMessage(null);
    attempt.current = 0;
    const backup = typeof window !== 'undefined' ? readBackup(lessonId) : null;
    if (backup && !same(backup, initial)) setRecovered(backup);
    else { setRecovered(null); if (backup) writeBackup(lessonId, null); }
  }, [lessonId, revision]);

  const save = useCallback(async () => {
    if (!enabled) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (inflight.current) return;
    const snapshot = draftRef.current;
    if (same(snapshot, savedRef.current)) { setStatus('saved'); return; }
    inflight.current = true;
    setStatus('saving');
    try {
      const res = await apiClient.put<{ revision: number }>(`/lessons/${lessonId}`, { title: snapshot.title, blocks: snapshot.blocks, isFreePreview: snapshot.isFreePreview, baseRevision: revisionRef.current });
      revisionRef.current = res.revision;
      savedRef.current = snapshot;
      attempt.current = 0;
      setSavedAt(new Date());
      setMessage(null);
      onSavedRef.current(snapshot, res.revision);
      if (same(draftRef.current, snapshot)) {
        setStatus('saved');
        writeBackup(lessonId, null);
      } else {
        setStatus('dirty');
        timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
      }
    } catch (err) {
      const e = errorOf(err);
      if (e.status === 409 && e.code === 'stale_revision') {
        setStatus('conflict');
        setMessage(e.error || 'This lesson was changed elsewhere.');
      } else if (e.status === 400 || e.status === 403 || e.status === 404 || (e.status === 409 && e.code === 'course_not_editable')) {
        setStatus('invalid');
        setMessage(e.error || 'This change could not be saved.');
      } else {
        const wait = BACKOFF[Math.min(attempt.current, BACKOFF.length - 1)];
        attempt.current += 1;
        setStatus('retrying');
        setMessage(e.status === 0 ? `Offline or unreachable. Retrying in ${Math.round(wait / 1000)} s; your work is kept in this browser.` : `The server did not save this change. Retrying in ${Math.round(wait / 1000)} s.`);
        timer.current = setTimeout(() => void save(), wait);
      }
    } finally {
      inflight.current = false;
    }
  }, [enabled, lessonId]);

  const update = useCallback((next: LessonDraft) => {
    draftRef.current = next;
    setDraft(next);
    if (!enabled) return;
    if (same(next, savedRef.current)) { setStatus('saved'); writeBackup(lessonId, null); return; }
    writeBackup(lessonId, { ...next, revision: revisionRef.current, at: new Date().toISOString() });
    setStatus((s) => (s === 'conflict' || s === 'retrying' ? s : 'dirty'));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
  }, [enabled, lessonId, save]);

  // Leaving the lesson (another lesson, another tab of the builder) saves what is pending.
  useEffect(() => () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; void save(); }
  }, [save]);

  /** After a conflict, the author may keep their version: it is saved on top of the newer one. */
  const overwrite = useCallback(async (serverRevision: number) => {
    revisionRef.current = serverRevision;
    setStatus('dirty');
    await save();
  }, [save]);

  const restore = useCallback(() => {
    if (!recovered) return;
    const { title, blocks, isFreePreview } = recovered;
    setRecovered(null);
    update({ title, blocks, isFreePreview });
  }, [recovered, update]);

  const discardRecovered = useCallback(() => { setRecovered(null); writeBackup(lessonId, null); }, [lessonId]);

  // Leaving with unsaved work asks first (the browser shows its own message).
  useEffect(() => {
    const dirty = status === 'dirty' || status === 'saving' || status === 'retrying' || status === 'invalid' || status === 'conflict';
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status]);

  return { draft, update, save, status, message, savedAt, recovered, restore, discardRecovered, overwrite, revision: revisionRef.current };
}
