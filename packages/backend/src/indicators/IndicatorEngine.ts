import {
  RSI,
  MACD,
  BollingerBands,
  ATR,
  EMA,
} from 'technicalindicators';

import type { Candle } from '../broker/types.js';
import type {
  IndicatorConfig,
  IndicatorSnapshot,
  RSIResult,
  MACDResult,
  BollingerBandsResult,
  ATRResult,
  EMAResult,
} from './types.js';
import { DEFAULT_INDICATOR_CONFIG } from './types.js';

export class IndicatorEngine {
  private config: IndicatorConfig;

  constructor(config: Partial<IndicatorConfig> = {}) {
    this.config = { ...DEFAULT_INDICATOR_CONFIG, ...config };
  }

  compute(candles: Candle[]): IndicatorSnapshot[] {
    if (candles.length === 0) return [];

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    const rsiValues = this.computeRSI(closes);
    const macdValues = this.computeMACD(closes);
    const bbValues = this.computeBB(closes);
    const atrValues = this.computeATR(highs, lows, closes);
    const emaShortValues = this.computeEMA(closes, this.config.emaShort);
    const emaMidValues = this.computeEMA(closes, this.config.emaMid);
    const emaLongValues = this.computeEMA(closes, this.config.emaLong);

    const snapshots: IndicatorSnapshot[] = [];

    for (let i = 0; i < candles.length; i++) {
      const rsiIdx = i - (candles.length - rsiValues.length);
      const macdIdx = i - (candles.length - macdValues.length);
      const bbIdx = i - (candles.length - bbValues.length);
      const atrIdx = i - (candles.length - atrValues.length);
      const emaShortIdx = i - (candles.length - emaShortValues.length);
      const emaMidIdx = i - (candles.length - emaMidValues.length);
      const emaLongIdx = i - (candles.length - emaLongValues.length);

      let rsi: RSIResult | null = null;
      if (rsiIdx >= 0 && rsiIdx < rsiValues.length) {
        const val = rsiValues[rsiIdx];
        rsi = {
          value: round(val, 4),
          overbought: val >= 70,
          oversold: val <= 30,
        };
      }

      let macd: MACDResult | null = null;
      if (macdIdx >= 0 && macdIdx < macdValues.length) {
        const m = macdValues[macdIdx];
        if (m.MACD !== undefined && m.signal !== undefined && m.histogram !== undefined) {
          macd = {
            macd: round(m.MACD, 6),
            signal: round(m.signal, 6),
            histogram: round(m.histogram, 6),
            bullish: m.histogram > 0,
          };
        }
      }

      let bollingerBands: BollingerBandsResult | null = null;
      if (bbIdx >= 0 && bbIdx < bbValues.length) {
        const bb = bbValues[bbIdx];
        const close = candles[i].close;
        const bandwidth = bb.upper - bb.lower;
        const percentB = bandwidth !== 0 ? (close - bb.lower) / bandwidth : 0.5;
        bollingerBands = {
          upper: round(bb.upper, 6),
          middle: round(bb.middle, 6),
          lower: round(bb.lower, 6),
          bandwidth: round(bandwidth, 6),
          percentB: round(percentB, 4),
        };
      }

      let atr: ATRResult | null = null;
      if (atrIdx >= 0 && atrIdx < atrValues.length) {
        atr = { value: round(atrValues[atrIdx], 6) };
      }

      let ema: EMAResult | null = null;
      const hasShort = emaShortIdx >= 0 && emaShortIdx < emaShortValues.length;
      const hasMid = emaMidIdx >= 0 && emaMidIdx < emaMidValues.length;
      const hasLong = emaLongIdx >= 0 && emaLongIdx < emaLongValues.length;
      if (hasShort && hasMid && hasLong) {
        const s = emaShortValues[emaShortIdx];
        const m = emaMidValues[emaMidIdx];
        const l = emaLongValues[emaLongIdx];
        ema = {
          short: round(s, 6),
          mid: round(m, 6),
          long: round(l, 6),
          shortAboveMid: s > m,
          shortAboveLong: s > l,
          midAboveLong: m > l,
        };
      }

      snapshots.push({
        timestamp: candles[i].timestamp,
        close: candles[i].close,
        rsi,
        macd,
        bollingerBands,
        atr,
        ema,
      });
    }

    return snapshots;
  }

  computeLatest(candles: Candle[]): IndicatorSnapshot | null {
    const all = this.compute(candles);
    return all.length > 0 ? all[all.length - 1] : null;
  }

  private computeRSI(closes: number[]): number[] {
    if (closes.length < this.config.rsiPeriod + 1) return [];
    return RSI.calculate({
      values: closes,
      period: this.config.rsiPeriod,
    });
  }

  private computeMACD(closes: number[]) {
    const minLen = this.config.macdSlow + this.config.macdSignal;
    if (closes.length < minLen) return [];
    return MACD.calculate({
      values: closes,
      fastPeriod: this.config.macdFast,
      slowPeriod: this.config.macdSlow,
      signalPeriod: this.config.macdSignal,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    });
  }

  private computeBB(closes: number[]) {
    if (closes.length < this.config.bbPeriod) return [];
    return BollingerBands.calculate({
      values: closes,
      period: this.config.bbPeriod,
      stdDev: this.config.bbStdDev,
    });
  }

  private computeATR(highs: number[], lows: number[], closes: number[]): number[] {
    if (closes.length < this.config.atrPeriod + 1) return [];
    return ATR.calculate({
      high: highs,
      low: lows,
      close: closes,
      period: this.config.atrPeriod,
    });
  }

  private computeEMA(closes: number[], period: number): number[] {
    if (closes.length < period) return [];
    return EMA.calculate({
      values: closes,
      period,
    });
  }

  updateConfig(partial: Partial<IndicatorConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  getConfig(): IndicatorConfig {
    return { ...this.config };
  }
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
