import { useState, useEffect } from 'react';
import { subscribePricing, unsubscribePricing, onPriceUpdate, type PriceUpdate } from '../../services/socket';

interface Props {
  instrument: string;
}

export function PriceTicker({ instrument }: Props) {
  const [price, setPrice] = useState<PriceUpdate | null>(null);

  useEffect(() => {
    subscribePricing([instrument]);
    const unsub = onPriceUpdate((p) => {
      if (p.instrument === instrument) setPrice(p);
    });
    return () => {
      unsub();
      unsubscribePricing([instrument]);
    };
  }, [instrument]);

  if (!price) return <div style={styles.ticker}>Connecting to {instrument.replace('_', '/')}...</div>;

  return (
    <div style={styles.ticker}>
      <span style={styles.pair}>{instrument.replace('_', '/')}</span>
      <span style={styles.bid}>Bid: {price.bid.toFixed(5)}</span>
      <span style={styles.ask}>Ask: {price.ask.toFixed(5)}</span>
      <span style={styles.spread}>Spread: {(price.spread * 10000).toFixed(1)} pips</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  ticker: {
    display: 'flex', alignItems: 'center', gap: 20,
    background: '#16213e', borderRadius: 8, padding: '12px 16px', marginBottom: 12,
    color: '#d1d4dc', fontSize: 14,
  },
  pair: { fontWeight: 'bold', fontSize: 18, color: '#fff' },
  bid: { color: '#26a69a' },
  ask: { color: '#ef5350' },
  spread: { color: '#8a8a9a', fontSize: 12 },
};
