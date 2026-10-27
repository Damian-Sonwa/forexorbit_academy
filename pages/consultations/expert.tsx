import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { messageFromUnknown } from '@/lib/public-error';

type Booking = {
  _id: string;
  expertId?: string;
  topic: string;
  description: string;
  lifecycle: string;
  startsAt?: string | null;
  durationMinutes?: number | null;
  proposedStartsAt?: string | null;
  meetingReady?: boolean;
  paymentStatus?: string;
  student?: { name?: string; email?: string } | null;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ZONES = ['UTC', 'Africa/Lagos', 'Africa/Johannesburg', 'Africa/Nairobi', 'Europe/London', 'America/New_York', 'Asia/Dubai'];

export default function ExpertConsultation() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [available, setAvailable] = useState(true);
  const [timeZone, setTimeZone] = useState('Africa/Lagos');
  const [durations, setDurations] = useState<number[]>([30]);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [focus, setFocus] = useState('');
  const [windows, setWindows] = useState(DAYS.map((_, weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5, start: '09:00', end: '17:00' })));
  const [links, setLinks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [recognized, setRecognized] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [rows, experts] = await Promise.all([
        apiClient.get<Booking[]>('/consultations/requests'),
        apiClient.get<Array<{
          _id: string;
          expertAvailable: boolean;
          schedule?: { timeZone?: string | null; durations?: number[]; bufferMinutes?: number; focus?: string; windows?: Array<{ weekday?: number; start?: string; end?: string }> } | null;
        }>>('/consultations/experts'),
      ]);
      setBookings(Array.isArray(rows) ? rows : []);
      const mine = experts.find((expert) => expert._id === user?.id);
      setRecognized(Boolean(mine));
      if (mine) {
        setAvailable(mine.expertAvailable !== false);
        const schedule = mine.schedule;
        if (schedule) {
          if (schedule.timeZone && ZONES.includes(schedule.timeZone)) setTimeZone(schedule.timeZone);
          if (Array.isArray(schedule.durations) && schedule.durations.length > 0) setDurations(schedule.durations);
          if (typeof schedule.bufferMinutes === 'number') setBufferMinutes(schedule.bufferMinutes);
          if (typeof schedule.focus === 'string') setFocus(schedule.focus);
          if (Array.isArray(schedule.windows)) {
            setWindows(DAYS.map((_, weekday) => {
              const saved = schedule.windows?.find((window) => window.weekday === weekday);
              return saved
                ? { weekday, enabled: true, start: saved.start || '09:00', end: saved.end || '17:00' }
                : { weekday, enabled: false, start: '09:00', end: '17:00' };
            }));
          }
        }
      }
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'Consultations could not be loaded.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authLoading && !isAuthenticated) router.push('/login');
  }, [authLoading, isAuthenticated, router]);

  useEffect(() => {
    if (isAuthenticated && user && user.role !== 'student') load();
  }, [isAuthenticated, user]);

  async function act(id: string, body: Record<string, unknown>) {
    setError('');
    setNotice('');
    try {
      await apiClient.put(`/consultations/requests/${id}`, body);
      setNotice('Consultation updated.');
      await load();
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'That change was not saved.');
    }
  }

  async function saveSchedule(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await apiClient.put('/consultations/experts', {
        timeZone,
        durations,
        bufferMinutes,
        focus,
        windows: windows.filter((window) => window.enabled).map(({ weekday, start, end }) => ({ weekday, start, end })),
      });
      setNotice('Weekly hours published. Learners can book the open times.');
      await load();
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'Availability could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleAvailable() {
    try {
      await apiClient.put('/consultations/experts', { available: !available });
      setAvailable(!available);
    } catch (reason) {
      setError(messageFromUnknown(reason) || 'Availability could not be changed.');
    }
  }

  if (authLoading || !isAuthenticated) return <LoadingSpinner message="Loading consultations..." fullScreen />;
  if (!user || user.role === 'student') return <div className="flex min-h-screen items-center justify-center">Access denied</div>;
  const ownBookings = bookings.filter((booking) => booking.expertId === user.id);

  return (
    <div className="flex min-h-screen flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      <div className="flex flex-1">
        <Sidebar />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="page-kicker">Availability</p>
              <h1 className="page-title mt-2">Consultation availability</h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-300">Saving these hours publishes them. Learners only see times that are still open. Confirmed consultations stay booked if you change the hours later.</p>
            </div>
            <button type="button" className="rounded-full border border-gray-300 px-4 py-2 text-sm font-semibold" onClick={toggleAvailable}>{available ? 'Pause new bookings' : 'Take new bookings'}</button>
          </div>
          {error ? <p className="mt-4 text-sm text-red-700" role="alert">{error}</p> : null}
          {notice ? <p className="mt-4 text-sm font-semibold" role="status">{notice}</p> : null}

          {!loading && !recognized && user.role === 'superadmin' ? <p className="mt-4 text-sm text-gray-700 dark:text-gray-200">You are not bookable yet. Saving the hours below publishes you as an expert.</p> : null}
          {!loading && !recognized && user.role !== 'superadmin' ? <p className="mt-4 text-sm text-gray-700 dark:text-gray-200">A super admin must approve you as an expert before these hours can be saved. The approval page is Consultation admin.</p> : null}

          <form className="mt-8 space-y-4 rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800" onSubmit={saveSchedule}>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Published weekly hours</h2>
            <label className="block text-sm font-semibold">Timezone
              <select className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 font-normal" value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
                {ZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </label>
            <fieldset>
              <legend className="text-sm font-semibold">Session length</legend>
              {[30, 60].map((minutes) => (
                <label key={minutes} className="mr-4 text-sm">
                  <input type="checkbox" className="mr-2" checked={durations.includes(minutes)} onChange={(event) => setDurations((current) => event.target.checked ? Array.from(new Set([...current, minutes])) : current.filter((item) => item !== minutes))} />
                  {minutes} minutes
                </label>
              ))}
            </fieldset>
            <label className="block text-sm font-semibold">Buffer after each session
              <select className="mt-1 rounded-xl border border-gray-300 bg-white px-3 py-2 font-normal" value={bufferMinutes} onChange={(event) => setBufferMinutes(Number(event.target.value))}>
                {[0, 5, 10, 15].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
              </select>
            </label>
            <label className="block text-sm font-semibold">What you help with
              <textarea className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 font-normal" rows={3} maxLength={280} value={focus} onChange={(event) => setFocus(event.target.value)} />
            </label>
            <ul className="space-y-2">
              {windows.map((window) => (
                <li key={window.weekday} className="flex flex-wrap items-center gap-2 text-sm">
                  <label className="w-28"><input type="checkbox" className="mr-2" checked={window.enabled} onChange={(event) => setWindows((current) => current.map((item) => item.weekday === window.weekday ? { ...item, enabled: event.target.checked } : item))} />{DAYS[window.weekday]}</label>
                  <input type="time" value={window.start} onChange={(event) => setWindows((current) => current.map((item) => item.weekday === window.weekday ? { ...item, start: event.target.value } : item))} />
                  <input type="time" value={window.end} onChange={(event) => setWindows((current) => current.map((item) => item.weekday === window.weekday ? { ...item, end: event.target.value } : item))} />
                </li>
              ))}
            </ul>
            <button type="submit" disabled={saving} className="rounded-full bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save availability'}</button>
          </form>

          <section className="mt-8">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Your booked consultations</h2>
            {loading ? <div className="mt-4 h-24 animate-pulse rounded-2xl bg-gray-200" aria-hidden /> : null}
            {!loading && ownBookings.length === 0 ? <p className="mt-3 text-sm text-gray-600">No consultations are booked with you.</p> : null}
            <ul className="mt-4 space-y-3">
              {ownBookings.map((booking) => (
                <li key={booking._id} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">{booking.lifecycle.replace(/_/g, ' ')}</p>
                  <h3 className="mt-1 font-semibold">{booking.topic}</h3>
                  <p className="mt-1 text-sm text-gray-600">{booking.student?.name || 'Learner'}{booking.student?.email ? ` · ${booking.student.email}` : ''} · {booking.startsAt ? new Date(booking.startsAt).toLocaleString() : 'No time'} · {booking.paymentStatus || 'not_required'}</p>
                  <p className="mt-2 text-sm">{booking.description}</p>
                  {booking.proposedStartsAt ? <p className="mt-2 text-sm">Requested time: {new Date(booking.proposedStartsAt).toLocaleString()}</p> : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {booking.lifecycle === 'PENDING_CONFIRMATION' ? (
                      <>
                        <button type="button" className="rounded-full bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => act(booking._id, { action: 'accept' })}>Accept</button>
                        <button type="button" className="rounded-full border px-3 py-1.5 text-sm" onClick={() => act(booking._id, { action: 'decline' })}>Decline</button>
                      </>
                    ) : null}
                    {booking.lifecycle === 'RESCHEDULE_REQUESTED' ? <button type="button" className="rounded-full bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => act(booking._id, { action: 'accept-reschedule' })}>Accept new time</button> : null}
                    {booking.lifecycle === 'CONFIRMED' ? (
                      <>
                        <button type="button" className="rounded-full border px-3 py-1.5 text-sm" onClick={() => act(booking._id, { action: 'complete' })}>Mark completed</button>
                        <button type="button" className="rounded-full border px-3 py-1.5 text-sm" onClick={() => act(booking._id, { action: 'no-show' })}>Report no-show</button>
                        <button type="button" className="rounded-full border px-3 py-1.5 text-sm" onClick={() => act(booking._id, { action: 'cancel', reason: 'Cancelled by expert' })}>Cancel</button>
                      </>
                    ) : null}
                  </div>
                  {booking.lifecycle === 'CONFIRMED' ? (
                    <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); act(booking._id, { action: 'meeting', meetingUrl: links[booking._id] || '' }); }}>
                      <label className="sr-only" htmlFor={`link-${booking._id}`}>Meeting link</label>
                      <input id={`link-${booking._id}`} className="min-w-0 flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm" placeholder="https://meet.google.com/abc-defg-hij" value={links[booking._id] || ''} onChange={(event) => setLinks((current) => ({ ...current, [booking._id]: event.target.value }))} />
                      <button type="submit" className="rounded-full border px-3 py-2 text-sm font-semibold">Save meeting link</button>
                    </form>
                  ) : null}
                  {booking.meetingReady ? <p className="mt-2 text-xs text-gray-500">A meeting link is saved. It is shown to the learner only while the consultation is confirmed.</p> : null}
                </li>
              ))}
            </ul>
          </section>
        </main>
      </div>
    </div>
  );
}
