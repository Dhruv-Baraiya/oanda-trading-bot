export interface IndicatorConfig {
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bbPeriod: number;
  bbStdDev: number;
  atrPeriod: number;
  emaShort: number;
  emaMid: number;
  emaLong: number;
}

export const DEFAULT_INDICATOR_CONFIG: IndicatorConfig = {
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  bbPeriod: 20,
  bbStdDev: 2,
  atrPeriod: 14,
  emaShort: 20,
  emaMid: 50,
  emaLong: 200,
};

export interface RSIResult {
  value: number;
  overbought: boolean;
  oversold: boolean;
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
  bullish: boolean;
}

export interface BollingerBandsResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
  percentB: number;
}

export interface ATRResult {
  value: number;
}

export interface EMAResult {
  short: number;
  mid: number;
  long: number;
  shortAboveMid: boolean;
  shortAboveLong: boolean;
  midAboveLong: boolean;
}

export interface IndicatorSnapshot {
  timestamp: string;
  close: number;
  rsi: RSIResult | null;
  macd: MACDResult | null;
  bollingerBands: BollingerBandsResult | null;
  atr: ATRResult | null;
  ema: EMAResult | null;
}
