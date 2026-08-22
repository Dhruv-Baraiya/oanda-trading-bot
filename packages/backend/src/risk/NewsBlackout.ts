const BLACKOUT_MINUTES = 15;
const POLL_INTERVAL_MS = 60 * 60 * 1000;

interface ScheduledEvent {
  name: string;
  date: string;
  time: string;
  currencies: string[];
}

interface BlackoutResult {
  blocked: boolean;
  reason: string | null;
}

// FOMC announcement dates 2026 — 14:00 ET (18:00 UTC)
const FOMC_2026 = [
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17',
  '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
];

// ECB rate decisions 2026 — 13:15 CET (12:15 UTC)
const ECB_2026 = [
  '2026-01-22', '2026-03-05', '2026-04-16', '2026-06-04',
  '2026-07-16', '2026-09-10', '2026-10-22', '2026-12-10',
];

// CPI release dates 2026 — 08:30 ET (12:30 UTC), typically 2nd or 3rd Tuesday/Wednesday
const CPI_2026 = [
  '2026-01-14', '2026-02-11', '2026-03-11', '2026-04-14',
  '2026-05-12', '2026-06-10', '2026-07-14', '2026-08-12',
  '2026-09-15', '2026-10-13', '2026-11-10', '2026-12-09',
];

// PPI release dates 2026 — 08:30 ET (12:30 UTC), typically day before or after CPI
const PPI_2026 = [
  '2026-01-15', '2026-02-12', '2026-03-12', '2026-04-09',
  '2026-05-13', '2026-06-11', '2026-07-15', '2026-08-13',
  '2026-09-16', '2026-10-14', '2026-11-12', '2026-12-10',
];

function buildSchedule(): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];

  for (const d of FOMC_2026) {
    events.push({ name: 'FOMC Rate Decision', date: d, time: '18:00', currencies: ['USD'] });
  }
  for (const d of ECB_2026) {
    events.push({ name: 'ECB Rate Decision', date: d, time: '12:15', currencies: ['EUR'] });
  }
  for (const d of CPI_2026) {
    events.push({ name: 'US CPI Release', date: d, time: '12:30', currencies: ['USD'] });
  }
  for (const d of PPI_2026) {
    events.push({ name: 'US PPI Release', date: d, time: '12:30', currencies: ['USD'] });
  }

  // NFP — first Friday of each month, 08:30 ET (12:30 UTC)
  for (let month = 0; month < 12; month++) {
    const firstDay = new Date(Date.UTC(2026, month, 1));
    const dayOfWeek = firstDay.getUTCDay();
    const fridayOffset = dayOfWeek <= 5 ? (5 - dayOfWeek) : (5 + 7 - dayOfWeek);
    const nfpDate = new Date(Date.UTC(2026, month, 1 + fridayOffset));
    events.push({
      name: 'Non-Farm Payrolls',
      date: nfpDate.toISOString().split('T')[0],
      time: '12:30',
      currencies: ['USD'],
    });
  }

  return events;
}

export class NewsBlackout {
  private static instance: NewsBlackout;
  private events: ScheduledEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  static getInstance(): NewsBlackout {
    if (!NewsBlackout.instance) {
      NewsBlackout.instance = new NewsBlackout();
    }
    return NewsBlackout.instance;
  }

  async start(): Promise<void> {
    this.events = buildSchedule();
    console.log(`[NewsBlackout] Loaded ${this.events.length} scheduled high-impact events for 2026`);

    // Hourly refresh in case we add dynamic sources later
    this.timer = setInterval(() => {
      this.events = buildSchedule();
    }, POLL_INTERVAL_MS);
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
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    for (const ev of this.events) {
      if (ev.date !== today) continue;
      if (!ev.currencies.some(c => currencies.includes(c))) continue;

      const eventTime = new Date(`${ev.date}T${ev.time}:00Z`).getTime();
      const diffMs = Math.abs(now - eventTime);

      if (diffMs <= BLACKOUT_MINUTES * 60 * 1000) {
        const minsAway = Math.round(diffMs / 60000);
        const when = now < eventTime ? `in ${minsAway}min` : `${minsAway}min ago`;
        return {
          blocked: true,
          reason: `News blackout: ${ev.name} ${when}`,
        };
      }
    }

    return { blocked: false, reason: null };
  }
}
