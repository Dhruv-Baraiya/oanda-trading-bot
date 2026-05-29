import { useRef, useEffect } from 'react';
import { createChart, type IChartApi, type ISeriesApi, ColorType } from 'lightweight-charts';
import type { EquityPoint } from '../../services/api';

interface Props {
  equityCurve: EquityPoint[];
  height?: number;
}

export function EquityCurveChart({ equityCurve, height = 250 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || equityCurve.length === 0) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0d1b3e' },
        textColor: '#8a8a9a',
      },
      grid: {
        vertLines: { color: '#1a2744' },
        horzLines: { color: '#1a2744' },
      },
      rightPriceScale: { borderColor: '#2a2a3e' },
      timeScale: { borderColor: '#2a2a3e', timeVisible: true },
    });

    const equitySeries = chart.addAreaSeries({
      topColor: 'rgba(38,166,154,0.4)',
      bottomColor: 'rgba(38,166,154,0.0)',
      lineColor: '#26a69a',
      lineWidth: 2,
    });

    const data = equityCurve.map(p => ({
      time: Math.floor(new Date(p.timestamp).getTime() / 1000) as any,
      value: p.equity,
    }));

    equitySeries.setData(data);
    chart.timeScale().fitContent();
    chartRef.current = chart;

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
    };
  }, [equityCurve, height]);

  if (equityCurve.length === 0) {
    return <div style={{ color: '#8a8a9a', textAlign: 'center', padding: 20 }}>No data</div>;
  }

  return <div ref={containerRef} />;
}
