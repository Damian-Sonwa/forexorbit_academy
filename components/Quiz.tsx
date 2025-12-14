/**
 * Quiz Component
 * Displays quiz questions and handles submission
 */

import { useState } from 'react';
import { apiClient } from '@/lib/api-client';

interface QuizProps {
  lessonId: string;
  courseId: string;
  quiz: {
    _id?: string;
    questions: Array<{
      question: string;
      options: string[];
      correctAnswer: number;
    }>;
  };
}

export default function Quiz({ lessonId, courseId, quiz }: QuizProps) {
  const [answers, setAnswers] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleAnswerChange = (questionIndex: number, answerIndex: number) => {
    const newAnswers = [...answers];
    newAnswers[questionIndex] = answerIndex;
    setAnswers(newAnswers);
  };

  const handleSubmit = async () => {
    if (answers.length !== quiz.questions.length) {
      alert('Please answer all questions');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post(`/quizzes/${lessonId}`, { answers });
      setResults(response);
      setSubmitted(true);
    } catch (error: any) {
      alert(error.message || 'Failed to submit quiz');
    } finally {
      setLoading(false);
    }
  };

  if (submitted && results) {
    const scoreColor = results.score >= 70 ? 'green' : results.score >= 50 ? 'yellow' : 'red';
    const scoreBg = {
      green: 'from-green-500 to-green-600',
      yellow: 'from-yellow-500 to-yellow-600',
      red: 'from-red-500 to-red-600',
    }[scoreColor];

    return (
      <div className="space-y-6">
        {/* Score Card */}
        <div className={`bg-gradient-to-br ${scoreBg} rounded-2xl p-8 text-white text-center shadow-lg`}>
          <div className="text-6xl font-bold mb-2">{results.score.toFixed(0)}%</div>
          <p className="text-xl font-semibold mb-1">Quiz Score</p>
          <p className="text-white/90">
            {results.correct} out of {results.total} questions correct
          </p>
          {results.score >= 70 && (
            <div className="mt-4 inline-flex items-center px-4 py-2 bg-white/20 rounded-full">
              <svg className="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Great job!
            </div>
          )}
        </div>

        {/* Results */}
        <div className="space-y-4">
          <h3 className="text-xl font-bold text-gray-900">Question Review</h3>
          {results.results.map((result: any, index: number) => (
            <div
              key={index}
              className={`p-6 rounded-xl border-2 ${
                result.isCorrect
                  ? 'bg-green-50 border-green-200'
                  : 'bg-red-50 border-red-200'
              }`}
            >
              <div className="flex items-start mb-3">
                {result.isCorrect ? (
                  <svg className="w-6 h-6 text-green-600 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="w-6 h-6 text-red-600 mr-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                )}
                <p className="font-semibold text-gray-900 flex-1">{result.question}</p>
              </div>
              <div className="ml-9 space-y-2 text-sm">
                <p className="text-gray-700">
                  <span className="font-medium">Your answer:</span>{' '}
                  <span className={result.isCorrect ? 'text-green-700 font-semibold' : 'text-red-700 font-semibold'}>
                    {result.userAnswer}
                  </span>
                </p>
                {!result.isCorrect && (
                  <p className="text-gray-700">
                    <span className="font-medium">Correct answer:</span>{' '}
                    <span className="text-green-700 font-semibold">{result.correctAnswer}</span>
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {quiz.questions.map((question, qIndex) => (
        <div key={qIndex} className="p-6 bg-gray-50 rounded-xl border border-gray-200">
          <div className="flex items-start mb-4">
            <div className="flex-shrink-0 w-8 h-8 bg-primary-600 text-white rounded-lg flex items-center justify-center font-bold mr-3">
              {qIndex + 1}
            </div>
            <p className="text-lg font-semibold text-gray-900 flex-1">
              {question.question}
            </p>
          </div>
          <div className="space-y-3 ml-11">
            {question.options.map((option, oIndex) => (
              <label
                key={oIndex}
                className={`flex items-center space-x-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                  answers[qIndex] === oIndex
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name={`question-${qIndex}`}
                  value={oIndex}
                  checked={answers[qIndex] === oIndex}
                  onChange={() => handleAnswerChange(qIndex, oIndex)}
                  className="w-5 h-5 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-gray-700 font-medium flex-1">{option}</span>
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="pt-4">
        <button
          onClick={handleSubmit}
          disabled={loading || answers.length !== quiz.questions.length}
          className="w-full px-6 py-4 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-lg transition-colors shadow-lg"
        >
          {loading ? (
            <span className="flex items-center justify-center">
              <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Submitting...
            </span>
          ) : (
            'Submit Quiz'
          )}
        </button>
      </div>
    </div>
  );
}

