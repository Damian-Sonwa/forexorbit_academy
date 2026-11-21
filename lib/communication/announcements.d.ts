/** Types for lib/communication/announcements.js (also the frontend contract). */
import type { Db } from 'mongodb';

type Member = { userId: string; role: string; email?: string | null };
type Notice = { userIds: string[] } & Record<string, unknown>;
type R<T> = Promise<({ ok: true; status?: number; notify?: Notice | null } & T) | { ok: false; status: number; error: string; field?: string }>;
export type Announcement = {
  id: string; title: string; body: string; audience: 'all' | 'students' | 'instructors' | 'course'; courseId: string | null;
  status: 'draft' | 'scheduled' | 'published' | 'archived'; publishAt: string | null; publishedAt: string | null; expiresAt: string | null;
  link: string | null; createdBy: string; recipients: number; createdAt: string | null;
};
export const AUDIENCES: readonly string[];
export const KIND: 'announcement';
export function create(db: Db, member: Member, body: unknown, options?: { now?: Date }): R<{ announcement: Announcement }>;
export function update(db: Db, member: Member, id: string, body: unknown, options?: { now?: Date }): R<{ announcement: Announcement }>;
export function publish(db: Db, member: Member, id: string, options?: { now?: Date }): R<{ announcement: Announcement; repeated?: boolean }>;
export function archive(db: Db, member: Member, id: string, options?: { now?: Date }): R<Record<string, never>>;
export function publishDue(db: Db, options?: { now?: Date; limit?: number }): Promise<Notice[]>;
export function visibleTo(db: Db, member: Member, options?: { now?: Date; page?: number }): R<{ announcements: Announcement[]; hasMore: boolean }>;
export function manageable(db: Db, member: Member, options?: { status?: string }): R<{ announcements: Announcement[]; courses: Array<{ id: string; title: string }>; canAnnounceToAll: boolean }>;
export function readAnnouncement(db: Db, member: Member, body: unknown, options?: { now?: Date }): Promise<Record<string, unknown>>;
export function recipientsFor(db: Db, a: Record<string, unknown>): Promise<string[]>;
