import mongoose, { Schema, type Document } from 'mongoose';
import type { StrategyConfig, Condition, StrategyRule } from './types.js';

export interface IStrategyDoc extends Document, Omit<StrategyConfig, 'name'> {
  name: string;
}

const conditionSchema = new Schema<Condition>({
  indicator: { type: String, required: true },
  field: { type: String, required: true },
  op: { type: String, required: true, enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'crosses_above', 'crosses_below'] },
  value: { type: Schema.Types.Mixed, required: true },
}, { _id: false });

const ruleSchema = new Schema<StrategyRule>({
  name: { type: String, required: true },
  conditions: [conditionSchema],
  logic: { type: String, enum: ['AND', 'OR'], default: 'AND' },
}, { _id: false });

const strategySchema = new Schema<IStrategyDoc>({
  name: { type: String, required: true },
  instrument: { type: String, required: true, index: true },
  granularity: { type: String, required: true },
  enabled: { type: Boolean, default: false },
  entryLong: { type: ruleSchema, required: true },
  entryShort: { type: ruleSchema, required: true },
  exitLong: { type: ruleSchema, required: true },
  exitShort: { type: ruleSchema, required: true },
  riskPerTrade: { type: Number, default: 0.005 },
  stopLossATRMultiplier: { type: Number, default: 1.5 },
  takeProfitRatio: { type: Number, default: 2.0 },
  maxOpenTrades: { type: Number, default: 3 },
}, { timestamps: true });

export const StrategyModel = mongoose.model<IStrategyDoc>('Strategy', strategySchema);
