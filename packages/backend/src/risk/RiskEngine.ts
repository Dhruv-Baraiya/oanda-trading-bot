import type { AccountSummary, PriceUpdate } from '../broker/types.js';
import type { RiskLimits, RiskState, RiskCheckResult } from './types.js';
import { DEFAULT_RISK_LIMITS } from './types.js';
import { EventEmitter } from 'events';

export class RiskEngine extends EventEmitter {
  private limits: RiskLimits;
  private dailyPnL = 0;
  private weeklyPnL = 0;
  private peakBalance = 0;
  private currentBalance = 0;
  private openTradeCount = 0;
  private lastTickTime = 0;
  private circuitBreakerTripped = false;
  private tripReason: string | null = null;
  private dailyResetTimer: ReturnType<typeof setInterval> | null = null;
  private weeklyResetTimer: ReturnType<typeof setInterval> | null = null;
  private startOfDayBalance = 0;
  private startOfWeekBalance = 0;

  constructor(limits: Partial<RiskLimits> = {}) {
    super();
    this.limits = { ...DEFAULT_RISK_LIMITS, ...limits };
  }

  initialize(account: AccountSummary): void {
    this.currentBalance = account.balance;
    this.peakBalance = Math.max(this.peakBalance, account.balance);
    this.startOfDayBalance = account.balance;
    this.startOfWeekBalance = account.balance;
    this.openTradeCount = account.openTradeCount;
    this.scheduleDailyReset();
    this.scheduleWeeklyReset();
    this.emit('initialized', this.getState());
  }

  updateAccount(account: AccountSummary): void {
    this.currentBalance = account.balance;
    this.openTradeCount = account.openTradeCount;

    if (account.balance > this.peakBalance) {
      this.peakBalance = account.balance;
    }

    this.dailyPnL = account.balance - this.startOfDayBalance;
    this.weeklyPnL = account.balance - this.startOfWeekBalance;

    this.checkDrawdownBreaker(account);
    this.checkDailyLimit(account);
    this.checkWeeklyLimit(account);
  }

  onPriceTick(_price: PriceUpdate): void {
    this.lastTickTime = Date.now();
  }

  checkEntryAllowed(spreadPips?: number): RiskCheckResult {
    const state = this.getState();

    if (this.circuitBreakerTripped) {
      return { allowed: false, reason: this.tripReason, riskState: state };
    }

    if (!this.isStreamHealthy()) {
      return { allowed: false, reason: 'Stream unhealthy — no tick received recently', riskState: state };
    }

    const dailyLossPercent = this.startOfDayBalance > 0
      ? Math.abs(Math.min(0, this.dailyPnL)) / this.startOfDayBalance
      : 0;
    if (dailyLossPercent >= this.limits.maxDailyLoss) {
      return { allowed: false, reason: `Daily loss limit hit: ${(dailyLossPercent * 100).toFixed(2)}%`, riskState: state };
    }

    const weeklyLossPercent = this.startOfWeekBalance > 0
      ? Math.abs(Math.min(0, this.weeklyPnL)) / this.startOfWeekBalance
      : 0;
    if (weeklyLossPercent >= this.limits.maxWeeklyLoss) {
      return { allowed: false, reason: `Weekly loss limit hit: ${(weeklyLossPercent * 100).toFixed(2)}%`, riskState: state };
    }

    const drawdownPercent = this.peakBalance > 0
      ? (this.peakBalance - this.currentBalance) / this.peakBalance
      : 0;
    if (drawdownPercent >= this.limits.maxDrawdown) {
      return { allowed: false, reason: `Max drawdown breaker: ${(drawdownPercent * 100).toFixed(2)}%`, riskState: state };
    }

    if (this.openTradeCount >= this.limits.maxOpenTrades) {
      return { allowed: false, reason: `Max open trades reached: ${this.openTradeCount}`, riskState: state };
    }

    if (spreadPips !== undefined && spreadPips > this.limits.maxSpreadPips) {
      return { allowed: false, reason: `Spread too wide: ${spreadPips.toFixed(1)} pips`, riskState: state };
    }

    return { allowed: true, reason: null, riskState: state };
  }

  checkSignalFreshness(signalTimestamp: string): boolean {
    const age = (Date.now() - new Date(signalTimestamp).getTime()) / 1000;
    return age <= this.limits.staleSignalSeconds;
  }

  calculatePositionSize(
    balance: number,
    stopLossDistance: number,
    _pipValue: number
  ): number {
    const riskAmount = balance * this.limits.maxRiskPerTrade;
    if (stopLossDistance <= 0) return 0;
    return Math.floor(riskAmount / stopLossDistance);
  }

