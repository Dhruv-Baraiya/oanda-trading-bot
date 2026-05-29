import type { Candle } from '../broker/types.js';
import type { IndicatorSnapshot } from '../indicators/types.js';
import type { StrategyConfig } from '../strategies/types.js';
import { IndicatorEngine } from '../indicators/IndicatorEngine.js';
import { SignalEngine } from '../strategies/SignalEngine.js';
import type {
  BacktestConfig,
  BacktestResult,
  BacktestTrade,
  BacktestMetrics,
  EquityPoint,
} from './types.js';

const PIP_VALUES: Record<string, number> = {
  EUR_USD: 0.0001, GBP_USD: 0.0001, AUD_USD: 0.0001, NZD_USD: 0.0001,
  USD_CAD: 0.0001, USD_CHF: 0.0001, EUR_GBP: 0.0001, EUR_JPY: 0.01,
  GBP_JPY: 0.01, USD_JPY: 0.01, AUD_JPY: 0.01, CAD_JPY: 0.01,
};

interface OpenPosition {
  id: number;
  direction: 'LONG' | 'SHORT';
  entryTime: string;
  entryPrice: number;
  entryBar: number;
  units: number;
  stopLoss: number;
  takeProfit: number;
}

export class BacktestEngine {
  private indicatorEngine = new IndicatorEngine();
  private signalEngine = new SignalEngine();

  run(
    strategy: StrategyConfig,
    candles: Candle[],
    config: BacktestConfig
  ): BacktestResult {
    const pipValue = PIP_VALUES[config.instrument] ?? 0.0001;
    const spreadCost = config.spreadPips * pipValue;
    const slippageCost = config.slippagePips * pipValue;

    const indicators = this.indicatorEngine.compute(candles);

    let balance = config.initialBalance;
    let peakBalance = balance;
    let maxDrawdown = 0;
    let maxDrawdownPct = 0;
    const trades: BacktestTrade[] = [];
    const equityCurve: EquityPoint[] = [];
    const openPositions: OpenPosition[] = [];
    let tradeCounter = 0;

    const warmup = Math.max(200, 0);

    for (let i = warmup; i < candles.length; i++) {
      const candle = candles[i];
      const snapshot = indicators[i];
      const prevSnapshot = i > 0 ? indicators[i - 1] : null;

      if (!snapshot?.rsi || !snapshot?.atr) continue;

      balance = this.checkStopsAndTargets(openPositions, candle, balance, trades, spreadCost, slippageCost, pipValue);

      const signal = this.signalEngine.evaluate(strategy, snapshot, prevSnapshot);

      if (signal) {
        if ((signal.direction === 'EXIT_LONG' || signal.direction === 'EXIT_SHORT') && openPositions.length > 0) {
          const toClose = openPositions.filter(p =>
            (signal.direction === 'EXIT_LONG' && p.direction === 'LONG') ||
            (signal.direction === 'EXIT_SHORT' && p.direction === 'SHORT')
          );
          for (const pos of toClose) {
            balance = this.closePosition(pos, candle, balance, trades, 'EXIT_SIGNAL', spreadCost, slippageCost, pipValue, i);
            openPositions.splice(openPositions.indexOf(pos), 1);
          }
        }

        if ((signal.direction === 'BUY' || signal.direction === 'SELL') &&
            openPositions.length < strategy.maxOpenTrades) {
          const atrValue = snapshot.atr!.value;
          const riskAmount = balance * strategy.riskPerTrade;
          const slDistance = atrValue * strategy.stopLossATRMultiplier;
          const tpDistance = slDistance * strategy.takeProfitRatio;

          if (slDistance > 0) {
            const units = Math.floor(riskAmount / slDistance);
            if (units > 0) {
              const entryPrice = signal.direction === 'BUY'
                ? candle.close + spreadCost / 2 + slippageCost
                : candle.close - spreadCost / 2 - slippageCost;

              const stopLoss = signal.direction === 'BUY'
                ? entryPrice - slDistance
                : entryPrice + slDistance;

              const takeProfit = signal.direction === 'BUY'
                ? entryPrice + tpDistance
                : entryPrice - tpDistance;

              openPositions.push({
                id: ++tradeCounter,
                direction: signal.direction === 'BUY' ? 'LONG' : 'SHORT',
                entryTime: candle.timestamp,
                entryPrice,
                entryBar: i,
                units,
                stopLoss,
                takeProfit,
              });
            }
          }
        }
      }

      const unrealized = this.calcUnrealized(openPositions, candle, spreadCost, pipValue);
      const equity = balance + unrealized;
      if (equity > peakBalance) peakBalance = equity;
      const dd = peakBalance - equity;
      const ddPct = peakBalance > 0 ? dd / peakBalance : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
      if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

      if (i % 10 === 0 || i === candles.length - 1) {
        equityCurve.push({
          timestamp: candle.timestamp,
          equity,
          drawdown: ddPct,
        });
      }
    }

    for (const pos of [...openPositions]) {
      const lastCandle = candles[candles.length - 1];
      balance = this.closePosition(pos, lastCandle, balance, trades, 'END_OF_DATA', spreadCost, slippageCost, pipValue, candles.length - 1);
    }
    openPositions.length = 0;

    const metrics = this.calculateMetrics(trades, config.initialBalance, balance, maxDrawdown, maxDrawdownPct);

    return {
      config,
      strategyName: strategy.name,
      metrics,
      trades,
      equityCurve,
      startBalance: config.initialBalance,
      endBalance: balance,
      runAt: new Date().toISOString(),
    };
  }

