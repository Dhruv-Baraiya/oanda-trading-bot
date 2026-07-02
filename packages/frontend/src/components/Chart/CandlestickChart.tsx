import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  ColorType,
  type CandlestickData,
  type LineData,
  type HistogramData,
  type Time,
} from 'lightweight-charts';
import type { Candle, IndicatorSnapshot } from '../../services/api';
import { onPriceUpdate, type PriceUpdate } from '../../services/socket';

interface Props {
  candles: Candle[];
  indicators: IndicatorSnapshot[];
  instrument: string;
  height?: number;
}

function toTime(timestamp: string): Time {
  return (new Date(timestamp).getTime() / 1000) as Time;
}

export function CandlestickChart({ candles, indicators, instrument, height = 500 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const emaShortRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaMidRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaLongRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMiddleRef = useRef<ISeriesApi<'Line'> | null>(null);
  const lastCandleRef = useRef<{ time: Time; open: number; high: number; low: number; close: number; volume: number } | null>(null);

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
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#2a2a3e' },
      timeScale: { borderColor: '#2a2a3e', timeVisible: true },
    });

    const pricePrecision = instrument.includes('JPY') ? 3 : 5;
    const priceFormat = { type: 'price' as const, precision: pricePrecision, minMove: Math.pow(10, -pricePrecision) };

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      priceFormat,
    });

    const volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });

    const emaShort = chart.addLineSeries({ color: '#ffeb3b', lineWidth: 1, title: 'EMA 20' });
    const emaMid = chart.addLineSeries({ color: '#2196f3', lineWidth: 1, title: 'EMA 50' });
    const emaLong = chart.addLineSeries({ color: '#ff9800', lineWidth: 1, title: 'EMA 200' });

    const bbUpper = chart.addLineSeries({ color: '#9c27b0', lineWidth: 1, lineStyle: 2, title: 'BB Upper' });
    const bbMiddle = chart.addLineSeries({ color: '#9c27b0', lineWidth: 1, lineStyle: 1, title: 'BB Mid' });
    const bbLower = chart.addLineSeries({ color: '#9c27b0', lineWidth: 1, lineStyle: 2, title: 'BB Lower' });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    emaShortRef.current = emaShort;
    emaMidRef.current = emaMid;
    emaLongRef.current = emaLong;
    bbUpperRef.current = bbUpper;
    bbMiddleRef.current = bbMiddle;
    bbLowerRef.current = bbLower;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [height]);

  // Load candle data from API
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candleData: CandlestickData[] = candles.map(c => ({
      time: toTime(c.timestamp),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData: HistogramData[] = candles.map(c => ({
      time: toTime(c.timestamp),
      value: c.volume,
      color: c.close >= c.open ? 'rgba(38, 166, 154, 0.3)' : 'rgba(239, 83, 80, 0.3)',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    // Track the last candle for live updates
    if (candles.length > 0) {
      const last = candles[candles.length - 1];
      lastCandleRef.current = {
        time: toTime(last.timestamp),
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume,
      };
    }
  }, [candles]);

  // Live tick updates — move the last candle in real-time
  useEffect(() => {
    const unsub = onPriceUpdate((price: PriceUpdate) => {
      if (price.instrument !== instrument) return;
      if (!candleSeriesRef.current || !lastCandleRef.current) return;

      const mid = (price.bid + price.ask) / 2;
      const candle = lastCandleRef.current;

      candle.close = mid;
      if (mid > candle.high) candle.high = mid;
      if (mid < candle.low) candle.low = mid;

      candleSeriesRef.current.update({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
    });

    return unsub;
  }, [instrument]);

  // Indicator overlays
  useEffect(() => {
    if (!emaShortRef.current || !emaMidRef.current || !emaLongRef.current) return;
    if (!bbUpperRef.current || !bbMiddleRef.current || !bbLowerRef.current) return;

    const emaShortData: LineData[] = [];
    const emaMidData: LineData[] = [];
    const emaLongData: LineData[] = [];
    const bbUpperData: LineData[] = [];
    const bbMiddleData: LineData[] = [];
    const bbLowerData: LineData[] = [];

    for (const ind of indicators) {
      const time = toTime(ind.timestamp);
      if (ind.ema) {
        emaShortData.push({ time, value: ind.ema.short });
        emaMidData.push({ time, value: ind.ema.mid });
        emaLongData.push({ time, value: ind.ema.long });
      }
      if (ind.bollingerBands) {
        bbUpperData.push({ time, value: ind.bollingerBands.upper });
        bbMiddleData.push({ time, value: ind.bollingerBands.middle });
        bbLowerData.push({ time, value: ind.bollingerBands.lower });
      }
    }

    emaShortRef.current.setData(emaShortData);
    emaMidRef.current.setData(emaMidData);
    emaLongRef.current.setData(emaLongData);
    bbUpperRef.current.setData(bbUpperData);
    bbMiddleRef.current.setData(bbMiddleData);
    bbLowerRef.current.setData(bbLowerData);
  }, [indicators]);

  return <div ref={containerRef} style={{ width: '100%' }} />;
}
