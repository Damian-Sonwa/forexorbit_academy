/**
 * To-Do List Component
 * Personal to-do list with real-time updates
 */

import { useState, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api-client';
import { useSocket } from '@/hooks/useSocket';
import { format, formatDistanceToNow, isPast, isToday, isTomorrow } from 'date-fns';

interface TodoItem {
  _id: string;
  title: string;
  description?: string;
  status: 'pending' | 'completed';
  priority: 'low' | 'medium' | 'high';
  relatedType?: 'task' | 'live_class' | 'reminder' | 'consultation' | null;
  relatedId?: string;
  dueDate?: Date | string;
  reminderAt?: Date | string | null;
  reminderTriggered?: boolean;
  createdAt: Date | string;
}

export default function TodoList() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [newTodoReminder, setNewTodoReminder] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editingReminder, setEditingReminder] = useState<string>('');
  const { socket, connected } = useSocket();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchTodos();
  }, []);

  // Listen for todo updates via socket
  useEffect(() => {
    if (!socket || !connected) return;

    const handleTodoCreated = (todo: TodoItem) => {
      setTodos((prev) => [todo, ...prev]);
    };

    const handleTodoUpdated = (update: Partial<TodoItem> & { _id: string }) => {
      setTodos((prev) =>
        prev.map((todo) => (todo._id === update._id ? { ...todo, ...update } : todo))
      );
    };

    const handleTodoDeleted = (data: { _id: string }) => {
      setTodos((prev) => prev.filter((todo) => todo._id !== data._id));
    };

    const handleReminderTriggered = (data: { todoId: string; title: string; reminderAt: Date | string }) => {
      // Update the todo to show reminder was triggered
      setTodos((prev) =>
        prev.map((todo) =>
          todo._id === data.todoId
            ? { ...todo, reminderTriggered: true }
            : todo
        )
      );

      // Play sound alert (graceful fallback)
      try {
        if (typeof window !== 'undefined' && 'Audio' in window) {
          // Create a simple beep sound using Web Audio API
          const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
          const oscillator = audioContext.createOscillator();
          const gainNode = audioContext.createGain();

          oscillator.connect(gainNode);
          gainNode.connect(audioContext.destination);

          oscillator.frequency.value = 800;
          oscillator.type = 'sine';
          gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
          gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

          oscillator.start(audioContext.currentTime);
          oscillator.stop(audioContext.currentTime + 0.5);
        }
      } catch (soundError) {
        // Silently fail if sound is blocked or not supported
        console.log('Sound alert not available:', soundError);
      }

      // Visual highlight - the todo will be highlighted via CSS
    };

    socket.on('todo_created', handleTodoCreated);
    socket.on('todo_updated', handleTodoUpdated);
    socket.on('todo_deleted', handleTodoDeleted);
    socket.on('todo_reminder_triggered', handleReminderTriggered);

    return () => {
      socket.off('todo_created', handleTodoCreated);
      socket.off('todo_updated', handleTodoUpdated);
      socket.off('todo_deleted', handleTodoDeleted);
      socket.off('todo_reminder_triggered', handleReminderTriggered);
    };
  }, [socket, connected]);

  const fetchTodos = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get<{ todos: TodoItem[] }>('/todos');
      setTodos(response.todos || []);
    } catch (error) {
      console.error('Failed to fetch todos:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTodoTitle.trim()) return;

    try {
      const reminderAt = newTodoReminder ? new Date(newTodoReminder) : null;
      const response = await apiClient.post<{ todo: TodoItem }>('/todos', {
        title: newTodoTitle.trim(),
        priority: 'medium',
        reminderAt: reminderAt?.toISOString() || null,
      });
      setTodos((prev) => [response.todo, ...prev]);
      setNewTodoTitle('');
      setNewTodoReminder('');
      setShowAddForm(false);
    } catch (error) {
      console.error('Failed to create todo:', error);
    }
  };

  const handleUpdateReminder = async (todoId: string, reminderAt: string | null) => {
    try {
      await apiClient.put(`/todos?todoId=${todoId}`, {
        reminderAt: reminderAt ? new Date(reminderAt).toISOString() : null,
      });
      setEditingTodoId(null);
      setEditingReminder('');
    } catch (error) {
      console.error('Failed to update reminder:', error);
    }
  };

  const handleQuickReminder = async (todoId: string, minutes: number) => {
    const reminderAt = new Date(Date.now() + minutes * 60 * 1000);
    await handleUpdateReminder(todoId, reminderAt.toISOString());
  };

  const handleToggleTodo = async (todoId: string, currentStatus: string) => {
    try {
      await apiClient.put(`/todos?todoId=${todoId}`, {
        status: currentStatus === 'completed' ? 'pending' : 'completed',
      });
      // Socket will handle the update
    } catch (error) {
      console.error('Failed to update todo:', error);
    }
  };

  const handleDeleteTodo = async (todoId: string) => {
    try {
      await apiClient.delete(`/todos?todoId=${todoId}`);
      // Socket will handle the deletion
    } catch (error) {
      console.error('Failed to delete todo:', error);
    }
  };

  const getPriorityColor = (priority: string): string => {
    switch (priority) {
      case 'high':
        return 'border-red-500 bg-red-50 dark:bg-red-900/20';
      case 'medium':
        return 'border-yellow-500 bg-yellow-50 dark:bg-yellow-900/20';
      case 'low':
        return 'border-green-500 bg-green-50 dark:bg-green-900/20';
      default:
        return 'border-gray-300 bg-gray-50 dark:bg-gray-700';
    }
  };

  const getReminderStatus = (reminderAt: Date | string | null | undefined, reminderTriggered: boolean | undefined): { status: 'none' | 'upcoming' | 'due' | 'triggered' | 'overdue'; timeText: string } => {
    if (!reminderAt) {
      return { status: 'none', timeText: '' };
    }

    if (reminderTriggered) {
      return { status: 'triggered', timeText: 'Reminded' };
    }

    const reminderDate = new Date(reminderAt);
    const now = new Date();
    const diffMs = reminderDate.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));

    if (diffMs < 0) {
      return { status: 'overdue', timeText: 'Overdue' };
    }

    if (diffMins <= 5) {
      return { status: 'due', timeText: `In ${diffMins} min` };
    }

    if (isToday(reminderDate)) {
      return { status: 'upcoming', timeText: `Today at ${format(reminderDate, 'HH:mm')}` };
    }

    if (isTomorrow(reminderDate)) {
      return { status: 'upcoming', timeText: `Tomorrow at ${format(reminderDate, 'HH:mm')}` };
    }

    return { status: 'upcoming', timeText: format(reminderDate, 'MMM dd, HH:mm') };
  };

  const pendingTodos = todos.filter((t) => t.status === 'pending');
  const completedTodos = todos.filter((t) => t.status === 'completed');

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

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">To-Do List</h3>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium"
        >
          {showAddForm ? 'Cancel' : '+ Add'}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddTodo} className="mb-4 space-y-3">
          <input
            type="text"
            value={newTodoTitle}
            onChange={(e) => setNewTodoTitle(e.target.value)}
            placeholder="Add a new task..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
              ⏰ Reminder (optional)
            </label>
            <input
              type="datetime-local"
              value={newTodoReminder}
              onChange={(e) => setNewTodoReminder(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm"
            />
          </div>
          <button
            type="submit"
            className="w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
          >
            Add Task
          </button>
        </form>
      )}

      {todos.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-4xl mb-2">✓</div>
          <p className="text-sm text-gray-500 dark:text-gray-400">No tasks yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Pending Todos */}
          {pendingTodos.map((todo) => {
            const reminderStatus = getReminderStatus(todo.reminderAt, todo.reminderTriggered);
            const isReminderDue = reminderStatus.status === 'due' || reminderStatus.status === 'overdue' || reminderStatus.status === 'triggered';
            const isEditing = editingTodoId === todo._id;

            return (
              <div
                key={todo._id}
                className={`p-3 rounded-lg border-l-4 transition-all ${
                  getPriorityColor(todo.priority)
                } ${
                  isReminderDue ? 'ring-2 ring-primary-400 ring-opacity-50' : ''
                } ${
                  reminderStatus.status === 'triggered' ? 'animate-pulse' : ''
                }`}
              >
                <div className="flex items-start space-x-3">
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={() => handleToggleTodo(todo._id, todo.status)}
                    className="mt-1 w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{todo.title}</p>
                      {reminderStatus.status !== 'none' && (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          reminderStatus.status === 'overdue' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                          reminderStatus.status === 'due' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' :
                          reminderStatus.status === 'triggered' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                          'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                        }`}>
                          <span>⏰</span>
                          <span>{reminderStatus.timeText}</span>
                        </span>
                      )}
                    </div>
                    {todo.description && (
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{todo.description}</p>
                    )}
                    {isEditing ? (
                      <div className="mt-2 space-y-2">
                        <input
                          type="datetime-local"
                          value={editingReminder || (todo.reminderAt ? format(new Date(todo.reminderAt), "yyyy-MM-dd'T'HH:mm") : '')}
                          onChange={(e) => setEditingReminder(e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleUpdateReminder(todo._id, editingReminder)}
                            className="px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => {
                              setEditingTodoId(null);
                              setEditingReminder('');
                            }}
                            className="px-2 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleUpdateReminder(todo._id, null)}
                            className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {!todo.reminderAt && (
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleQuickReminder(todo._id, 10)}
                              className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                              title="Remind in 10 minutes"
                            >
                              10m
                            </button>
                            <button
                              onClick={() => handleQuickReminder(todo._id, 60)}
                              className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                              title="Remind in 1 hour"
                            >
                              1h
                            </button>
                            <button
                              onClick={() => {
                                const tomorrow = new Date();
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                tomorrow.setHours(9, 0, 0, 0);
                                handleUpdateReminder(todo._id, tomorrow.toISOString());
                              }}
                              className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600"
                              title="Remind tomorrow at 9 AM"
                            >
                              Tomorrow
                            </button>
                          </div>
                        )}
                        {todo.reminderAt && (
                          <button
                            onClick={() => {
                              setEditingTodoId(todo._id);
                              setEditingReminder(todo.reminderAt ? format(new Date(todo.reminderAt), "yyyy-MM-dd'T'HH:mm") : '');
                            }}
                            className="px-2 py-0.5 text-xs text-primary-600 dark:text-primary-400 hover:underline"
                          >
                            Edit reminder
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteTodo(todo._id)}
                    className="text-gray-400 hover:text-red-500 transition-colors"
                    aria-label="Delete todo"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}

          {/* Completed Todos (collapsed) */}
          {completedTodos.length > 0 && (
            <details className="mt-4">
              <summary className="text-sm text-gray-500 dark:text-gray-400 cursor-pointer">
                Completed ({completedTodos.length})
              </summary>
              <div className="mt-2 space-y-2">
                {completedTodos.map((todo) => (
                  <div
                    key={todo._id}
                    className="p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50 opacity-60"
                  >
                    <div className="flex items-start space-x-3">
                      <input
                        type="checkbox"
                        checked={true}
                        onChange={() => handleToggleTodo(todo._id, todo.status)}
                        className="mt-1 w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-500 dark:text-gray-400 line-through">
                          {todo.title}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteTodo(todo._id)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        aria-label="Delete todo"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

