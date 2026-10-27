import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';

type Expert = {
  _id: string;
  name: string;
  profilePhoto?: string | null;
  expertAvailable: boolean;
  timeZone?: string | null;
  durations: number[];
  focus?: string;
  hasAvailability: boolean;
};

type Slot = { startsAt: string; endsAt: string; durationMinutes: number };

type Booking = {
  _id: string;
  topic: string;
  description: string;
  lifecycle: string;
  startsAt?: string | null;
  durationMinutes?: number | null;
  meetingUrl?: string | null;
  meetingReady?: boolean;
  paymentStatus?: string;
  expert?: { name?: string } | null;
};

function when(value?: string | null) {
  if (!value) return 'Time to be confirmed';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Time to be confirmed';
  return date.toLocaleString();
}

export default function Consultations() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [experts, setExperts] = useState<Expert[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [expertId, setExpertId] = useState('');
  const [slotKey, setSlotKey] = useState('');
  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [moves, setMoves] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [expertRows, bookingRows] = await Promise.all([
        apiClient.get<Expert[]>('/consultations/experts'),
        apiClient.get<Booking[]>('/consultations/requests'),
      ]);
      setExperts(Array.isArray(expertRows) ? expertRows : []);
      setBookings(Array.isArray(bookingRows) ? bookingRows : []);
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'The consultation list could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'student') load();
  }, [isAuthenticated, user]);

  async function chooseExpert(id: string) {
    setExpertId(id);
    setSlotKey('');
    setSlots([]);
    setError('');
    const from = new Date();
    const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
    try {
      const data = await apiClient.get<{ slots: Slot[] }>(`/consultations/experts/${id}/slots?from=${from.toISOString()}&to=${to.toISOString()}`);
      setSlots(Array.isArray(data.slots) ? data.slots : []);
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'Available times could not be loaded.');
    }
  }

  async function onBook(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const slot = slots.find((item) => item.startsAt + ':' + item.durationMinutes === slotKey);
    if (!slot) {
      setError('Choose an available time.');
      return;
    }
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      await apiClient.post('/consultations/requests', {
        expertId,
        topic,
        description,
        startsAt: slot.startsAt,
        durationMinutes: slot.durationMinutes,
      });
      setNotice('Request sent. It is not confirmed until the expert accepts it.');
      setTopic('');
      setDescription('');
      setSlotKey('');
      await load();
      await chooseExpert(expertId);
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'The booking could not be created.');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(id: string) {
    setError('');
    try {
      await apiClient.put(`/consultations/requests/${id}`, { action: 'cancel', reason: 'Cancelled by learner' });
      setNotice('Consultation cancelled.');
      await load();
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'The consultation could not be cancelled.');
    }
  }

  if (authLoading || !isAuthenticated) return <LoadingSpinner message="Loading consultations..." fullScreen />;
  if (user?.role !== 'student') return <div className="flex min-h-screen items-center justify-center">Access denied</div>;

  const upcoming = bookings.filter((item) => ['PENDING_CONFIRMATION', 'CONFIRMED', 'RESCHEDULE_REQUESTED'].includes(item.lifecycle));
  const closed = bookings.filter((item) => !upcoming.includes(item));

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1">
        <Sidebar />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
              <p className="page-kicker">Guidance</p>
              <h1 className="page-title mt-2">Consultations</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">Choose an expert who has published times. The meeting happens on Google Meet or Zoom after they confirm and add the link. There is no charge in this booking flow.</p>
          {error ? <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">{error} <button type="button" className="font-semibold" onClick={load}>Try again</button></p> : null}
          {notice ? <p className="mt-4 text-sm font-semibold text-gray-900 dark:text-white" role="status">{notice}</p> : null}
          {loading ? <div className="mt-6 h-28 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" aria-hidden /> : null}

          <section className="mt-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Experts</h2>
            {!loading && experts.length === 0 ? <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">No expert has published consultation times yet. You can come back after an expert opens their schedule, or ask in the community in the meantime.</p> : null}
            <ul className="mt-4 grid gap-3 md:grid-cols-2">
              {experts.map((expert) => (
                <li key={expert._id}>
                  <button type="button" onClick={() => chooseExpert(expert._id)} className={`w-full rounded-2xl border p-4 text-left ${expertId === expert._id ? 'border-primary-600' : 'border-gray-200 dark:border-gray-700'} bg-white dark:bg-gray-800`}>
                    <p className="font-semibold text-gray-900 dark:text-white">{expert.name}</p>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{expert.focus || 'Consultation'}</p>
                    <p className="mt-2 text-xs text-gray-500">{!expert.hasAvailability ? 'No published hours yet' : expert.expertAvailable ? 'Taking consultations' : 'Not taking new consultations'}{expert.timeZone ? ` · ${expert.timeZone}` : ''}{expert.durations.length ? ` · ${expert.durations.join(' or ')} min` : ''}</p>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          {expertId ? (
            <form className="mt-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800" onSubmit={onBook}>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Book a time</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300">Times are shown in your timezone. Price is not collected because consultations are not charged here.</p>
              {slots.length === 0 ? <p className="text-sm text-gray-600 dark:text-gray-300">This expert has no open times in the next 14 days. Choose another expert, or come back after they publish more hours.</p> : (
                <div className="flex flex-wrap gap-2" role="listbox" aria-label="Available times">
                  {slots.map((slot) => {
                    const key = slot.startsAt + ':' + slot.durationMinutes;
                    return (
                      <button key={key} type="button" aria-pressed={slotKey === key} className={`rounded-full border px-3 py-1.5 text-sm ${slotKey === key ? 'border-primary-600 bg-primary-50' : 'border-gray-300'}`} onClick={() => setSlotKey(key)}>
                        {when(slot.startsAt)} · {slot.durationMinutes} min
                      </button>
                    );
                  })}
                </div>
              )}
              <label className="block text-sm font-semibold text-gray-900 dark:text-white">Topic
                <input className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 font-normal text-gray-900" value={topic} onChange={(event) => setTopic(event.target.value)} required minLength={3} maxLength={120} />
              </label>
              <label className="block text-sm font-semibold text-gray-900 dark:text-white">What do you want to cover?
                <textarea className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 font-normal text-gray-900" rows={4} value={description} onChange={(event) => setDescription(event.target.value)} required minLength={10} maxLength={2000} />
              </label>
              <button type="submit" disabled={submitting} className="rounded-full bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{submitting ? 'Sending request…' : 'Request consultation'}</button>
            </form>
          ) : null}

          <section className="mt-10">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Your consultations</h2>
            {!loading && bookings.length === 0 ? <p className="mt-3 text-sm text-gray-600 dark:text-gray-300">You have no consultations yet.</p> : null}
            <ul className="mt-4 space-y-3">
              {[...upcoming, ...closed].map((booking) => (
                <li key={booking._id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{booking.lifecycle.replace(/_/g, ' ')}</p>
                  <h3 className="mt-1 font-semibold text-gray-900 dark:text-white">{booking.topic}</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{booking.expert?.name || 'Expert'} · {when(booking.startsAt)} · {booking.paymentStatus === 'not_required' ? 'No payment required' : booking.paymentStatus}</p>
                  <p className="mt-2 text-sm text-gray-700 dark:text-gray-200">{booking.description}</p>
                  <div className="mt-3 flex flex-wrap gap-3">
                    {booking.meetingUrl ? (
                      <a className="rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white" href={booking.meetingUrl} target="_blank" rel="noopener noreferrer">Join consultation</a>
                    ) : null}
                    {upcoming.includes(booking) ? (
                      <button type="button" className="text-sm font-semibold text-gray-700 dark:text-gray-200" onClick={() => cancel(booking._id)}>Cancel</button>
                    ) : null}
                    {booking.lifecycle === 'CONFIRMED' || booking.lifecycle === 'PENDING_CONFIRMATION' ? (
                      <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
                        event.preventDefault();
                        const value = moves[booking._id];
                        if (!value) return;
                        apiClient.put(`/consultations/requests/${booking._id}`, {
                          action: 'request-reschedule',
                          startsAt: new Date(value).toISOString(),
                          durationMinutes: booking.durationMinutes || 30,
                        }).then(() => {
                          setNotice('Reschedule requested. The original time stays until the expert accepts.');
                          return load();
                        }).catch((reason) => setError(messageFromUnknown(reason) || 'The new time could not be requested.'));
                      }}>
                        <label className="sr-only" htmlFor={`move-${booking._id}`}>New time</label>
                        <input id={`move-${booking._id}`} type="datetime-local" className="rounded-xl border border-gray-300 px-2 py-1 text-sm" value={moves[booking._id] || ''} onChange={(event) => setMoves((current) => ({ ...current, [booking._id]: event.target.value }))} />
                        <button type="submit" className="text-sm font-semibold text-primary-700">Request new time</button>
                        <span className="text-xs text-gray-500">Use one of that expert's open times. The original time stays until they accept.</span>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}
