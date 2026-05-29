import { EventEmitter } from 'events';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import type { CandleGranularity } from '../broker/types.js';
import { IndicatorEngine } from '../indicators/IndicatorEngine.js';
import { SignalEngine } from '../strategies/SignalEngine.js';
import { RiskEngine } from '../risk/RiskEngine.js';
import { StrategyModel } from '../strategies/models.js';
import { DecisionLogModel, type DecisionType } from '../data/DecisionLog.js';
import { SignalModel } from '../data/models.js';

export interface AutoTraderStatus {
  running: boolean;
  lastEvaluation: string | null;
  evaluationCount: number;
  activeStrategies: number;
  tradesPlaced: number;
  tradesRejected: number;
  errors: number;
  startedAt: string | null;
}

export class AutoTrader extends EventEmitter {
  private broker: BrokerAdapter;
  private riskEngine: RiskEngine;
  private indicatorEngine = new IndicatorEngine();
  private signalEngine = new SignalEngine();
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private evaluationCount = 0;
  private tradesPlaced = 0;
  private tradesRejected = 0;
  private errors = 0;
  private lastEvaluation: string | null = null;
  private startedAt: string | null = null;
  private activeStrategies = 0;

  constructor(broker: BrokerAdapter, riskEngine: RiskEngine) {
    super();
    this.broker = broker;
    this.riskEngine = riskEngine;
  }

  async start(intervalMs = 60000): Promise<void> {
    if (this.running) return;

    this.running = true;
    this.startedAt = new Date().toISOString();
    this.evaluationCount = 0;
    this.tradesPlaced = 0;
    this.tradesRejected = 0;
    this.errors = 0;

    await this.log('BOT_STARTED', { message: `Auto-trader started, interval: ${intervalMs}ms` });
    this.emit('status', this.getStatus());

    await this.evaluate();

    this.timer = setInterval(() => this.evaluate(), intervalMs);
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.log('BOT_STOPPED', { message: 'Auto-trader stopped' });
    this.startedAt = null;
    this.emit('status', this.getStatus());
  }

  getStatus(): AutoTraderStatus {
    return {
      running: this.running,
      lastEvaluation: this.lastEvaluation,
      evaluationCount: this.evaluationCount,
      activeStrategies: this.activeStrategies,
      tradesPlaced: this.tradesPlaced,
      tradesRejected: this.tradesRejected,
      errors: this.errors,
      startedAt: this.startedAt,
    };
  }

  private async evaluate(): Promise<void> {
    try {
      const strategies = await StrategyModel.find({ enabled: true }).lean();
      this.activeStrategies = strategies.length;

      if (strategies.length === 0) {
        this.lastEvaluation = new Date().toISOString();
        this.evaluationCount++;
        this.emit('status', this.getStatus());
        return;
      }

      for (const strategy of strategies) {
        await this.evaluateStrategy(strategy);
      }

      this.lastEvaluation = new Date().toISOString();
      this.evaluationCount++;
      this.emit('status', this.getStatus());
    } catch (err: any) {
      this.errors++;
      console.error('[AutoTrader] Evaluation error:', err.message);
      this.emit('error', err);
    }
  }

  private async evaluateStrategy(strategy: any): Promise<void> {
    const strategyId = strategy._id.toString();
    const strategyName = strategy.name;

    try {
      const candles = await this.broker.getCandles({
        instrument: strategy.instrument,
        granularity: strategy.granularity as CandleGranularity,
        count: 300,
      });

      if (candles.length < 200) {
        await this.log('EVALUATION_SKIP', {
          strategyId,
          strategyName,
          instrument: strategy.instrument,
          message: `Not enough candles: ${candles.length}`,
        });
        return;
      }

      const indicators = this.indicatorEngine.compute(candles);
      const current = indicators[indicators.length - 1];
      const previous = indicators.length > 1 ? indicators[indicators.length - 2] : null;

      if (!current?.rsi || !current?.atr) return;

      const signal = this.signalEngine.evaluate(strategy, current, previous);

      if (!signal) {
        await this.log('EVALUATION_SKIP', {
          strategyId,
          strategyName,
          instrument: strategy.instrument,
          message: 'No signal — conditions not met',
        });
        return;
      }

      await this.log('SIGNAL_GENERATED', {
        strategyId,
        strategyName,
        instrument: strategy.instrument,
        direction: signal.direction,
        confidence: signal.confidence,
        triggeredConditions: signal.triggeredConditions,
        indicatorValues: signal.indicatorValues,
      });

      await SignalModel.create({
        instrument: signal.instrument,
        direction: signal.direction,
        source: strategyName,
        strategyId,
        strategyName,
        confidence: signal.confidence,
        indicators: signal.indicatorValues,
        triggeredConditions: signal.triggeredConditions,
        timestamp: new Date(),
        acted: false,
      });

      if (signal.direction === 'BUY' || signal.direction === 'SELL') {
        const openTrades = await this.broker.getOpenTrades();
        const sameInstrumentTrades = openTrades.filter(t => t.instrument === strategy.instrument);
        if (sameInstrumentTrades.length >= strategy.maxOpenTrades) {
          await this.log('EVALUATION_SKIP', {
            strategyId,
            strategyName,
            instrument: strategy.instrument,
            direction: signal.direction,
            message: `Max open trades reached (${sameInstrumentTrades.length}/${strategy.maxOpenTrades})`,
          });
          return;
        }
      }

      const signalTime = new Date().toISOString();
      if (!this.riskEngine.checkSignalFreshness(signalTime)) {
        await this.log('RISK_CHECK_FAILED', {
          strategyId,
          strategyName,
          instrument: strategy.instrument,
          direction: signal.direction,
          riskCheckResult: { allowed: false, reason: 'Stale signal' },
        });
        this.tradesRejected++;
        return;
      }

      const riskCheck = this.riskEngine.checkEntryAllowed();

      if (!riskCheck.allowed) {
        await this.log('RISK_CHECK_FAILED', {
          strategyId,
          strategyName,
          instrument: strategy.instrument,
          direction: signal.direction,
          riskCheckResult: { allowed: false, reason: riskCheck.reason },
        });
        this.tradesRejected++;
        return;
      }

      await this.log('RISK_CHECK_PASSED', {
        strategyId,
        strategyName,
        instrument: strategy.instrument,
        direction: signal.direction,
        riskCheckResult: { allowed: true, reason: null },
      });

      if (signal.direction === 'EXIT_LONG' || signal.direction === 'EXIT_SHORT') {
        await this.handleExit(strategy, signal);
        return;
      }

      if (signal.direction === 'BUY' || signal.direction === 'SELL') {
        await this.handleEntry(strategy, signal, current);
      }
    } catch (err: any) {
      this.errors++;
      await this.log('ORDER_REJECTED', {
        strategyId,
        strategyName,
        instrument: strategy.instrument,
        message: `Error: ${err.message}`,
      });
    }
  }

