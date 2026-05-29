import { EventEmitter } from 'events';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import type { PriceUpdate } from '../broker/types.js';

export type StreamState = 'CONNECTED' | 'STALE' | 'RECONNECTING' | 'DISCONNECTED';

export interface StreamHealthStatus {
  state: StreamState;
  lastTickTime: number;
  lastTickAge: number;
  reconnectCount: number;
  entriesPaused: boolean;
  instruments: string[];
}

interface StreamHealthConfig {
  staleThresholdMs: number;
  reconnectDelayMs: number;
  maxReconnectAttempts: number;
  checkIntervalMs: number;
}

const DEFAULT_CONFIG: StreamHealthConfig = {
  staleThresholdMs: 5000,
  reconnectDelayMs: 2000,
  maxReconnectAttempts: 10,
  checkIntervalMs: 1000,
};

export class StreamHealthMonitor extends EventEmitter {
  private config: StreamHealthConfig;
  private state: StreamState = 'DISCONNECTED';
  private lastTickTime = 0;
  private reconnectCount = 0;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private stopStream: (() => void) | null = null;
  private instruments: string[] = [];
  private broker: BrokerAdapter;
  private onPriceCallback: ((price: PriceUpdate) => void) | null = null;

  constructor(broker: BrokerAdapter, config: Partial<StreamHealthConfig> = {}) {
    super();
    this.broker = broker;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  start(instruments: string[], onPrice: (price: PriceUpdate) => void): void {
    this.instruments = instruments;
    this.onPriceCallback = onPrice;
    this.connect();
    this.startHealthCheck();
  }

  stop(): void {
    if (this.stopStream) {
      this.stopStream();
      this.stopStream = null;
    }
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    this.setState('DISCONNECTED');
  }

  updateInstruments(instruments: string[]): void {
    this.instruments = instruments;
    if (this.state === 'CONNECTED' || this.state === 'STALE') {
      this.reconnect();
    }
  }

  onTick(): void {
    this.lastTickTime = Date.now();
    if (this.state !== 'CONNECTED') {
      this.setState('CONNECTED');
      this.reconnectCount = 0;
    }
  }

  getStatus(): StreamHealthStatus {
    return {
      state: this.state,
      lastTickTime: this.lastTickTime,
      lastTickAge: this.lastTickTime > 0 ? Date.now() - this.lastTickTime : -1,
      reconnectCount: this.reconnectCount,
      entriesPaused: this.state !== 'CONNECTED',
      instruments: [...this.instruments],
    };
  }

  isHealthy(): boolean {
    return this.state === 'CONNECTED';
  }

  private connect(): void {
    if (this.stopStream) {
      this.stopStream();
    }

    if (this.instruments.length === 0) {
      this.setState('DISCONNECTED');
      return;
    }

    this.stopStream = this.broker.streamPricing(
      this.instruments,
      (price) => {
        this.onTick();
        this.onPriceCallback?.(price);
      }
    );

    if (this.lastTickTime === 0) {
      this.setState('CONNECTED');
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectCount >= this.config.maxReconnectAttempts) {
      this.setState('DISCONNECTED');
      this.emit('max-reconnects', { count: this.reconnectCount });
      return;
    }

    this.setState('RECONNECTING');
    this.reconnectCount++;

    this.emit('reconnecting', {
      attempt: this.reconnectCount,
      max: this.config.maxReconnectAttempts,
    });

    if (this.stopStream) {
      this.stopStream();
      this.stopStream = null;
    }

    await delay(this.config.reconnectDelayMs);
    this.connect();
  }

  private startHealthCheck(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);

    this.checkTimer = setInterval(() => {
      if (this.state === 'DISCONNECTED' || this.state === 'RECONNECTING') return;
      if (this.instruments.length === 0) return;

      const elapsed = Date.now() - this.lastTickTime;

      if (this.lastTickTime > 0 && elapsed > this.config.staleThresholdMs) {
        if (this.state === 'CONNECTED') {
          this.setState('STALE');
          this.emit('stale', { elapsed, threshold: this.config.staleThresholdMs });
        }

        if (elapsed > this.config.staleThresholdMs * 2) {
          this.reconnect();
        }
      }
    }, this.config.checkIntervalMs);
  }

  private setState(newState: StreamState): void {
    if (this.state === newState) return;
    const oldState = this.state;
    this.state = newState;
    this.emit('state-change', { from: oldState, to: newState });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
