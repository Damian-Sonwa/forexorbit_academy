/**
 * GET ?attempt=<attempt id>&file=<file id>: opens one evidence file. The reader must be the
 * attempt's student or staff over the task's course (otherwise 404). The response is a redirect to
 * a signed storage link that expires after five minutes; the link is never stored or cached.
 */
import { queryText } from '@/lib/practical-route';
import { evidenceFile } from '@/lib/practical-tasks';
import { privateImageUrl } from '@/lib/cloudinary';
import { withAuth, AuthRequest } from '@/lib/auth-middleware';
import type { NextApiResponse } from 'next';
import { getDb } from '@/lib/mongodb';
import { allowRequest, assessmentLimiter } from '@/lib/content-rate-limit';
import { setPrivateNoStore } from '@/lib/lesson-documents';
import { unexpectedBody } from '@/lib/public-error';

export default withAuth(async (req: AuthRequest, res: NextApiResponse): Promise<void> => {
  setPrivateNoStore(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const member = { userId: req.user!.userId, role: req.user!.role };
    if (!(await allowRequest(assessmentLimiter, { userId: member.userId, res, getDb }))) return;
    const found = await evidenceFile(await getDb(), member, { attempt: queryText(req.query.attempt), file: queryText(req.query.file) });
    if (!found.ok) {
      res.status(found.status).json({ error: found.error });
      return;
    }
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(302, privateImageUrl(found.publicId, found.format));
  } catch (err: unknown) {
    console.error(JSON.stringify({ event: 'practicalTaskEvidenceRead', result: 'failed' }));
    res.status(500).json(unexpectedBody('api', err));
  }
}, ['student', 'instructor', 'admin', 'superadmin']);