  private async handleEntry(strategy: any, signal: any, indicators: any): Promise<void> {
    const account = await this.broker.getAccountSummary();
    const atrValue = indicators.atr?.value ?? 0;
    if (atrValue <= 0) return;

    const pipValue = strategy.instrument.includes('JPY') ? 0.01 : 0.0001;
    const slDistance = atrValue * strategy.stopLossATRMultiplier;
    const tpDistance = slDistance * strategy.takeProfitRatio;

    const units = this.riskEngine.calculatePositionSize(account.balance, slDistance, pipValue);
    if (units <= 0) return;

    const isBuy = signal.direction === 'BUY';
    const signedUnits = isBuy ? units : -units;

    const currentPrice = indicators.close;
    const stopLoss = isBuy ? currentPrice - slDistance : currentPrice + slDistance;
    const takeProfit = isBuy ? currentPrice + tpDistance : currentPrice - tpDistance;

    const slPrecision = strategy.instrument.includes('JPY') ? 3 : 5;

    try {
      const order = await this.broker.placeOrder({
        instrument: strategy.instrument,
        units: signedUnits,
        type: 'MARKET',
        stopLossPrice: parseFloat(stopLoss.toFixed(slPrecision)),
        takeProfitPrice: parseFloat(takeProfit.toFixed(slPrecision)),
      });

      this.tradesPlaced++;

      await this.log('ORDER_PLACED', {
        strategyId: strategy._id.toString(),
        strategyName: strategy.name,
        instrument: strategy.instrument,
        direction: signal.direction,
        confidence: signal.confidence,
        orderDetails: {
          orderId: order.orderId,
          tradeId: order.tradeId,
          units: signedUnits,
          price: order.price,
          stopLoss: parseFloat(stopLoss.toFixed(slPrecision)),
          takeProfit: parseFloat(takeProfit.toFixed(slPrecision)),
          type: 'MARKET',
        },
      });

      this.emit('trade', { type: 'entry', order, strategy: strategy.name, signal });
    } catch (err: any) {
      this.tradesRejected++;
      await this.log('ORDER_REJECTED', {
        strategyId: strategy._id.toString(),
        strategyName: strategy.name,
        instrument: strategy.instrument,
        direction: signal.direction,
        message: err.message,
      });
    }
  }

  private async handleExit(strategy: any, signal: any): Promise<void> {
    try {
      const trades = await this.broker.getOpenTrades();
      const matching = trades.filter(t =>
        t.instrument === strategy.instrument &&
        ((signal.direction === 'EXIT_LONG' && t.units > 0) ||
         (signal.direction === 'EXIT_SHORT' && t.units < 0))
      );

      for (const trade of matching) {
        const result = await this.broker.closeTrade(trade.tradeId);

        await this.log('TRADE_CLOSED', {
          strategyId: strategy._id.toString(),
          strategyName: strategy.name,
          instrument: strategy.instrument,
          direction: signal.direction,
          tradeResult: {
            tradeId: result.tradeId,
            pnl: result.pl,
            exitReason: 'EXIT_SIGNAL',
          },
        });

        this.emit('trade', { type: 'exit', result, strategy: strategy.name });
      }
    } catch (err: any) {
      this.errors++;
      await this.log('ORDER_REJECTED', {
        strategyId: strategy._id.toString(),
        strategyName: strategy.name,
        instrument: strategy.instrument,
        message: `Exit failed: ${err.message}`,
      });
    }
  }

  private async log(type: DecisionType, data: Partial<{
    strategyId: string;
    strategyName: string;
    instrument: string;
    direction: string;
    confidence: number;
    riskCheckResult: { allowed: boolean; reason: string | null };
    orderDetails: Record<string, any>;
    tradeResult: Record<string, any>;
    indicatorValues: Record<string, number>;
    triggeredConditions: string[];
    message: string;
  }>): Promise<void> {
    try {
      await DecisionLogModel.create({
        timestamp: new Date(),
        type,
        ...data,
      });
      this.emit('decision', { type, ...data, timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error('[AutoTrader] Failed to log decision:', err.message);
      this.emit('decision', { type, ...data, timestamp: new Date().toISOString() });
    }
  }
}
