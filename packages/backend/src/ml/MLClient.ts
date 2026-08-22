export interface MLPrediction {
  universal: {
    direction: 'UP' | 'DOWN' | 'FLAT';
    direction_probabilities: { UP: number; DOWN: number; FLAT: number };
    magnitude_pips: number;
    inference_time_ms: number;
  } | null;
  specialist: {
    signal_confidence: number;
    size_multiplier: number;
    inference_time_ms: number;
  } | null;
  meta: {
    action: string;
    direction: string | null;
    confidence: number;
    size_factor: number;
    ai_direction?: string;
    ai_probability?: number;
    reasoning: string[];
  };
  inference_time_ms: number;
}

export class MLClient {
  private baseUrl: string;
  private timeout: number;
  private enabled: boolean;
  private consecutiveFailures = 0;
  private suppressedUntil = 0;

  constructor(baseUrl?: string, timeout = 5000) {
    this.baseUrl = baseUrl || process.env.ML_SERVICE_URL || 'http://localhost:8000';
    this.timeout = timeout;
    this.enabled = true;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async predict(params: {
    instrument: string;
    candles_h1: any[];
    candles_m1?: any[];
    candles_m15?: any[];
    candles_h4?: any[];
    indicators?: Record<string, number>;
    sentiment?: Record<string, number>;
    rule_signal?: { direction: string; strategy_name: string };
  }): Promise<MLPrediction | null> {
    if (!this.enabled) return null;
    if (Date.now() < this.suppressedUntil) return null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      const res = await fetch(`${this.baseUrl}/predict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instrument: params.instrument,
          candles_h1: params.candles_h1.map(c => ({
            t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
          })),
          candles_m1: params.candles_m1?.map(c => ({
            t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
          })),
          candles_m15: params.candles_m15?.map(c => ({
            t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
          })),
          candles_h4: params.candles_h4?.map(c => ({
            t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume,
          })),
          indicators: params.indicators,
          sentiment: params.sentiment,
          rule_signal: params.rule_signal,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        this.consecutiveFailures++;
        if (this.consecutiveFailures <= 3) {
          console.error(`[MLClient] ML service error: ${res.status}`);
        }
        if (this.consecutiveFailures === 5) {
          this.suppressedUntil = Date.now() + 10 * 60 * 1000;
          console.warn(`[MLClient] 5 consecutive failures — suppressing for 10min, falling back to rules-only`);
        }
        return null;
      }

      this.consecutiveFailures = 0;
      return await res.json() as MLPrediction;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        console.warn('[MLClient] ML service timeout, falling back to rules-only');
      } else {
        console.warn('[MLClient] ML service unavailable:', err.message);
      }
      return null;
    }
  }

  async health(): Promise<{ status: string; model_loaded: boolean } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }
}
