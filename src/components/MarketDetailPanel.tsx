import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Layers,
  Clock,
  ShieldAlert,
  Lightbulb,
  FileText,
  Trash2,
  Activity,
  BarChart3,
  Sparkles,
  Maximize2
} from 'lucide-react';
import { StockPoolItem, QuoteSnapshot, MinutePoint, TickPoint, KlinePoint, SupplementaryNote } from '../types.ts';
import { MinuteChart } from './MinuteChart.tsx';
import { KlineChart } from './KlineChart.tsx';

interface Props {
  stock: StockPoolItem | null;
  quote?: QuoteSnapshot;
  onDeleteStock: (code: string) => void;
  onRequestAuth: () => void;
  token: string | null;
}

export const MarketDetailPanel: React.FC<Props> = ({
  stock,
  quote,
  onDeleteStock,
  onRequestAuth,
  token
}) => {
  const [activeTab, setActiveTab] = useState<'minute' | 'kline' | 'ticks' | 'notes'>('minute');
  const [klinePeriod, setKlinePeriod] = useState<'day' | 'week' | 'month'>('day');
  const [minutePoints, setMinutePoints] = useState<MinutePoint[]>([]);
  const [ticks, setTicks] = useState<TickPoint[]>([]);
  const [klines, setKlines] = useState<KlinePoint[]>([]);
  const [note, setNote] = useState<SupplementaryNote | null>(null);
  const [loadingMinute, setLoadingMinute] = useState(false);
  const [loadingKline, setLoadingKline] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 挂载或切换股票时拉取详情数据与激活上游调度
  useEffect(() => {
    if (!stock) return;

    fetch('/api/active-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: stock.code, action: 'enter' })
    }).catch(() => {});

    loadMinuteData(stock.code);
    loadTickData(stock.code);
    loadNoteData(stock.code);
    if (activeTab === 'kline') {
      loadKlineData(stock.code, klinePeriod);
    }

    return () => {
      fetch('/api/active-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: stock.code, action: 'leave' })
      }).catch(() => {});
    };
  }, [stock?.code]);

  const loadMinuteData = async (code: string) => {
    setLoadingMinute(true);
    try {
      const res = await fetch(`/api/quotes/${code}/minute`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setMinutePoints(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMinute(false);
    }
  };

  const loadTickData = async (code: string) => {
    try {
      const res = await fetch(`/api/quotes/${code}/tick`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setTicks(data.slice(-50).reverse());
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadKlineData = async (code: string, period: 'day' | 'week' | 'month' = klinePeriod) => {
    setLoadingKline(true);
    try {
      const res = await fetch(`/api/quotes/${code}/kline?period=${period}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setKlines(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingKline(false);
    }
  };

  const loadNoteData = async (code: string) => {
    try {
      const res = await fetch(`/api/notes/${code}`);
      if (res.ok) {
        const data = await res.json();
        setNote(data);
      } else {
        setNote(null);
      }
    } catch (e) {
      setNote(null);
    }
  };

  const handleDelete = async () => {
    if (!stock) return;
    if (!token) {
      onRequestAuth();
      return;
    }

    if (!confirm(`确定要将 ${stock.name} (${stock.code}) 从跟踪池中移除吗？`)) {
      return;
    }

    setDeleting(true);
    try {
      const res = await fetch(`/api/pool/${stock.code}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok || res.status === 204) {
        onDeleteStock(stock.code);
      } else {
        alert('删除标的失败，请确认管理授权');
      }
    } catch (err: any) {
      alert(err.message || '网络异常');
    } finally {
      setDeleting(false);
    }
  };

  if (!stock) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-500 bg-slate-950/40">
        <Activity className="w-12 h-12 text-slate-700 mb-3 animate-pulse" />
        <h3 className="text-sm font-semibold text-slate-400">请在左侧选择一只标的</h3>
        <p className="text-xs text-slate-600 mt-1 max-w-xs">
          选择后右侧将即时铺满高帧率分时走势图、五档深盘、逐笔成交与研报逻辑
        </p>
      </div>
    );
  }

  const isUp = (quote?.change_pct ?? 0) > 0;
  const isDown = (quote?.change_pct ?? 0) < 0;
  const priceColor = isUp ? 'text-rose-400' : isDown ? 'text-emerald-400' : 'text-slate-200';

  const maxOrderVol = Math.max(
    ...(quote?.bid.map(b => b[1]) || [1]),
    ...(quote?.ask.map(a => a[1]) || [1]),
    1
  );

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-950/50">
      {/* 紧凑顶部行情栏 */}
      <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800/80 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* 左侧：标的名称与行业信息 */}
          <div className="flex items-center space-x-2.5">
            <span className="px-1.5 py-0.5 text-[11px] font-mono font-bold rounded bg-slate-800 text-slate-300">
              {stock.market}.{stock.code}
            </span>
            <h2 className="text-base font-bold text-slate-100 flex items-center space-x-1.5">
              <span>{stock.name}</span>
              <span className={`text-[10px] px-1.5 py-0.2 rounded font-normal ${
                stock.tier === '重点观察' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' :
                stock.tier === '候补观察' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' :
                'bg-slate-700/40 text-slate-300'
              }`}>
                {stock.tier}
              </span>
            </h2>
            <div className="hidden xl:flex items-center text-xs text-slate-400 space-x-1">
              <span>{stock.industry_l1}</span>
              <span>·</span>
              <span className="text-sky-400/90 font-medium">【{stock.sub_sector || '主线细分'}】</span>
            </div>
          </div>

          {/* 右侧：删除操作 */}
          <div className="flex items-center space-x-2">
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="从跟踪池移除此标的"
              className="px-2 py-1 text-xs text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded transition flex items-center space-x-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">移除</span>
            </button>
          </div>
        </div>

        {/* 紧凑价格看板与盘口水平折叠栏 */}
        <div className="mt-2 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          {/* 实时报价 */}
          <div className="md:col-span-4 flex items-baseline space-x-3">
            <span className={`text-3xl font-extrabold font-mono tracking-tight ${priceColor}`}>
              ¥{quote?.price ? quote.price.toFixed(2) : '--'}
            </span>
            <div className="flex flex-col">
              <div className={`flex items-center text-xs font-bold font-mono ${priceColor}`}>
                {isUp ? <TrendingUp className="w-3.5 h-3.5 mr-0.5" /> : isDown ? <TrendingDown className="w-3.5 h-3.5 mr-0.5" /> : null}
                <span>{isUp ? '+' : ''}{quote?.change ? quote.change.toFixed(2) : '0.00'}</span>
                <span className="ml-1">({isUp ? '+' : ''}{quote?.change_pct ? quote.change_pct.toFixed(2) : '0.00'}%)</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">
                {quote?.timestamp ? new Date(quote.timestamp).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '--'} · {quote?.source || '多源对齐'}
              </span>
            </div>
          </div>

          {/* 紧凑指标条 */}
          <div className="md:col-span-4 grid grid-cols-3 gap-x-2 gap-y-0.5 text-[11px] font-mono">
            <div>
              <span className="text-slate-500 mr-1">今开:</span>
              <span className="text-slate-200">¥{quote?.open?.toFixed(2) || '--'}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-1">最高:</span>
              <span className="text-rose-400">¥{quote?.high?.toFixed(2) || '--'}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-1">总手:</span>
              <span className="text-slate-200">{((quote?.volume || 0) / 10000).toFixed(1)}万</span>
            </div>
            <div>
              <span className="text-slate-500 mr-1">昨收:</span>
              <span className="text-slate-400">¥{quote?.prev_close?.toFixed(2) || '--'}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-1">最低:</span>
              <span className="text-emerald-400">¥{quote?.low?.toFixed(2) || '--'}</span>
            </div>
            <div>
              <span className="text-slate-500 mr-1">成交:</span>
              <span className="text-slate-200">{((quote?.amount || 0) / 100000000).toFixed(2)}亿</span>
            </div>
          </div>

          {/* 紧凑买卖五档 (横向精炼版) */}
          <div className="md:col-span-4 bg-slate-900 border border-slate-800/80 rounded-lg p-1.5 text-[10px] font-mono">
            <div className="grid grid-cols-2 gap-x-2">
              {/* 卖档 */}
              <div className="space-y-0.5">
                {(quote?.ask || []).slice(0, 2).reverse().map((a, i) => (
                  <div key={`ask-${i}`} className="flex justify-between items-center text-emerald-400">
                    <span className="text-slate-500">卖{2 - i}</span>
                    <span>¥{a[0].toFixed(2)}</span>
                    <span className="text-slate-400">{a[1]}手</span>
                  </div>
                ))}
              </div>
              {/* 买档 */}
              <div className="space-y-0.5">
                {(quote?.bid || []).slice(0, 2).map((b, i) => (
                  <div key={`bid-${i}`} className="flex justify-between items-center text-rose-400">
                    <span className="text-slate-500">买{i + 1}</span>
                    <span>¥{b[0].toFixed(2)}</span>
                    <span className="text-slate-400">{b[1]}手</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 紧凑 Tab 切换条 */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/60 px-4 shrink-0">
        <div className="flex -mb-px space-x-1">
          {[
            { id: 'minute', label: '分时走势 (1-min)', icon: Activity },
            { id: 'kline', label: '复权K线', icon: BarChart3 },
            { id: 'ticks', label: '逐笔成交', icon: Clock },
            { id: 'notes', label: '投资逻辑与研报建议', icon: Lightbulb },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id as any);
                  if (tab.id === 'kline') {
                    loadKlineData(stock.code, klinePeriod);
                  }
                }}
                className={`flex items-center space-x-1 py-2 px-3 text-xs font-medium border-b-2 transition ${
                  active
                    ? 'border-blue-500 text-blue-400 font-bold'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* 右侧：若在 K线 tab 则显示 日K / 周K / 月K 切换开关；否则显示提示说明 */}
        {activeTab === 'kline' ? (
          <div className="flex items-center space-x-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 my-1">
            {[
              { id: 'day', label: '日K' },
              { id: 'week', label: '周K' },
              { id: 'month', label: '月K' }
            ].map(p => (
              <button
                key={p.id}
                onClick={() => {
                  const newPeriod = p.id as 'day' | 'week' | 'month';
                  setKlinePeriod(newPeriod);
                  loadKlineData(stock.code, newPeriod);
                }}
                className={`px-2.5 py-0.5 text-[11px] font-medium rounded transition ${
                  klinePeriod === p.id
                    ? 'bg-blue-600 text-white font-bold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 font-mono hidden sm:block">
            {activeTab === 'minute' && '分时均线与成交量实时驱动'}
            {activeTab === 'ticks' && '逐笔撮合明细'}
            {activeTab === 'notes' && '研报要点与风控建议'}
          </div>
        )}
      </div>

      {/* 主展示区 (Chart 尽可能大，占满下部剩余空间) */}
      <div className="flex-1 p-3 overflow-hidden flex flex-col min-h-0">
        {activeTab === 'minute' && (
          <div className="flex-1 flex flex-col min-h-0 h-full">
            <div className="flex-1 min-h-[380px] w-full">
              <MinuteChart points={minutePoints} prevClose={quote?.prev_close || 0} />
            </div>
            <div className="pt-1.5 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
              <span>东财/腾讯双通道秒级分时聚合</span>
              <button
                onClick={() => loadMinuteData(stock.code)}
                disabled={loadingMinute}
                className="text-blue-400 hover:underline"
              >
                {loadingMinute ? '拉取中...' : '刷新分时'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'kline' && (
          <div className="flex-1 flex flex-col min-h-0 h-full">
            <div className="flex-1 min-h-[380px] w-full">
              {loadingKline ? (
                <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                  正在拉取前复权{klinePeriod === 'week' ? '周K' : klinePeriod === 'month' ? '月K' : '日K'}线数据...
                </div>
              ) : (
                <KlineChart data={klines} period={klinePeriod} />
              )}
            </div>
            <div className="pt-1.5 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
              <span>前复权历史走势 (支持日K / 周K / 月K自由切换)</span>
              <button
                onClick={() => loadKlineData(stock.code, klinePeriod)}
                disabled={loadingKline}
                className="text-blue-400 hover:underline"
              >
                {loadingKline ? '拉取中...' : '刷新K线'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'ticks' && (
          <div className="flex-1 overflow-hidden bg-slate-950 border border-slate-800 rounded-xl flex flex-col">
            <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 flex justify-between items-center text-xs text-slate-400 shrink-0">
              <span>逐笔成交明细 (最近 50 笔)</span>
              <span className="flex items-center text-emerald-400 text-[11px]">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />
                秒级成交推流
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-xs font-mono text-left">
                <thead className="text-[11px] text-slate-500 bg-slate-900/80 sticky top-0">
                  <tr>
                    <th className="px-3 py-1.5">时间</th>
                    <th className="px-3 py-1.5">成交价</th>
                    <th className="px-3 py-1.5 text-right">现手</th>
                    <th className="px-3 py-1.5 text-center">盘向</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {ticks.map((t, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/40">
                      <td className="px-3 py-1 text-slate-400">{t.time}</td>
                      <td className="px-3 py-1 font-bold text-slate-100">¥{t.price.toFixed(2)}</td>
                      <td className="px-3 py-1 text-right text-slate-300">{t.volume}</td>
                      <td className="px-3 py-1 text-center">
                        {t.direction === 'B' ? (
                          <span className="text-rose-400 font-bold">买盘</span>
                        ) : t.direction === 'S' ? (
                          <span className="text-emerald-400 font-bold">卖盘</span>
                        ) : (
                          <span className="text-slate-500">中性</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
              <div className="flex items-center space-x-2 text-amber-400 text-xs font-bold">
                <Lightbulb className="w-3.5 h-3.5" />
                <span>核心投资逻辑 (Logic)</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                {stock.logic || '暂无详细记录，建议持续关注其订单释放与估值性价比。'}
              </p>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-1.5">
              <div className="flex items-center space-x-2 text-rose-400 text-xs font-bold">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>风险提示 (Risk Factors)</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed font-sans">
                {stock.risk || '注意市场风格剧烈轮动与行业周期下行风险。'}
              </p>
            </div>

            {note && (
              <div className="bg-blue-950/20 border border-blue-800/40 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center space-x-2 text-blue-400 text-xs font-bold">
                  <FileText className="w-3.5 h-3.5" />
                  <span>补充跟踪建议 (专家跟踪视角)</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div>
                    <span className="text-slate-400 block font-semibold">🔹 操作策略：</span>
                    <p className="text-slate-200">{note.operation_advice}</p>
                  </div>
                  {note.risk_note && (
                    <div>
                      <span className="text-slate-400 block font-semibold">🔹 特别警示：</span>
                      <p className="text-slate-300">{note.risk_note}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
