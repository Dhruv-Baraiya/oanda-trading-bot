import mongoose, { Schema, type Document } from 'mongoose';

export type DecisionType =
  | 'SIGNAL_GENERATED'
  | 'RISK_CHECK_PASSED'
  | 'RISK_CHECK_FAILED'
  | 'ORDER_PLACED'
  | 'ORDER_REJECTED'
  | 'TRADE_OPENED'
  | 'TRADE_CLOSED'
  | 'EXIT_SIGNAL'
  | 'EVALUATION_SKIP'
  | 'BOT_STARTED'
  | 'BOT_STOPPED';

export interface IDecisionLogDoc extends Document {
  timestamp: Date;
  type: DecisionType;
  strategyId?: string;
  strategyName?: string;
  instrument?: string;
  direction?: string;
  confidence?: number;
  riskCheckResult?: {
    allowed: boolean;
    reason: string | null;
  };
  orderDetails?: {
    orderId?: string;
    tradeId?: string;
    units?: number;
    price?: number;
    stopLoss?: number;
    takeProfit?: number;
    type?: string;
  };
  tradeResult?: {
    tradeId?: string;
    pnl?: number;
    exitReason?: string;
  };
  indicatorValues?: Record<string, number>;
  triggeredConditions?: string[];
  message?: string;
  metadata?: Record<string, any>;
}

const decisionLogSchema = new Schema<IDecisionLogDoc>({
  timestamp: { type: Date, required: true, index: true },
  type: { type: String, required: true, index: true },
  strategyId: { type: String, index: true },
  strategyName: String,
  instrument: { type: String, index: true },
  direction: String,
  confidence: Number,
  riskCheckResult: {
    allowed: Boolean,
    reason: String,
  },
  orderDetails: Schema.Types.Mixed,
  tradeResult: Schema.Types.Mixed,
  indicatorValues: Schema.Types.Mixed,
  triggeredConditions: [String],
  message: String,
  metadata: Schema.Types.Mixed,
}, { timestamps: true });

decisionLogSchema.index({ timestamp: -1 });
decisionLogSchema.index({ type: 1, timestamp: -1 });

export const DecisionLogModel = mongoose.model<IDecisionLogDoc>('DecisionLog', decisionLogSchema);
