import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';

type ExpertRow = { _id: string; name?: string; role?: string; expertAvailable?: boolean };
type StaffRow = { _id: string; name?: string; role?: string; isExpert?: boolean };

export default function ConsultationAdmin() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [enabled, setEnabled] = useState(true);
  const [experts, setExperts] = useState<ExpertRow[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [settings, users] = await Promise.all([
        apiClient.get<{ consultationEnabled: boolean; experts: ExpertRow[] }>('/consultations/admin'),
        apiClient.get<StaffRow[]>('/admin/users'),
      ]);
      setEnabled(settings.consultationEnabled !== false);
      setExperts(Array.isArray(settings.experts) ? settings.experts : []);
      setStaff((Array.isArray(users) ? users : []).filter((person) => person.role === 'instructor' || person.role === 'admin' || person.role === 'superadmin'));
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'Consultation settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'superadmin') load();
  }, [isAuthenticated, user]);

  async function toggleFeature(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      await apiClient.put('/consultations/admin', { action: 'toggleFeature', data: { enabled: !enabled } });
      setEnabled(!enabled);
      setNotice(enabled ? 'New consultation bookings are turned off.' : 'Consultation bookings are on.');
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'The consultation switch could not be changed.');
    }
  }

  async function setExpert(userId: string, isExpert: boolean) {
    setError('');
    try {
      await apiClient.put('/consultations/admin', { action: 'approveExpert', data: { userId, isExpert } });
      setNotice(isExpert ? 'Expert approved. They can publish hours from Consultation availability.' : 'Expert approval removed. Existing bookings stay on record.');
      await load();
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'Expert approval could not be changed.');
    }
  }

  if (authLoading || !isAuthenticated) return <LoadingSpinner message="Loading consultation admin..." fullScreen />;
  if (!user || user.role !== 'superadmin') return <div className="flex min-h-screen items-center justify-center">Access denied</div>;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1 lg:items-start">
        <Sidebar />
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 pt-16 lg:pt-8">
          <p className="page-kicker">Super admin</p>
          <h1 className="page-title mt-2">Consultation admin</h1>
          <p className="mt-2 max-w-2xl text-sm text-neutral-600">Approve who may publish consultation hours. Your own hours are published from Consultation availability.</p>
          <Link href="/consultations/expert" className="mt-4 inline-flex rounded-full bg-primary-400 px-5 py-2.5 text-sm font-semibold text-neutral-900">Publish my hours</Link>
          {error ? <p className="mt-4 text-sm text-red-700" role="alert">{error}</p> : null}
          {notice ? <p className="mt-4 text-sm font-semibold" role="status">{notice}</p> : null}
          {loading ? <div className="mt-6 h-24 animate-pulse rounded-2xl bg-neutral-200" aria-hidden /> : null}

          <form className="mt-8 border-t border-neutral-200 pt-6" onSubmit={toggleFeature}>
            <h2 className="font-display text-lg font-semibold">Bookings</h2>
            <p className="mt-2 text-sm text-neutral-600">{enabled ? 'Learners can request consultations.' : 'Learners cannot start a new consultation.'}</p>
            <button type="submit" className="mt-3 text-sm font-semibold text-primary-700">{enabled ? 'Turn bookings off' : 'Turn bookings on'}</button>
          </form>

          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold">Staff</h2>
            <ul className="mt-3 divide-y divide-neutral-200">
              {staff.map((person) => {
                const id = String(person._id);
                return (
                <li key={id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <span>
                    <span className="block font-medium">{person.name || 'Staff member'}</span>
                    <span className="text-sm capitalize text-neutral-500">{person.role}{person.isExpert ? ' · expert' : ''}</span>
                  </span>
                  <button type="button" className="text-sm font-semibold text-primary-700" onClick={() => setExpert(id, !person.isExpert)}>
                    {person.isExpert ? 'Remove expert approval' : 'Approve as expert'}
                  </button>
                </li>
                );
              })}
            </ul>
            {!loading && staff.length === 0 ? <p className="mt-3 text-sm text-neutral-600">No instructor or admin accounts were found.</p> : null}
          </section>

          <section className="mt-8">
            <h2 className="font-display text-lg font-semibold">Currently bookable</h2>
            <ul className="mt-3 divide-y divide-neutral-200">
              {experts.map((expert) => (
                <li key={expert._id} className="py-3 text-sm">
                  <span className="font-medium">{expert.name || 'Expert'}</span>
                  <span className="text-neutral-500"> · {expert.expertAvailable === false ? 'Paused' : 'Taking consultations'}</span>
                </li>
              ))}
            </ul>
            {!loading && experts.length === 0 ? <p className="mt-3 text-sm text-neutral-600">Nobody has been approved yet. Publishing your own hours also approves your account.</p> : null}
          </section>
        </main>
      </div>
    </div>
  );
}
