/**
 * AI Analytics Component for Instructors
 * Provides AI-powered insights about student performance
 */

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface StudentAnalysis {
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendations: string[];
}

interface StudentData {
  name: string;
  email: string;
  level: string;
  totalTrades: number;
  winRate: number;
  averageProfitLoss: number;
  completedTasks: number;
  pendingTasks: number;
  averageGrade: number;
}

interface AIAnalyticsProps {
  studentId: string;
  studentName: string;
  onClose?: () => void;
}

export default function AIAnalytics({ studentId, studentName, onClose }: AIAnalyticsProps) {
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState<StudentAnalysis | null>(null);
  const [studentData, setStudentData] = useState<StudentData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.post<{ analysis: StudentAnalysis; studentData: StudentData }>(
        '/ai/instructor/analyze-student',
        { studentId }
      );
      setAnalysis(response.analysis);
      setStudentData(response.studentData);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to analyze student performance';
      setError(errorMessage);
      console.error('AI analytics error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-gray-900 dark:text-white flex items-center">
            <span className="mr-2">🤖</span>
            AI Performance Analysis
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            Get AI-powered insights for {studentName}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {!analysis && !loading && (
        <div className="text-center py-8">
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Get AI-powered insights about this student&apos;s performance, including strengths, concerns, and recommendations.
          </p>
          <button
            onClick={handleAnalyze}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white rounded-lg font-semibold transition-all flex items-center space-x-2 mx-auto"
          >
            <span>🤖</span>
            <span>Analyze Student Performance</span>
          </button>
        </div>
      )}

      {loading && (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Analyzing student performance...</p>
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {analysis && studentData && (
        <div className="space-y-6">
          {/* Student Data Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Total Trades</p>
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{studentData.totalTrades}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Win Rate</p>
              <p className="text-lg font-bold text-green-600 dark:text-green-400">
                {(studentData.winRate * 100).toFixed(1)}%
              </p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Avg Grade</p>
              <p className="text-lg font-bold text-purple-600 dark:text-purple-400">
                {studentData.averageGrade.toFixed(1)}
              </p>
            </div>
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Pending Tasks</p>
              <p className="text-lg font-bold text-orange-600 dark:text-orange-400">
                {studentData.pendingTasks}
              </p>
            </div>
          </div>

          {/* AI Summary */}
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
            <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-2 flex items-center">
              <span className="mr-2">📊</span>
              Performance Summary
            </h4>
            <p className="text-sm text-gray-700 dark:text-gray-300">{analysis.summary}</p>
          </div>

          {/* Strengths */}
          {analysis.strengths && analysis.strengths.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-green-700 dark:text-green-400 mb-2 flex items-center">
                <span className="mr-2">✅</span>
                Strengths
              </h4>
              <ul className="list-disc list-inside space-y-1">
                {analysis.strengths.map((strength, idx) => (
                  <li key={idx} className="text-sm text-gray-700 dark:text-gray-300">{strength}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Concerns */}
          {analysis.concerns && analysis.concerns.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-orange-700 dark:text-orange-400 mb-2 flex items-center">
                <span className="mr-2">⚠️</span>
                Areas of Concern
              </h4>
              <ul className="list-disc list-inside space-y-1">
                {analysis.concerns.map((concern, idx) => (
                  <li key={idx} className="text-sm text-gray-700 dark:text-gray-300">{concern}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {analysis.recommendations && analysis.recommendations.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-blue-700 dark:text-blue-400 mb-2 flex items-center">
                <span className="mr-2">💡</span>
                Recommendations
              </h4>
              <ul className="list-disc list-inside space-y-1">
                {analysis.recommendations.map((rec, idx) => (
                  <li key={idx} className="text-sm text-gray-700 dark:text-gray-300">{rec}</li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={handleAnalyze}
            className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg font-medium transition-colors"
          >
            Refresh Analysis
          </button>
        </div>
      )}
    </div>
  );
}

