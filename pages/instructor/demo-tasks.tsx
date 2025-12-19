/**
 * Instructor Demo Trading Tasks Management
 * Allows instructors to create, view, and manage demo trading tasks for students
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';

interface DemoTask {
  _id: string;
  title: string;
  description: string;
  instructions: string;
  assignedBy: string;
  assignedByName?: string;
  assignedTo: string | null;
  assignedToName?: string;
  dueDate?: string;
  completed: boolean;
  completedAt?: string;
  completedBy?: string;
  createdAt: string;
}

interface Student {
  _id: string;
  name: string;
  email: string;
}

export default function InstructorDemoTasks() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tasks, setTasks] = useState<DemoTask[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [editingTask, setEditingTask] = useState<DemoTask | null>(null);
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    instructions: '',
    assignedTo: '',
    dueDate: '',
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!authLoading && isAuthenticated && user?.role !== 'instructor' && user?.role !== 'admin') {
      router.push('/dashboard');
      return;
    }
  }, [authLoading, isAuthenticated, user, router]);

  useEffect(() => {
    if (isAuthenticated && (user?.role === 'instructor' || user?.role === 'admin')) {
      loadData();
    }
  }, [isAuthenticated, user]);

  const loadData = async () => {
    try {
      setLoading(true);
      const tasksData = await apiClient.get<DemoTask[]>('/demo-trading/tasks').catch(() => []);
      setTasks(Array.isArray(tasksData) ? tasksData : []);
      
      // Try to fetch students - if endpoint doesn't exist, continue without it
      try {
        const studentsData = await apiClient.get<Student[]>('/admin/users?role=student');
        setStudents(Array.isArray(studentsData) ? studentsData : []);
      } catch (err) {
        // If endpoint doesn't exist, students list will be empty (can still assign to "All Students")
        console.log('Student list endpoint not available, continuing without it');
        setStudents([]);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const taskData = {
        ...taskForm,
        assignedTo: taskForm.assignedTo || null, // null means all students
        dueDate: taskForm.dueDate || undefined,
      };

      await apiClient.post('/demo-trading/tasks', taskData);
      setShowTaskModal(false);
      setTaskForm({
        title: '',
        description: '',
        instructions: '',
        assignedTo: '',
        dueDate: '',
      });
      setEditingTask(null);
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to create task');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Are you sure you want to delete this task?')) {
      return;
    }

    try {
      // Note: We need to add a DELETE endpoint for this
      // For now, we'll just show an alert
      alert('Delete functionality will be added. Please contact support to delete tasks.');
      // await apiClient.delete(`/demo-trading/tasks/${taskId}`);
      // await loadData();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to delete task');
    }
  };

  const openEditModal = (task: DemoTask) => {
    setEditingTask(task);
    setTaskForm({
      title: task.title,
      description: task.description,
      instructions: task.instructions || '',
      assignedTo: task.assignedTo || '',
      dueDate: task.dueDate ? format(new Date(task.dueDate), 'yyyy-MM-dd') : '',
    });
    setShowTaskModal(true);
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated || (user?.role !== 'instructor' && user?.role !== 'admin')) {
    return null;
  }

  const pendingTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />

      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />

        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:ml-0 pt-14 lg:pt-6 bg-white lg:bg-gray-50 overflow-y-auto w-full">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Demo Trading Tasks</h1>
            <p className="text-gray-600">Create and manage practice tasks for students to complete in their demo trading accounts</p>
          </div>

          {/* Create Task Button */}
          <div className="mb-6">
            <button
              onClick={() => {
                setEditingTask(null);
                setTaskForm({
                  title: '',
                  description: '',
                  instructions: '',
                  assignedTo: '',
                  dueDate: '',
                });
                setShowTaskModal(true);
              }}
              className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium shadow-md hover:shadow-lg transition-colors"
            >
              + Create New Task
            </button>
          </div>

          {/* Tasks List */}
          {loading ? (
            <p className="text-gray-500">Loading tasks...</p>
          ) : (
            <>
              {/* Pending Tasks */}
              {pendingTasks.length > 0 && (
                <div className="mb-8">
                  <h2 className="text-xl font-semibold text-gray-900 mb-4">Pending Tasks</h2>
                  <div className="space-y-4">
                    {pendingTasks.map((task) => (
                      <div key={task._id} className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start mb-4">
                          <div className="flex-1">
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">{task.title}</h3>
                            <p className="text-gray-600 mb-3">{task.description}</p>
                            {task.instructions && (
                              <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded mb-3">
                                <p className="text-sm text-gray-700 whitespace-pre-line">{task.instructions}</p>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                              <span>Assigned by: {task.assignedByName || 'Unknown'}</span>
                              <span>Assigned to: {task.assignedToName || 'All Students'}</span>
                              {task.dueDate && (
                                <span>Due: {format(new Date(task.dueDate), 'MMM dd, yyyy')}</span>
                              )}
                              <span>Created: {format(new Date(task.createdAt), 'MMM dd, yyyy')}</span>
                            </div>
                          </div>
                          <div className="ml-4 flex space-x-2">
                            <button
                              onClick={() => openEditModal(task)}
                              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteTask(task._id)}
                              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Completed Tasks */}
              {completedTasks.length > 0 && (
                <div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-4">Completed Tasks</h2>
                  <div className="space-y-4">
                    {completedTasks.map((task) => (
                      <div key={task._id} className="bg-gray-50 border border-gray-200 rounded-lg p-6 opacity-75">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2 mb-2">
                              <h3 className="text-lg font-semibold text-gray-900">{task.title}</h3>
                              <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Completed</span>
                            </div>
                            <p className="text-gray-600 mb-2">{task.description}</p>
                            <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500">
                              <span>Assigned to: {task.assignedToName || 'All Students'}</span>
                              {task.completedAt && (
                                <span>Completed: {format(new Date(task.completedAt), 'MMM dd, yyyy HH:mm')}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tasks.length === 0 && (
                <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
                  <p className="text-gray-500 mb-4">No tasks created yet.</p>
                  <button
                    onClick={() => {
                      setEditingTask(null);
                      setTaskForm({
                        title: '',
                        description: '',
                        instructions: '',
                        assignedTo: '',
                        dueDate: '',
                      });
                      setShowTaskModal(true);
                    }}
                    className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium"
                  >
                    Create Your First Task
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Create/Edit Task Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">
                  {editingTask ? 'Edit Task' : 'Create New Task'}
                </h2>
                <button
                  onClick={() => {
                    setShowTaskModal(false);
                    setEditingTask(null);
                    setTaskForm({
                      title: '',
                      description: '',
                      instructions: '',
                      assignedTo: '',
                      dueDate: '',
                    });
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleCreateTask} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Task Title *</label>
                  <input
                    type="text"
                    required
                    value={taskForm.title}
                    onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                    placeholder="e.g., Open a Buy trade on EUR/USD with 1% risk"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
                  <textarea
                    required
                    value={taskForm.description}
                    onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                    rows={3}
                    placeholder="Brief description of what students need to do"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Detailed Instructions</label>
                  <textarea
                    value={taskForm.instructions}
                    onChange={(e) => setTaskForm({ ...taskForm, instructions: e.target.value })}
                    rows={6}
                    placeholder="Step-by-step instructions for students to follow..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Provide clear, actionable steps for students to complete this task.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Assign To</label>
                  <select
                    value={taskForm.assignedTo}
                    onChange={(e) => setTaskForm({ ...taskForm, assignedTo: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    <option value="">All Students</option>
                    {students.map((student) => (
                      <option key={student._id} value={student._id}>
                        {student.name} ({student.email})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Leave as "All Students" to assign to everyone, or select a specific student.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date (Optional)</label>
                  <input
                    type="date"
                    value={taskForm.dueDate}
                    onChange={(e) => setTaskForm({ ...taskForm, dueDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowTaskModal(false);
                      setEditingTask(null);
                      setTaskForm({
                        title: '',
                        description: '',
                        instructions: '',
                        assignedTo: '',
                        dueDate: '',
                      });
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium"
                  >
                    {editingTask ? 'Update Task' : 'Create Task'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}

