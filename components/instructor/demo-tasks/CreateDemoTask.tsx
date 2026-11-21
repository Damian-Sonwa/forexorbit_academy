/**
 * Create Demo Task Component
 * Form to create new demo trading tasks
 */

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';

interface Student {
  _id: string;
  name: string;
  email: string;
}

interface CreateDemoTaskProps {
  students: Student[];
  onTaskCreated: () => void;
}

export default function CreateDemoTask({ students, onTaskCreated }: CreateDemoTaskProps) {
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    instructions: '',
    assignedTo: '',
    dueDate: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const taskData = {
        ...taskForm,
        assignedTo: taskForm.assignedTo || null,
        dueDate: taskForm.dueDate || undefined,
      };

      await apiClient.post('/demo-trading/tasks', taskData);
      
      // Reset form
      setTaskForm({
        title: '',
        description: '',
        instructions: '',
        assignedTo: '',
        dueDate: '',
      });

      onTaskCreated();
    } catch (error: any) {
      setError(error.response?.data?.message || error.response?.data?.error || 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card rounded-xl p-6">
      <h2 className="text-2xl font-bold mb-6 text-ink">Create New Demo Task</h2>

      {error && (
        <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-ink-muted">
            Task Title *
          </label>
          <input
            type="text"
            required
            value={taskForm.title}
            onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
            placeholder="e.g., Open a Buy trade on EUR/USD with 1% risk"
            className="input w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-ink-muted">
            Description *
          </label>
          <textarea
            required
            value={taskForm.description}
            onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
            rows={3}
            placeholder="Brief description of what students need to do"
            className="input w-full"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-ink-muted">
            Detailed Instructions
          </label>
          <textarea
            value={taskForm.instructions}
            onChange={(e) => setTaskForm({ ...taskForm, instructions: e.target.value })}
            rows={6}
            placeholder="Step-by-step instructions for students to follow..."
            className="input w-full"
          />
          <p className="text-xs mt-1 text-ink-muted">
            Provide clear, actionable steps for students to complete this task.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-ink-muted">
            Assign To
          </label>
          <select
            value={taskForm.assignedTo}
            onChange={(e) => setTaskForm({ ...taskForm, assignedTo: e.target.value })}
            className="input w-full"
          >
            <option value="">All Students</option>
            {students.map((student) => (
              <option key={student._id} value={student._id}>
                {student.name} ({student.email})
              </option>
            ))}
          </select>
          <p className="text-xs mt-1 text-ink-muted">
            Leave as "All Students" to assign to everyone, or select a specific student.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1 text-ink-muted">
            Due Date (Optional)
          </label>
          <input
            type="date"
            value={taskForm.dueDate}
            onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })}
            className="input w-full"
          />
        </div>

        <div className="flex justify-end space-x-3 pt-4">
          <button
            type="button"
            onClick={() => {
              setTaskForm({
                title: '',
                description: '',
                instructions: '',
                assignedTo: '',
                dueDate: '',
              });
              setError(null);
            }}
            className="btn btn-secondary px-4 py-2"
          >
            Clear
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary px-4 py-2"
          >
            {submitting ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  );
}

