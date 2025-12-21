/**
 * Demo Tasks Tabs Component
 * Main tab container for Demo Tasks management
 */

import { useState, ReactNode, createContext, useContext } from 'react';

type TabType = 'create' | 'submissions' | 'review';

interface DemoTasksTabsContextType {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

const DemoTasksTabsContext = createContext<DemoTasksTabsContextType | undefined>(undefined);

export function useDemoTasksTabs() {
  const context = useContext(DemoTasksTabsContext);
  if (!context) {
    throw new Error('useDemoTasksTabs must be used within DemoTasksTabs');
  }
  return context;
}

interface DemoTasksTabsProps {
  children: {
    create: ReactNode;
    submissions: ReactNode;
    review: ReactNode;
  };
}

export default function DemoTasksTabs({ children }: DemoTasksTabsProps) {
  const [activeTab, setActiveTab] = useState<TabType>('create');

  const tabs = [
    { id: 'create' as const, label: 'Create Task', icon: '➕' },
    { id: 'submissions' as const, label: 'Submissions', icon: '📋' },
    { id: 'review' as const, label: 'Review / Feedback', icon: '✏️' },
  ];

  return (
    <DemoTasksTabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="w-full">
        {/* Tabs Navigation */}
        <div className="border-b border-gray-200 dark:border-gray-700 mb-6">
          <nav className="flex space-x-8" aria-label="Tabs">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`
                  py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    activeTab === tab.id
                      ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
                  }
                `}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        <div className="mt-6">
          {activeTab === 'create' && <div className="tab-content">{children.create}</div>}
          {activeTab === 'submissions' && <div className="tab-content">{children.submissions}</div>}
          {activeTab === 'review' && <div className="tab-content">{children.review}</div>}
        </div>
      </div>
    </DemoTasksTabsContext.Provider>
  );
}

