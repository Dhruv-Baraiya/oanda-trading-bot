import mongoose, { Schema, type Document } from 'mongoose';

export interface ICandleDoc extends Document {
  instrument: string;
  granularity: string;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const candleSchema = new Schema<ICandleDoc>({
  instrument: { type: String, required: true, index: true },
  granularity: { type: String, required: true, index: true },
  timestamp: { type: Date, required: true },
  open: { type: Number, required: true },
  high: { type: Number, required: true },
  low: { type: Number, required: true },
  close: { type: Number, required: true },
  volume: { type: Number, required: true },
});

candleSchema.index({ instrument: 1, granularity: 1, timestamp: 1 }, { unique: true });

export const CandleModel = mongoose.model<ICandleDoc>('Candle', candleSchema);

export interface ITradeDoc extends Document {
  tradeId: string;
  instrument: string;
  units: number;
  entryPrice: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  openTime: Date;
  closeTime?: Date;
  pl?: number;
  state: 'OPEN' | 'CLOSED';
  signals: string[];
  notes?: string;
}

const tradeSchema = new Schema<ITradeDoc>({
  tradeId: { type: String, required: true, unique: true },
  instrument: { type: String, required: true, index: true },
  units: { type: Number, required: true },
  entryPrice: { type: Number, required: true },
  exitPrice: Number,
  stopLoss: Number,
  takeProfit: Number,
  openTime: { type: Date, required: true },
  closeTime: Date,
  pl: Number,
  state: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN', index: true },
  signals: [String],
  notes: String,
}, { timestamps: true });

export const TradeModel = mongoose.model<ITradeDoc>('Trade', tradeSchema);

export interface ISignalDoc extends Document {
  instrument: string;
  direction: 'BUY' | 'SELL' | 'FLAT';
  source: string;
  strategyId?: string;
  strategyName?: string;
  confidence: number;
  indicators: Record<string, number>;
  triggeredConditions?: string[];
  timestamp: Date;
  acted: boolean;
  review?: 'GOOD' | 'BAD';
  reviewNotes?: string;
}

const signalSchema = new Schema<ISignalDoc>({
  instrument: { type: String, required: true, index: true },
  direction: { type: String, enum: ['BUY', 'SELL', 'FLAT'], required: true },
  source: { type: String, required: true },
  strategyId: { type: String, index: true },
  strategyName: String,
  confidence: { type: Number, required: true },
  indicators: { type: Schema.Types.Mixed, default: {} },
  triggeredConditions: [String],
  timestamp: { type: Date, required: true, index: true },
  acted: { type: Boolean, default: false },
  review: { type: String, enum: ['GOOD', 'BAD'] },
  reviewNotes: String,
}, { timestamps: true });

export const SignalModel = mongoose.model<ISignalDoc>('Signal', signalSchema);

export interface IAccountSnapshotDoc extends Document {
  accountId: string;
  balance: number;
  nav: number;
  unrealizedPL: number;
  marginUsed: number;
  openTradeCount: number;
  timestamp: Date;
}

const accountSnapshotSchema = new Schema<IAccountSnapshotDoc>({
  accountId: { type: String, required: true },
  balance: { type: Number, required: true },
  nav: { type: Number, required: true },
  unrealizedPL: { type: Number, required: true },
  marginUsed: { type: Number, required: true },
  openTradeCount: { type: Number, required: true },
  timestamp: { type: Date, required: true, index: true },
});

export const AccountSnapshotModel = mongoose.model<IAccountSnapshotDoc>('AccountSnapshot', accountSnapshotSchema);

export interface IBacktestResultDoc extends Document {
  strategyId: string;
  strategyName: string;
  instrument: string;
  granularity: string;
  from: Date;
  to: Date;
  initialBalance: number;
  endBalance: number;
  spreadPips: number;
  slippagePips: number;
  metrics: Record<string, number>;
  trades: Array<Record<string, any>>;
  equityCurve: Array<{ timestamp: Date; equity: number; drawdown: number }>;
  runAt: Date;
}

const backtestResultSchema = new Schema<IBacktestResultDoc>({
  strategyId: { type: String, required: true, index: true },
  strategyName: { type: String, required: true },
  instrument: { type: String, required: true },
  granularity: { type: String, required: true },
  from: { type: Date, required: true },
  to: { type: Date, required: true },
  initialBalance: { type: Number, required: true },
  endBalance: { type: Number, required: true },
  spreadPips: { type: Number, required: true },
  slippagePips: { type: Number, required: true },
  metrics: { type: Schema.Types.Mixed, required: true },
  trades: [Schema.Types.Mixed],
  equityCurve: [{ timestamp: Date, equity: Number, drawdown: Number }],
  runAt: { type: Date, required: true },
}, { timestamps: true });

export const BacktestResultModel = mongoose.model<IBacktestResultDoc>('BacktestResult', backtestResultSchema);
