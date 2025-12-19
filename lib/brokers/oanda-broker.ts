/**
 * OANDA Demo Broker Integration
 * Implements BaseBroker for OANDA's practice API
 * 
 * Environment Variables Required:
 * - OANDA_API_KEY: Your OANDA practice API key
 * - OANDA_ACCOUNT_ID: Optional, for account-specific operations
 * - OANDA_DEMO_URL: https://api-fxpractice.oanda.com (default)
 */

import { BaseBroker, BrokerAccount, BrokerOrder, BrokerPosition, BrokerCandle } from './base-broker';

export class OandaBroker extends BaseBroker {
  private accountId?: string;

  constructor(apiKey: string, accountId?: string) {
    const demoUrl = process.env.OANDA_DEMO_URL || 'https://api-fxpractice.oanda.com';
    super(apiKey, demoUrl, true); // Always demo mode
    this.accountId = accountId;
  }

  async createDemoAccount(studentId: string, studentEmail: string, initialBalance: number = 10000): Promise<BrokerAccount> {
    // OANDA practice accounts are created via their web interface
    // For programmatic access, we use the provided practice account
    // In production, you'd integrate with OANDA's account creation API if available
    
    // For now, we'll create a virtual account in our database
    // and use OANDA's practice API for trading operations
    
    if (!this.accountId) {
      throw new Error('OANDA account ID is required. Please set OANDA_ACCOUNT_ID environment variable.');
    }

    // Get account details from OANDA
    const account = await this.getAccount(this.accountId);
    
    return {
      accountId: `${this.accountId}_${studentId}`, // Virtual sub-account ID
      accountName: `Demo Account - ${studentEmail}`,
      balance: initialBalance,
      currency: account.currency || 'USD',
      marginAvailable: initialBalance,
      marginUsed: 0,
      openTrades: 0,
      createdAt: new Date(),
    };
  }

