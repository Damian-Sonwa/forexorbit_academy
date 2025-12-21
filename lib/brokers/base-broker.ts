/**
 * Base Broker Interface
 * Abstract class for broker API integrations
 * Ensures modular architecture - brokers can be swapped easily
 */

export interface BrokerAccount {
  accountId: string;
  accountName: string;
  balance: number;
  currency: string;
  marginAvailable?: number;
  marginUsed?: number;
  openTrades?: number;
  createdAt: Date;
}

export interface BrokerOrder {
  orderId: string;
  instrument: string;
  units: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop';
  price?: number;
  stopLoss?: number;
  takeProfit?: number;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  createdAt: Date;
  filledAt?: Date;
  fillPrice?: number;
}

export interface BrokerPosition {
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

export interface BrokerCandle {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  averageWin: number;
  averageLoss: number;
  largestWin: number;
  largestLoss: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  riskRewardRatio: number;
  consistencyScore: number; // 0-100
  riskManagementScore: number; // 0-100
}

export abstract class BaseBroker {
  protected apiKey: string;
  protected apiUrl: string;
  protected isDemo: boolean;

  constructor(apiKey: string, apiUrl: string, isDemo: boolean = true) {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.isDemo = isDemo;
    
    // CRITICAL: Ensure this is always demo mode
    if (!isDemo) {
      throw new Error('Real trading is not allowed. Only demo accounts are permitted.');
    }
  }

  /**
   * Create a demo account for a student
   */
  abstract createDemoAccount(studentId: string, studentEmail: string, initialBalance?: number): Promise<BrokerAccount>;

  /**
   * Get account details
   */
  abstract getAccount(accountId: string): Promise<BrokerAccount>;

  /**
   * Place a market order
   */
  abstract placeMarketOrder(
    accountId: string,
    instrument: string,
    units: number,
    side: 'buy' | 'sell',
    stopLoss?: number,
    takeProfit?: number
  ): Promise<BrokerOrder>;

  /**
   * Place a limit order
   */
  abstract placeLimitOrder(
    accountId: string,
    instrument: string,
    units: number,
    side: 'buy' | 'sell',
    price: number,
    stopLoss?: number,
    takeProfit?: number
  ): Promise<BrokerOrder>;

  /**
   * Place a stop order
   */
  abstract placeStopOrder(
    accountId: string,
    instrument: string,
    units: number,
    side: 'buy' | 'sell',
    price: number,
    stopLoss?: number,
    takeProfit?: number
  ): Promise<BrokerOrder>;

  /**
   * Cancel an order
   */
  abstract cancelOrder(accountId: string, orderId: string): Promise<boolean>;

  /**
   * Get open positions
   */
  abstract getOpenPositions(accountId: string): Promise<BrokerPosition[]>;

  /**
   * Close a position
   */
  abstract closePosition(accountId: string, positionId: string): Promise<BrokerOrder>;

  /**
   * Get order history
   */
  abstract getOrderHistory(accountId: string, limit?: number): Promise<BrokerOrder[]>;

  /**
   * Get current prices for instruments
   */
  abstract getPrices(instruments: string[]): Promise<Record<string, { bid: number; ask: number; time: Date }>>;

  /**
   * Get historical candles
   */
  abstract getCandles(
    instrument: string,
    granularity: string,
    count: number
  ): Promise<BrokerCandle[]>;

  /**
   * Validate that this is a demo account (security check)
   */
  protected validateDemoAccount(_accountId: string): void {
    // Each broker implementation should validate account is demo
    if (!this.isDemo) {
      throw new Error('Only demo accounts are allowed');
    }
  }
}


