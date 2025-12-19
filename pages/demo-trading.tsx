/**
 * Demo Trading Page
 * Students can practice trading with MetaTrader demo accounts
 * Includes guide, WebTrader iframe, tasks, and trade journal
 */

import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Header from '@/components/Header';
import Sidebar from '@/components/Sidebar';
import Footer from '@/components/Footer';
import { useAuth } from '@/hooks/useAuth';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';
import TradingInterface from '@/components/TradingInterface';

interface DemoTask {
  _id: string;
  title: string;
  description: string;
  instructions: string;
  assignedBy: string;
  assignedByName?: string;
  dueDate?: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
}

interface TradeJournalEntry {
  _id: string;
  pair: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  result: 'win' | 'loss' | 'breakeven' | 'open';
  profitLoss?: number;
  notes: string;
  taskId?: string;
  taskTitle?: string;
  createdAt: string;
}

export default function DemoTrading() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'guide' | 'trader' | 'live' | 'tasks' | 'journal'>('guide');
  const [tasks, setTasks] = useState<DemoTask[]>([]);
  const [journalEntries, setJournalEntries] = useState<TradeJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showJournalModal, setShowJournalModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<DemoTask | null>(null);
  
  // Trade journal form state
  const [journalForm, setJournalForm] = useState({
    pair: '',
    direction: 'buy' as 'buy' | 'sell',
    entryPrice: '',
    stopLoss: '',
    takeProfit: '',
    lotSize: '',
    result: 'open' as 'win' | 'loss' | 'breakeven' | 'open',
    profitLoss: '',
    notes: '',
    taskId: '',
  });

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/login');
      return;
    }
    if (!authLoading && isAuthenticated && user?.role !== 'student') {
      router.push('/dashboard');
      return;
    }
  }, [authLoading, isAuthenticated, user, router]);

  useEffect(() => {
    if (isAuthenticated && user?.role === 'student') {
      loadData();
    }
  }, [isAuthenticated, user]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [tasksData, journalData] = await Promise.all([
        apiClient.get<DemoTask[]>('/demo-trading/tasks').catch(() => []),
        apiClient.get<TradeJournalEntry[]>('/demo-trading/journal').catch(() => []),
      ]);
      setTasks(Array.isArray(tasksData) ? tasksData : []);
      setJournalEntries(Array.isArray(journalData) ? journalData : []);
    } catch (error) {
      console.error('Failed to load demo trading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      await apiClient.post(`/demo-trading/tasks/${taskId}/complete`);
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to mark task as complete');
    }
  };

  const handleSubmitJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const entryData = {
        ...journalForm,
        entryPrice: parseFloat(journalForm.entryPrice),
        stopLoss: parseFloat(journalForm.stopLoss),
        takeProfit: parseFloat(journalForm.takeProfit),
        lotSize: parseFloat(journalForm.lotSize),
        profitLoss: journalForm.profitLoss ? parseFloat(journalForm.profitLoss) : undefined,
        taskId: journalForm.taskId || undefined,
      };

      await apiClient.post('/demo-trading/journal', entryData);
      setShowJournalModal(false);
      setJournalForm({
        pair: '',
        direction: 'buy',
        entryPrice: '',
        stopLoss: '',
        takeProfit: '',
        lotSize: '',
        result: 'open',
        profitLoss: '',
        notes: '',
        taskId: '',
      });
      await loadData();
    } catch (error: any) {
      alert(error.response?.data?.error || 'Failed to save trade journal entry');
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== 'student') {
    return null;
  }

  const pendingTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed);
  const openTrades = journalEntries.filter(t => t.result === 'open');
  const closedTrades = journalEntries.filter(t => t.result !== 'open');

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />

      <div className="flex flex-1 relative overflow-hidden lg:items-start">
        <Sidebar />

        <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:ml-0 pt-14 lg:pt-6 bg-white lg:bg-gray-50 overflow-y-auto w-full">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Demo Trading</h1>
            <p className="text-gray-600">Practice trading with virtual money using MetaTrader demo accounts</p>
          </div>

          {/* Disclaimer */}
          <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-lg">
            <div className="flex">
              <div className="flex-shrink-0">
                <span className="text-2xl">⚠️</span>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">Important Disclaimer</h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p className="mb-2">
                    <strong>ForexOrbit Academy does not provide brokerage services or financial advice.</strong>
                  </p>
                  <p className="mb-2">
                    This demo trading feature is for educational purposes only. All trades are simulated using virtual money.
                  </p>
                  <p>
                    Trading forex involves substantial risk of loss. Past performance is not indicative of future results.
                    Always consult with a licensed financial advisor before making real trading decisions.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 border-b border-gray-200">
            <nav className="-mb-px flex space-x-8">
              {[
                { id: 'guide', label: '📖 Setup Guide', icon: '📖' },
                { id: 'trader', label: '💻 WebTrader', icon: '💻' },
                { id: 'live', label: '⚡ Live Trading', icon: '⚡' },
                { id: 'tasks', label: '📋 Tasks', icon: '📋' },
                { id: 'journal', label: '📊 Trade Journal', icon: '📊' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm ${
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6">
            {/* Setup Guide Tab */}
            {activeTab === 'guide' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">MetaTrader Demo Account Setup Guide</h2>
                
                <div className="prose max-w-none">
                  <section className="mb-8">
                    <h3 className="text-xl font-semibold mb-4 text-gray-900">Step 1: Choose Your Platform</h3>
                    <p className="text-gray-700 mb-4">
                      MetaTrader offers two platforms: MT4 (MetaTrader 4) and MT5 (MetaTrader 5). 
                      Both are excellent for learning, but MT5 has more features and is the newer version.
                    </p>
                    <div className="grid md:grid-cols-2 gap-4 mb-4">
                      <div className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-semibold mb-2">MetaTrader 4 (MT4)</h4>
                        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                          <li>Most popular platform</li>
                          <li>Simpler interface</li>
                          <li>Great for beginners</li>
                          <li>Widely supported by brokers</li>
                        </ul>
                      </div>
                      <div className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-semibold mb-2">MetaTrader 5 (MT5)</h4>
                        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                          <li>More advanced features</li>
                          <li>Better charting tools</li>
                          <li>More timeframes</li>
                          <li>Enhanced backtesting</li>
                        </ul>
                      </div>
                    </div>
                  </section>

                  <section className="mb-8">
                    <h3 className="text-xl font-semibold mb-4 text-gray-900">Step 2: Create a Demo Account</h3>
                    <div className="space-y-4">
                      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded">
                        <h4 className="font-semibold mb-2">Option A: WebTrader (Recommended for Beginners)</h4>
                        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                          <li>Visit a reputable broker's website (e.g., IC Markets, FXTM, XM)</li>
                          <li>Look for "Open Demo Account" or "Try Demo" button</li>
                          <li>Fill in your details (name, email, phone)</li>
                          <li>Choose your demo account settings:
                            <ul className="list-disc list-inside ml-4 mt-1">
                              <li>Account type: Demo</li>
                              <li>Leverage: 1:100 or 1:500 (for practice)</li>
                              <li>Initial balance: $10,000 - $50,000 (virtual money)</li>
                              <li>Base currency: USD</li>
                            </ul>
                          </li>
                          <li>Submit the form and check your email for login credentials</li>
                          <li>Use the WebTrader link provided or download the desktop/mobile app</li>
                        </ol>
                      </div>

                      <div className="bg-green-50 border-l-4 border-green-400 p-4 rounded">
                        <h4 className="font-semibold mb-2">Option B: Mobile Apps (MT4/MT5)</h4>
                        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
                          <li>Download MetaTrader 4 or MetaTrader 5 from:
                            <ul className="list-disc list-inside ml-4 mt-1">
                              <li>iOS: App Store</li>
                              <li>Android: Google Play Store</li>
                            </ul>
                          </li>
                          <li>Open the app and tap "Open an Account"</li>
                          <li>Search for your broker or select "Demo"</li>
                          <li>Fill in the registration form</li>
                          <li>You'll receive demo account credentials instantly</li>
                          <li>Log in and start trading!</li>
                        </ol>
                      </div>
                    </div>
                  </section>

                  <section className="mb-8">
                    <h3 className="text-xl font-semibold mb-4 text-gray-900">Step 3: Access Your Demo Account</h3>
                    <div className="space-y-4">
                      <div className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-semibold mb-2">WebTrader Access</h4>
                        <p className="text-sm text-gray-700 mb-2">
                          Most brokers provide a WebTrader link. Simply click the link, enter your demo account credentials, 
                          and you can trade directly in your browser - no download required!
                        </p>
                        <p className="text-sm text-gray-600 italic">
                          💡 Tip: Use the WebTrader tab above to access your broker's WebTrader if they provide an embeddable version.
                        </p>
                      </div>

                      <div className="border border-gray-200 rounded-lg p-4">
                        <h4 className="font-semibold mb-2">Desktop/Mobile App Access</h4>
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
                  </section>

                  <section className="mb-8">
                    <h3 className="text-xl font-semibold mb-4 text-gray-900">Step 4: Start Practicing</h3>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <p className="text-sm text-gray-700 mb-3">
                        Now that you have a demo account, here's what to do next:
                      </p>
                      <ul className="list-disc list-inside space-y-2 text-sm text-gray-700">
                        <li>Check your assigned tasks from instructors in the "Tasks" tab</li>
                        <li>Practice placing trades with different currency pairs</li>
                        <li>Learn to set stop loss and take profit levels</li>
                        <li>Log your trades in the "Trade Journal" tab</li>
                        <li>Review your performance and learn from each trade</li>
                      </ul>
                    </div>
                  </section>

                  <section className="mb-8">
                    <h3 className="text-xl font-semibold mb-4 text-gray-900">Important Notes</h3>
                    <div className="space-y-3 text-sm text-gray-700">
                      <div className="flex items-start">
                        <span className="mr-2">✅</span>
                        <p><strong>Demo accounts use virtual money</strong> - you cannot lose real money, but you also cannot withdraw profits.</p>
                      </div>
                      <div className="flex items-start">
                        <span className="mr-2">✅</span>
                        <p><strong>Demo accounts expire</strong> - typically after 30 days. You can create a new one anytime.</p>
                      </div>
                      <div className="flex items-start">
                        <span className="mr-2">✅</span>
                        <p><strong>Market conditions may differ</strong> - demo accounts sometimes have different spreads and execution speeds than live accounts.</p>
                      </div>
                      <div className="flex items-start">
                        <span className="mr-2">✅</span>
                        <p><strong>Practice makes perfect</strong> - use demo accounts to test strategies, learn the platform, and build confidence before trading with real money.</p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* WebTrader Tab */}
            {activeTab === 'trader' && (
              <div className="space-y-6">
                <h2 className="text-2xl font-bold text-gray-900">MetaTrader WebTrader</h2>
                <p className="text-gray-600">
                  Access your broker's WebTrader platform directly in your browser. 
                  If your broker provides an embeddable WebTrader, you can access it here.
                </p>
                
                <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                  <p className="text-gray-600 mb-4">
                    To use WebTrader, you need to:
                  </p>
                  <ol className="list-decimal list-inside space-y-2 text-left max-w-md mx-auto text-sm text-gray-700 mb-6">
                    <li>Create a demo account with a broker that supports WebTrader</li>
                    <li>Get your WebTrader URL from your broker</li>
                    <li>Contact your instructor if you need help setting this up</li>
                  </ol>
                  
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                    <p className="text-sm text-blue-800">
                      <strong>Alternative:</strong> Use the mobile apps (MT4/MT5) or desktop platform. 
                      Most brokers provide download links and setup instructions.
                    </p>
                  </div>

                  {/* Deep Links to Mobile Apps */}
                  <div className="grid md:grid-cols-2 gap-4 max-w-2xl mx-auto mt-6">
                    <a
                      href="https://apps.apple.com/app/metatrader-4/id496212596"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors"
                    >
                      <span>📱</span>
                      <span>Download MT4 (iOS)</span>
                    </a>
                    <a
                      href="https://play.google.com/store/apps/details?id=net.metaquotes.metatrader4"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg transition-colors"
                    >
                      <span>📱</span>
                      <span>Download MT4 (Android)</span>
                    </a>
                    <a
                      href="https://apps.apple.com/app/metatrader-5/id413251709"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center space-x-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg transition-colors"
                    >
                      <span>📱</span>
                      <span>Download MT5 (iOS)</span>
                    </a>
                    <a
                      href="https://play.google.com/store/apps/details?id=net.metaquotes.metatrader5"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center space-x-2 bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg transition-colors"
                    >
                      <span>📱</span>
                      <span>Download MT5 (Android)</span>
                    </a>
                  </div>
                </div>

                {/* Iframe placeholder - can be configured with broker WebTrader URL */}
                <div className="mt-6">
                  <p className="text-sm text-gray-500 mb-2">
                    If your broker provides a WebTrader embed URL, it can be displayed here.
                    Contact your instructor for configuration.
                  </p>
                </div>
              </div>
            )}

            {/* Live Trading Tab */}
            {activeTab === 'live' && (
              <div className="space-y-6">
                <div className="mb-6 bg-red-50 border-l-4 border-red-400 p-4 rounded-lg">
                  <div className="flex">
                    <div className="flex-shrink-0">
                      <span className="text-2xl">⚠️</span>
                    </div>
                    <div className="ml-3">
                      <h3 className="text-sm font-medium text-red-800">Critical Security Notice</h3>
                      <div className="mt-2 text-sm text-red-700">
                        <p className="mb-2">
                          <strong>This is a DEMO trading interface using paper trading only.</strong>
                        </p>
                        <p className="mb-2">
                          • All trades are executed in demo/paper trading mode with virtual money
                        </p>
                        <p className="mb-2">
                          • No real money can be deposited, traded, or withdrawn
                        </p>
                        <p className="mb-2">
                          • ForexOrbit Academy does not provide brokerage services
                        </p>
                        <p>
                          • This feature is for educational purposes only. Trading involves substantial risk.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <TradingInterface />
              </div>
            )}

            {/* Tasks Tab */}
            {activeTab === 'tasks' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-gray-900">Demo Trading Tasks</h2>
                  <button
                    onClick={() => setShowTaskModal(true)}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium"
                  >
                    View Task Details
                  </button>
                </div>

                {loading ? (
                  <p className="text-gray-500">Loading tasks...</p>
                ) : (
                  <>
                    {/* Pending Tasks */}
                    {pendingTasks.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Pending Tasks</h3>
                        <div className="space-y-4">
                          {pendingTasks.map((task) => (
                            <div key={task._id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                              <div className="flex justify-between items-start mb-2">
                                <div className="flex-1">
                                  <h4 className="font-semibold text-gray-900 mb-1">{task.title}</h4>
                                  <p className="text-sm text-gray-600 mb-2">{task.description}</p>
                                  {task.instructions && (
                                    <div className="bg-blue-50 border-l-4 border-blue-400 p-3 rounded mb-2">
                                      <p className="text-sm text-gray-700 whitespace-pre-line">{task.instructions}</p>
                                    </div>
                                  )}
                                  <div className="flex items-center space-x-4 text-xs text-gray-500 mt-2">
                                    <span>Assigned by: {task.assignedByName || 'Instructor'}</span>
                                    {task.dueDate && (
                                      <span>Due: {format(new Date(task.dueDate), 'MMM dd, yyyy')}</span>
                                    )}
                                    <span>Created: {format(new Date(task.createdAt), 'MMM dd, yyyy')}</span>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleCompleteTask(task._id)}
                                  className="ml-4 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium"
                                >
                                  Mark Complete
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Completed Tasks */}
                    {completedTasks.length > 0 && (
                      <div className="mt-6">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Completed Tasks</h3>
                        <div className="space-y-4">
                          {completedTasks.map((task) => (
                            <div key={task._id} className="border border-gray-200 rounded-lg p-4 bg-gray-50 opacity-75">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <div className="flex items-center space-x-2 mb-1">
                                    <h4 className="font-semibold text-gray-900">{task.title}</h4>
                                    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Completed</span>
                                  </div>
                                  <p className="text-sm text-gray-600">{task.description}</p>
                                  {task.completedAt && (
                                    <p className="text-xs text-gray-500 mt-2">
                                      Completed on: {format(new Date(task.completedAt), 'MMM dd, yyyy HH:mm')}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {tasks.length === 0 && (
                      <div className="text-center py-12">
                        <p className="text-gray-500 mb-4">No tasks assigned yet.</p>
                        <p className="text-sm text-gray-400">Your instructor will assign practice tasks here.</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Trade Journal Tab */}
            {activeTab === 'journal' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-bold text-gray-900">Trade Journal</h2>
                  <button
                    onClick={() => setShowJournalModal(true)}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium"
                  >
                    + Add Trade
                  </button>
                </div>

                {loading ? (
                  <p className="text-gray-500">Loading journal entries...</p>
                ) : (
                  <>
                    {/* Open Trades */}
                    {openTrades.length > 0 && (
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Open Trades</h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pair</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">SL</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">TP</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Lot Size</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {openTrades.map((trade) => (
                                <tr key={trade._id}>
                                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{trade.pair}</td>
                                  <td className="px-4 py-3 text-sm">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      trade.direction === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                    }`}>
                                      {trade.direction.toUpperCase()}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-900">{trade.entryPrice}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900">{trade.stopLoss}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900">{trade.takeProfit}</td>
                                  <td className="px-4 py-3 text-sm text-gray-900">{trade.lotSize}</td>
                                  <td className="px-4 py-3 text-sm text-gray-500">{format(new Date(trade.createdAt), 'MMM dd, yyyy')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Closed Trades */}
                    {closedTrades.length > 0 && (
                      <div className={openTrades.length > 0 ? 'mt-6' : ''}>
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Closed Trades</h3>
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Pair</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Direction</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Result</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">P/L</th>
                                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                              </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-gray-200">
                              {closedTrades.map((trade) => (
                                <tr key={trade._id}>
                                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{trade.pair}</td>
                                  <td className="px-4 py-3 text-sm">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      trade.direction === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                                    }`}>
                                      {trade.direction.toUpperCase()}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-900">{trade.entryPrice}</td>
                                  <td className="px-4 py-3 text-sm">
                                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                                      trade.result === 'win' ? 'bg-green-100 text-green-800' :
                                      trade.result === 'loss' ? 'bg-red-100 text-red-800' :
                                      'bg-gray-100 text-gray-800'
                                    }`}>
                                      {trade.result.toUpperCase()}
                                    </span>
                                  </td>
                                  <td className={`px-4 py-3 text-sm font-medium ${
                                    trade.profitLoss && trade.profitLoss > 0 ? 'text-green-600' :
                                    trade.profitLoss && trade.profitLoss < 0 ? 'text-red-600' : 'text-gray-900'
                                  }`}>
                                    {trade.profitLoss !== undefined ? `$${trade.profitLoss.toFixed(2)}` : '-'}
                                  </td>
                                  <td className="px-4 py-3 text-sm text-gray-500">{format(new Date(trade.createdAt), 'MMM dd, yyyy')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {journalEntries.length === 0 && (
                      <div className="text-center py-12">
                        <p className="text-gray-500 mb-4">No trades logged yet.</p>
                        <button
                          onClick={() => setShowJournalModal(true)}
                          className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium"
                        >
                          Log Your First Trade
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Trade Journal Modal */}
      {showJournalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Log Trade</h2>
                <button
                  onClick={() => {
                    setShowJournalModal(false);
                    setJournalForm({
                      pair: '',
                      direction: 'buy',
                      entryPrice: '',
                      stopLoss: '',
                      takeProfit: '',
                      lotSize: '',
                      result: 'open',
                      profitLoss: '',
                      notes: '',
                      taskId: '',
                    });
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSubmitJournal} className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Currency Pair *</label>
                    <input
                      type="text"
                      required
                      value={journalForm.pair}
                      onChange={(e) => setJournalForm({ ...journalForm, pair: e.target.value.toUpperCase() })}
                      placeholder="EUR/USD"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Direction *</label>
                    <select
                      required
                      value={journalForm.direction}
                      onChange={(e) => setJournalForm({ ...journalForm, direction: e.target.value as 'buy' | 'sell' })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    >
                      <option value="buy">Buy (Long)</option>
                      <option value="sell">Sell (Short)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Entry Price *</label>
                    <input
                      type="number"
                      required
                      step="0.00001"
                      value={journalForm.entryPrice}
                      onChange={(e) => setJournalForm({ ...journalForm, entryPrice: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Stop Loss *</label>
                    <input
                      type="number"
                      required
                      step="0.00001"
                      value={journalForm.stopLoss}
                      onChange={(e) => setJournalForm({ ...journalForm, stopLoss: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Take Profit *</label>
                    <input
                      type="number"
                      required
                      step="0.00001"
                      value={journalForm.takeProfit}
                      onChange={(e) => setJournalForm({ ...journalForm, takeProfit: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Lot Size *</label>
                    <input
                      type="number"
                      required
                      step="0.01"
                      value={journalForm.lotSize}
                      onChange={(e) => setJournalForm({ ...journalForm, lotSize: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Result *</label>
                    <select
                      required
                      value={journalForm.result}
                      onChange={(e) => setJournalForm({ ...journalForm, result: e.target.value as any })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    >
                      <option value="open">Open</option>
                      <option value="win">Win</option>
                      <option value="loss">Loss</option>
                      <option value="breakeven">Breakeven</option>
                    </select>
                  </div>

                  {journalForm.result !== 'open' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Profit/Loss ($)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={journalForm.profitLoss}
                        onChange={(e) => setJournalForm({ ...journalForm, profitLoss: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                      />
                    </div>
                  )}

                  {pendingTasks.length > 0 && (
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Related Task (Optional)</label>
                      <select
                        value={journalForm.taskId}
                        onChange={(e) => setJournalForm({ ...journalForm, taskId: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                      >
                        <option value="">None</option>
                        {pendingTasks.map((task) => (
                          <option key={task._id} value={task._id}>{task.title}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                  <textarea
                    value={journalForm.notes}
                    onChange={(e) => setJournalForm({ ...journalForm, notes: e.target.value })}
                    rows={4}
                    placeholder="What did you learn from this trade? Any observations?"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setShowJournalModal(false);
                      setJournalForm({
                        pair: '',
                        direction: 'buy',
                        entryPrice: '',
                        stopLoss: '',
                        takeProfit: '',
                        lotSize: '',
                        result: 'open',
                        profitLoss: '',
                        notes: '',
                        taskId: '',
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
                    Save Trade
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

