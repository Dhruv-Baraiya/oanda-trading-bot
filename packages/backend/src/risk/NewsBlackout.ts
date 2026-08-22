const CURRENCY_COUNTRIES: Record<string, string[]> = {
  USD: ['US'],
  EUR: ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'FI', 'IE', 'PT', 'GR'],
  GBP: ['GB'],
  JPY: ['JP'],
  AUD: ['AU'],
  NZD: ['NZ'],
  CAD: ['CA'],
  CHF: ['CH'],
};

const BLACKOUT_MINUTES = 15;
const POLL_INTERVAL_MS = 30 * 60 * 1000;

interface EconomicEvent {
  country: string;
  event: string;
  impact: string;
  time: string;
  date: string;
}

interface BlackoutResult {
  blocked: boolean;
  reason: string | null;
}

export class NewsBlackout {
  private static instance: NewsBlackout;
  private events: EconomicEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  static getInstance(): NewsBlackout {
    if (!NewsBlackout.instance) {
      NewsBlackout.instance = new NewsBlackout();
    }
    return NewsBlackout.instance;
  }

  async start(): Promise<void> {
    await this.fetchEvents();
    this.timer = setInterval(() => this.fetchEvents(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  checkNewsBlackout(instrument: string): BlackoutResult {
    if (this.events.length === 0) {
      return { blocked: false, reason: null };
    }

    const currencies = instrument.split('_');
    const relevantCountries = new Set<string>();
    for (const cur of currencies) {
      const countries = CURRENCY_COUNTRIES[cur];
      if (countries) countries.forEach(c => relevantCountries.add(c));
    }

    if (relevantCountries.size === 0) {
      return { blocked: false, reason: null };
    }

    const now = Date.now();

    for (const ev of this.events) {
      if (!relevantCountries.has(ev.country)) continue;

      const eventTime = this.parseEventTime(ev);
      if (!eventTime) continue;

      const diffMs = Math.abs(now - eventTime);
      if (diffMs <= BLACKOUT_MINUTES * 60 * 1000) {
        const minsAway = Math.round(diffMs / 60000);
        const when = now < eventTime ? `in ${minsAway}min` : `${minsAway}min ago`;
        return {
          blocked: true,
          reason: `News blackout: ${ev.event} (${ev.country}) ${when}`,
        };
      }
    }

    return { blocked: false, reason: null };
  }

  private parseEventTime(ev: EconomicEvent): number | null {
    try {
      if (ev.date && ev.time) {
        return new Date(`${ev.date}T${ev.time}:00Z`).getTime();
      }
      if (ev.date) {
        return new Date(`${ev.date}T00:00:00Z`).getTime();
      }
      return null;
    } catch {
      return null;
    }
  }

  private async fetchEvents(): Promise<void> {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) {
      console.warn('[NewsBlackout] No FINNHUB_API_KEY — skipping');
      return;
    }

    try {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const from = today.toISOString().split('T')[0];
      const to = tomorrow.toISOString().split('T')[0];

      const res = await fetch(
        `https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${apiKey}`
      );

      if (!res.ok) {
        console.warn(`[NewsBlackout] Finnhub API error: ${res.status}`);
        return;
      }

      const data = await res.json() as { economicCalendar?: EconomicEvent[] };
      const all = data.economicCalendar ?? [];
      this.events = all.filter(e => e.impact === 'high');
      console.log(`[NewsBlackout] Loaded ${this.events.length} high-impact events`);
    } catch (err: any) {
      console.warn(`[NewsBlackout] Fetch failed: ${err.message}`);
    }
  }
}