  async getAccount(accountId: string): Promise<BrokerAccount> {
    this.validateDemoAccount(accountId);
    
    const response = await fetch(`${this.apiUrl}/v3/accounts/${accountId}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`OANDA API error: ${response.statusText}`);
    }

    const data = await response.json();
    const account = data.account;

    return {
      accountId: account.id,
      accountName: account.alias || `Account ${account.id}`,
      balance: parseFloat(account.balance),
      currency: account.currency,
      marginAvailable: parseFloat(account.marginAvailable || '0'),
      marginUsed: parseFloat(account.marginUsed || '0'),
      openTrades: parseInt(account.openTradeCount || '0'),
      createdAt: new Date(account.createdTime),
    };
  }

  async placeMarketOrder(
    accountId: string,
    instrument: string,
    units: number,
    side: 'buy' | 'sell',
    stopLoss?: number,
    takeProfit?: number
  ): Promise<BrokerOrder> {
    this.validateDemoAccount(accountId);
    
    const order = {
      order: {
        type: 'MARKET',
        instrument: instrument,
        units: side === 'buy' ? units : -units, // Negative for sell
        stopLossOnFill: stopLoss ? {
          price: stopLoss.toString(),
          timeInForce: 'GTC',
        } : undefined,
        takeProfitOnFill: takeProfit ? {
          price: takeProfit.toString(),
          timeInForce: 'GTC',
        } : undefined,
      },
    };

    const response = await fetch(`${this.apiUrl}/v3/accounts/${accountId}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(order),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OANDA order error: ${error.errorMessage || response.statusText}`);
    }

    const data = await response.json();
    const orderFill = data.orderFillTransaction;

    return {
      orderId: orderFill.id,
      instrument: instrument,
      units: Math.abs(units),
      side: side,
      type: 'market',
      stopLoss: stopLoss,
      takeProfit: takeProfit,
      status: 'filled',
      createdAt: new Date(orderFill.time),
      filledAt: new Date(orderFill.time),
      fillPrice: parseFloat(orderFill.price || '0'),
    };
  }

  async placeLimitOrder(
    accountId: string,
    instrument: string,
    units: number,
    side: 'buy' | 'sell',
    price: number,
    stopLoss?: number,
    takeProfit?: number
  ): Promise<BrokerOrder> {
    this.validateDemoAccount(accountId);
    
    const order = {
      order: {
        type: 'LIMIT',
        instrument: instrument,
        units: side === 'buy' ? units : -units,
        price: price.toString(),
        stopLossOnFill: stopLoss ? {
          price: stopLoss.toString(),
          timeInForce: 'GTC',
        } : undefined,
        takeProfitOnFill: takeProfit ? {
          price: takeProfit.toString(),
          timeInForce: 'GTC',
        } : undefined,
      },
    };

    const response = await fetch(`${this.apiUrl}/v3/accounts/${accountId}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(order),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OANDA order error: ${error.errorMessage || response.statusText}`);
    }

    const data = await response.json();
    const orderCreate = data.orderCreateTransaction;

    return {
      orderId: orderCreate.id,
      instrument: instrument,
      units: Math.abs(units),
      side: side,
      type: 'limit',
      price: price,
      stopLoss: stopLoss,
      takeProfit: takeProfit,
      status: 'pending',
      createdAt: new Date(orderCreate.time),
    };
  }

  async placeStopOrder(
    accountId: string,
    instrument: string,
    units: number,
    side: 'buy' | 'sell',
    price: number,
    stopLoss?: number,
    takeProfit?: number
  ): Promise<BrokerOrder> {
    this.validateDemoAccount(accountId);
    
    const order = {
      order: {
        type: 'STOP',
        instrument: instrument,
        units: side === 'buy' ? units : -units,
        price: price.toString(),
        stopLossOnFill: stopLoss ? {
          price: stopLoss.toString(),
          timeInForce: 'GTC',
        } : undefined,
        takeProfitOnFill: takeProfit ? {
          price: takeProfit.toString(),
          timeInForce: 'GTC',
        } : undefined,
      },
    };

    const response = await fetch(`${this.apiUrl}/v3/accounts/${accountId}/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(order),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OANDA order error: ${error.errorMessage || response.statusText}`);
    }

    const data = await response.json();
    const orderCreate = data.orderCreateTransaction;

    return {
      orderId: orderCreate.id,
      instrument: instrument,
      units: Math.abs(units),
      side: side,
      type: 'stop',
      price: price,
      stopLoss: stopLoss,
      takeProfit: takeProfit,
      status: 'pending',
      createdAt: new Date(orderCreate.time),
    };
  }

  async cancelOrder(accountId: string, orderId: string): Promise<boolean> {
    this.validateDemoAccount(accountId);
    
    const response = await fetch(`${this.apiUrl}/v3/accounts/${accountId}/orders/${orderId}/cancel`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    return response.ok;
  }

  async getOpenPositions(accountId: string): Promise<BrokerPosition[]> {
    this.validateDemoAccount(accountId);
    
    const response = await fetch(`${this.apiUrl}/v3/accounts/${accountId}/openPositions`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`OANDA API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.positions.map((pos: any) => ({
      positionId: pos.id,
      instrument: pos.instrument,
      units: parseFloat(pos.long?.units || pos.short?.units || '0'),
      side: parseFloat(pos.long?.units || '0') > 0 ? 'buy' : 'sell',
      averagePrice: parseFloat(pos.long?.averagePrice || pos.short?.averagePrice || '0'),
      currentPrice: parseFloat(pos.long?.currentPrice || pos.short?.currentPrice || '0'),
      unrealizedPL: parseFloat(pos.unrealizedPL || '0'),
      stopLoss: pos.long?.stopLossOrder?.price ? parseFloat(pos.long.stopLossOrder.price) : 
                pos.short?.stopLossOrder?.price ? parseFloat(pos.short.stopLossOrder.price) : undefined,
      takeProfit: pos.long?.takeProfitOrder?.price ? parseFloat(pos.long.takeProfitOrder.price) : 
                  pos.short?.takeProfitOrder?.price ? parseFloat(pos.short.takeProfitOrder.price) : undefined,
      openedAt: new Date(pos.long?.openTime || pos.short?.openTime || Date.now()),
    }));
  }

  async closePosition(accountId: string, positionId: string): Promise<BrokerOrder> {
    this.validateDemoAccount(accountId);
    
    // Extract instrument from position ID (OANDA format)
    const positions = await this.getOpenPositions(accountId);
    const position = positions.find(p => p.positionId === positionId);
    
    if (!position) {
      throw new Error('Position not found');
    }

    const response = await fetch(`${this.apiUrl}/v3/accounts/${accountId}/positions/${position.instrument}/close`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        longUnits: position.side === 'buy' ? 'ALL' : undefined,
        shortUnits: position.side === 'sell' ? 'ALL' : undefined,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`OANDA close position error: ${error.errorMessage || response.statusText}`);
    }

    const data = await response.json();
    const closeTransaction = data.longOrderFillTransaction || data.shortOrderFillTransaction;

    return {
      orderId: closeTransaction.id,
      instrument: position.instrument,
      units: position.units,
      side: position.side === 'buy' ? 'sell' : 'buy',
      type: 'market',
      status: 'filled',
      createdAt: new Date(closeTransaction.time),
      filledAt: new Date(closeTransaction.time),
      fillPrice: parseFloat(closeTransaction.price || '0'),
    };
  }

