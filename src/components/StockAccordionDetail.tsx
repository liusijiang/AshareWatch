import React, { useState, useEffect } from 'react';
import { TrendingUp, BarChart3, ChevronUp, ExternalLink, Loader2, Info } from 'lucide-react';
import { StockPoolItem, QuoteSnapshot, MinutePoint, KlinePoint } from '../types.ts';
import { MinuteChart } from './MinuteChart.tsx';
import { KlineChart } from './KlineChart.tsx';

interface Props {
  stock: StockPoolItem;
  quote?: QuoteSnapshot;
  onCollapse: () => void;
  onOpenFullDetail?: () => void;
  realtimeMinutePoints?: MinutePoint[];
}

export const StockAccordionDetail: React.FC<Props> = ({
  stock,
  quote,
  onCollapse,
  onOpenFullDetail,
  realtimeMinutePoints
}) => {
  const [tab, setTab] = useState<'minute' | 'kline'>('minute');
  const [minutePoints, setMinutePoints] = useState<MinutePoint[]>([]);
  const [klines, setKlines] = useState<KlinePoint[]>([]);
  const [loadingMinute, setLoadingMinute] = useState(false);
  const [loadingKline, setLoadingKline] = useState(false);

  // 实时 SSE 分时走势同步
  useEffect(() => {
    if (realtimeMinutePoints && realtimeMinutePoints.length > 0) {
      setMinutePoints(realtimeMinutePoints);
    }
  }, [realtimeMinutePoints]);

  // 展开时激活并拉取分时走势与日K线
  useEffect(() => {
    let isMounted = true;

    // 激活后台对当前标的的高频分时/逐笔调度
    fetch('/api/active-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: stock.code, action: 'enter' })
    }).catch(() => {});

    // 1. 加载分时数据
    setLoadingMinute(true);
    fetch(`/api/quotes/${stock.code}/minute`)
      .then(res => res.json())
      .then(data => {
        if (isMounted && Array.isArray(data)) {
          setMinutePoints(data);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (isMounted) setLoadingMinute(false);
      });

    // 2. 预载日K线数据
    setLoadingKline(true);
    fetch(`/api/quotes/${stock.code}/kline?period=day`)
      .then(res => res.json())
      .then(data => {
        if (isMounted && Array.isArray(data)) {
          setKlines(data);
        }
      })
      .catch(console.error)
      .finally(() => {
        if (isMounted) setLoadingKline(false);
      });

    return () => {
      isMounted = false;
      fetch('/api/active-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: stock.code, action: 'leave' })
      }).catch(() => {});
    };
  }, [stock.code]);

  // 格式化金额
  const formatAmount = (amt?: number) => {
    if (!amt) return '--';
    if (amt >= 100000000) return `${(amt / 100000000).toFixed(2)}亿`;
    if (amt >= 10000) return `${(amt / 10000).toFixed(1)}万`;
    return amt.toFixed(0);
  };

  const isUp = (quote?.change_pct ?? 0) > 0;
  const isDown = (quote?.change_pct ?? 0) < 0;
  const priceColor = isUp ? 'text-rose-400' : isDown ? 'text-emerald-400' : 'text-slate-300';
  const prevClose = quote?.prev_close || quote?.open || 0;
  const amplitude = prevClose && quote?.high && quote?.low
    ? (((quote.high - quote.low) / prevClose) * 100).toFixed(2)
    : '--';

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="bg-slate-900/95 border-y border-blue-500/30 px-3 py-2.5 space-y-2.5 shadow-inner transition-all animate-fadeIn"
    >
      {/* 1. 顶部控制栏：分时/日K切换与关键行情微矩阵 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
        {/* 分时 / 日K 切换 Tab */}
        <div className="flex items-center space-x-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
          <button
            onClick={() => setTab('minute')}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-medium transition ${
              tab === 'minute'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>分时走势</span>
          </button>
          <button
            onClick={() => setTab('kline')}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded-md text-xs font-medium transition ${
              tab === 'kline'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>日K线</span>
          </button>
        </div>

        {/* 关键数据微矩阵 */}
        <div className="flex items-center space-x-3 text-[11px] font-mono">
          <div>
            <span className="text-slate-500 mr-1">开:</span>
            <span className={quote && quote.open >= prevClose ? 'text-rose-400 font-semibold' : 'text-emerald-400 font-semibold'}>
              {quote?.open?.toFixed(2) || '--'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 mr-1">高:</span>
            <span className="text-rose-400 font-semibold">{quote?.high?.toFixed(2) || '--'}</span>
          </div>
          <div>
            <span className="text-slate-500 mr-1">低:</span>
            <span className="text-emerald-400 font-semibold">{quote?.low?.toFixed(2) || '--'}</span>
          </div>
          <div className="hidden sm:block">
            <span className="text-slate-500 mr-1">额:</span>
            <span className="text-slate-200">{formatAmount(quote?.amount)}</span>
          </div>
          <div className="hidden sm:block">
            <span className="text-slate-500 mr-1">振幅:</span>
            <span className="text-slate-300">{amplitude}%</span>
          </div>
        </div>

        {/* 操作快捷按钮 */}
        <div className="flex items-center space-x-1.5 ml-auto">
          {onOpenFullDetail && (
            <button
              onClick={onOpenFullDetail}
              className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[11px] text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 transition"
              title="查看五档盘口与完整详情"
            >
              <span>盘口明细</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={onCollapse}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
            title="收起"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. 图表主渲染区域 (高度适配平板/手机竖屏) */}
      <div className="w-full h-[210px] bg-slate-950/90 rounded-lg border border-slate-800/80 relative overflow-hidden flex flex-col justify-center">
        {tab === 'minute' ? (
          loadingMinute && minutePoints.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              <span>正在获取分时走势...</span>
            </div>
          ) : minutePoints.length === 0 ? (
            <div className="flex items-center justify-center text-slate-500 text-xs">
              暂无分时数据或未开盘
            </div>
          ) : (
            <MinuteChart
              points={minutePoints}
              prevClose={prevClose}
              height={208}
            />
          )
        ) : (
          loadingKline && klines.length === 0 ? (
            <div className="flex flex-col items-center justify-center space-y-2 text-slate-500 text-xs">
              <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
              <span>正在加载历史日K线...</span>
            </div>
          ) : klines.length === 0 ? (
            <div className="flex items-center justify-center text-slate-500 text-xs">
              暂无日K线数据
            </div>
          ) : (
            <KlineChart
              data={klines}
              period="day"
              height={208}
            />
          )
        )}
      </div>

      {/* 3. 底部信息：赛道定位与投资逻辑摘要 */}
      {(stock.logic || stock.risk) && (
        <div className="pt-1 border-t border-slate-800/60 flex items-start space-x-2 text-[11px] text-slate-400 leading-relaxed">
          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
          <div className="truncate">
            <span className="text-slate-300 font-medium mr-1.5">核心逻辑:</span>
            <span>{stock.logic || '优质龙头赛道'}</span>
            {stock.risk && (
              <span className="text-slate-500 ml-2">({stock.risk})</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
