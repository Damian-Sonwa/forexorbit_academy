/**
 * MarketSignal Component
 * Displays live Forex market signals
 */

import { useEffect, useState } from 'react';
import { useSocket } from '@/hooks/useSocket';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function MarketSignal() {
  const { marketSignal, connected } = useSocket();
  const [signalHistory, setSignalHistory] = useState<Array<{ time: string; price: number }>>([]);

  useEffect(() => {
    if (marketSignal) {
      setSignalHistory((prev) => {
        const newHistory = [
          ...prev,
          { time: new Date(marketSignal.timestamp).toLocaleTimeString(), price: parseFloat(marketSignal.price) },
        ];
        // Keep only last 20 points
        return newHistory.slice(-20);
      });
    }
  }, [marketSignal]);

  if (!connected) {
    return (
      <div className="card">
        <h3 className="text-lg font-semibold mb-4">Market Signals</h3>
        <p className="text-gray-500 text-sm">Connecting to market data...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-gray-900">Live Market Signals</h3>
        <div className={`w-3 h-3 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
      </div>

      {marketSignal && (
        <div className="mb-6 p-4 bg-gradient-to-br from-primary-50 to-secondary-50 rounded-xl border border-primary-100">
          <div className="flex items-center justify-between mb-3">
            <span className="text-2xl font-bold text-gray-900">{marketSignal.symbol}</span>
            <span
              className={`px-4 py-1.5 rounded-full text-xs font-bold ${
                marketSignal.type === 'buy'
                  ? 'bg-green-500 text-white'
                  : 'bg-red-500 text-white'
              }`}
            >
              {marketSignal.type.toUpperCase()}
            </span>
          </div>
          <p className="text-4xl font-bold text-primary-600 mb-2">{marketSignal.price}</p>
          <p className="text-xs text-gray-500">
            {new Date(marketSignal.timestamp).toLocaleString()}
          </p>
        </div>
      )}

      {signalHistory.length > 0 && (
        <div className="h-48 bg-gray-50 rounded-xl p-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={signalHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="time" tick={{ fontSize: 10 }} stroke="#6b7280" />
              <YAxis tick={{ fontSize: 10 }} stroke="#6b7280" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'white', 
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '8px'
                }} 
              />
              <Line 
                type="monotone" 
                dataKey="price" 
                stroke="#0284c7" 
                strokeWidth={3} 
                dot={false}
                activeDot={{ r: 6, fill: '#0284c7' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {!marketSignal && signalHistory.length === 0 && (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3"></div>
          <p className="text-gray-500 text-sm font-medium">Waiting for market signals...</p>
        </div>
      )}
    </div>
  );
}

