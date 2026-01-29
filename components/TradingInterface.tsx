/**
 * Trading Interface Component
 * Allows students to place orders and manage positions via broker API
 */

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { format } from 'date-fns';

interface BrokerAccount {
  accountId: string;
  accountName: string;
  balance: number;
  currency: string;
  marginAvailable?: number;
  marginUsed?: number;
  openTrades?: number;
}

interface BrokerPosition {
  positionId: string;
  instrument: string;
  units: number;
  side: 'buy' | 'sell';
  averagePrice: number;
  currentPrice: number;
  unrealizedPL: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt: Date;
}

interface BrokerOrder {
  orderId: string;
  instrument: string;
  units: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';
  price?: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  createdAt: Date;
}

interface PerformanceMetrics {
  totalTrades: number;
  winRate: number;
  netProfit: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  riskRewardRatio: number;
  consistencyScore: number;
  riskManagementScore: number;
}

export default function TradingInterface() {
  const [account, setAccount] = useState<BrokerAccount | null>(null);
  const [positions, setPositions] = useState<BrokerPosition[]>([]);
  const [orderHistory, setOrderHistory] = useState<BrokerOrder[]>([]);
  const [performance, setPerformance] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [orderForm, setOrderForm] = useState({
    orderType: 'market' as 'market' | 'limit' | 'stop',
    instrument: 'EUR_USD',
    units: '',
    side: 'buy' as 'buy' | 'sell',
    price: '',
    stopLoss: '',
    takeProfit: '',
  });
  const [prices, setPrices] = useState<Record<string, { bid: number; ask: number }>>({});
  const [submitting, setSubmitting] = useState(false);

  const popularPairs = [
    { value: 'EUR_USD', label: 'EUR/USD' },
    { value: 'GBP_USD', label: 'GBP/USD' },
    { value: 'USD_JPY', label: 'USD/JPY' },
    { value: 'AUD_USD', label: 'AUD/USD' },
    { value: 'USD_CAD', label: 'USD/CAD' },
    { value: 'USD_CHF', label: 'USD/CHF' },
  ];

  const loadPrices = useCallback(async () => {
    try {
      const instruments = popularPairs.map(p => p.value);
      // This would call a prices API endpoint
      // For now, we'll use mock data structure
      const mockPrices: Record<string, { bid: number; ask: number }> = {};
      instruments.forEach(instrument => {
        mockPrices[instrument] = {
          bid: 1.0 + Math.random() * 0.1,
          ask: 1.0 + Math.random() * 0.1 + 0.0001,
        };
      });
      setPrices(mockPrices);
    } catch (error) {
      console.error('Failed to load prices:', error);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [accountData, tradesData, performanceData] = await Promise.all([
        apiClient.get<BrokerAccount>('/demo-trading/account').catch(() => null),
        apiClient.get<{ openPositions: BrokerPosition[]; orderHistory: BrokerOrder[] }>('/demo-trading/trades').catch(() => ({ openPositions: [], orderHistory: [] })),
        apiClient.get<PerformanceMetrics>('/demo-trading/performance').catch(() => null),
      ]);

      if (accountData) {
        setAccount(accountData);
        loadPrices();
      }
      if (tradesData) {
        setPositions(tradesData.openPositions || []);
        setOrderHistory(tradesData.orderHistory || []);
      }
      if (performanceData) {
        setPerformance(performanceData);
      }
    } catch (error) {
      console.error('Failed to load trading data:', error);
    } finally {
      setLoading(false);
    }
  }, [loadPrices]);

  useEffect(() => {
    loadData();
    // Refresh prices every 5 seconds
    const priceInterval = setInterval(() => {
      if (account) {
        loadPrices();
      }
    }, 5000);
    return () => clearInterval(priceInterval);
  }, [account, loadData, loadPrices]);

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      await apiClient.post('/demo-trading/trades', orderForm);
      setShowOrderModal(false);
      setOrderForm({
        orderType: 'market',
        instrument: 'EUR_USD',
        units: '',
        side: 'buy',
        price: '',
        stopLoss: '',
        takeProfit: '',
      });
      await loadData();
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to place order'
        : 'Failed to place order';
      alert(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClosePosition = async (positionId: string) => {
    if (!confirm('Are you sure you want to close this position?')) {
      return;
    }

    try {
      await apiClient.post(`/demo-trading/positions/${positionId}/close`);
      await loadData();
    } catch (error) {
      const errorMessage = error && typeof error === 'object' && 'response' in error
        ? (error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to close position'
        : 'Failed to close position';
      alert(errorMessage);
    }
  };

  if (loading) {
    return <div className="text-center py-8">Loading trading interface...</div>;
  }

  if (!account) {
    return (
      <div className="text-center py-12 space-y-6">
        <div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">Create Your Demo Trading Account</h3>
          <p className="text-gray-600 mb-6">
            Choose a broker to create your demo account. All accounts use virtual money for practice.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4 max-w-2xl mx-auto">
          {/* OANDA Option */}
          <div className="border-2 border-blue-200 rounded-xl p-6 bg-blue-50 hover:bg-blue-100 transition-colors">
            <div className="mb-4">
              <h4 className="text-lg font-bold text-gray-900 mb-2">OANDA Demo Account</h4>
              <p className="text-sm text-gray-600 mb-4">
                Create a free practice account with OANDA. Perfect for API integration and real market data.
              </p>
            </div>
            <a
              href="https://hub.oanda.com/apply/demo/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-center transition-colors"
            >
              Create OANDA Demo Account →
            </a>
            <p className="text-xs text-gray-500 mt-2">
              Opens in new tab
            </p>
          </div>

          {/* MetaTrader Option */}
          <div className="border-2 border-green-200 rounded-xl p-6 bg-green-50 hover:bg-green-100 transition-colors">
            <div className="mb-4">
              <h4 className="text-lg font-bold text-gray-900 mb-2">MetaTrader Demo Account</h4>
              <p className="text-sm text-gray-600 mb-4">
                Create a MetaTrader 4 or 5 demo account with any supported broker.
              </p>
            </div>
            <a
              href="https://www.metatrader4.com/en/download"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-center transition-colors mb-2"
            >
              Download MT4/MT5 →
            </a>
            <p className="text-xs text-gray-500">
              Then create demo account in platform
            </p>
          </div>
        </div>

        {/* Alternative: API-based account (if configured) */}
        {process.env.NEXT_PUBLIC_BROKER_API_ENABLED === 'true' && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-600 mb-3">Or create an account via our API:</p>
            <button
              onClick={async () => {
                try {
                  await apiClient.post('/demo-trading/account', { initialBalance: 10000 });
                  await loadData();
                } catch (error) {
                  const errorMessage = error && typeof error === 'object' && 'response' in error
                    ? (error as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to create account'
                    : 'Failed to create account';
                  alert(errorMessage);
                }
              }}
              className="px-6 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg font-medium"
            >
              Create Account via API
            </button>
          </div>
        )}

        <div className="mt-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
          <p className="text-sm text-yellow-800">
            <strong>Note:</strong> After creating your demo account, you can use it to practice trading. 
            If you&apos;ve already created an account, make sure you&apos;re logged in to the broker&apos;s platform.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Account Summary */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl p-6 text-white">
        <h2 className="text-2xl font-bold mb-4">Account Summary</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-blue-100 text-sm">Balance</p>
            <p className="text-2xl font-bold">{account.currency} {account.balance.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-blue-100 text-sm">Margin Available</p>
            <p className="text-2xl font-bold">{account.currency} {(account.marginAvailable || 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-blue-100 text-sm">Margin Used</p>
            <p className="text-2xl font-bold">{account.currency} {(account.marginUsed || 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-blue-100 text-sm">Open Positions</p>
            <p className="text-2xl font-bold">{account.openTrades || 0}</p>
          </div>
        </div>
      </div>

      {/* Performance Metrics */}
      {performance && (
        <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Performance Metrics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-gray-600 text-sm">Win Rate</p>
              <p className="text-2xl font-bold text-green-600">{performance.winRate.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-gray-600 text-sm">Net Profit</p>
              <p className={`text-2xl font-bold ${performance.netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                ${performance.netProfit.toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-gray-600 text-sm">Max Drawdown</p>
              <p className="text-2xl font-bold text-red-600">{performance.maxDrawdownPercent.toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-gray-600 text-sm">Risk/Reward</p>
              <p className="text-2xl font-bold text-gray-900">{performance.riskRewardRatio.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-gray-600 text-sm">Consistency</p>
              <p className="text-2xl font-bold text-blue-600">{performance.consistencyScore.toFixed(0)}</p>
            </div>
            <div>
              <p className="text-gray-600 text-sm">Risk Management</p>
              <p className="text-2xl font-bold text-purple-600">{performance.riskManagementScore.toFixed(0)}</p>
            </div>
          </div>
        </div>
      )}

      {/* Place Order Button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowOrderModal(true)}
          className="px-6 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium shadow-md"
        >
          + Place Order
        </button>
      </div>

      {/* Open Positions */}
      {positions.length > 0 && (
        <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Open Positions</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instrument</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Side</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Units</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Current</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">P/L</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {positions.map((position) => (
                  <tr key={position.positionId}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{position.instrument}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        position.side === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {position.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{position.units}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{position.averagePrice.toFixed(5)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{position.currentPrice.toFixed(5)}</td>
                    <td className={`px-4 py-3 text-sm font-medium ${
                      position.unrealizedPL >= 0 ? 'text-green-600' : 'text-red-600'
                    }`}>
                      ${position.unrealizedPL.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        onClick={() => handleClosePosition(position.positionId)}
                        className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium"
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Order History */}
      {orderHistory.length > 0 && (
        <div className="bg-white rounded-xl shadow-md border border-gray-100 p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Recent Orders</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Instrument</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Side</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Units</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orderHistory.slice(0, 10).map((order) => (
                  <tr key={order.orderId}>
                    <td className="px-4 py-3 text-sm text-gray-500">{format(new Date(order.createdAt), 'MMM dd, HH:mm')}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{order.instrument}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">{order.type}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        order.side === 'buy' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {order.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">{order.units}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        order.status === 'filled' ? 'bg-green-100 text-green-800' :
                        order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {order.status.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Place Order Modal */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Place Order</h2>
                <button
                  onClick={() => setShowOrderModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handlePlaceOrder} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Order Type *</label>
                  <select
                    required
                    value={orderForm.orderType}
                    onChange={(e) => setOrderForm({ ...orderForm, orderType: e.target.value as 'market' | 'limit' | 'stop' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                  >
                    <option value="market">Market</option>
                    <option value="limit">Limit</option>
                    <option value="stop">Stop</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Instrument *</label>
                  <select
                    required
                    value={orderForm.instrument}
                    onChange={(e) => setOrderForm({ ...orderForm, instrument: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                  >
                    {popularPairs.map((pair) => (
                      <option key={pair.value} value={pair.value}>
                        {pair.label} {prices[pair.value] && `(${prices[pair.value].bid.toFixed(5)})`}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Side *</label>
                  <select
                    required
                    value={orderForm.side}
                    onChange={(e) => setOrderForm({ ...orderForm, side: e.target.value as 'buy' | 'sell' })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                  >
                    <option value="buy">Buy (Long)</option>
                    <option value="sell">Sell (Short)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Units *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    step="1"
                    value={orderForm.units}
                    onChange={(e) => setOrderForm({ ...orderForm, units: e.target.value })}
                    placeholder="1000"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                  />
                </div>

                {orderForm.orderType !== 'market' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Price *</label>
                    <input
                      type="number"
                      required
                      step="0.00001"
                      value={orderForm.price}
                      onChange={(e) => setOrderForm({ ...orderForm, price: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stop Loss (Optional)</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={orderForm.stopLoss}
                    onChange={(e) => setOrderForm({ ...orderForm, stopLoss: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Take Profit (Optional)</label>
                  <input
                    type="number"
                    step="0.00001"
                    value={orderForm.takeProfit}
                    onChange={(e) => setOrderForm({ ...orderForm, takeProfit: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 bg-white"
                  />
                </div>

                <div className="flex justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowOrderModal(false)}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50"
                  >
                    {submitting ? 'Placing...' : 'Place Order'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

