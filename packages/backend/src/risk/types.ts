export interface RiskLimits {
  maxRiskPerTrade: number;       // 0.005 = 0.5%
  maxDailyLoss: number;          // 0.02 = 2%
  maxWeeklyLoss: number;         // 0.05 = 5%
  maxDrawdown: number;           // 0.10 = 10%
  maxOpenTrades: number;         // 3
  maxSpreadPips: number;         // 3.0 — reject if spread exceeds
  maxCorrelatedPositions: number; // 2 — max same-direction trades in a correlation group
  staleSignalSeconds: number;    // 5
  staleTickSeconds: number;      // 5
}

export interface RiskState {
  dailyPnL: number;
  weeklyPnL: number;
  peakBalance: number;
  currentDrawdown: number;
  currentDrawdownPercent: number;
  openTradeCount: number;
  lastTickTime: number;
  streamHealthy: boolean;
  circuitBreakerTripped: boolean;
  tripReason: string | null;
  limits: RiskLimits;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason: string | null;
  riskState: RiskState;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxRiskPerTrade: 0.005,
  maxDailyLoss: 0.02,
  maxWeeklyLoss: 0.05,
  maxDrawdown: 0.10,
  maxOpenTrades: 3,
  maxSpreadPips: 3.0,
  maxCorrelatedPositions: 2,
  staleSignalSeconds: 5,
  staleTickSeconds: 5,
};
