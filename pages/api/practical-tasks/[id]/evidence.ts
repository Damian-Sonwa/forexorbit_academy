/**
 * Evidence files for the student's attempt in progress (screenshots from the simulator or an
 * external broker such as OANDA).
 * POST    multipart field "file": PNG, JPEG or WebP, at most 8 MB, checked
 *         and rewritten (lib/upload-check.js) under a random name. Stored as a private Cloudinary image
 *         (no public address); read only through GET /api/practical-tasks/evidence.
 * DELETE  ?file=<id>: removes a file from the attempt in progress (and from storage).
 * Screenshots are student-submitted evidence: nothing here reads or verifies their content.
 */
import fs from 'fs';
import os from 'os';
import formidable from 'formidable';
import { practicalRoute, queryText } from '@/lib/practical-route';
import { addAttachment, attachmentSlot, removeAttachment } from '@/lib/practical-tasks';
import { deletePrivateImage, isCloudinaryConfigured, uploadPrivateImageFromPath } from '@/lib/cloudinary';
import { inspectUpload } from '@/lib/upload-check';
import { uploadLimiter } from '@/lib/content-rate-limit';

export const config = { api: { bodyParser: false } };

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

export default practicalRoute('practicalTaskEvidence', {
  POST: {
    limiter: uploadLimiter,
    handler: async (req, db, member) => {
      if (member.role !== 'student') return { ok: false, status: 403, error: 'Only students can attach evidence.' };
      const taskId = queryText(req.query.id);
      const slot = await attachmentSlot(db, member, { taskId });
      if (!slot.ok) return slot;
      if (!isCloudinaryConfigured()) return { ok: false, status: 503, error: 'File uploads are not available right now.' };
      const form = formidable({ uploadDir: os.tmpdir(), keepExtensions: false, maxFiles: 1, maxFileSize: MAX_BYTES, filter: ({ name, mimetype }) => name === 'file' && Boolean(mimetype) && TYPES.includes(String(mimetype).toLowerCase()) });
      let parsed;
      try {
        parsed = await form.parse(req);
      } catch {
        return { ok: false, status: 400, error: 'Upload a PNG, JPEG or WebP image of at most 8 MB.' };
      }
      const [, files] = parsed;
      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!file) return { ok: false, status: 400, error: 'Upload a PNG, JPEG or WebP image of at most 8 MB.' };
      try {
        const checked = await inspectUpload(file.filepath, { name: file.originalFilename, allow: ['png', 'jpg', 'webp'] });
        if (!checked.ok) return { ok: false, status: checked.status, error: checked.error };
        const uploaded = await uploadPrivateImageFromPath(file.filepath, 'practical-evidence');
        const saved = await addAttachment(db, member, { taskId, file: { publicId: uploaded.publicId, format: uploaded.format, bytes: uploaded.bytes, width: uploaded.width, height: uploaded.height, name: checked.fileName, delivery: 'private' } });
        if (!saved.ok) await deletePrivateImage(uploaded.publicId).catch(() => undefined);
        return saved.ok ? { ...saved, status: 201 } : saved;
      } finally {
        fs.promises.unlink(file.filepath).catch(() => undefined);
      }
    },
  },
  DELETE: {
    limiter: uploadLimiter,
    handler: async (req, db, member) => {
      if (member.role !== 'student') return { ok: false, status: 403, error: 'Only students can remove evidence.' };
      const removed = await removeAttachment(db, member, { taskId: queryText(req.query.id), fileId: queryText(req.query.file) });
      if (removed.ok) await deletePrivateImage(removed.removed).catch(() => undefined);
      return removed.ok ? { ok: true } : removed;
    },
  },
});
