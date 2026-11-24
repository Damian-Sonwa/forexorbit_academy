/**
 * Profile photo (POST/DELETE /api/upload/profile), shared by onboarding and Settings. Choosing a file
 * uploads it; if that fails the previous photo is shown again. Removal is confirmed. Must not be
 * rendered inside a <form> (the confirmation has its own).
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera } from 'lucide-react';
import ConfirmDialog from '@/components/admin/portal/ConfirmDialog';
import { apiClient } from '@/lib/api-client';
import { preparePhoto } from '@/components/profile/prepare-photo';
import { apiErrorText } from '@/lib/student-profile';

export default function PhotoField({ photo, name, onChange }: { photo: string; name: string; onChange: (photo: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const upload = async (file: File) => {
    setError('');
    setStatus('');
    setBusy(true);
    try {
      const photo = await preparePhoto(file);
      setPreview(URL.createObjectURL(photo));
      const body = new FormData();
      body.append('profilePhoto', photo, photo.name);
      const res = await apiClient.post<{ imageUrl: string }>('/upload/profile', body, { headers: { 'Content-Type': 'multipart/form-data' } });
      onChange(res.imageUrl);
      setStatus('Photo saved.');
    } catch (err) {
      setError(apiErrorText(err, 'Failed to upload photo'));
    } finally {
      setPreview('');
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await apiClient.delete('/upload/profile');
      onChange('');
      setError('');
      setStatus('Photo removed.');
      setConfirming(false);
      return null;
    } catch (err) {
      return apiErrorText(err, 'Failed to remove photo');
    }
  };

  const shown = preview || photo;
  return (
    <div className="flex items-center gap-4">
      <span className={`flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#14263e] font-display text-2xl font-semibold text-[#ffab6b] transition-opacity ${busy ? 'opacity-60' : ''}`}>
        {shown ? <img src={shown} alt="Your profile photo" className="h-full w-full object-cover" /> : <span aria-hidden>{name.trim().charAt(0).toUpperCase() || <Camera className="h-6 w-6" />}</span>}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary min-h-[2.75rem]" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Uploading…' : photo ? 'Change photo' : 'Add a photo'}</button>
          {photo && !busy && <button type="button" className="btn btn-ghost min-h-[2.75rem]" onClick={() => setConfirming(true)}>Remove photo</button>}
        </div>
        <p className="studio-hint mt-1.5">Optional. It is cropped to a square.</p>
        <p className="studio-hint" role="status">{status}</p>
        {error && <p className="studio-error" role="alert">{error}</p>}
        <input ref={input} type="file" accept="image/*" className="hidden" aria-label="Profile photo file" tabIndex={-1} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void upload(file); }} />
      </div>
      {confirming && createPortal(<ConfirmDialog title="Remove your photo?" consequence="Your initial is shown instead. You can add another photo at any time." confirmLabel="Remove photo" danger onConfirm={remove} onClose={() => setConfirming(false)} />, document.body)}
    </div>
  );
}
