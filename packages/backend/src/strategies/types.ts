export type CompareOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'crosses_above' | 'crosses_below';

export interface Condition {
  indicator: string;
  field: string;
  op: CompareOp;
  value: number | string;
}

export interface StrategyRule {
  name: string;
  conditions: Condition[];
  logic: 'AND' | 'OR';
}

export interface StrategyConfig {
  name: string;
  instrument: string;
  granularity: string;
  enabled: boolean;
  entryLong: StrategyRule;
  entryShort: StrategyRule;
  exitLong: StrategyRule;
  exitShort: StrategyRule;
  riskPerTrade: number;
  stopLossATRMultiplier: number;
  takeProfitRatio: number;
  maxOpenTrades: number;
}

export interface Signal {
  strategyId: string;
  strategyName: string;
  instrument: string;
  direction: 'BUY' | 'SELL' | 'EXIT_LONG' | 'EXIT_SHORT' | 'FLAT';
  confidence: number;
  triggeredConditions: string[];
  indicatorValues: Record<string, number>;
  timestamp: string;
  acted: boolean;
}

export const INDICATOR_FIELDS: Record<string, string[]> = {
  rsi: ['value'],
  macd: ['macd', 'signal', 'histogram'],
  bollingerBands: ['upper', 'middle', 'lower', 'percentB', 'bandwidth'],
  atr: ['value'],
  ema: ['short', 'mid', 'long'],
};

export const DEFAULT_STRATEGY: StrategyConfig = {
  name: 'New Strategy',
  instrument: 'EUR_USD',
  granularity: 'H1',
  enabled: false,
  entryLong: {
    name: 'Long Entry',
    logic: 'AND',
    conditions: [
      { indicator: 'rsi', field: 'value', op: 'lt', value: 30 },
      { indicator: 'ema', field: 'short', op: 'crosses_above', value: 'ema.mid' },
    ],
  },
  entryShort: {
    name: 'Short Entry',
    logic: 'AND',
    conditions: [
      { indicator: 'rsi', field: 'value', op: 'gt', value: 70 },
      { indicator: 'ema', field: 'short', op: 'crosses_below', value: 'ema.mid' },
    ],
  },
  exitLong: {
    name: 'Long Exit',
    logic: 'OR',
    conditions: [
      { indicator: 'rsi', field: 'value', op: 'gt', value: 70 },
    ],
  },
  exitShort: {
    name: 'Short Exit',
    logic: 'OR',
    conditions: [
      { indicator: 'rsi', field: 'value', op: 'lt', value: 30 },
    ],
  },
  riskPerTrade: 0.005,
  stopLossATRMultiplier: 1.5,
  takeProfitRatio: 2.0,
  maxOpenTrades: 3,
};
