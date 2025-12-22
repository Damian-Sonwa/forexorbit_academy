/**
 * To-Do List Component
 * Personal to-do list with real-time updates
 */

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api-client';
import { useSocket } from '@/hooks/useSocket';

interface TodoItem {
  _id: string;
  title: string;
  description?: string;
  status: 'pending' | 'completed';
  priority: 'low' | 'medium' | 'high';
  relatedType?: 'task' | 'live_class' | 'reminder' | 'consultation' | null;
  relatedId?: string;
  dueDate?: Date | string;
  createdAt: Date | string;
}

export default function TodoList() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const { socket, connected } = useSocket();

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

    socket.on('todo_created', handleTodoCreated);
    socket.on('todo_updated', handleTodoUpdated);
    socket.on('todo_deleted', handleTodoDeleted);

    return () => {
      socket.off('todo_created', handleTodoCreated);
      socket.off('todo_updated', handleTodoUpdated);
      socket.off('todo_deleted', handleTodoDeleted);
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
      const response = await apiClient.post<{ todo: TodoItem }>('/todos', {
        title: newTodoTitle.trim(),
        priority: 'medium',
      });
      setTodos((prev) => [response.todo, ...prev]);
      setNewTodoTitle('');
      setShowAddForm(false);
    } catch (error) {
      console.error('Failed to create todo:', error);
    }
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
        <form onSubmit={handleAddTodo} className="mb-4">
          <input
            type="text"
            value={newTodoTitle}
            onChange={(e) => setNewTodoTitle(e.target.value)}
            placeholder="Add a new task..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            autoFocus
          />
          <button
            type="submit"
            className="mt-2 w-full px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
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
          {pendingTodos.map((todo) => (
            <div
              key={todo._id}
              className={`p-3 rounded-lg border-l-4 ${getPriorityColor(todo.priority)}`}
            >
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => handleToggleTodo(todo._id, todo.status)}
                  className="mt-1 w-4 h-4 text-primary-600 rounded focus:ring-primary-500"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{todo.title}</p>
                  {todo.description && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{todo.description}</p>
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
          ))}

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