  async getOrderHistory(accountId: string, limit: number = 100): Promise<BrokerOrder[]> {
    this.validateDemoAccount(accountId);
    
    const response = await fetch(`${this.apiUrl}/v3/accounts/${accountId}/transactions?count=${limit}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`OANDA API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.transactions
      .filter((t: any) => t.type === 'ORDER_FILL' || t.type === 'ORDER_CREATE')
      .map((t: any) => ({
        orderId: t.id,
        instrument: t.instrument,
        units: Math.abs(parseFloat(t.units || '0')),
        side: parseFloat(t.units || '0') > 0 ? 'buy' : 'sell',
        type: t.type === 'ORDER_FILL' ? 'market' : 'limit',
        status: t.type === 'ORDER_FILL' ? 'filled' : 'pending',
        createdAt: new Date(t.time),
        filledAt: t.type === 'ORDER_FILL' ? new Date(t.time) : undefined,
        fillPrice: t.type === 'ORDER_FILL' ? parseFloat(t.price || '0') : undefined,
      }));
  }

  async getPrices(instruments: string[]): Promise<Record<string, { bid: number; ask: number; time: Date }>> {
    const instrumentsParam = instruments.join(',');
    const response = await fetch(`${this.apiUrl}/v3/accounts/${this.accountId}/pricing?instruments=${instrumentsParam}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`OANDA API error: ${response.statusText}`);
    }

    const data = await response.json();
    const prices: Record<string, { bid: number; ask: number; time: Date }> = {};

    data.prices.forEach((price: any) => {
      prices[price.instrument] = {
        bid: parseFloat(price.bids[0].price),
        ask: parseFloat(price.asks[0].price),
        time: new Date(price.time),
      };
    });

    return prices;
  }

  async getCandles(
    instrument: string,
    granularity: string = 'H1',
    count: number = 100
  ): Promise<BrokerCandle[]> {
    const response = await fetch(
      `${this.apiUrl}/v3/instruments/${instrument}/candles?granularity=${granularity}&count=${count}`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`OANDA API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.candles.map((c: any) => ({
      time: new Date(c.time),
      open: parseFloat(c.mid.o),
      high: parseFloat(c.mid.h),
      low: parseFloat(c.mid.l),
      close: parseFloat(c.mid.c),
      volume: parseInt(c.volume || '0'),
    }));
  }
}

