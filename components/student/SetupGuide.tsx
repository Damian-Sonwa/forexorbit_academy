/**
 * Demo Account Setup Guide Component
 * Comprehensive guide for students to set up demo trading accounts
 */

import { useState } from 'react';
import Link from 'next/link';

export default function SetupGuide() {
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const steps = [
    {
      id: 1,
      title: 'What is a Demo Trading Account?',
      content: (
        <div className="space-y-4">
          <p className="text-gray-700">
            A <strong>demo trading account</strong> (also called a practice account or paper trading account) is a 
            simulated trading environment that allows you to practice trading with virtual money. It provides access to 
            real-time market data and trading tools without risking any real capital.
          </p>
          <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
            <h4 className="font-semibold text-blue-900 mb-2">Key Features:</h4>
            <ul className="list-disc list-inside space-y-1 text-blue-800 text-sm">
              <li><strong>Virtual Money:</strong> Start with a virtual balance (typically $10,000 - $100,000)</li>
              <li><strong>Real Market Data:</strong> Access live prices and market conditions</li>
              <li><strong>Full Trading Tools:</strong> Use all features of the trading platform</li>
              <li><strong>No Financial Risk:</strong> You cannot lose or make real money</li>
              <li><strong>Learning Environment:</strong> Perfect for practicing strategies and techniques</li>
            </ul>
          </div>
        </div>
      ),
    },
    {
      id: 2,
      title: 'Choose Your Platform',
      content: (
        <div className="space-y-4">
          <p className="text-gray-700">
            MetaTrader offers two platforms: MT4 (MetaTrader 4) and MT5 (MetaTrader 5). 
            Both are excellent for learning, but MT5 has more features and is the newer version.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-gray-200 rounded-lg p-4 bg-white">
              <h4 className="font-semibold mb-2 text-gray-900">MetaTrader 4 (MT4)</h4>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                <li>Most popular platform</li>
                <li>Simpler interface</li>
                <li>Great for beginners</li>
                <li>Widely supported by brokers</li>
              </ul>
            </div>
            <div className="border border-gray-200 rounded-lg p-4 bg-white">
              <h4 className="font-semibold mb-2 text-gray-900">MetaTrader 5 (MT5)</h4>
              <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                <li>More advanced features</li>
                <li>Better charting tools</li>
                <li>More timeframes</li>
                <li>Enhanced backtesting</li>
              </ul>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 3,
      title: 'Create a Demo Account',
      content: (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-blue-50 to-green-50 border-2 border-blue-200 rounded-xl p-6">
            <h4 className="font-bold text-lg mb-4 text-gray-900">🚀 Quick Start - Create Account Now</h4>
            <div className="grid md:grid-cols-2 gap-4">
              <a
                href="https://hub.oanda.com/apply/demo/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-lg font-medium transition-colors shadow-md hover:shadow-lg"
              >
                <span>📊</span>
                <span>Create OANDA Demo Account</span>
                <span>→</span>
              </a>
              <a
                href="https://www.metatrader4.com/en/download"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white px-6 py-4 rounded-lg font-medium transition-colors shadow-md hover:shadow-lg"
              >
                <span>💻</span>
                <span>Download MetaTrader</span>
                <span>→</span>
              </a>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
              <h4 className="font-semibold mb-2 text-blue-900">Option A: OANDA Demo Account (Recommended for API Integration)</h4>
              <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
                <li>Click the "Create OANDA Demo Account" button above</li>
                <li>Fill in the registration form with your email and details</li>
                <li>Verify your email address</li>
                <li>Log in to your OANDA practice account</li>
                <li>Get your Account ID from the dashboard</li>
                <li>Generate an API token from Account → Manage API Access</li>
              </ol>
            </div>

            <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded">
              <h4 className="font-semibold mb-2 text-green-900">Option B: MetaTrader Demo Account (Recommended for Desktop Trading)</h4>
              <ol className="list-decimal list-inside space-y-2 text-sm text-green-800">
                <li>Click the "Download MetaTrader" button above</li>
                <li>Download and install MT4 or MT5</li>
                <li>Open the platform and click "Open an Account"</li>
                <li>Select a broker (e.g., IC Markets, FXTM, XM)</li>
                <li>Choose "Demo Account" option</li>
                <li>Fill in the registration form</li>
                <li>You'll receive login credentials via email</li>
              </ol>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 4,
      title: 'Access Your Demo Account',
      content: (
        <div className="space-y-4">
          <div className="border border-gray-200 rounded-lg p-4 bg-white">
            <h4 className="font-semibold mb-2 text-gray-900">WebTrader Access</h4>
            <p className="text-sm text-gray-700 mb-2">
              Most brokers provide a WebTrader link. Simply click the link, enter your demo account credentials, 
              and you can trade directly in your browser - no download required!
            </p>
            <p className="text-sm text-gray-600 italic">
              💡 Tip: Contact your instructor if you need help accessing your broker's WebTrader platform.
            </p>
          </div>

          <div className="border border-gray-200 rounded-lg p-4 bg-white">
            <h4 className="font-semibold mb-2 text-gray-900">Desktop/Mobile App Access</h4>
            <p className="text-sm text-gray-700 mb-2">
              Use your demo account credentials (login, password, server) to connect via MT4/MT5 apps.
            </p>
            <div className="mt-2 space-y-1 text-sm text-gray-600">
              <p><strong>Login:</strong> Your demo account number</p>
              <p><strong>Password:</strong> The password you received</p>
              <p><strong>Server:</strong> Usually something like "BrokerName-Demo" or "Demo-Server"</p>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 5,
      title: 'Access Tasks & Submit for Review',
      content: (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 rounded-xl p-6">
            <h4 className="font-bold text-lg mb-4 text-gray-900">📋 How to Access and Submit Tasks</h4>
            
            <div className="space-y-4">
              <div className="bg-white rounded-lg p-4 border border-purple-200">
                <h5 className="font-semibold mb-2 text-purple-900 flex items-center">
                  <span className="mr-2">1️⃣</span>
                  Navigate to Trading Dashboard
                </h5>
                <p className="text-sm text-gray-700 mb-2">
                  Click on <strong>"Trading Dashboard"</strong> in the sidebar or from the main dashboard page.
                </p>
                <p className="text-xs text-gray-600">
                  You'll see three tabs: <strong>Live Trading</strong>, <strong>Tasks</strong>, and <strong>Trade Journal</strong>
                </p>
              </div>

              <div className="bg-white rounded-lg p-4 border border-purple-200">
                <h5 className="font-semibold mb-2 text-purple-900 flex items-center">
                  <span className="mr-2">2️⃣</span>
                  View Your Assigned Tasks
                </h5>
                <p className="text-sm text-gray-700 mb-2">
                  Click on the <strong>"Tasks"</strong> tab to see all tasks assigned to you by your instructor.
                </p>
                <ul className="text-xs text-gray-600 list-disc list-inside space-y-1">
                  <li>Tasks are organized by status: <strong>Pending</strong> and <strong>Submitted</strong></li>
                  <li>Each task shows: Title, Description, Level (Beginner/Intermediate/Advanced), and Due Date</li>
                  <li>Pending tasks have a <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded text-xs">Pending</span> badge</li>
                </ul>
              </div>

              <div className="bg-white rounded-lg p-4 border border-purple-200">
                <h5 className="font-semibold mb-2 text-purple-900 flex items-center">
                  <span className="mr-2">3️⃣</span>
                  Open Task Details
                </h5>
                <p className="text-sm text-gray-700 mb-2">
                  Click the <strong>"View Task"</strong> button on any pending task card.
                </p>
                <p className="text-xs text-gray-600">
                  This opens the Task Detail page where you can see:
                </p>
                <ul className="text-xs text-gray-600 list-disc list-inside space-y-1 mt-1">
                  <li>Full task instructions</li>
                  <li>Task level and requirements</li>
                  <li>Submission form</li>
                </ul>
              </div>

              <div className="bg-white rounded-lg p-4 border border-purple-200">
                <h5 className="font-semibold mb-2 text-purple-900 flex items-center">
                  <span className="mr-2">4️⃣</span>
                  Complete the Task
                </h5>
                <p className="text-sm text-gray-700 mb-2">
                  Use your demo trading account to complete the task requirements.
                </p>
                <p className="text-xs text-gray-600">
                  This might involve:
                </p>
                <ul className="text-xs text-gray-600 list-disc list-inside space-y-1 mt-1">
                  <li>Placing specific trades</li>
                  <li>Analyzing market conditions</li>
                  <li>Applying trading strategies</li>
                  <li>Taking screenshots of your trading activity</li>
                </ul>
              </div>

              <div className="bg-white rounded-lg p-4 border border-purple-200">
                <h5 className="font-semibold mb-2 text-purple-900 flex items-center">
                  <span className="mr-2">5️⃣</span>
                  Submit Your Work
                </h5>
                <p className="text-sm text-gray-700 mb-2">
                  On the Task Detail page, fill out the submission form:
                </p>
                <ul className="text-xs text-gray-600 list-disc list-inside space-y-1">
                  <li><strong>Reasoning / Analysis:</strong> Explain your approach, analysis, or reasoning (required)</li>
                  <li><strong>Screenshot:</strong> Upload a screenshot of your demo trading activity (optional)</li>
                </ul>
                <p className="text-sm text-gray-700 mt-3 mb-2">
                  Click <strong>"Submit Task"</strong> to send your work for instructor review.
                </p>
              </div>

              <div className="bg-white rounded-lg p-4 border border-purple-200">
                <h5 className="font-semibold mb-2 text-purple-900 flex items-center">
                  <span className="mr-2">6️⃣</span>
                  Track Your Submission Status
                </h5>
                <p className="text-sm text-gray-700 mb-2">
                  After submission, you can track the status of your work:
                </p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">Submitted</span>
                  <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">Reviewed</span>
                  <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-xs font-medium">Graded</span>
                </div>
                <p className="text-xs text-gray-600 mt-2">
                  Once reviewed, you'll see instructor feedback and grades on the task detail page.
                </p>
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 6,
      title: 'Important Notes',
      content: (
        <div className="space-y-3 text-sm text-gray-700">
          <div className="flex items-start">
            <span className="mr-2 text-green-600">✅</span>
            <p><strong>Demo accounts use virtual money</strong> - you cannot lose real money, but you also cannot withdraw profits.</p>
          </div>
          <div className="flex items-start">
            <span className="mr-2 text-green-600">✅</span>
            <p><strong>Demo accounts expire</strong> - typically after 30 days. You can create a new one anytime.</p>
          </div>
          <div className="flex items-start">
            <span className="mr-2 text-green-600">✅</span>
            <p><strong>Market conditions may differ</strong> - demo accounts sometimes have different spreads and execution speeds than live accounts.</p>
          </div>
          <div className="flex items-start">
            <span className="mr-2 text-green-600">✅</span>
            <p><strong>Practice makes perfect</strong> - use demo accounts to test strategies, learn the platform, and build confidence before trading with real money.</p>
          </div>
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded mt-4">
            <p className="text-sm text-yellow-800">
              <strong>💡 Important:</strong> Demo accounts are essential for your ForexOrbit Academy journey. 
              They allow you to complete practice tasks, log trades in your journal, and demonstrate your 
              understanding of trading concepts without any financial risk.
            </p>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Demo Account Setup Guide</h2>
        <p className="text-gray-600">Complete guide to setting up your demo trading account and submitting tasks</p>
      </div>

      <div className="space-y-3">
        {steps.map((step) => (
          <div
            key={step.id}
            className="border border-gray-200 rounded-lg overflow-hidden transition-all hover:shadow-md"
          >
            <button
              onClick={() => setActiveStep(activeStep === step.id ? null : step.id)}
              className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                  activeStep === step.id
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-200 text-gray-700'
                }`}>
                  {step.id}
                </div>
                <h3 className="font-semibold text-gray-900">{step.title}</h3>
              </div>
              <svg
                className={`w-5 h-5 text-gray-500 transition-transform ${
                  activeStep === step.id ? 'transform rotate-180' : ''
                }`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {activeStep === step.id && (
              <div className="p-4 bg-white border-t border-gray-200 animate-in slide-in-from-top-2">
                {step.content}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-gradient-to-r from-primary-50 to-blue-50 rounded-lg border border-primary-200">
        <p className="text-sm text-gray-700">
          <strong>Ready to get started?</strong> Once you've set up your demo account, head to the{' '}
          <Link href="/student-dashboard" className="text-primary-600 hover:text-primary-700 font-semibold underline">
            Trading Dashboard
          </Link>{' '}
          to view your assigned tasks and start practicing!
        </p>
      </div>
    </div>
  );
}

