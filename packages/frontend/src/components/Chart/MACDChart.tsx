import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  ColorType,
  type LineData,
  type HistogramData,
  type Time,
} from 'lightweight-charts';
import type { IndicatorSnapshot } from '../../services/api';

interface Props {
  indicators: IndicatorSnapshot[];
  height?: number;
}

export function MACDChart({ indicators, height = 150 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#1a1a2e' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: '#2a2a3e' },
        horzLines: { color: '#2a2a3e' },
      },
      rightPriceScale: { borderColor: '#2a2a3e' },
      timeScale: { borderColor: '#2a2a3e', timeVisible: true },
    });

    const macdLine = chart.addLineSeries({ color: '#2196f3', lineWidth: 2, title: 'MACD' });
    const signalLine = chart.addLineSeries({ color: '#ff9800', lineWidth: 2, title: 'Signal' });
    const histogram = chart.addHistogramSeries({ title: 'Histogram' });

    const macdData: LineData[] = [];
    const signalData: LineData[] = [];
    const histData: HistogramData[] = [];

    for (const ind of indicators) {
      if (ind.macd) {
        const time = (new Date(ind.timestamp).getTime() / 1000) as Time;
        macdData.push({ time, value: ind.macd.macd });
        signalData.push({ time, value: ind.macd.signal });
        histData.push({
          time,
          value: ind.macd.histogram,
          color: ind.macd.histogram >= 0 ? 'rgba(38, 166, 154, 0.6)' : 'rgba(239, 83, 80, 0.6)',
        });
      }
    }

    macdLine.setData(macdData);
    signalLine.setData(signalData);
    histogram.setData(histData);

    chartRef.current = chart;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [indicators, height]);

  return (
    <div>
      <div style={{ color: '#d1d4dc', fontSize: 12, padding: '4px 0', fontWeight: 'bold' }}>MACD (12, 26, 9)</div>
      <div ref={containerRef} style={{ width: '100%' }} />
    </div>
  );
}
