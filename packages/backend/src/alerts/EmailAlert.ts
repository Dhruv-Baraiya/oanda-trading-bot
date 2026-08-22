import sgMail from '@sendgrid/mail';

const RATE_LIMIT_MS = 5 * 60 * 1000;

export class EmailAlert {
  private static instance: EmailAlert;
  private enabled = false;
  private toEmail: string;
  private lastSent = new Map<string, number>();

  private constructor() {
    const apiKey = process.env.SENDGRID_API_KEY;
    this.toEmail = process.env.ALERT_EMAIL || '';

    if (apiKey && this.toEmail) {
      sgMail.setApiKey(apiKey);
      this.enabled = true;
      console.log(`[EmailAlert] Enabled — alerts to ${this.toEmail}`);
    } else {
      console.warn('[EmailAlert] Disabled — missing SENDGRID_API_KEY or ALERT_EMAIL');
    }
  }

  static getInstance(): EmailAlert {
    if (!EmailAlert.instance) {
      EmailAlert.instance = new EmailAlert();
    }
    return EmailAlert.instance;
  }

  async sendAlert(subject: string, body: string, eventType?: string): Promise<void> {
    if (!this.enabled) return;

    const key = eventType || subject;
    const lastTime = this.lastSent.get(key) || 0;
    if (Date.now() - lastTime < RATE_LIMIT_MS) return;

    try {
      await sgMail.send({
        to: this.toEmail,
        from: 'alerts@tradingbot.dev',
        subject: `[TradingBot] ${subject}`,
        text: body,
      });
      this.lastSent.set(key, Date.now());
      console.log(`[EmailAlert] Sent: ${subject}`);
    } catch (err: any) {
      console.error(`[EmailAlert] Failed: ${err.message}`);
    }
  }
}
