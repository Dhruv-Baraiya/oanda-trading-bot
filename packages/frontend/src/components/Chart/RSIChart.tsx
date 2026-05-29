import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  ColorType,
  type LineData,
  type Time,
} from 'lightweight-charts';
import type { IndicatorSnapshot } from '../../services/api';

interface Props {
  indicators: IndicatorSnapshot[];
  height?: number;
}

export function RSIChart({ indicators, height = 150 }: Props) {
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

    const rsiSeries = chart.addLineSeries({
      color: '#e91e63',
      lineWidth: 2,
      title: 'RSI(14)',
    });

    const obLine = chart.addLineSeries({
      color: 'rgba(255,255,255,0.2)',
      lineWidth: 1,
      lineStyle: 2,
    });

    const osLine = chart.addLineSeries({
      color: 'rgba(255,255,255,0.2)',
      lineWidth: 1,
      lineStyle: 2,
    });

    const rsiData: LineData[] = [];
    const obData: LineData[] = [];
    const osData: LineData[] = [];

    for (const ind of indicators) {
      if (ind.rsi) {
        const time = (new Date(ind.timestamp).getTime() / 1000) as Time;
        rsiData.push({ time, value: ind.rsi.value });
        obData.push({ time, value: 70 });
        osData.push({ time, value: 30 });
      }
    }

    rsiSeries.setData(rsiData);
    obLine.setData(obData);
    osLine.setData(osData);

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
      <div style={{ color: '#d1d4dc', fontSize: 12, padding: '4px 0', fontWeight: 'bold' }}>RSI (14)</div>
      <div ref={containerRef} style={{ width: '100%' }} />
    </div>
  );
}