  private checkStopsAndTargets(
    positions: OpenPosition[],
    candle: Candle,
    balance: number,
    trades: BacktestTrade[],
    spreadCost: number,
    slippageCost: number,
    pipValue: number
  ): number {
    const toRemove: OpenPosition[] = [];

    for (const pos of positions) {
      if (pos.direction === 'LONG') {
        if (candle.low <= pos.stopLoss) {
          balance = this.closePositionAt(pos, pos.stopLoss, candle, balance, trades, 'STOP_LOSS', pipValue);
          toRemove.push(pos);
        } else if (candle.high >= pos.takeProfit) {
          balance = this.closePositionAt(pos, pos.takeProfit, candle, balance, trades, 'TAKE_PROFIT', pipValue);
          toRemove.push(pos);
        }
      } else {
        if (candle.high >= pos.stopLoss) {
          balance = this.closePositionAt(pos, pos.stopLoss, candle, balance, trades, 'STOP_LOSS', pipValue);
          toRemove.push(pos);
        } else if (candle.low <= pos.takeProfit) {
          balance = this.closePositionAt(pos, pos.takeProfit, candle, balance, trades, 'TAKE_PROFIT', pipValue);
          toRemove.push(pos);
        }
      }
    }

    for (const p of toRemove) {
      positions.splice(positions.indexOf(p), 1);
    }

    return balance;
  }

  private closePositionAt(
    pos: OpenPosition,
    exitPrice: number,
    candle: Candle,
    balance: number,
    trades: BacktestTrade[],
    reason: BacktestTrade['exitReason'],
    pipValue: number
  ): number {
    const priceDiff = pos.direction === 'LONG'
      ? exitPrice - pos.entryPrice
      : pos.entryPrice - exitPrice;

    const pnl = priceDiff * pos.units;

    trades.push({
      id: pos.id,
      direction: pos.direction,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime: candle.timestamp,
      exitPrice,
      units: pos.units,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      pnl,
      pnlPercent: balance > 0 ? pnl / balance : 0,
      exitReason: reason,
    });

    return balance + pnl;
  }

  private closePosition(
    pos: OpenPosition,
    candle: Candle,
    balance: number,
    trades: BacktestTrade[],
    reason: BacktestTrade['exitReason'],
    spreadCost: number,
    slippageCost: number,
    pipValue: number,
    barIndex: number
  ): number {
    const exitPrice = pos.direction === 'LONG'
      ? candle.close - spreadCost / 2 - slippageCost
      : candle.close + spreadCost / 2 + slippageCost;

    return this.closePositionAt(pos, exitPrice, candle, balance, trades, reason, pipValue);
  }

  private calcUnrealized(positions: OpenPosition[], candle: Candle, spreadCost: number, pipValue: number): number {
    let total = 0;
    for (const pos of positions) {
      const exitPrice = pos.direction === 'LONG'
        ? candle.close - spreadCost / 2
        : candle.close + spreadCost / 2;
      const diff = pos.direction === 'LONG'
        ? exitPrice - pos.entryPrice
        : pos.entryPrice - exitPrice;
      total += diff * pos.units;
    }
    return total;
  }

  private calculateMetrics(
    trades: BacktestTrade[],
    startBalance: number,
    endBalance: number,
    maxDrawdown: number,
    maxDrawdownPct: number
  ): BacktestMetrics {
    if (trades.length === 0) {
      return {
        totalTrades: 0, winningTrades: 0, losingTrades: 0, winRate: 0,
        grossProfit: 0, grossLoss: 0, netProfit: 0, netProfitPercent: 0,
        profitFactor: 0, maxDrawdown: 0, maxDrawdownPercent: 0, sharpeRatio: 0,
        avgWin: 0, avgLoss: 0, avgRiskReward: 0,
        maxConsecutiveWins: 0, maxConsecutiveLosses: 0, avgTradeDurationBars: 0,
      };
    }

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const netProfit = endBalance - startBalance;

    const returns = trades.map(t => t.pnlPercent);
    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const stdDev = Math.sqrt(
      returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / returns.length
    );
    const sharpe = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

    let maxConsWins = 0, maxConsLosses = 0, consWins = 0, consLosses = 0;
    for (const t of trades) {
      if (t.pnl > 0) { consWins++; consLosses = 0; }
      else { consLosses++; consWins = 0; }
      if (consWins > maxConsWins) maxConsWins = consWins;
      if (consLosses > maxConsLosses) maxConsLosses = consLosses;
    }

    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

    return {
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: wins.length / trades.length,
      grossProfit,
      grossLoss,
      netProfit,
      netProfitPercent: startBalance > 0 ? netProfit / startBalance : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
      maxDrawdown,
      maxDrawdownPercent: maxDrawdownPct,
      sharpeRatio: sharpe,
      avgWin,
      avgLoss,
      avgRiskReward: avgLoss > 0 ? avgWin / avgLoss : 0,
      maxConsecutiveWins: maxConsWins,
      maxConsecutiveLosses: maxConsLosses,
      avgTradeDurationBars: 0,
    };
  }
}
