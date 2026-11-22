/**
 * Chat attachments (Phase 15): files shared in consultation and community chats.
 *
 * Before Phase 15 they were written to public/uploads on the server's disk. That had three faults:
 * Next.js does not serve files added to public/ after the build (so attachments did not load in
 * production), the host's disk is replaced on every deploy (so they were lost), and anything that
 * was served could be opened by anyone holding the link. Files were also stored before the
 * uploader's access was checked.
 *
 * Now: the access check runs first, the file goes to Cloudinary with delivery type 'private' (no
 * public address), and the message stores the storage reference. Readers open
 * /api/attachments/<kind>/<messageId>, which checks membership again and redirects to a signed
 * link that expires after five minutes. Older messages keep their stored /uploads/... links.
 */

import { v2 as cloudinary } from 'cloudinary';
import { isCloudinaryConfigured, randomPublicId } from '@/lib/cloudinary';

export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
export type StoredAttachment = { publicId: string; resourceType: 'image' | 'video' | 'raw'; format: string | null; bytes: number | null; delivery: 'private' };

export function attachmentsAvailable(): boolean {
  return isCloudinaryConfigured();
}

/** Uploads a temporary file as a private asset. Throws when storage fails (callers answer 503). */
export async function storeChatAttachment(filePath: string, folder: 'consultation-chat' | 'community-chat'): Promise<StoredAttachment> {
  const result = await new Promise<{ public_id: string; resource_type: string; format?: string; bytes?: number }>((resolve, reject) => {
    cloudinary.uploader.upload(
      filePath,
      { folder: `forexorbit/${folder}`, resource_type: 'auto', type: 'private', public_id: randomPublicId(), overwrite: false },
      (error, res) => (error || !res ? reject(new Error('Attachment storage failed')) : resolve(res))
    );
  });
  const resourceType = result.resource_type === 'image' || result.resource_type === 'video' ? result.resource_type : 'raw';
  return { publicId: result.public_id, resourceType, format: result.format || null, bytes: typeof result.bytes === 'number' ? result.bytes : null, delivery: 'private' };
}

/** A signed, expiring download link for a stored attachment. */
export function signedAttachmentUrl(a: StoredAttachment, seconds = 300): string {
  return cloudinary.utils.private_download_url(a.publicId, a.format || '', {
    type: 'private',
    resource_type: a.resourceType,
    expires_at: Math.floor(Date.now() / 1000) + seconds,
  });
}

export const attachmentPath = (kind: 'consultation' | 'community', messageId: string) => `/api/attachments/${kind}/${messageId}`;
