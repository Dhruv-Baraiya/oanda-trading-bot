export interface BacktestConfig {
  strategyId: string;
  instrument: string;
  granularity: string;
  from: string;
  to: string;
  initialBalance: number;
  spreadPips: number;
  slippagePips: number;
}

export interface BacktestTrade {
  id: number;
  direction: 'LONG' | 'SHORT';
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  units: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  pnlPercent: number;
  exitReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'EXIT_SIGNAL' | 'END_OF_DATA';
}

export interface EquityPoint {
  timestamp: string;
  equity: number;
  drawdown: number;
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  netProfitPercent: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  avgWin: number;
  avgLoss: number;
  avgRiskReward: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgTradeDurationBars: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  strategyName: string;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  startBalance: number;
  endBalance: number;
  runAt: string;
}
