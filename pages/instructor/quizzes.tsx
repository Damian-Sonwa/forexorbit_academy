/**
 * Instructor Quizzes Page
 * Manage quizzes for lessons - extracted from dashboard
 * Reuses same logic and components as dashboard
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/hooks/useAuth';
import { useSocket } from '@/hooks/useSocket';
import { apiClient } from '@/lib/api-client';
import { useCourses } from '@/hooks/useCourses';

interface Lesson {
  _id: string;
  courseId: string;
  title: string;
  description: string;
  summary?: string;
  order: number;
}

interface Quiz {
  _id: string;
  lessonId: string;
  courseId: string;
  questions: Array<{
    question: string;
    options: string[];
    correctAnswer: number;
  }>;
}

interface Course {
  _id?: string;
  id?: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  category: string;
}

export default function InstructorQuizzes() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const { courses, refetch } = useCourses();
  const { socket, connected } = useSocket();
  const [allCourses, setAllCourses] = useState<Course[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<string | null>(null);
  const [selectedCourseData, setSelectedCourseData] = useState<Course | null>(null);
  const [courseLessons, setCourseLessons] = useState<Lesson[]>([]);
  const [editingQuiz, setEditingQuiz] = useState<string | null>(null);
  const [quizForm, setQuizForm] = useState<Partial<Quiz>>({});
  const [showQuizForm, setShowQuizForm] = useState(false);
  const [loading, setLoading] = useState(false);

  // Group courses by difficulty level
  const coursesByLevel = {
    beginner: allCourses.filter(c => c.difficulty === 'beginner'),
    intermediate: allCourses.filter(c => c.difficulty === 'intermediate'),
    advanced: allCourses.filter(c => c.difficulty === 'advanced'),
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (isAuthenticated && user?.role !== 'instructor' && user?.role !== 'admin' && user?.role !== 'superadmin') {
      router.push('/dashboard');
      return;
    }
    if (isAuthenticated && user) {
      loadAllCourses();
    }
  }, [authLoading, isAuthenticated, user, router]);

  useEffect(() => {
    if (selectedCourse) {
      loadCourseLessons(selectedCourse);
    }
  }, [selectedCourse]);

  useEffect(() => {
    if (socket && connected && editingQuiz) {
      socket.on('quizUpdated', (data: { lessonId: string }) => {
        if (editingQuiz === data.lessonId) {
          loadQuiz(data.lessonId);
        }
      });

      return () => {
        socket.off('quizUpdated');
      };
    }
  }, [socket, connected, editingQuiz]);

  const loadAllCourses = async () => {
    try {
      setAllCourses(courses as Course[]);
    } catch (error) {
      console.error('Failed to load courses:', error);
    }
  };

  const loadCourseLessons = async (courseId: string) => {
    try {
      setLoading(true);
      const lessons = await apiClient.get<Lesson[]>(`/lessons?courseId=${courseId}`);
      setCourseLessons(lessons.sort((a, b) => a.order - b.order));
    } catch (error: any) {
      console.error('Failed to load lessons:', error);
      alert(error.message || 'Failed to load lessons');
    } finally {
      setLoading(false);
    }
  };

  const loadQuiz = async (lessonId: string) => {
    try {
      const quiz = await apiClient.get<Quiz>(`/quizzes/${lessonId}`);
      setQuizForm(quiz);
    } catch {
      // Quiz might not exist yet
      setQuizForm({ lessonId, courseId: selectedCourse || '', questions: [] });
    }
  };

  const handleSelectCourse = async (courseId: string) => {
    setSelectedCourse(courseId);
    const course = allCourses.find(c => (c._id || c.id) === courseId);
    setSelectedCourseData(course || null);
    await loadCourseLessons(courseId);
    setEditingQuiz(null);
    setShowQuizForm(false);
  };

  const handleEditQuiz = async (lessonId: string) => {
    setEditingQuiz(lessonId);
    await loadQuiz(lessonId);
    setShowQuizForm(true);
  };

  const handleSaveQuiz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingQuiz || !selectedCourse) return;

    try {
      setLoading(true);
      await apiClient.put(`/quizzes/${editingQuiz}`, {
        lessonId: editingQuiz,
        courseId: selectedCourse,
        questions: quizForm.questions || [],
      });

      // Emit real-time update
      if (socket && connected) {
        socket.emit('quizUpdated', { lessonId: editingQuiz });
      }

      setEditingQuiz(null);
      setShowQuizForm(false);
      setQuizForm({});
      alert('Quiz saved successfully!');
    } catch (error: any) {
      alert(error.message || 'Failed to save quiz');
    } finally {
      setLoading(false);
    }
  };

  const addQuizQuestion = () => {
    const questions = quizForm.questions || [];
    setQuizForm({
      ...quizForm,
      questions: [...questions, { question: '', options: ['', '', '', ''], correctAnswer: 0 }],
    });
  };

  const removeQuizQuestion = (index: number) => {
    const questions = quizForm.questions || [];
    setQuizForm({
      ...quizForm,
      questions: questions.filter((_, i) => i !== index),
    });
  };

  if (authLoading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 dark:border-primary-400 mx-auto"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      {/* Persistent Sidebar Layout - Sidebar remains visible across all instructor pages */}
      <div className="flex flex-1 overflow-hidden pt-20 lg:pt-0">
        <Sidebar />
        <main className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          {/* Header Section */}
          <div className="mb-3 sm:mb-4 flex-shrink-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Quizzes Management</h1>
            <p className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm mt-1">Manage quizzes for your lessons</p>
          </div>

          {/* Main Content Area */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* Left Panel: Courses by Level */}
            <div className="lg:col-span-1 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
              <div className="p-3 sm:p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 z-10">
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">All Courses</h2>
              </div>
              <div className="p-3 sm:p-4 space-y-3 sm:space-y-4 max-h-[calc(100vh-300px)] overflow-y-auto">
                {/* Beginner Courses */}
                {coursesByLevel.beginner.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-level-basic-dark dark:text-level-basic mb-2 uppercase tracking-wide">
                      Beginner
                    </h3>
                    <div className="space-y-2">
                      {coursesByLevel.beginner.map((course) => (
                        <div
                          key={course._id || course.id}
                          className={`w-full rounded-lg border-2 transition-all ${
                            selectedCourse === (course._id || course.id)
                              ? 'border-level-basic-dark dark:border-level-basic bg-level-basic-light dark:bg-level-basic/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <button
                            onClick={() => handleSelectCourse(course._id || course.id || '')}
                            className="w-full text-left p-3"
                          >
                            <p className="font-semibold text-sm text-gray-900 dark:text-white">{course.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{course.description}</p>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Intermediate Courses */}
                {coursesByLevel.intermediate.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-level-intermediate-dark dark:text-level-intermediate mb-2 uppercase tracking-wide">
                      Intermediate
                    </h3>
                    <div className="space-y-2">
                      {coursesByLevel.intermediate.map((course) => (
                        <div
                          key={course._id || course.id}
                          className={`w-full rounded-lg border-2 transition-all ${
                            selectedCourse === (course._id || course.id)
                              ? 'border-level-intermediate-dark dark:border-level-intermediate bg-level-intermediate-light dark:bg-level-intermediate/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <button
                            onClick={() => handleSelectCourse(course._id || course.id || '')}
                            className="w-full text-left p-3"
                          >
                            <p className="font-semibold text-sm text-gray-900 dark:text-white">{course.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{course.description}</p>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Advanced Courses */}
                {coursesByLevel.advanced.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-level-advanced-dark dark:text-level-advanced mb-2 uppercase tracking-wide">
                      Advanced
                    </h3>
                    <div className="space-y-2">
                      {coursesByLevel.advanced.map((course) => (
                        <div
                          key={course._id || course.id}
                          className={`w-full rounded-lg border-2 transition-all ${
                            selectedCourse === (course._id || course.id)
                              ? 'border-level-advanced-dark dark:border-level-advanced bg-level-advanced-light dark:bg-level-advanced/20'
                              : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                          }`}
                        >
                          <button
                            onClick={() => handleSelectCourse(course._id || course.id || '')}
                            className="w-full text-left p-3"
                          >
                            <p className="font-semibold text-sm text-gray-900 dark:text-white">{course.title}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{course.description}</p>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {allCourses.length === 0 && (
                  <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400 text-sm">No courses yet.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Lessons & Quizzes */}
            <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
              {!selectedCourse ? (
                <div className="flex items-center justify-center p-6 sm:p-12 min-h-[300px] sm:min-h-[400px]">
                  <div className="text-center px-4">
                    <svg className="w-12 h-12 sm:w-16 sm:h-16 text-gray-400 dark:text-gray-500 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400">Select a course from the left to manage quizzes</p>
                  </div>
                </div>
              ) : showQuizForm ? (
                <div className="p-6">
                  <form onSubmit={handleSaveQuiz} className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-gray-900 dark:text-white">Edit Quiz</h3>
                      <button
                        type="button"
                        onClick={addQuizQuestion}
                        className="text-sm text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        + Add Question
                      </button>
                    </div>

                    {(quizForm.questions || []).map((question, qIndex) => (
                      <div key={qIndex} className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Question {qIndex + 1}</span>
                          <button
                            type="button"
                            onClick={() => removeQuizQuestion(qIndex)}
                            className="text-sm text-red-600 dark:text-red-400 hover:underline"
                          >
                            Remove
                          </button>
                        </div>
                        <input
                          type="text"
                          value={question.question}
                          onChange={(e) => {
                            const questions = [...(quizForm.questions || [])];
                            questions[qIndex].question = e.target.value;
                            setQuizForm({ ...quizForm, questions });
                          }}
                          placeholder="Question text"
                          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg"
                        />
                        {question.options.map((option, oIndex) => (
                          <div key={oIndex} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`correct-${qIndex}`}
                              checked={question.correctAnswer === oIndex}
                              onChange={() => {
                                const questions = [...(quizForm.questions || [])];
                                questions[qIndex].correctAnswer = oIndex;
                                setQuizForm({ ...quizForm, questions });
                              }}
                              className="w-4 h-4"
                            />
                            <input
                              type="text"
                              value={option}
                              onChange={(e) => {
                                const questions = [...(quizForm.questions || [])];
                                questions[qIndex].options[oIndex] = e.target.value;
                                setQuizForm({ ...quizForm, questions });
                              }}
                              placeholder={`Option ${oIndex + 1}`}
                              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg"
                            />
                          </div>
                        ))}
                      </div>
                    ))}

                    {(!quizForm.questions || quizForm.questions.length === 0) && (
                      <p className="text-gray-500 dark:text-gray-400 text-center py-4">No questions yet. Click "+ Add Question" to start.</p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={loading}
                        className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white rounded-lg font-semibold transition-colors"
                      >
                        {loading ? 'Saving...' : 'Save Quiz'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowQuizForm(false);
                          setEditingQuiz(null);
                          setQuizForm({});
                        }}
                        className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="p-6">
                  <div className="mb-4">
                    <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
                      {selectedCourseData?.title || 'Lessons'}
                    </h2>
                    {selectedCourseData && (
                      <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                        <span className="capitalize">{selectedCourseData.difficulty}</span>
                        <span>•</span>
                        <span>{selectedCourseData.category}</span>
                        <span>•</span>
                        <span>{courseLessons.length} lessons</span>
                      </div>
                    )}
                  </div>

                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
                    </div>
                  ) : courseLessons.length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-gray-500 dark:text-gray-400 mb-4">No lessons yet for this course.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {courseLessons.map((lesson) => (
                        <div
                          key={lesson._id}
                          className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 hover:shadow-md transition-shadow"
                        >
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <h3 className="font-bold text-gray-900 dark:text-white mb-1">{lesson.title}</h3>
                              {lesson.summary && (
                                <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{lesson.summary}</p>
                              )}
                              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{lesson.description}</p>
                            </div>
                            <div className="flex gap-2 ml-4">
                              <button
                                onClick={() => handleEditQuiz(lesson._id)}
                                className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-sm font-semibold hover:bg-blue-200 dark:hover:bg-blue-900/50"
                              >
                                {editingQuiz === lesson._id ? 'Editing...' : 'Edit Quiz'}
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                            <div className="flex items-center gap-3 text-xs">
                              <span className="text-gray-500 dark:text-gray-400">Order: {lesson.order}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

