/**
 * Reminders Panel Component
 * Displays user's reminders with countdown timers
 */

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { useSocket } from '@/hooks/useSocket';
import { BookOpen, Clock, FileText, MessageSquare } from 'lucide-react';

interface Reminder {
  _id: string;
  type: 'live_class' | 'task_deadline' | 'consultation' | 'custom';
  title: string;
  description?: string;
  scheduledAt: Date | string;
  relatedId?: string;
  completed: boolean;
  createdAt: Date | string;
}

export default function RemindersPanel() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const { socket, connected } = useSocket();

  useEffect(() => {
    fetchReminders();
  }, []);

  // Listen for reminder updates via socket
  useEffect(() => {
    if (!socket || !connected) return;

    const handleReminderUpdate = () => {
      fetchReminders();
    };

    socket.on('reminder_updated', handleReminderUpdate);
    return () => {
      socket.off('reminder_updated', handleReminderUpdate);
    };
  }, [socket, connected]);

  const fetchReminders = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ reminders: Reminder[] }>('/reminders?upcoming=true');
      setReminders(response.reminders || []);
    } catch (error) {
      console.error('Failed to fetch reminders:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTimeUntil = (scheduledAt: Date | string): string => {
    const now = new Date();
    const scheduled = new Date(scheduledAt);
    const diff = scheduled.getTime() - now.getTime();

    if (diff < 0) {
      return 'Overdue';
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  };

  const reminderIconClass = 'h-5 w-5 shrink-0';
  const getReminderIcon = (type: string) => {
    switch (type) {
      case 'live_class':
        return <BookOpen className={reminderIconClass} aria-hidden />;
      case 'task_deadline':
        return <FileText className={reminderIconClass} aria-hidden />;
      case 'consultation':
        return <MessageSquare className={reminderIconClass} aria-hidden />;
      default:
        return <Clock className={reminderIconClass} aria-hidden />;
    }
  };

  const getReminderColor = (type: string): string => {
    switch (type) {
      case 'live_class':
        return 'bg-primary-50 dark:bg-primary-950/40 text-primary-800 dark:text-primary-300';
      case 'task_deadline':
        return 'bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200';
      case 'consultation':
        return 'bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200';
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300';
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3"></div>
          <div className="h-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  const upcomingReminders = reminders.filter((r) => !r.completed).slice(0, 5);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Upcoming Reminders</h3>
        {upcomingReminders.length > 0 && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {upcomingReminders.length} {upcomingReminders.length === 1 ? 'reminder' : 'reminders'}
          </span>
        )}
      </div>

      {upcomingReminders.length === 0 ? (
        <div className="text-center py-8">
          <Clock className="mx-auto mb-2 h-10 w-10 text-neutral-400" aria-hidden />
          <p className="text-sm text-gray-500 dark:text-gray-400">No upcoming reminders</p>
        </div>
      ) : (
        <div className="space-y-3">
          {upcomingReminders.map((reminder) => (
            <div
              key={reminder._id}
              className={`p-3 rounded-lg border border-gray-200 dark:border-gray-700 ${getReminderColor(reminder.type)}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-2 flex-1">
                  <span className="mt-0.5">{getReminderIcon(reminder.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{reminder.title}</p>
                    {reminder.description && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                        {reminder.description}
                      </p>
                    )}
                    <p className="text-xs font-semibold mt-2">
                      {formatTimeUntil(reminder.scheduledAt)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

