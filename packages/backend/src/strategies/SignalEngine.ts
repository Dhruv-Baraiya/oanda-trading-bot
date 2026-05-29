import type { IndicatorSnapshot } from '../indicators/types.js';
import type { Condition, StrategyConfig, StrategyRule, Signal, CompareOp } from './types.js';

export class SignalEngine {
  evaluate(
    strategy: StrategyConfig,
    current: IndicatorSnapshot,
    previous: IndicatorSnapshot | null
  ): Signal | null {
    const indicatorValues = this.flattenIndicators(current);

    const longEntry = this.evaluateRule(strategy.entryLong, current, previous);
    const shortEntry = this.evaluateRule(strategy.entryShort, current, previous);
    const longExit = this.evaluateRule(strategy.exitLong, current, previous);
    const shortExit = this.evaluateRule(strategy.exitShort, current, previous);

    let direction: Signal['direction'] = 'FLAT';
    let confidence = 0;
    let triggeredConditions: string[] = [];

    if (longExit.passed) {
      direction = 'EXIT_LONG';
      confidence = longExit.score;
      triggeredConditions = longExit.triggered;
    }
    if (shortExit.passed) {
      direction = 'EXIT_SHORT';
      confidence = shortExit.score;
      triggeredConditions = shortExit.triggered;
    }
    if (longEntry.passed) {
      direction = 'BUY';
      confidence = longEntry.score;
      triggeredConditions = longEntry.triggered;
    }
    if (shortEntry.passed) {
      direction = 'SELL';
      confidence = shortEntry.score;
      triggeredConditions = shortEntry.triggered;
    }

    if (direction === 'FLAT') return null;

    return {
      strategyId: (strategy as any)._id?.toString() ?? '',
      strategyName: strategy.name,
      instrument: strategy.instrument,
      direction,
      confidence,
      triggeredConditions,
      indicatorValues,
      timestamp: current.timestamp,
      acted: false,
    };
  }

  evaluateRule(
    rule: StrategyRule,
    current: IndicatorSnapshot,
    previous: IndicatorSnapshot | null
  ): { passed: boolean; score: number; triggered: string[] } {
    if (rule.conditions.length === 0) return { passed: false, score: 0, triggered: [] };

    const results = rule.conditions.map(cond => {
      const passed = this.evaluateCondition(cond, current, previous);
      const label = `${cond.indicator}.${cond.field} ${cond.op} ${cond.value}`;
      return { passed, label };
    });

    const triggered = results.filter(r => r.passed).map(r => r.label);
    const score = triggered.length / rule.conditions.length;

    const passed = rule.logic === 'AND'
      ? results.every(r => r.passed)
      : results.some(r => r.passed);

    return { passed, score, triggered };
  }

  private evaluateCondition(
    cond: Condition,
    current: IndicatorSnapshot,
    previous: IndicatorSnapshot | null
  ): boolean {
    const currentVal = this.getIndicatorValue(current, cond.indicator, cond.field);
    if (currentVal === null) return false;

    if (cond.op === 'crosses_above' || cond.op === 'crosses_below') {
      return this.evaluateCrossover(cond, currentVal, current, previous);
    }

    let target: number;
    if (typeof cond.value === 'string') {
      const parts = cond.value.split('.');
      const refVal = this.getIndicatorValue(current, parts[0], parts[1]);
      if (refVal === null) return false;
      target = refVal;
    } else {
      target = cond.value;
    }

    return this.compare(currentVal, cond.op, target);
  }

  private evaluateCrossover(
    cond: Condition,
    currentVal: number,
    current: IndicatorSnapshot,
    previous: IndicatorSnapshot | null
  ): boolean {
    if (!previous) return false;

    const prevVal = this.getIndicatorValue(previous, cond.indicator, cond.field);
    if (prevVal === null) return false;

    let currentTarget: number;
    let prevTarget: number;

    if (typeof cond.value === 'string') {
      const parts = cond.value.split('.');
      const ct = this.getIndicatorValue(current, parts[0], parts[1]);
      const pt = this.getIndicatorValue(previous, parts[0], parts[1]);
      if (ct === null || pt === null) return false;
      currentTarget = ct;
      prevTarget = pt;
    } else {
      currentTarget = cond.value;
      prevTarget = cond.value;
    }

    if (cond.op === 'crosses_above') {
      return prevVal <= prevTarget && currentVal > currentTarget;
    }
    return prevVal >= prevTarget && currentVal < currentTarget;
  }

  private compare(a: number, op: CompareOp, b: number): boolean {
    switch (op) {
      case 'gt': return a > b;
      case 'gte': return a >= b;
      case 'lt': return a < b;
      case 'lte': return a <= b;
      case 'eq': return Math.abs(a - b) < 1e-10;
      default: return false;
    }
  }

  private getIndicatorValue(snapshot: IndicatorSnapshot, indicator: string, field: string): number | null {
    const group = snapshot[indicator as keyof IndicatorSnapshot] as any;
    if (!group || typeof group !== 'object') return null;
    const val = group[field];
    return typeof val === 'number' ? val : null;
  }

  private flattenIndicators(snapshot: IndicatorSnapshot): Record<string, number> {
    const result: Record<string, number> = { close: snapshot.close };
    const groups = ['rsi', 'macd', 'bollingerBands', 'atr', 'ema'] as const;
    for (const g of groups) {
      const data = snapshot[g] as any;
      if (!data) continue;
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'number') result[`${g}.${k}`] = v;
      }
    }
    return result;
  }
}
