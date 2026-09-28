import React, { useEffect, useRef } from 'react';
import { createChart, ColorType, IChartApi, ISeriesApi, LineSeries, HistogramSeries, LineData, HistogramData } from 'lightweight-charts';
import { MinutePoint } from '../types.ts';

interface Props {
  points: MinutePoint[];
  prevClose: number;
  height?: number;
}

export const MinuteChart: React.FC<Props> = ({ points, prevClose, height }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const avgSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const prevCloseLineRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 11
      },
      grid: {
        vertLines: { color: 'rgba(51, 65, 85, 0.4)' },
        horzLines: { color: 'rgba(51, 65, 85, 0.4)' }
      },
      localization: {
        locale: 'zh-CN',
        timeFormatter: (timestamp: number) => {
          const date = new Date(timestamp * 1000);
          return date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
        }
      },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 4,
        tickMarkFormatter: (timestamp: number) => {
          const date = new Date(timestamp * 1000);
          return date.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
        }
      },
      rightPriceScale: {
        borderColor: '#334155',
        scaleMargins: { top: 0.1, bottom: 0.25 }
      },
      crosshair: {
        vertLine: { color: '#64748b', width: 1, style: 3 },
        horzLine: { color: '#64748b', width: 1, style: 3 }
      }
    });

    // 价格线 (主分时线 - lightweight-charts v5 addSeries)
    const priceSeries = chart.addSeries(LineSeries, {
      color: '#38bdf8',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
    });

    // 均价线 (黄色)
    const avgSeries = chart.addSeries(LineSeries, {
      color: '#eab308',
      lineWidth: 1,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
    });

    // 成交量柱状图 (放在底端)
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volumeScale'
    });

    chart.priceScale('volumeScale').applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 }
    });

    chartRef.current = chart;
    priceSeriesRef.current = priceSeries;
    avgSeriesRef.current = avgSeries;
    volumeSeriesRef.current = volumeSeries;

    // 自适应大小
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

  // 更新数据点
  useEffect(() => {
    if (!priceSeriesRef.current || !avgSeriesRef.current || !volumeSeriesRef.current || points.length === 0) {
      return;
    }

    // 获取当前的北京日期 (yyyy-MM-dd)
    const beijingFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    const todayStr = beijingFormatter.format(new Date()); // 格式 "2026-09-26"
    const priceData: LineData[] = [];
    const avgData: LineData[] = [];
    const volData: HistogramData[] = [];

    // 校验成交量数据是否具有累计单调递增特征，若是则自动做一阶差分计算单分钟成交量
    let isCumulativeVolume = false;
    if (points.length >= 10) {
      let monotonicCount = 0;
      for (let i = 1; i < Math.min(points.length, 25); i++) {
        if (points[i].volume >= points[i - 1].volume) monotonicCount++;
      }
      if (monotonicCount >= Math.min(points.length, 25) - 3 && points[points.length - 1].volume > points[0].volume * 3) {
        isCumulativeVolume = true;
      }
    }

    // 确保时间按递增顺序排列并转为时间戳 (+08:00)
    points.forEach((p, idx) => {
      const timeStr = p.time.length === 5 ? `${p.time}:00` : p.time;
      const d = new Date(`${todayStr}T${timeStr}+08:00`);
      const timestamp = Math.floor(d.getTime() / 1000);

      priceData.push({
        time: timestamp as any,
        value: p.price
      });

      if (p.avg_price > 0) {
        avgData.push({
          time: timestamp as any,
          value: p.avg_price
        });
      }

      // 如果是累计量则取差分，否则直接取单分钟量
      let barVol = p.volume;
      if (isCumulativeVolume) {
        barVol = idx === 0 ? p.volume : Math.max(0, p.volume - points[idx - 1].volume);
      }

      const isUp = idx === 0 ? p.price >= prevClose : p.price >= points[idx - 1].price;
      volData.push({
        time: timestamp as any,
        value: barVol,
        color: isUp ? 'rgba(239, 68, 68, 0.65)' : 'rgba(16, 185, 129, 0.65)'
      });
    });

    priceSeriesRef.current.setData(priceData);
    avgSeriesRef.current.setData(avgData);
    volumeSeriesRef.current.setData(volData);

    if (prevClose > 0) {
      if (prevCloseLineRef.current) {
        try {
          priceSeriesRef.current.removePriceLine(prevCloseLineRef.current);
        } catch (e) {
          // ignore
        }
        prevCloseLineRef.current = null;
      }
      try {
        prevCloseLineRef.current = priceSeriesRef.current.createPriceLine({
          price: prevClose,
          color: 'rgba(148, 163, 184, 0.45)',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: '昨收'
        });
      } catch (e) {
        // ignore
      }
    }

    chartRef.current?.timeScale().fitContent();
  }, [points, prevClose]);

  return (
    <div
      className="relative w-full bg-slate-950/70 border border-slate-800/80 rounded-xl p-2 flex flex-col"
      style={{ height: height ? `${height}px` : '100%', minHeight: height ? undefined : '360px' }}
    >
      <div className="absolute top-3 left-4 z-10 flex items-center space-x-4 text-xs font-mono bg-slate-900/80 px-2 py-1 rounded backdrop-blur-xs">
        <span className="flex items-center text-sky-400">
          <span className="w-2.5 h-0.5 bg-sky-400 rounded-full mr-1.5" />
          分时价格线
        </span>
        <span className="flex items-center text-amber-400">
          <span className="w-2.5 h-0.5 bg-amber-400 rounded-full mr-1.5" />
          分时均价线
        </span>
        {prevClose > 0 && (
          <span className="text-slate-500">
            昨收基准: ¥{prevClose.toFixed(2)}
          </span>
        )}
      </div>
      <div ref={containerRef} className="w-full flex-1" />
    </div>
  );
};