  tripCircuitBreaker(reason: string): void {
    this.circuitBreakerTripped = true;
    this.tripReason = reason;
    this.emit('circuit-breaker', { tripped: true, reason });
  }

  resetCircuitBreaker(): void {
    this.circuitBreakerTripped = false;
    this.tripReason = null;
    this.emit('circuit-breaker', { tripped: false, reason: null });
  }

  isStreamHealthy(): boolean {
    if (this.lastTickTime === 0) return true;
    const elapsed = (Date.now() - this.lastTickTime) / 1000;
    return elapsed < this.limits.staleTickSeconds;
  }

  getState(): RiskState {
    const drawdown = this.peakBalance > 0
      ? this.peakBalance - this.currentBalance
      : 0;
    const drawdownPercent = this.peakBalance > 0
      ? drawdown / this.peakBalance
      : 0;

    return {
      dailyPnL: this.dailyPnL,
      weeklyPnL: this.weeklyPnL,
      peakBalance: this.peakBalance,
      currentDrawdown: drawdown,
      currentDrawdownPercent: drawdownPercent,
      openTradeCount: this.openTradeCount,
      lastTickTime: this.lastTickTime,
      streamHealthy: this.isStreamHealthy(),
      circuitBreakerTripped: this.circuitBreakerTripped,
      tripReason: this.tripReason,
      limits: { ...this.limits },
    };
  }

  updateLimits(partial: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...partial };
  }

  private checkDrawdownBreaker(account: AccountSummary): void {
    const drawdownPercent = this.peakBalance > 0
      ? (this.peakBalance - account.balance) / this.peakBalance
      : 0;

    if (drawdownPercent >= this.limits.maxDrawdown) {
      this.tripCircuitBreaker(`Max drawdown breaker: ${(drawdownPercent * 100).toFixed(2)}% (limit: ${(this.limits.maxDrawdown * 100)}%)`);
      this.emit('drawdown-breaker', { drawdownPercent, balance: account.balance, peak: this.peakBalance });
    }
  }

  private checkDailyLimit(account: AccountSummary): void {
    const lossPct = this.startOfDayBalance > 0
      ? Math.abs(Math.min(0, this.dailyPnL)) / this.startOfDayBalance
      : 0;

    if (lossPct >= this.limits.maxDailyLoss) {
      this.tripCircuitBreaker(`Daily loss limit: ${(lossPct * 100).toFixed(2)}%`);
      this.emit('daily-limit', { lossPct, dailyPnL: this.dailyPnL });
    }
  }

  private checkWeeklyLimit(account: AccountSummary): void {
    const lossPct = this.startOfWeekBalance > 0
      ? Math.abs(Math.min(0, this.weeklyPnL)) / this.startOfWeekBalance
      : 0;

    if (lossPct >= this.limits.maxWeeklyLoss) {
      this.tripCircuitBreaker(`Weekly loss limit: ${(lossPct * 100).toFixed(2)}%`);
      this.emit('weekly-limit', { lossPct, weeklyPnL: this.weeklyPnL });
    }
  }

  private getPipValue(instrument: string): number {
    return instrument.includes('JPY') ? 0.01 : 0.0001;
  }

  private scheduleDailyReset(): void {
    if (this.dailyResetTimer) clearInterval(this.dailyResetTimer);

    this.dailyResetTimer = setInterval(() => {
      const now = new Date();
      if (now.getUTCHours() === 21 && now.getUTCMinutes() === 0) {
        this.startOfDayBalance = this.currentBalance;
        this.dailyPnL = 0;
        if (this.circuitBreakerTripped && this.tripReason?.includes('Daily')) {
          this.resetCircuitBreaker();
        }
        this.emit('daily-reset', { balance: this.currentBalance });
      }
    }, 60000);
  }

  private scheduleWeeklyReset(): void {
    if (this.weeklyResetTimer) clearInterval(this.weeklyResetTimer);

    this.weeklyResetTimer = setInterval(() => {
      const now = new Date();
      if (now.getUTCDay() === 0 && now.getUTCHours() === 21 && now.getUTCMinutes() === 0) {
        this.startOfWeekBalance = this.currentBalance;
        this.weeklyPnL = 0;
        if (this.circuitBreakerTripped && this.tripReason?.includes('Weekly')) {
          this.resetCircuitBreaker();
        }
        this.emit('weekly-reset', { balance: this.currentBalance });
      }
    }, 60000);
  }

  destroy(): void {
    if (this.dailyResetTimer) clearInterval(this.dailyResetTimer);
    if (this.weeklyResetTimer) clearInterval(this.weeklyResetTimer);
  }
}
