/**
 * FAQ Page
 * Frequently Asked Questions with collapsible accordion-style answers
 */

import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

interface FAQItem {
  question: string;
  answer: string;
  category: string;
}

const faqs: FAQItem[] = [
  {
    category: 'Account & Registration',
    question: 'How do I create an account?',
    answer: 'Click the "Sign Up" button on the homepage, enter your email, name, and password, select your role (Student, Instructor, or Admin), and complete the email verification if required. You\'ll then be guided through the onboarding process to set up your profile.',
  },
  {
    category: 'Account & Registration',
    question: 'Can I change my role after registration?',
    answer: 'Role changes require approval from administrators. If you need to change your role, please contact support with your request and reason.',
  },
  {
    category: 'Account & Registration',
    question: 'I forgot my password. How do I reset it?',
    answer: 'Currently, password reset functionality is being developed. Please contact support at madudamian25@gmail.com or call +234 813 244 6354 for assistance with password recovery.',
  },
  {
    category: 'Courses & Learning',
    question: 'How do I enroll in a course?',
    answer: 'Browse available courses from the "Courses" page, click on a course to view details, and click the "Enroll" button. The course will then appear in your dashboard under "Enrolled Courses".',
  },
  {
    category: 'Courses & Learning',
    question: 'Can I access courses on mobile devices?',
    answer: 'Yes! ForexOrbit Academy is fully responsive and works on mobile phones, tablets, and desktops. You can access all features including video lessons, quizzes, and community chat from any device.',
  },
  {
    category: 'Courses & Learning',
    question: 'How are my quiz scores calculated?',
    answer: 'Quiz scores are calculated based on the number of correct answers. Your scores contribute to your overall course progress and can be viewed in the Progress section of your dashboard.',
  },
  {
    category: 'Courses & Learning',
    question: 'Do I get a certificate after completing a course?',
    answer: 'Yes! Upon successful completion of a course (including all lessons and quizzes), you\'ll receive a digital certificate that you can download and share.',
  },
  {
    category: 'Community & Chat',
    question: 'How do I join community chat rooms?',
    answer: 'Community chat rooms are organized by learning level (Beginner, Intermediate, Advanced). You can access rooms that match your current learning level from the Community page. Advanced rooms unlock as you progress.',
  },
  {
    category: 'Community & Chat',
    question: 'Can I send files in chat?',
    answer: 'Yes! You can send images, videos, audio recordings, and documents in community chat. Use the attachment button in the chat interface to upload files.',
  },
  {
    category: 'Community & Chat',
    question: 'How do I request an expert consultation?',
    answer: 'Go to the "Expert Consultation" page, select an available expert from the list, submit a consultation request with your question or topic, and wait for the expert to accept. Once accepted, you\'ll have a private consultation session via chat.',
  },
  {
    category: 'Technical Issues',
    question: 'Videos are not playing. What should I do?',
    answer: 'Check your internet connection, try refreshing the page, clear your browser cache, ensure your browser supports HTML5 video, and disable browser extensions that might interfere with playback.',
  },
  {
    category: 'Technical Issues',
    question: 'My profile photo won\'t upload. Why?',
    answer: 'Ensure the image is less than 5MB and in a supported format (JPG, PNG, or GIF). Check your internet connection and try refreshing the page. If issues persist, try a different image.',
  },
  {
    category: 'Technical Issues',
    question: 'Chat messages are not sending. How do I fix this?',
    answer: 'Check your internet connection, ensure you\'re connected to the chat (look for the connection indicator), refresh the page to reconnect, clear your browser cache, or try using a different browser.',
  },
  {
    category: 'Billing & Payments',
    question: 'Is ForexOrbit Academy free?',
    answer: 'ForexOrbit Academy offers free access to courses and learning materials. Some premium features or advanced courses may require payment, but basic access is free.',
  },
  {
    category: 'Billing & Payments',
    question: 'How do I cancel my subscription?',
    answer: 'If you have a subscription, you can manage it through your account settings or contact support for assistance with cancellation.',
  },
  {
    category: 'Instructors & Admins',
    question: 'How do I become an instructor?',
    answer: 'Sign up with the instructor role and wait for admin approval. Once approved, you\'ll have access to the instructor dashboard where you can create courses, lessons, and manage your content.',
  },
  {
    category: 'Instructors & Admins',
    question: 'Can instructors create upcoming classes/events?',
    answer: 'Yes! Instructors can create and manage upcoming classes and events from their dashboard. These events will appear on student dashboards automatically.',
  },
  {
    category: 'Instructors & Admins',
    question: 'How do I post market updates in the community?',
    answer: 'Instructors and admins can post market updates and news from the community page. Use the "Add Update" or "View Updates" button in the chat header to create and manage updates.',
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const categories = ['All', ...Array.from(new Set(faqs.map(faq => faq.category)))];
  const filteredFaqs = selectedCategory === 'All' 
    ? faqs 
    : faqs.filter(faq => faq.category === selectedCategory);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-900">
      <Header />
      
      <main className="flex-1 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white mb-4">Frequently Asked Questions</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400">
            Find quick answers to common questions about ForexOrbit Academy
          </p>
        </div>

        {/* Category Filter */}
        <div className="mb-8 flex flex-wrap gap-2 justify-center">
          {categories.map((category) => (
            <button
              key={category}
              onClick={() => {
                setSelectedCategory(category);
                setOpenIndex(null);
              }}
              className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                selectedCategory === category
                  ? 'bg-primary-600 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* FAQ Accordion */}
        <div className="space-y-4">
          {filteredFaqs.map((faq, index) => (
            <div
              key={index}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-md overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex-1">
                  <span className="text-xs font-semibold text-primary-600 dark:text-primary-400 mb-1 block">
                    {faq.category}
                  </span>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    {faq.question}
                  </h3>
                </div>
                <svg
                  className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform flex-shrink-0 ml-4 ${
                    openIndex === index ? 'transform rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {openIndex === index && (
                <div className="px-6 pb-4">
                  <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
                    {faq.answer}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Still Have Questions */}
        <div className="mt-12 bg-primary-50 dark:bg-primary-900/20 rounded-xl p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Still Have Questions?</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Can't find what you're looking for? Our support team is ready to help.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="/contact"
              className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold transition-colors"
            >
              Contact Support
            </a>
            <a
              href="/help"
              className="px-6 py-3 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-white border border-gray-300 dark:border-gray-600 rounded-lg font-semibold transition-colors"
            >
              Visit Help Center
            </a>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

