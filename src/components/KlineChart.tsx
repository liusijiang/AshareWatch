import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, CandlestickSeries, HistogramSeries, CandlestickData, HistogramData } from 'lightweight-charts';
import { KlinePoint } from '../types.ts';

interface Props {
  data: KlinePoint[];
  period?: 'day' | 'week' | 'month';
  height?: number;
}

export const KlineChart: React.FC<Props> = ({ data, period = 'day', height }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 11
      },
      localization: {
        locale: 'zh-CN',
        dateFormat: 'yyyy-MM-dd'
      },
      grid: {
        vertLines: { color: 'rgba(51, 65, 85, 0.4)' },
        horzLines: { color: 'rgba(51, 65, 85, 0.4)' }
      },
      timeScale: {
        borderColor: '#334155',
        barSpacing: 6
      },
      rightPriceScale: {
        borderColor: '#334155',
        scaleMargins: { top: 0.1, bottom: 0.25 }
      }
    });

    // A股红涨绿跌蜡烛图 - lightweight-charts v5 addSeries
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',
      downColor: '#10b981',
      borderUpColor: '#ef4444',
      borderDownColor: '#10b981',
      wickUpColor: '#ef4444',
      wickDownColor: '#10b981'
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'klineVolume'
    });

    chart.priceScale('klineVolume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 }
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0] && containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || data.length === 0) {
      return;
    }

    const candleData: CandlestickData[] = [];
    const volData: HistogramData[] = [];

    // 时间转换与格式化
    for (const bar of data) {
      // time: "2026-09-25"
      const timeStr = bar.time.includes(' ') ? bar.time.split(' ')[0] : bar.time;
      candleData.push({
        time: timeStr as any,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close
      });

      const isUp = bar.close >= bar.open;
      volData.push({
        time: timeStr as any,
        value: bar.volume,
        color: isUp ? 'rgba(239, 68, 68, 0.65)' : 'rgba(16, 185, 129, 0.65)'
      });
    }

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volData);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  const periodName = period === 'week' ? '周K线' : period === 'month' ? '月K线' : '日K线';
  const unitName = period === 'week' ? '周' : period === 'month' ? '月' : '交易日';

  return (
    <div
      className="relative w-full bg-slate-950/70 border border-slate-800/80 rounded-xl p-2 flex flex-col"
      style={{ height: height ? `${height}px` : '100%', minHeight: height ? undefined : '360px' }}
    >
      <div className="absolute top-3 left-4 z-10 flex items-center space-x-3 text-xs font-mono bg-slate-900/80 px-2 py-1 rounded backdrop-blur-xs">
        <span className="flex items-center text-slate-300">
          <span className="w-2.5 h-2.5 bg-rose-500 rounded-sm mr-1" />
          前复权{periodName}
        </span>
        <span className="text-slate-500">最近 {data.length} {unitName}</span>
      </div>
      <div ref={containerRef} className="w-full flex-1" />
    </div>
  );
};
