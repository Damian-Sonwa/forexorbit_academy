/**
 * Performance Metrics Calculator
 * Calculates trading performance metrics from trade history
 */

import { BrokerOrder, PerformanceMetrics } from './brokers/base-broker';

export class PerformanceMetricsCalculator {
  /**
   * Calculate performance metrics from closed trades
   */
  static calculate(orders: BrokerOrder[]): PerformanceMetrics {
    // Filter only filled orders (closed trades)
    const closedTrades = orders.filter(
      o => o.status === 'filled' && o.fillPrice && o.filledAt
    );

    if (closedTrades.length === 0) {
      return this.getEmptyMetrics();
    }

    // Calculate P/L for each trade
    const tradeResults = closedTrades.map((trade) => {
      // For simplicity, we'll use a mock P/L calculation
      // In real implementation, you'd track actual entry/exit prices
      const entryPrice = trade.fillPrice || 0;
      const exitPrice = trade.fillPrice || 0; // This would come from closing trade
      const units = trade.units;
      const profitLoss = trade.side === 'buy' 
        ? (exitPrice - entryPrice) * units * 10000
        : (entryPrice - exitPrice) * units * 10000;

      return {
        profitLoss,
        isWin: profitLoss > 0,
        isLoss: profitLoss < 0,
        isBreakeven: Math.abs(profitLoss) < 0.01,
      };
    });

    const winningTrades = tradeResults.filter(t => t.isWin).length;
    const losingTrades = tradeResults.filter(t => t.isLoss).length;
    const totalTrades = tradeResults.length;

    const profits = tradeResults.filter(t => t.profitLoss > 0).map(t => t.profitLoss);
    const losses = tradeResults.filter(t => t.profitLoss < 0).map(t => Math.abs(t.profitLoss));

    const totalProfit = profits.reduce((sum, p) => sum + p, 0);
    const totalLoss = losses.reduce((sum, l) => sum + l, 0);
    const netProfit = totalProfit - totalLoss;

    const averageWin = profits.length > 0 ? totalProfit / profits.length : 0;
    const averageLoss = losses.length > 0 ? totalLoss / losses.length : 0;

    const largestWin = profits.length > 0 ? Math.max(...profits) : 0;
    const largestLoss = losses.length > 0 ? Math.max(...losses) : 0;

    // Calculate drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let maxDrawdownPercent = 0;
    let runningBalance = 0;

    tradeResults.forEach(trade => {
      runningBalance += trade.profitLoss;
      if (runningBalance > peak) {
        peak = runningBalance;
      }
      const drawdown = peak - runningBalance;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownPercent = peak > 0 ? (drawdown / peak) * 100 : 0;
      }
    });

    // Risk/Reward Ratio
    const riskRewardRatio = averageLoss > 0 ? averageWin / averageLoss : 0;

    // Consistency Score (0-100)
    // Based on win rate and consistency of results
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const consistencyScore = this.calculateConsistencyScore(tradeResults, winRate);

    // Risk Management Score (0-100)
    // Based on use of stop loss, position sizing, etc.
    const riskManagementScore = this.calculateRiskManagementScore(orders);

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate,
      totalProfit,
      totalLoss,
      netProfit,
      averageWin,
      averageLoss,
      largestWin,
      largestLoss,
      maxDrawdown,
      maxDrawdownPercent,
      riskRewardRatio,
      consistencyScore,
      riskManagementScore,
    };
  }

  private static calculateConsistencyScore(
    tradeResults: Array<{ profitLoss: number; isWin: boolean }>,
    winRate: number
  ): number {
    if (tradeResults.length === 0) return 0;

    // Calculate variance in results
    const profits = tradeResults.map(t => t.profitLoss);
    const mean = profits.reduce((sum, p) => sum + p, 0) / profits.length;
    const variance = profits.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / profits.length;
    const stdDev = Math.sqrt(variance);

    // Lower variance = higher consistency
    const consistencyFromVariance = Math.max(0, 100 - (stdDev / Math.abs(mean || 1)) * 100);

    // Combine with win rate
    return (consistencyFromVariance * 0.6 + winRate * 0.4);
  }

  private static calculateRiskManagementScore(orders: BrokerOrder[]): number {
    if (orders.length === 0) return 0;

    let score = 0;
    let factors = 0;

    // Check for stop loss usage
    const ordersWithSL = orders.filter(o => o.stopLoss !== undefined && o.stopLoss !== null).length;
    const slUsage = orders.length > 0 ? (ordersWithSL / orders.length) * 100 : 0;
    score += slUsage * 0.4;
    factors += 0.4;

    // Check for take profit usage
    const ordersWithTP = orders.filter(o => o.takeProfit !== undefined && o.takeProfit !== null).length;
    const tpUsage = orders.length > 0 ? (ordersWithTP / orders.length) * 100 : 0;
    score += tpUsage * 0.3;
    factors += 0.3;

    // Check position sizing (simplified - would need account balance)
    // For now, assume good if units are reasonable
    const avgUnits = orders.reduce((sum, o) => sum + o.units, 0) / orders.length;
    const positionSizeScore = avgUnits > 0 && avgUnits < 100000 ? 100 : 50;
    score += positionSizeScore * 0.3;
    factors += 0.3;

    return factors > 0 ? score / factors : 0;
  }

  private static getEmptyMetrics(): PerformanceMetrics {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      winRate: 0,
      totalProfit: 0,
      totalLoss: 0,
      netProfit: 0,
      averageWin: 0,
      averageLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      riskRewardRatio: 0,
      consistencyScore: 0,
      riskManagementScore: 0,
    };
  }
}

